# @amiba/dsh-plugin-pin

DSH plugin owning Amiba's session pinning: a "置顶"/"取消置顶" (Pin/Unpin)
toggle on every session row's ⋯ menu, and a "置顶"/"Pinned" group at the top
of the sidebar session list holding every pinned session. Replaces the
built-in pin core used to carry (`SessionMeta.pinned`, the row's pin icon,
pinned-first sort, `Sidebar`'s bulk-pin button) — core no longer knows what
pinning is; this plugin is the only thing that does.

## Shape

- **Host half** (`src/index.ts`): intentionally empty. Pinning is a purely
  client-side, per-device preference — there is no host-side state or wire
  face. This entry only lets DSH discover the package's `dsh.client`
  declaration and serve the browser bundle as a normal DSH plugin (the
  `dsh-plugin-ui-shell` / `dsh-plugin-agent-preset` precedent).
- **Client half** (`src/client/`):
  - `state.ts` — `createPinState(storage)`: an observable in-memory set of
    pinned session ids, backed by `getPlatform().storage` under the key
    `pin.sessionIds` (a plain `string[]`). `load()` reads the persisted value
    once (tolerating a missing key, a non-array value, or non-string
    entries); `pin`/`unpin` mutate the in-memory set, notify subscribers,
    then persist; `isPinned`/`subscribe` are the read side.
  - `faces.ts` — the three slot business faces built from a `PinState`:
    `pinMenuFace` (visible when unpinned, `run` pins),
    `unpinMenuFace` (visible when pinned, `run` unpins — mutually exclusive
    with `pinMenuFace` on any given row), and `pinnedGroupFace` (`claim`
    when pinned).
  - `i18n.ts` — the `pin.menu.pin` / `pin.menu.unpin` / `pin.group` overlay
    strings (en/zh-CN).
  - `index.tsx` — registers two `amiba.sessions.item.menu` entries (`pin`,
    `unpin`, both order 10) and one `amiba.sessions.list.group` entry
    (`pinned`, order 0), all deferred via `ctx.slots.inject` with a
    never-rendered placeholder component (the shell reads `options.label`
    and `inject()` directly — see `dsh-plugin-ui-shell`'s
    `session-list-sources.ts`). Labels are resolved outside React (the
    registered component is never mounted), reading
    `document.documentElement.lang` — the same style as the steward's
    `copy()`/`adoptCopy()`. `state.load()` is kicked off (not awaited) at
    `apply()` so the persisted set is applied as soon as it's read, without
    blocking plugin startup.

## Data plane

`getPlatform().storage` (`@amiba/app-runtime/platform`) — the same
`StorageAdapter.get`/`.set` surface `dsh-plugin-usage`'s prefs and core's
`sessions-runtime` hidden-session set already use for small, per-device,
JSON-serializable state. No host round-trip, no `ctx.remote`.

## Ordering

The pin group (`order: 0`) renders ahead of any other `amiba.sessions.list.group`
registrant (e.g. the steward's `order: 50` "大管家" group) — a session pinned
*and* steward-managed shows up once, under "置顶", since group claiming is
first-registrant-wins by `order` (see `partitionSessionGroups` in
`packages/ui`).
