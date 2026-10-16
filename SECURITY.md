# Security policy

## Supported versions

The latest release receives security fixes. Older releases are not patched; upgrade to the current
release before reporting.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting:
[Security → Report a vulnerability](https://github.com/rojosinalma/opencode-model-fallback/security/advisories/new).
Never open a public issue for a security problem.

Include what you found, how to reproduce it and the version affected. You get an acknowledgement
within a few days and a fix or a mitigation as soon as one exists; the advisory is published once a
fixed release is out.

## Scope

The plugin runs inside the OpenCode server process and rewrites outgoing provider requests. Issues
of interest: a rewrite that leaks or alters anything other than the model id, a way for a malicious
configuration or response to escape the configured `provider_id`/`cascade`, and anything that
crashes the server or loses a turn.
