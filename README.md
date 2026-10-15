# opencode-model-fallback

An [OpenCode](https://opencode.ai) plugin that keeps a turn alive when the provider throttles the
session's model. A 429 forces a retry; after a few failures on the same model that model goes into a
short global cooldown, and while it lasts every outgoing request for it is transparently rewritten —
URL path and body `modelId` — to the first available model in a configured cascade. The session's
configured model, its history and the UI are untouched: the swap exists only on the wire and in the
log. Built for Bedrock-style routes where the model id sits in the URL (`/model/<id>/converse-stream`)
and auth is a bearer token, so a path rewrite is safe.

## Install

Clone into the global plugins directory; it is auto-discovered. Without a `cascade` it only forces retries on throttling and never swaps models:

```sh
git clone https://github.com/rojosinalma/opencode-model-fallback ~/.config/opencode/plugins/model-fallback
```

To set the cascade and other options, reference **that same path** from `opencode.jsonc` — never a second copy, or two
instances will both rewrite requests:

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/model-fallback",
      "options": {
        "provider_id": "amazon-bedrock",
        "cascade": ["<model-a>", "<model-b>", "<model-c>"],
        "cooldown_s": 120
      }
    }
  ]
}
```

No runtime dependencies (`@opencode/plugin` is imported as types only).

## Options

| key | default | meaning |
|---|---|---|
| `provider_id` | `amazon-bedrock` | provider whose requests are inspected |
| `cascade` | `[]` (retry only, no swap) | ordered model ids to fall back through; the one the request is already on is skipped |
| `cooldown_s` | `120` | how long a throttled model stays swapped out |
| `same_model_attempts` | `2` | 429s on one model before it is put in cooldown |
| `retry_delay_ms` | `1500` | delay forced on the retry |
| `statuses` | `[429]` | HTTP statuses treated as throttling |
| `cascade_only` | `true` | only swap models listed in `cascade` (keeps small-model traffic such as titles from being upgraded) |
| `test_cooldown` | `[]` | model ids to put in cooldown at load, for verification |
| `debug` | `false` | verbose logging |

## How it works

1. `session.hook("retry")` catches `provider.rate-limit` errors, forces a retry and counts attempts per model.
2. `session.hook("http.request")` rewrites the URL path and body `modelId` of any request for a cooling model to the first non-cooling cascade model.
3. Swaps are logged as `[model-fallback] swap: …`.

## Caveats

- Wire-only: cost accounting and the UI stay attributed to the configured model.
- With an empty `cascade` nothing is ever rewritten; the retry hook still runs.
- Loaded per location boot; running locations keep the plugin set they started with.
