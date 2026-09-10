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

The client also contributes the `amiba.sessions.list.group` seat as 定时任务.
Membership is read from the first durable `user/message` source (`cron:<task-id>:<rpc-id>`),
not the title or a rule's last-session pointer. Older runs and runs whose rule was
removed stay grouped without rewriting history. The `sessionIds` remote classifies
at most 100 requested sessions per call and caches settled origins in memory.
The group receives the actual sidebar rows through `claim`, batches new ids for
classification, and retries every 15 seconds; unloading removes the group and timer. Steward-adopted sessions take precedence
through the existing slot order, so no session appears in both groups.


Each task keeps a durable `runs` ledger (session ID, start time, and idle time).
The task row expands to show every recorded run, newest first; selecting a run
uses the shell's open-session route. `list(sessionIds?)` also recovers earlier
runs from the persisted first-message provenance of known sessions, while
retaining the legacy `lastSessionId` entry. Idle time does not imply success;
the conversation remains the source for the run's outcome.

The page and navigation refresh every five seconds while mounted. The shell's
generic `sessionActivity` workspace-seat face supplies the same local unread
state and durable read watermark used by the conversation list. New runs and
later completions are reconciled on reconnect, including runs completed before
their session reached the list. Opening a conversation acknowledges it; opening
the cron panel or expanding history does not. Unread results add a quiet dot to
the run, its task and the navigation entry. Archived conversations do not
contribute to that navigation indicator.
