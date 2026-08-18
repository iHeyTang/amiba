# @amiba/dsh-plugin-schedule-adapter

Independent dual-face DSH plugin over the official Schedule tools. Its Host
face invokes `schedule_create`, `schedule_list`, and `schedule_delete` in the
exact live Agent scope; its Client face registers navigation and content into
the Amiba root's workspace slots. DSH owns persistence, recovery, validation,
delivery, plugin registration, and UI composition; Electron owns none of the
feature implementation.

- Injects: `webServer`, `agents`, `tools`
- Config: per-process `apiToken`
- Client slots: `amiba.workspace.navigation`, `amiba.workspace.view`
- Compatibility route: `/api/amiba/schedules`
