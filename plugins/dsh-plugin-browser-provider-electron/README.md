# @amiba/dsh-plugin-browser-provider-electron

Independent desktop workbench browser package: DSH activation patch, client UI,
Electron native module, and browser tool provider ship together.

The package owns the address bar, tabs, favicon, background-session WebViews,
page snapshots, input/click/screenshot execution, and cleanup. The desktop app
provides only a leased native-extension transport and partition enforcement.

## Install, remove, replace

Build and pack from the repository:

```sh
pnpm --dir plugins/dsh-plugin-browser-provider-electron build
pnpm --dir plugins/dsh-plugin-browser-provider-electron pack
```

In the desktop plugin-management page, install the generated `.tgz`. Remove
`@amiba/dsh-plugin-browser-provider-electron` to uninstall it. Install a new
archive to replace its version. These actions use DSH's official profile plugin
commands, rebuild the graph, and restart the runtime/renderer.

Desktop profiles migrate the formerly mandatory browser to one direct optional
package on first startup after this change. Subsequent removal survives restart.
The desktop base bundle supplies the gateway but no longer activates a browser.

The existing Core and Web bundles provide `amibaBrowser`, the runtime gateway,
UI Shell, and React. Electron is supplied by the desktop host. The archive has no
private workspace runtime dependencies to fetch from a registry.

## Alternative implementations

A replacement package registers its own `amiba.workbench.view` contribution for
`browser`, including its `host`, `component`, `toolbar`, `tabIcon`, and optional
`resolveUrl`. Lower `order` wins consistently for every frontend contribution.
The persistent host is a sibling of the chat tree, so changing plugins does not
reset a chat draft. Only the elected host is mounted.

Native implementations declare `dsh.native` pointing to one bundled `.cjs` file
exporting `create(DesktopExtensionContext): DesktopExtension`. The DSH provider
attaches that package through `amiba_native_attach`, registers its browser
provider only after attachment, and detaches during disposal. Use distinct
provider/contribution IDs for another implementation. Uninstall the previous
package when replacing the complete browser implementation.

Leases are instance-specific. Unload removes tools, closes guests, cancels pending
tab creation, removes listeners, and rejects stale calls/events. UI resource
records may remain unavailable until a compatible view is installed again;
live DOM/history is not persisted across an uninstall.

## Verification

```sh
pnpm --dir plugins/dsh-plugin-browser-provider-electron test
node --experimental-strip-types --test plugins/dsh-plugin-browser-provider-electron/src/native/embedded-browser-tabs.test.mjs
node apps/desktop/scripts/smoke-browser.mjs
node apps/desktop/scripts/smoke-browser-profile.mjs
node apps/desktop/scripts/smoke-browser-app.mjs
```

The Electron smoke consumes a packed archive, exercises real guests and the
managed DSH startup/stop lifecycle. The profile smoke runs actual official CLI
install/remove/replacement commands in a temporary profile. Evidence is written
to `apps/desktop/out/browser-smoke`.

## Import website cookies (macOS)

Open a browser tab and use the import icon beside “Open in default browser”.
The default screen offers a browser choice and **One-click import**: all websites
from the displayed profile are imported, preserving existing workbench cookies.

**Advanced settings** contains profile selection, custom website selection (up to
100 domains), and explicit replacement. Collapsing it preserves those choices.
One-click import has no 100-domain restriction; the native operation accepts up to
100,000 cookie rows with bounded output, and fails rather than silently truncating.
The result page offers “Start browsing”; cookie counts and website links are under
“View import details”. Empty imports and partial failures have distinct outcomes.

This supports standard macOS profile locations, Chromium OSCrypt v10 cookies and
cookie database versions 10–24 where the required columns exist. Chrome's v24
host hash is verified. HttpOnly, Secure, SameSite, path, host-only/domain scope and
expiry are retained. Partitioned cookies and unknown encryption formats are
skipped. Safari, Firefox, custom profile locations, Windows/Linux, saved passwords,
passkeys, localStorage and IndexedDB migration are not implemented. Some websites
will still require signing in again. Session cookies retain session lifetime.

Discovery reads profile metadata and the website list without accessing the
Keychain. Import reads the chosen scope from SQLite in read-only mode, and
macOS may prompt for the source browser's Safe Storage Keychain permission.
Cancelling Keychain access causes no cookie writes. The importer creates no
plaintext export or temporary files; destination persistence uses Electron's
session storage. No cookie values are sent to the renderer, DSH tools, model or
logs. Cookies are shared by workbench tabs, in the existing persistent partition;
uninstall closes pages but does not erase that partition's stored login data.

Verification: `node apps/desktop/scripts/smoke-cookie-import.mjs` uses a synthetic
Chromium database and encryption key with a real Electron session, proving cookie
flags, selected-domain isolation, authenticated HTTP requests, conflict handling
and replacement. Unit tests cover source immutability, hash validation, denied
Keychain access and unload cancellation. Tests do not access personal browser
profiles or the user's Keychain. Actual OS permission UI still depends on the
source browser and the installed app's signing/access policy. The smoke also
renders the real import panel using desktop CSS and synthetic metadata, saving
`cookie-import.png` and `cookie-import-result.png` beside `cookie-result.json`.
