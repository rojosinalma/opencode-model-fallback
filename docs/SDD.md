# Software design document

## Purpose

Provider rate limits end a turn with an error the model never gets to recover from. This plugin
turns a throttled request into a retry and, after repeated throttling on one model, routes the
retries to another model for a short while — without touching the session's configured model, its
history or what the UI shows. The whole mechanism lives in one file, `index.ts`, and has no runtime
dependencies.

## Architecture

Two OpenCode session hooks, one shared state:

| component | where | role |
|---|---|---|
| `resolveOptions` | `index.ts` | maps the snake_case `options` of the `plugins[]` entry to typed `Options` with defaults |
| retry hook | `ctx.session.hook("retry", …)` | classifies the error, forces a retry, starts a cooldown after `same_model_attempts` failures on one model |
| request hook | `ctx.session.hook("http.request", …, { providerID })` | rewrites the URL path and body `modelId` of a request whose model is cooling |
| `cooldowns` | module-level `Map<model, untilMs>` | which models are throttled and until when |
| `lastSent` | module-level `Map<sessionID, {model, at}>` | the model id actually sent per session, so a failure on an already-swapped request cools the fallback, not the configured model |

Both maps are module-level on purpose: OpenCode boots plugins per location, and every location
loaded in one server process must share the same view of which models are throttled.

The hooks talk only through those maps. The retry hook writes cooldowns and reads `lastSent`; the
request hook reads cooldowns, writes `lastSent` and rewrites the request.

## Data model / storage

Nothing is persisted. The state is in memory and is lost on a server restart, which is the intended
lifetime of a cooldown anyway.

- `cooldowns`: model id → epoch milliseconds when the cooldown ends. Entries are removed lazily by
  `cooling()` the first time they are read after expiry.
- `lastSent`: session id → `{ model, at }`. Capped at `MAX_TRACKED_SESSIONS` (500); when full, the
  least recently written entry is evicted before a new session is added.

## Key flows

### Throttling

1. The provider answers 429 (or an error with `type: "provider.rate-limit"`, or a status listed in
   `statuses`). OpenCode emits a `retry` event with `model`, `error`, `attempt` and `sessionID`.
2. The hook ignores events for a different `providerID`.
3. `actual` = the model last sent for that session (`lastSent`), falling back to the event's model.
4. If `attempt >= same_model_attempts`, `actual` is put in cooldown for `cooldown_s`
   (`startCooldown`) and a `throttled:` line is logged.
5. The decision is `{ retry: true, delay }`: `retry_delay_ms` when `actual` is cooling *and* a
   cascade model is available (a swap will happen on the next request), otherwise exponential backoff
   `min(2^attempt s, 15 s)`.

### Swapping

1. Every request to the provider passes the `http.request` hook. `modelFromUrl` extracts the model id
   from `/model/<id>/…`; requests without that path segment are left alone.
2. The id is recorded as the session's last sent model.
3. If the model is not cooling, or `cascade_only` is on and the model is not in `cascade`, the request
   goes through unchanged.
4. `pickReplacement` returns the first cascade model that is neither the current one nor cooling. With
   none available, the request is sent unchanged (a debug line explains why).
5. `rewriteUrl` swaps the path segment (URL-encoded); `rewriteBody` replaces the top-level `modelId`
   of the JSON body, passing non-JSON bodies through. A new `Request` with the same method and
   headers replaces `event.request`.
6. The replacement is recorded as the session's last sent model and a `swap:` line is logged.

### Blocked responses

The provider's content filter intermittently kills a stream with "Provider blocked the response"
(`isContentBlock`). This is not throttling: the hook forces up to three retries after
`retry_delay_ms`, with no cooldown and no swap.

### Verification at load

`test_cooldown` lists model ids to put in cooldown the moment the plugin loads, so a cascade can be
exercised end to end without waiting for a real 429.

## Configuration surface

All options are read once in `setup()` from `ctx.options` through `resolveOptions`; see
`configuration.md` for the keys, defaults and meaning. The cascade is deliberately empty by
default: a fresh install only forces retries until model ids are configured.

## Decisions and rationale

- **Wire-only swap.** OpenCode's model selection, message history and cost attribution are not
  touched. Changing them mid-turn would mean rewriting session state from a hook; rewriting the
  request keeps the plugin self-contained and reversible (the cooldown lapses and the original model
  is used again).
- **Path and body rewrite, bearer auth only.** The rewrite is safe only when the request is not
  signed over its URL and body. Bedrock's bearer-token API is the reference target; signed providers
  are out of the swap path (keep `cascade` empty for them).
- **Cooldown after N attempts, not on the first 429.** A single 429 is usually transient; a cooldown
  on the first one would swap models too eagerly. `same_model_attempts` tunes this.
- **`lastSent` instead of the event's model.** The `retry` event carries the session's configured
  model. When the failing request was already swapped, cooling the configured model would be wrong —
  the fallback is the one that was throttled.
- **`cascade_only` on by default.** OpenCode's small model (titles, summaries) shares the provider;
  without the filter a throttled small model would be upgraded to the first cascade entry, which is
  typically the most expensive one.
- **Module-level state.** Shared across locations in one server process (see Architecture); bounded
  (`MAX_TRACKED_SESSIONS`, lazy cooldown expiry) so a long-lived server never grows it unbounded.
- **Type-only dependency.** `@opencode/plugin` is imported with `import type`, so the plugin runs
  from a bare clone with no `node_modules`.

## Current scope and non-goals

- One provider per plugin instance (`provider_id`); the model id is taken from the URL path shape
  `/model/<id>/…` and the body key `modelId`.
- Cooldowns are per process and in memory; they are not shared between servers or persisted.
- The plugin does not change which model OpenCode believes answered. Attribution of a swapped
  response in the UI or in cost reports stays with the configured model.

## Operations

- **Logs.** Everything goes to the server's standard error with the `[model-fallback]` prefix; the
  line catalogue is in `troubleshooting.md`. `debug: true` adds forced retries and skipped swaps.
- **Health.** There is no endpoint; a working install shows a `swap:` line after a `throttled:` line.
  `test_cooldown` forces that sequence on demand.
- **Upgrade.** `git pull` in the plugin directory and restart the OpenCode server: plugins are
  loaded per location boot, so running locations keep the old code until then.
- **Tests.** `bun test` runs the suite in `test/`, which covers the pure helpers (URL and body
  rewrite, cascade selection, cooldown and `lastSent` bookkeeping, option parsing, error
  classification). The hooks themselves are exercised against a live server with `test_cooldown`.
