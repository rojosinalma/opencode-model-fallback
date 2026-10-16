# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-16

### Changed

- Licence to AGPL-3.0 (was MIT).
- The default `cascade` is empty: without one the plugin only forces retries on throttling and never
  rewrites a request. Set the model ids in the `plugins[]` entry to enable swaps.
- `@opencode/plugin` pinned to an exact version.

### Added

- `bun test` suite for the exported pure helpers (option resolution, URL and body rewrite, cascade
  selection, cooldown and last-sent bookkeeping, error classification), run in CI on every push and
  pull request (`run-tests.yml`).
- `docs/configuration.md`, `docs/SDD.md`, `docs/troubleshooting.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, Dependabot.

## [0.1.0] - 2026-10-15

### Added

- `retry` hook: forces a retry on throttling (HTTP 429 or `provider.rate-limit`), with exponential
  backoff, and on the provider's intermittent "blocked the response" errors; after
  `same_model_attempts` failures the model goes into a global cooldown.
- `http.request` hook: while a model is cooling, rewrites the URL path and body `modelId` of its
  requests to the first available cascade model, skipping the current model and any model that is
  cooling itself.
- Options `provider_id`, `cascade`, `cooldown_s`, `same_model_attempts`, `retry_delay_ms`,
  `statuses`, `cascade_only`, `test_cooldown`, `debug`.

[Unreleased]: https://github.com/rojosinalma/opencode-model-fallback/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/rojosinalma/opencode-model-fallback/releases/tag/v0.2.0
[0.1.0]: https://github.com/rojosinalma/opencode-model-fallback/compare/60f2c5c...555226e
