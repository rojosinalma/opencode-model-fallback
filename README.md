# opencode-model-fallback

[![run-tests](https://github.com/rojosinalma/opencode-model-fallback/actions/workflows/run-tests.yml/badge.svg)](https://github.com/rojosinalma/opencode-model-fallback/actions/workflows/run-tests.yml)
[![release](https://img.shields.io/github/v/release/rojosinalma/opencode-model-fallback)](https://github.com/rojosinalma/opencode-model-fallback/releases)
[![license](https://img.shields.io/github/license/rojosinalma/opencode-model-fallback)](LICENSE)

An [OpenCode](https://opencode.ai) plugin that keeps a turn alive when the provider throttles the
session's model. A 429 forces a retry; after a few failures on the same model that model goes into a
short global cooldown, and while it lasts every outgoing request for it is transparently rewritten —
URL path and body `modelId` — to the first available model in a configured cascade. The session's
configured model, its history and the UI are untouched: the swap exists only on the wire and in the
log. Configuration, design and troubleshooting are documented in `docs/`.

## Requirements

- [OpenCode](https://opencode.ai) ≥ 2.0 (the plugin uses the `session.hook("retry")` and
  `session.hook("http.request")` hooks).
- [Bun](https://bun.sh) ≥ 1.4, the runtime OpenCode loads plugins with.
- A provider whose requests carry the model id in the URL path (`/model/<id>/…`) and in the body
  `modelId`, and that authenticates with a bearer token rather than request signing, so a path
  rewrite is safe. Amazon Bedrock's `converse-stream` API is the reference target.
- No runtime dependencies: `@opencode/plugin` is imported as types only.

## Installation

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

## Usage

Nothing to do once loaded: a throttled turn keeps going instead of ending with a rate-limit error.
The server log shows what happened — `[model-fallback] swap: <from> -> <to>` when a request was
rewritten to a cascade model, and (with `debug: true`) every forced retry. The key option is
`cascade`: an ordered list of model ids, most-preferred first; the model a request is already on and
any model currently cooling are skipped. To see a swap without waiting for a real 429, set
`test_cooldown` to your usual model ids and send a prompt (see
[docs/configuration.md](docs/configuration.md#verifying-a-cascade)).

## Development

```sh
bun install   # @opencode/plugin types only
bun test
```

The suite covers the pure helpers exported by `index.ts`; the hooks are verified against a running
OpenCode server as described in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

AGPL-3.0 — see [LICENSE](LICENSE). Copyright (C) 2026 rojosinalma.
