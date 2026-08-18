# @amiba/dsh-plugin-browser-core

Provider-neutral browser capability for Amiba's DSH runtime.

- Owns the eight model-facing browser tool names, schemas, rendering and provenance.
- Provides `ctx.amibaBrowser`, a provider registry with deterministic priority.
- Registers tools only while at least one browser provider is live.
- Knows nothing about Electron, CDP, WebViews or an operating-system process.

Execution is supplied by independent `dsh-plugin-browser-provider-*` packages.
