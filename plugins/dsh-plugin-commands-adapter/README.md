# @amiba/dsh-plugin-commands-adapter

Authenticated UI adapter over DSH's session-scoped human command registry. It lists and executes the commands actually mounted for a live Agent; it defines no parallel command system.

- Injects: `webServer`, `commands`, `agents`
- Config: per-process `apiToken`
- Route: `/api/amiba/commands`
