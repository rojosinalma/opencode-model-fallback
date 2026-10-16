# opencode-model-fallback

An [OpenCode](https://opencode.ai) plugin that keeps a turn alive when the provider throttles the
session's model. A 429 forces a retry; after a few failures on the same model that model goes into a
short global cooldown, and while it lasts every outgoing request for it is transparently rewritten —
URL path and body `modelId` — to the first available model in a configured cascade. The session's
configured model, its history and the UI are untouched: the swap exists only on the wire and in the
log. Configuration, design and troubleshooting are documented in `docs/`.

## Requirements

- OpenCode 2.x running on Bun (the plugin uses the `session.hook("retry")` and
  `session.hook("http.request")` hooks).
- A provider whose requests carry the model id in the URL path (`/model/<id>/…`) and in the body
  `modelId`, and that authenticates with a bearer token rather than request signing, so a path
  rewrite is safe. Amazon Bedrock's `converse-stream` API is the reference target.
- No runtime dependencies: `@opencode/plugin` is imported as types only.

## Setup

Clone into the global plugins directory; it is auto-discovered. Without a `cascade` it only forces
retries on throttling and never swaps models:

```sh
git clone https://github.com/rojosinalma/opencode-model-fallback ~/.config/opencode/plugins/model-fallback
```

To set the cascade and other options, reference **that same path** from `opencode.jsonc` — never a
second copy, or two instances will both rewrite requests:

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

All options are listed in [docs/configuration.md](docs/configuration.md).

## License

MIT — see [LICENSE](LICENSE).
