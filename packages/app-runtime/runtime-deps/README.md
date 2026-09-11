# Distribution dependencies

This npm manifest and lockfile describe the standalone Amiba runtime. They are
separate from the repository's pnpm workspace lockfile because the distribution
installs registry dependencies before copying the built Amiba plugins.

`pnpm runtime:prepare` validates the manifest against the enabled bundles and
plugins, then installs with `npm ci`. The lockfile is part of the runtime cache
fingerprint. A dependency change must not silently reuse a different resolved tree.

After changing plugin dependencies, the DSH version or runtime overrides, run
`pnpm runtime:lock` from the repository root and commit both JSON files here.
This refreshes the generated manifest and updates the existing lock without
building plugins or running dependency lifecycle scripts. Then validate with
`pnpm runtime:prepare` and `pnpm runtime:smoke`.

Do not remove the lockfile or use `--legacy-peer-deps`: DSH relies on installed
peer dependencies to boot. Local paths and workspace symlinks are rejected from
the distribution lockfile.
