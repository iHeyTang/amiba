# Plugin distribution

The host and every built-in plugin have separate dependency manifests and npm locks. Built-in means preinstalled; it does not transfer dependency ownership to the host.

- `packages/app-runtime/host-dependencies.json` is the explicit host interface/package inventory. Additions require an architectural reason. Business SDKs do not belong here.
- `plugins/<plugin>/package.json` owns that plugin's private dependencies. Shared DSH/React interfaces and required plugins are peer contracts.
- `plugins/<plugin>/distribution/default/` contains the generated, reproducible installation manifest and lock. A target directory exists only when that plugin declares target overrides.
- `amiba.distribution.overrides` and `amiba.distribution.targets` belong to the plugin that needs them (for example MemOS's Intel ONNX binding).

Run `pnpm runtime:lock` after manifest changes. To update only one plugin, run `node packages/app-runtime/scripts/dsh-runtime/prepare.mjs --update-lock --plugin=dsh-plugin-pets`. For a target override add `--lock-target=darwin-x64`. Commit the generated manifest and lock. Normal builds use `npm ci` and reject stale manifests, incompatible host peers and local development sources.

Each plugin is installed in its own `app/node_modules/@amiba/<plugin>/node_modules` tree. npm first validates and installs its locked graph, including platform-specific native scripts. Artifact assembly retains the graph reachable from private dependencies and removes compatible host interface copies and unrelated installation packages. Shared interfaces resolve to the parent host. Different private package versions remain independent. A standalone embedded application may retain its own incompatible React version; it must not use that instance to render into the host's React tree.

Client-only libraries already bundled by Vite must be reviewed before removing runtime dependencies: modules, subprocess entry points, workers, static files and dynamically resolved packages may still need their original package files. Dependency relocation alone does not justify deleting any of them.

The emitted plugin package includes compiled code, declared resources, its private dependency tree, a portable manifest and its installation lock. The existing DSH loader resolves it at the standard package location. Runtime staging is verified before replacing the previous runtime; failed assembly leaves the previous runtime available. User data remains outside plugin artifacts.

This change establishes dependency and artifact boundaries for preinstalled plugins. A user-facing independent plugin update/download/rollback service is a separate layer; copying a directory or removing dependencies is not a substitute for that lifecycle service. Dependency separation is not a security sandbox.
