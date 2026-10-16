# Contributing

## Running it locally

The plugin is a single Bun/TypeScript file with no runtime dependencies, loaded by an OpenCode 2.x
server.

1. Clone it where OpenCode discovers plugins:
   ```sh
   git clone https://github.com/rojosinalma/opencode-model-fallback ~/.config/opencode/plugins/model-fallback
   ```
2. Add a `plugins[]` entry in `opencode.jsonc` with a `cascade` (see `docs/configuration.md`). Use
   the discovered path `./plugins/model-fallback` as `package`, never a second copy.
3. Restart the OpenCode server (plugins load per location boot) and watch its log for
   `[model-fallback]` lines. `test_cooldown` forces a swap without waiting for a real 429;
   `debug: true` logs every forced retry.

## Tests

```sh
bun install --frozen-lockfile   # only for the @opencode/plugin types
bun test
```

The suite in `test/model-fallback.test.ts` covers the pure helpers that `index.ts` exports: option
parsing, URL and body rewrite, cascade selection, cooldown and last-sent bookkeeping, error
classification. The hooks themselves are verified against a live server (step 3 above).
`.github/workflows/run-tests.yml` runs the same suite on every push and pull request.

## Code style and layout

- `index.ts` holds everything: option resolution, the pure helpers (exported so they can be tested),
  the module-level state and the plugin object with its two hooks.
- Keep the hooks thin; new logic goes into an exported pure function with a test.
- Behaviour must not change for an existing configuration: defaults stay as they are and new options
  are opt-in.
- Two-space indentation, no semicolons, double quotes — match the existing file.

## Commits and PRs

- Plain, descriptive commit messages in the imperative ("Skip cooling models when picking a
  replacement"). No attribution trailers.
- Every commit is GPG-signed (`git config commit.gpgsign true`); unsigned commits are not merged.
- One logical change per commit; a PR explains the behaviour change and names the option it adds or
  alters.
- Run `bun test` before pushing.

## Documentation

- `README.md` — what it is, requirements, installation, usage, development, licence. Nothing else
  goes there.
- `CHANGELOG.md` — Keep a Changelog; every behaviour or option change gets a line under
  `[Unreleased]`.
- `SECURITY.md` — how to report a vulnerability; `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1.
- `docs/configuration.md` — every option, its default and meaning; how to choose a cascade.
- `docs/SDD.md` — design: hooks, data flow, state, decisions and rationale, operations.
- `docs/troubleshooting.md` — symptoms, causes and the log line catalogue.

A change in behaviour updates the matching doc in the same commit.

## Releasing

Bump `version` in `package.json`, move the `[Unreleased]` changelog entries under a dated section,
commit, create a signed tag `vX.Y.Z` and a GitHub release whose notes are that changelog section.
