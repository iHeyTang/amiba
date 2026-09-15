# Workbench framework

Installs the right-hand workbench through `amiba.workbench.shell`. The framework owns the single edge toggle, empty state, resource tab rail, new-tab popover, resizing and legacy panel bridge. Session state and reusable UI primitives are supplied by the shell module; the shell does not install a workbench by itself.

Resource plugins register `amiba.workbench.view`. An elected view's `launcher` appears in both the empty state and the new-tab popover. `createResource()` returns a resource with a unique id for independent instances, or omit it to open a singleton view. Removing a contribution removes its action; existing tabs display an unavailable state and can recover when the plugin returns.

Default extensions are independently packaged as `dsh-plugin-file-preview`, `dsh-plugin-terminal` and `dsh-plugin-browser-provider-electron`. No browser or terminal dependency is bundled by this framework.

See `docs/workbench-extensions.md` for the SDK contract.
