# Troubleshooting

## Nothing is ever swapped

- `cascade` is empty (the default). Without it the plugin only forces retries; set the model ids in
  the `plugins[]` entry (see `configuration.md`).
- The throttled model is not in `cascade` and `cascade_only` is on. Either add it to the cascade or
  set `cascade_only: false`.
- Fewer than `same_model_attempts` throttling failures have hit that model yet; the cooldown starts
  only at that count. Lower the number if you want a faster swap.
- Every other cascade model is cooling as well. With `debug: true` the log says
  `<model> is cooling but no cascade model is available; leaving request untouched`.
- The plugin loaded before you changed the config. Plugins are loaded per location boot; a running
  location keeps the plugin set and options it started with until the server restarts.

## The provider is not the configured one

Both hooks filter on `provider_id` (default `amazon-bedrock`). Events for other providers are
ignored, so a throttled model on a different provider rides the normal retry path. Set `provider_id`
to the provider id as it appears in OpenCode's provider list.

## Cost and UI still show the configured model

Expected. The swap is wire-only: OpenCode never learns that a different model answered, so the
session's model, the per-message model in the database and any cost accounting stay attributed to
the configured model. The server log is the only record of a swap
(`[model-fallback] swap: <from> -> <to> (session <id>, kind <request kind>)`).

## Two swaps for one request, or doubled log lines

Two instances of the plugin are loaded: a directory under `~/.config/opencode/plugins/` is
auto-discovered, and a `plugins[]` entry pointing at a *different* path to the same code loads it a
second time. Reference the discovered path (`./plugins/model-fallback`) in the entry, never a second
clone.

## A request fails with a signature or auth error after a swap

The rewrite changes the URL path and body of a request that was already prepared. That is safe only
for providers that authenticate with a bearer token; a provider that signs the request (SigV4 and the
like) rejects the modified request. Use a bearer-token credential for the provider, or leave the
cascade empty so the plugin only retries.

## "Blocked the response" errors

The provider's content filter intermittently kills a stream with "Provider blocked the response".
The plugin retries such a turn up to three times after `retry_delay_ms`, without a cooldown or a
swap, and logs `content-block retry for <session>: attempt <n>`. If all three fail the turn ends
with the provider's error as usual.

## Reading the log

The plugin writes to the server's standard error with the `[model-fallback]` prefix. Lines:

| line | meaning |
|---|---|
| `test_cooldown: <model> cooling for <n>s` | `test_cooldown` applied at load |
| `throttled: <model> cooling for <n>s (session …, attempt …)` | a model reached `same_model_attempts` and entered cooldown |
| `swap: <from> -> <to> (session …, kind …)` | a request was rewritten |
| `content-block retry for <session>: attempt <n>` | a blocked-response error was retried |
| `retry forced for <session>: attempt <n>, delay <ms>ms` | (debug) a throttling error was retried |
| `<model> is cooling but no cascade model is available; …` | (debug) nothing left to swap to |
