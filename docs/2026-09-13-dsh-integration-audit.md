# Amiba / DSH integration audit

## Scope

Reviewed desktop and CLI launch paths, temporary development profiles, native
extension discovery, plugin dependency isolation, and plugin-owned asset paths.
The relevant environments are a managed installation, a linked source plugin,
and the active user profile. These directories need not share a parent.

## Confirmed defects and fixes

| Boundary | Failure | Fix |
| --- | --- | --- |
| Tool catalog → DSH installation | Resolving DSH relative to a linked plugin fails with `MODULE_NOT_FOUND`. | Resolve from the active profile, including DSH's shared profile fallback. |
| Development profile → installed plugins | Requiring an exported `package.json` rejects valid packages, or selects a different installation copy after the profile copy fails resolution. | Find manifests using Node's package lookup paths without requiring a manifest export; preserve profile-first lookup. |
| Native extension → hoisted dependencies | The manifest-export fallback only checks a direct child, missing hoisted native packages. | Use the same package-directory resolver throughout the dependency walk. |
| Desktop → Node child processes | Desktop inherited the shell's PATH, unlike CLI and plugin commands. Tools could invoke another Node version or fail when no system Node is present. | Share managed runtime environment construction across all three launch paths, including Windows Path/PATH normalization. |

## Other reviewed boundaries

- The development preload already unifies `@deepseek-ai/*` host modules. A real
  DSH probe confirms identical Cordis Context and ToolRuntime classes and a shared
  Remote method registry between a linked plugin and the managed host.
- The same probe exercises attach, host HMR, disposal, and preservation of the
  installed profile. No further defect was reproduced in those checks.
- PDF dependencies and Studio assets intentionally resolve from their owning
  plugin. They are private dependencies, unlike the DSH host package. The
  packaged Studio HTML/JavaScript smoke check passes.
- Bundled skills resolve beside the plugin's lib directory; runtime preparation
  explicitly copies the skills directory. Product data roots are supplied by
  bundle configuration through DSH home paths.
- Distribution tests cover private dependency isolation, host peers, lock
  validation, and runtime patch application. These checks pass.

## Validation and limits

Local validation on macOS ARM: 9 runtime tests, 20 catalog tests, 11 desktop
profile/native/development tests, 13 distribution tests, and 28 release tests;
runtime and CLI compilation, desktop typecheck and production build, and the
real DSH development smoke test. The DSH smoke used the existing managed runtime
read-only with a disposable profile, not the user's running desktop/profile.

CI now runs profile/catalog/native regressions and the linked-plugin smoke on
the three existing runtime targets, in addition to packaged composition checks.
Windows/macOS Intel results depend on those CI runs. This audit does not claim
an interactive test of every feature or a newly built installer on every OS.
