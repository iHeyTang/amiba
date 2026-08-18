# @amiba/app-runtime

Shared application-domain code used by Amiba's Electron renderer and main
process. Its public subpaths cover core state, platform contracts, protocol,
the DSH client, DSH distribution composition, the harness-independent Model
Plane, its DSH adapter, and pure utilities.

Plugin loading, model tools, MCP providers, schedules, skills, memory, and UI
slot lifecycle are not implemented here. Those capabilities live in separate
`dsh-plugin-*` packages and are composed by the independent
`@amiba/dsh-bundle-amiba-core`, `-web`, and `-desktop` layers.

There is intentionally no Extension Host, Managed Extensions runtime, WebView
bridge, or MCP subprocess host in this package.

`dsh-distribution` contains the Core/Web/Desktop profile contract.
`dsh-runtime` owns the matching pinned Node/DSH artifact, preparation,
verification, profile lifecycle, and application packaging paths. They remain
separate submodules so browser consumers do not load Node code, but both belong
to this package.
