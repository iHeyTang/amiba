# @amiba/dsh-plugin-steward

Amiba steward (大管家): ONE hidden, always-live conversation the user talks to.
The steward has no work tools — only `steward_*` dispatch tools. Each request is
routed to an existing task session or a fresh one (`ctx.agents.create/resume` +
`followup`); every completed turn of a managed session is folded from
`session/event` and relayed back into the steward conversation, where the
steward summarises it for the user.

- Task bindings persist as JSON under `config.root`.
- The steward's own preset (`amiba-steward`) is seeded create-only into
  `config.agentPresetsRoot`.
- Managed task sessions get `ask_user_question` guarded off; they ask in plain
  text instead, and the steward relays the question.
- Client half: a workspace navigation entry beside 定时任务, a task board in the
  session header utilities, and a "交给大管家" header action on ordinary
  sessions. The steward session itself is hidden from history via ui-shell's
  `amibaSessionVisibility`.
