import { expect, test } from "bun:test"
import {
  cooling,
  isContentBlock,
  isThrottle,
  lastSentModel,
  modelFromUrl,
  pickReplacement,
  recordSent,
  resolveOptions,
  rewriteBody,
  rewriteUrl,
  startCooldown,
  trackedSessions,
} from "../index.ts"

const BASE = "https://bedrock-runtime.us-east-1.amazonaws.com"
const url = (model: string) => `${BASE}/model/${encodeURIComponent(model)}/converse-stream`
const T0 = 1_000_000

test("defaults: retry-only until a cascade is configured", () => {
  const opts = resolveOptions()
  expect(opts.providerID).toBe("amazon-bedrock")
  expect(opts.cascade).toEqual([])
  expect(opts.cooldownS).toBe(120)
  expect(opts.sameModelAttempts).toBe(2)
  expect(opts.retryDelayMs).toBe(1500)
  expect([...opts.statuses]).toEqual([429])
  expect(opts.cascadeOnly).toBe(true)
  expect(opts.testCooldown).toEqual([])
  expect(opts.debug).toBe(false)
})

test("options: snake_case keys map over, non-string cascade entries are dropped", () => {
  const opts = resolveOptions({
    provider_id: "acme",
    cascade: ["model-a", 42, null, "model-b"],
    cooldown_s: "30",
    same_model_attempts: 1,
    retry_delay_ms: 10,
    statuses: [429, 503],
    cascade_only: false,
    test_cooldown: ["model-x"],
    debug: true,
  })
  expect(opts.providerID).toBe("acme")
  expect(opts.cascade).toEqual(["model-a", "model-b"])
  expect(opts.cooldownS).toBe(30)
  expect(opts.sameModelAttempts).toBe(1)
  expect(opts.retryDelayMs).toBe(10)
  expect([...opts.statuses]).toEqual([429, 503])
  expect(opts.cascadeOnly).toBe(false)
  expect(opts.testCooldown).toEqual(["model-x"])
  expect(opts.debug).toBe(true)
})

test("modelFromUrl reads and decodes the path segment", () => {
  expect(modelFromUrl(url("vendor.model-a"))).toBe("vendor.model-a")
  expect(modelFromUrl(url("arn:aws:bedrock:us-east-1::foundation-model/x"))).toBe(
    "arn:aws:bedrock:us-east-1::foundation-model/x",
  )
  expect(modelFromUrl(`${BASE}/foundation-models`)).toBeUndefined()
  expect(modelFromUrl(`${BASE}/model/no-trailing-segment`)).toBeUndefined()
})

test("rewriteUrl swaps only the model segment and encodes the replacement", () => {
  expect(rewriteUrl(url("model-a"), "model-b")).toBe(url("model-b"))
  expect(rewriteUrl(`${BASE}/model/model-a/converse-stream?x=1`, "model-b")).toBe(
    `${BASE}/model/model-b/converse-stream?x=1`,
  )
  expect(rewriteUrl(url("model-a"), "a/b")).toBe(`${BASE}/model/a%2Fb/converse-stream`)
  expect(rewriteUrl(`${BASE}/foundation-models`, "model-b")).toBeUndefined()
})

test("rewriteBody replaces a top-level modelId and leaves everything else alone", () => {
  const body = JSON.stringify({ modelId: "model-a", messages: [{ role: "user", content: "hi" }] })
  expect(JSON.parse(rewriteBody(body, "model-b"))).toEqual({
    modelId: "model-b",
    messages: [{ role: "user", content: "hi" }],
  })
  const noModel = JSON.stringify({ messages: [] })
  expect(rewriteBody(noModel, "model-b")).toBe(noModel)
  expect(rewriteBody("not json", "model-b")).toBe("not json")
  expect(rewriteBody("", "model-b")).toBe("")
  expect(rewriteBody("[1,2]", "model-b")).toBe("[1,2]")
})

test("isThrottle: rate-limit type or a configured status", () => {
  const statuses = new Set([429, 503])
  expect(isThrottle({ type: "provider.rate-limit" }, statuses)).toBe(true)
  expect(isThrottle({ type: "provider.error", status: 429 }, statuses)).toBe(true)
  expect(isThrottle({ type: "provider.error", status: 503 }, statuses)).toBe(true)
  expect(isThrottle({ type: "provider.error", status: 500 }, statuses)).toBe(false)
  expect(isThrottle({ type: "provider.error" }, statuses)).toBe(false)
})

test("isContentBlock matches the provider's blocked-response errors only", () => {
  expect(isContentBlock({ type: "provider.blocked" })).toBe(true)
  expect(isContentBlock({ message: "Provider blocked the response" })).toBe(true)
  expect(isContentBlock({ type: "provider.rate-limit", message: "Too many requests" })).toBe(false)
  expect(isContentBlock({})).toBe(false)
})

test("cooldown: a model cools until its deadline, then clears itself", () => {
  const model = "cool.model-a"
  expect(cooling(model, T0)).toBe(false)
  startCooldown(model, T0, 120)
  expect(cooling(model, T0)).toBe(true)
  expect(cooling(model, T0 + 119_999)).toBe(true)
  expect(cooling(model, T0 + 120_000)).toBe(false)
  // Expiry removes the entry: an earlier timestamp no longer sees it either.
  expect(cooling(model, T0)).toBe(false)
})

test("pickReplacement skips the current model and every cooling one, in cascade order", () => {
  const cascade = ["pick.a", "pick.b", "pick.c"]
  expect(pickReplacement(cascade, "pick.a", T0)).toBe("pick.b")
  expect(pickReplacement(cascade, "pick.b", T0)).toBe("pick.a")
  startCooldown("pick.a", T0, 60)
  startCooldown("pick.b", T0, 60)
  expect(pickReplacement(cascade, "pick.a", T0)).toBe("pick.c")
  expect(pickReplacement(cascade, "pick.c", T0)).toBeUndefined()
  // After the cooldowns lapse the first cascade model wins again.
  expect(pickReplacement(cascade, "pick.c", T0 + 60_000)).toBe("pick.a")
  expect(pickReplacement([], "pick.a", T0)).toBeUndefined()
})

test("lastSent: remembers the model actually sent per session", () => {
  expect(lastSentModel("ses_none")).toBeUndefined()
  recordSent("ses_1", "sent.a", T0)
  expect(lastSentModel("ses_1")).toBe("sent.a")
  recordSent("ses_1", "sent.b", T0 + 1)
  expect(lastSentModel("ses_1")).toBe("sent.b")
})

test("lastSent: evicts the least recently used session at the cap", () => {
  const before = trackedSessions()
  for (let i = 0; i < 600; i++) recordSent(`ses_evict_${i}`, "evict.model", T0 + i)
  expect(trackedSessions()).toBeLessThanOrEqual(500)
  expect(trackedSessions()).toBeGreaterThanOrEqual(Math.min(before, 500))
  expect(lastSentModel("ses_evict_0")).toBeUndefined()
  expect(lastSentModel("ses_evict_599")).toBe("evict.model")
})
