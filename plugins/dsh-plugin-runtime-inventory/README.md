# @amiba/dsh-plugin-runtime-inventory

Amiba presentation plugin for the official DSH Loader inventory.

- Host lifecycle truth comes from `@deepseek-ai/dsh-host-plugin-inventory`.
- The Client face reads `ctx.remote.pluginInventory` through the official
  `@deepseek-ai/dsh-api-remotes` graph.
- The UI contributes one `plugins` section to
  `amiba.settings.section`; it does not maintain an Extension registry or
  install plugins through Electron.
