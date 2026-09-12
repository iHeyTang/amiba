# @amiba/dsh-bundle-amiba-desktop

Optional native providers loaded only by the Electron profile.

The bundle supplies an authenticated execution connector and the visible
Electron browser provider. It must not contain general Amiba product state or
be required by Core, Headless, TUI, or ordinary Web profiles.

The browser has its own activation patch in `dsh-plugin-browser-provider-electron`.
This base bundle distributes the package but does not activate it; desktop profiles
migrate it once to an optional, independently removable profile dependency.
