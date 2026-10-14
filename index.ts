// Type-only import: Bun resolves bare specifiers from the symlink's real path, where no node_modules exists.
import type { Plugin } from "@opencode/plugin"

// Keeps a turn alive when the provider throttles the session's model: a 429 puts that
// model into a short global cooldown and forces a retry; while the cooldown lasts, every
// outgoing request for a cooled model is transparently rewritten (URL + body modelId) to
// the first available model in the configured cascade, skipping the model the request was
// already on. The session's configured model, history and UI are untouched — the swap
// exists only on the wire and in the journal log.
//
// Scope: Bedrock-style routes where the model id sits in the URL path
// (`/model/<id>/converse-stream`) and auth is a bearer token (no request signing), so a
// path rewrite is safe. Only models listed in `cascade` are swapped (`cascade_only`), so
// small_model traffic (titles, summaries) rides the normal retry instead of being
// upgraded to an expensive model.

export type Options = {
  providerID: string
  cascade: string[]
  cooldownS: number
  sameModelAttempts: number
  retryDelayMs: number
  statuses: Set<number>
  cascadeOnly: boolean
  testCooldown: string[]
  debug: boolean
}

export function resolveOptions(raw: Readonly<Record<string, any>> = {}): Options {
  return {
    providerID: String(raw.provider_id ?? "amazon-bedrock"),
    cascade: (raw.cascade as string[] | undefined) ?? [
      "global.anthropic.claude-fable-5-1",
      "global.anthropic.claude-fable-5",
      "global.anthropic.claude-opus-5-5",
      "global.anthropic.claude-opus-5",
    ],
    cooldownS: Number(raw.cooldown_s ?? 120),
    sameModelAttempts: Number(raw.same_model_attempts ?? 2),
    retryDelayMs: Number(raw.retry_delay_ms ?? 1500),
    statuses: new Set((raw.statuses as number[] | undefined) ?? [429]),
    cascadeOnly: raw.cascade_only !== false,
    testCooldown: (raw.test_cooldown as string[] | undefined) ?? [],
    debug: raw.debug === true,
  }
}

// Module-level so every location loaded in this server process shares one view of
// which models are throttled.
const cooldowns = new Map<string, number>()

// Last model id actually sent per session, so a failure on an already-swapped request
// cools the fallback model rather than the configured one. Bounded, lazily swept.
const MAX_TRACKED_SESSIONS = 500
const lastSent = new Map<string, { model: string; at: number }>()

function recordSent(sessionID: string, model: string, now: number): void {
  if (lastSent.size >= MAX_TRACKED_SESSIONS && !lastSent.has(sessionID)) {
    let oldestKey: string | undefined
    let oldestAt = Infinity
    for (const [key, value] of lastSent) {
      if (value.at < oldestAt) {
        oldestAt = value.at
        oldestKey = key
      }
    }
    if (oldestKey) lastSent.delete(oldestKey)
  }
  lastSent.set(sessionID, { model, at: now })
}

export function cooling(model: string, now: number): boolean {
  const until = cooldowns.get(model)
  if (until === undefined) return false
  if (now >= until) {
    cooldowns.delete(model)
    return false
  }
  return true
}

export function pickReplacement(cascade: string[], current: string, now: number): string | undefined {
  return cascade.find((model) => model !== current && !cooling(model, now))
}

export function isThrottle(error: { type: string; status?: number }, statuses: Set<number>): boolean {
  if (error.type === "provider.rate-limit") return true
  return error.status !== undefined && statuses.has(error.status)
}

// Bedrock's content filter intermittently kills a stream with "Provider blocked
// the response"; a plain retry of the same request usually passes. Distinct from
// throttling: no cooldown, no model swap — just retry a few times.
export function isContentBlock(error: { type?: string; message?: string }): boolean {
  const text = `${error.type ?? ""} ${error.message ?? ""}`.toLowerCase()
  return text.includes("blocked the response") || text.includes("provider.blocked")
}

const MODEL_PATH = /(\/model\/)([^/]+)(\/)/

export function rewriteUrl(url: string, replacement: string): string | undefined {
  const match = MODEL_PATH.exec(url)
  if (!match) return undefined
  return url.replace(MODEL_PATH, `$1${encodeURIComponent(replacement)}$3`)
}

export function modelFromUrl(url: string): string | undefined {
  const match = MODEL_PATH.exec(url)
  return match ? decodeURIComponent(match[2]) : undefined
}

const plugin: Plugin.Plugin = {
  id: "model-fallback",
  async setup(ctx) {
    const opts = resolveOptions(ctx.options)
    const log = (msg: string) => console.error(`[model-fallback] ${msg}`)
    const debug = (msg: string) => opts.debug && log(msg)

    for (const model of opts.testCooldown) {
      cooldowns.set(model, Date.now() + opts.cooldownS * 1000)
      log(`test_cooldown: ${model} cooling for ${opts.cooldownS}s`)
    }

    await ctx.session.hook("retry", (event) => {
      if (event.model.providerID !== opts.providerID) return
      if (isContentBlock(event.error) && !isThrottle(event.error, opts.statuses)) {
        if (event.attempt <= 3) {
          event.decision = { retry: true, delay: opts.retryDelayMs }
          log(`content-block retry for ${event.sessionID}: attempt ${event.attempt}`)
        }
        return
      }
      if (!isThrottle(event.error, opts.statuses)) return
      const now = Date.now()
      const actual = lastSent.get(event.sessionID)?.model ?? event.model.id
      if (event.attempt >= opts.sameModelAttempts) {
        cooldowns.set(actual, now + opts.cooldownS * 1000)
        log(`throttled: ${actual} cooling for ${opts.cooldownS}s (session ${event.sessionID}, attempt ${event.attempt})`)
      }
      const fallbackReady = pickReplacement(opts.cascade, actual, now) !== undefined
      const delay = cooling(actual, now) && fallbackReady
        ? opts.retryDelayMs
        : Math.min(2 ** event.attempt * 1000, 15000)
      event.decision = { retry: true, delay }
      debug(`retry forced for ${event.sessionID}: attempt ${event.attempt}, delay ${delay}ms`)
    })

    await ctx.session.hook(
      "http.request",
      async (event) => {
        const now = Date.now()
        const url = event.request.url
        const current = modelFromUrl(url)
        if (!current) return
        recordSent(event.sessionID, current, now)
        if (!cooling(current, now)) return
        if (opts.cascadeOnly && !opts.cascade.includes(current)) return
        const replacement = pickReplacement(opts.cascade, current, now)
        if (!replacement) {
          debug(`${current} is cooling but no cascade model is available; leaving request untouched`)
          return
        }
        const newUrl = rewriteUrl(url, replacement)
        if (!newUrl) return
        let body: string | undefined
        try {
          body = await event.request.text()
          const parsed = JSON.parse(body)
          if (parsed && typeof parsed === "object" && "modelId" in parsed) {
            parsed.modelId = replacement
            body = JSON.stringify(parsed)
          }
        } catch {
          // Non-JSON or unreadable body: send it through unchanged.
        }
        event.request = new Request(newUrl, {
          method: event.request.method,
          headers: event.request.headers,
          body,
        })
        recordSent(event.sessionID, replacement, now)
        log(`swap: ${current} -> ${replacement} (session ${event.sessionID}, kind ${event.kind})`)
      },
      { providerID: opts.providerID },
    )
  },
}

export default plugin
