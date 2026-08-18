# @amiba/cli

`amiba` is the product CLI for the same DSH distribution used by Amiba Web and
Desktop. It also scaffolds and builds independent `dsh-plugin-*` projects. It
does not create Electron WebViews, manifests, registries, or a second Extension
Host.

## Commands

```bash
amiba run "summarize this repository"
amiba web --host 127.0.0.1 --port 14514
amiba doctor

amiba plugin create issue-tracker --id issue-tracker
cd dsh-plugin-issue-tracker
amiba plugin build
amiba plugin dev
amiba plugin pack
```

`run` composes the official DSH base/headless bundles with
`dsh-bundle-amiba-core`. `web` adds the Amiba Web bundle, while Desktop adds
only the native-provider bundle on top. All three surfaces preserve additional
third-party bundles installed into their profile. CLI launches DSH with the
Node binary from `@amiba/app-runtime/dsh-runtime`; it does not execute DSH with the
Node that happened to launch the CLI.

By default the CLI reuses Desktop's DSH home, so DSH settings, credentials,
sessions, and installed profile layers remain one ecosystem. Override the
location with `--dsh-home`, `AMIBA_DSH_HOME`, or `DSH_HOME`.
Override the managed artifact only for development with `--runtime-dir` or
`AMIBA_DSH_RUNTIME_DIR`.

The generated project follows DSH's package contract:

```text
dsh-plugin-issue-tracker/
├── package.json              # DSH Client graph metadata
├── src/
│   ├── index.ts              # Host Cordis plugin
│   └── client/
│       ├── index.tsx         # DSH Client plugin
│       └── styles.css        # contribution-owned styles
├── tsconfig.build.json
└── vite.config.ts            # DSH ModuleLoader client bundle
```

The example Client plugin registers into `amiba.chat.header.after`. Other
Amiba children slots are exported by `@amiba/extension-sdk`. A plugin is loaded
by a DSH bundle or Loader entry; Electron never discovers it directly.

`amiba plugin pack` produces `dsh-plugin.tgz` containing `package.json`, `README.md`,
and the built `lib/` directory. Installation is deliberately not implemented
as an Electron registry operation; it belongs to the DSH Loader/config layer.
