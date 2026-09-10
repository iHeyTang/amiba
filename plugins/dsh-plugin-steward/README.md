# @amiba/dsh-plugin-steward

Amiba steward (大管家): ONE hidden, always-live conversation the user talks to.
The steward retains its chosen base preset and adds scoped `steward_*` tools. Work is
routed to an existing task session or a fresh one (`ctx.agents.create/resume` +
`followup`); every completed turn of a managed session is folded from
`session/event` and relayed back into the steward conversation, where the
steward summarises it for the user.

- Task bindings persist as JSON under `config.root`.
- No internal preset is generated. `config.basePreset` optionally chooses the
  base; otherwise the current DSH default is resolved and pinned when creating
  the session. Resume uses the session's recorded base, not a new default.
- `session-features` records and restores the versioned steward behavior. Its
  persona overrides the base persona slot without a `complete` prompt, keeping
  Code Mode SDK instructions intact. Base tools and runtime services remain;
  choosing minimal still means no automatic context compaction.
- Managed task sessions get `ask_user_question` guarded off; they ask in plain
  text instead, and the steward relays the question.
- The steward's own session title is pinned: every time `ensureStewardAgent`
  obtains the live steward agent (on create, on resume, and when it reuses an
  already-live agent), the host checks the session's latest logged
  `session/title` event and, if it isn't already 「大管家」, calls
  `ctx.sessionTitle.rename(agent.session, "大管家")` — an explicit
  user-sourced rename, which pins the title and stops auto-summarization. A
  rename failure is logged and swallowed; it never blocks boot.
- Client half: a workspace navigation entry beside 定时任务, and registrations
  into the shell's generic session-list slots — `amiba.sessions.list.group`
  pulls every adopted session out of the sidebar's normal channel/date
  sections into its own 「大管家」 section below the built-in recent tasks, and
  `amiba.sessions.item.menu` adds a "交给大管家" item to a session row's ⋯
  menu (hidden on the steward's own session and on sessions already
  adopted). Both read a client-side adopted-id set that's refreshed at
  apply, right after a successful adopt, and on a 20s interval while the
  plugin is mounted. The steward session itself is hidden from history via
  ui-shell's `amibaSessionVisibility.hideSession(sessionId)`, never by preset ID. A message the steward dispatches into a
  managed session carries a 「来自 大管家」 attribution on its chat bubble, via
  a declarative `amiba.message.source` registration.
