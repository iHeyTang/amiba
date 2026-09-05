# @amiba/dsh-plugin-cron

Amiba cron: durable task definitions that spawn a **fresh agent session** when
they fire — daily reports, news digests, anything phrased as "at this time,
start a new task".

Named apart from `@deepseek-ai/dsh-schedule` on purpose. That official plugin
owns session-local **reminders**: an agent capability, created by asking the
agent in conversation, delivered as a follow-up turn inside the same session.
Cron is the other thing, and upstream does not provide it (verified against
the full `@deepseek-ai` npm scope — `dsh-jobs*` is a background registry for
long-running tool work, not scheduling).

- Task definitions persist as JSON in the DSH home (`config.root`), same
  pattern as the Model Plane registry.
- One process-local timer aims at the earliest upcoming fire and re-arms at
  least hourly. Each wake runs every task whose next instant after the
  previous check (a watermark, not `now - 1`: real timers wake late, never
  early) is at or before now — so a fire the process slept through still runs
  as soon as the timer wakes. A fire is `ctx.agents.create` on a brand-new
  session (seeded with the user's home as `cwd` and the host's default model,
  same recipe as messaging-core and the steward) plus a `followup` of the
  task prompt, so a run is an ordinary, persisted session. The handle is
  disposed once the agent goes idle — never kept alive.
- Rules: one-shot at an instant, daily at a wall-clock time in an IANA zone,
  or a fixed interval (≥ 5 minutes) anchored at creation.
- The timer lives in the DSH process: nothing fires while the app is closed.
  A task may opt into `catchUp`, which runs at most one missed fire at the
  next startup. This boundary is stated in the UI rather than papered over.
- Management face: the `amibaCron` Typert remote
  (`list`/`createTask`/`updateTask`/`removeTask`/`runNow`); the client half
  contributes the 定时任务 navigation entry and page.
