# @amiba/dsh-plugin-steward

Amiba steward (大管家): ONE hidden, always-live conversation the user talks to.
The steward has no work tools — only `steward_*` dispatch tools. Each request is
routed to an existing task session or a fresh one (`ctx.agents.create/resume` +
`followup`); every completed turn of a managed session is folded from
`session/event` and relayed back into the steward conversation, where the
steward summarises it for the user.

- Task bindings persist as JSON under `config.root`.
- The steward's own preset (`amiba-steward`) is seeded create-only into
  `config.agentPresetsRoot`: an existing `<agentPresetsRoot>/amiba-steward/`
  directory is never touched, so an install that already has one must delete it
  to pick up changes to the seeded composition (persona, compaction, …).
- Managed task sessions get `ask_user_question` guarded off; they ask in plain
  text instead, and the steward relays the question.
- Client half: a workspace navigation entry beside 定时任务, and registrations
  into the shell's generic session-list slots — `amiba.sessions.item.badge`
  marks every adopted session with a 「大管家」 chip, `amiba.sessions.list.filter`
  adds a 「大管家」 chip to the sidebar's filter row so the list can narrow to
  just adopted (or just un-adopted) sessions, and `amiba.sessions.item.menu`
  adds a "交给大管家" item to a session row's ⋯ menu (hidden on the steward's
  own session and on sessions already adopted). All three read a
  client-side adopted-id set that's refreshed at apply, right after a
  successful adopt, and on a 20s interval while the plugin is mounted. The
  steward session itself is hidden from history via ui-shell's
  `amibaSessionVisibility`.
