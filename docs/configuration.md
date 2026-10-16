# Configuration

Options go in the plugin's `plugins[]` entry in `opencode.jsonc`, under `options`. Every key is
optional; the defaults below apply when a key is missing. The `package` path must be the directory
the plugin is discovered from (`./plugins/model-fallback` for a clone under
`~/.config/opencode/plugins/`) — a different path to the same code loads a second instance that
rewrites requests too.

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/model-fallback",
      "options": {
        "provider_id": "amazon-bedrock",
        "cascade": ["<model-a>", "<model-b>", "<model-c>"],
        "cooldown_s": 120,
        "same_model_attempts": 2,
        "retry_delay_ms": 1500,
        "statuses": [429],
        "cascade_only": true,
        "test_cooldown": [],
        "debug": false
      }
    }
  ]
}
```

## Options

| key | default | meaning |
|---|---|---|
| `provider_id` | `amazon-bedrock` | provider whose requests are inspected; events for other providers are ignored |
| `cascade` | `[]` (retry only, no swap) | ordered model ids to fall back through; the one the request is already on is skipped, as is any model currently cooling |
| `cooldown_s` | `120` | how long a throttled model stays swapped out |
| `same_model_attempts` | `2` | throttling failures on one model before it is put in cooldown |
| `retry_delay_ms` | `1500` | delay forced on the retry once a fallback is ready (and on content-block retries) |
| `statuses` | `[429]` | HTTP statuses treated as throttling, in addition to the `provider.rate-limit` error type |
| `cascade_only` | `true` | only swap models listed in `cascade`; keeps small-model traffic such as titles and summaries from being upgraded to an expensive model |
| `test_cooldown` | `[]` | model ids to put in cooldown the moment the plugin loads, for verifying a cascade end to end |
| `debug` | `false` | log forced retries and skipped swaps, not only the swaps themselves |

## Choosing a cascade

- List the models most-preferred first. The request's current model is always skipped, so the first
  entry is the fallback for every other model and the second entry is the fallback for the first.
- Use the exact model ids the provider expects in the URL (for Bedrock, the inference-profile or
  model id, e.g. `global.anthropic.<model>`); the same string goes into the body `modelId`.
- Keep `cascade_only` on unless every model the provider serves should be eligible for a swap.

## Retry behaviour without a cascade

With `cascade` empty the `http.request` hook never rewrites anything. The `retry` hook still runs:
throttling errors are retried with exponential backoff (`2^attempt` seconds, capped at 15 s), and the
provider's intermittent "blocked the response" errors are retried up to three times after
`retry_delay_ms`.

## Verifying a cascade

Set `test_cooldown` to the model ids a session would normally use, restart the server (plugins load
per location boot) and send a prompt. The server log shows `[model-fallback] test_cooldown: … cooling`
at load and `[model-fallback] swap: <from> -> <to>` on the first request. Remove `test_cooldown`
afterwards.
