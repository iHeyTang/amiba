/**
 * Persistence layer for the multi-session schema.
 *
 * As of the backplane refactor, the canonical conversation log lives in
 * Hermes Agent's ``state.db`` (``hermes_state.SessionDB``), reached via the
 * backplane plugin's ``/hermes/sessions/*`` HTTP routes. The browser
 * extension is no longer the source of truth; the CLI, gateway, dashboard,
 * and this extension all read and append to the same SessionDB rows.
 *
 * What stays in ``chrome.storage.local``:
 *   - ``sessions.activeId``      — which open tab is currently shown
 *   - ``sessions.openTabIds``    — ordered list of tabs in the panel header
 *   - ``sessions.local-meta``    — per-session UI-only flags
 *                                  (``pinned`` / ``archived`` / ``titleManual``)
 *
 * What goes to Hermes:
 *   - the session row itself (``id``, ``title``, ``started_at``,
 *     ``message_count``, ``last_active`` …)
 *   - the full message log
 *
 * The function signatures here intentionally match the old
 * ``chrome.storage.local`` version so ``use-sessions.ts`` is unaware of
 * the swap. Two impedance issues are absorbed inside this module:
 *
 *   1. **Snapshot save vs append-only Hermes.** ``saveMessages`` is called
 *      every 250 ms during streaming with the *entire* message array.
 *      Hermes only supports per-row ``append_message``. We keep an
 *      in-memory ``uiId → already appended`` set per session, computed
 *      lazily on first ``loadMessages`` and ``saveMessages`` for that
 *      session, and only POST messages whose ``uiId`` we haven't seen
 *      before. The last message in the snapshot is deferred if its
 *      ``streaming`` flag is true so we don't commit a half-baked
 *      assistant turn — the next ``saveMessages`` after stream completion
 *      picks it up.
 *
 *   2. **Snapshot save of the session list vs Hermes per-mutation API.**
 *      ``saveIndex`` is called every time the React array of
 *      ``SessionMeta`` changes. We diff against the previous snapshot
 *      (kept in module state) and emit only the targeted PATCH / POST
 *      calls — title changes go to ``updateHermesSession``, brand-new
 *      sessions go to ``createHermesSession``. UI-only fields land in
 *      the local sidecar.
 *
 * On boot, the first ``loadIndex`` populates the snapshot so the very
 * first ``saveIndex`` doesn't try to re-create everything.
 */

import { getPlatform } from "@amiba/platform";
import { shortId } from "@amiba/utils";

import {
  createHermesSession,
  deleteHermesSession,
  ensureHermesSession,
  forgetEnsuredHermesSession,
  getHermesMessages,
  type HermesMessage,
  type HermesSession,
  listHermesSessions,
  secToMs,
  updateHermesSession,
} from "../hermes-sessions";
import { getLocalSource, SOURCE_LOCAL } from "../channels";
import {
  LOCAL_META_KEY,
  SESSION_KEYS,
  type SessionLocalMeta,
  type SessionMessage,
  type SessionMeta,
} from "../sessions";

// Re-exported for callers that imported it from here historically. The
// canonical definition lives in ``../channels.ts`` alongside the rest of
// the source-tag constants and the descriptor registry.
export { SOURCE_LOCAL };

// Page size for the initial list fetch. SessionDB scales to thousands; if
// a user actually has more than this they'll have to wait while we
// paginate. Kept generous because the panel's History drawer needs the
// whole list eagerly to render its date-bucket sidebar.
const LIST_FETCH_PAGE = 500;

/**
 * Hermes session sources we never want to show in the chat-history
 * sidebar. ``cron`` is automated and creates one session per scheduled
 * run, which otherwise drowns out real conversations in the History
 * drawer. Add more here if other non-conversational sources appear.
 */
const HIDDEN_SESSION_SOURCES = ["cron"];

// ---------------------------------------------------------------------------
// Module-scoped state for impedance matching
// ---------------------------------------------------------------------------

/** Sessions for which the row is known to exist in Hermes. */
const _ensuredSessions = new Set<string>();

/** Snapshot of the last sessions array we saw, keyed by id. */
let _lastSavedIndex: Map<string, SessionMeta> | null = null;

/** Snapshot of the last local-meta map (pinned/archived/titleManual). */
let _lastSavedLocalMeta: Record<string, SessionLocalMeta> = {};

// ---------------------------------------------------------------------------
// Local sidecar (pinned / archived / titleManual)
// ---------------------------------------------------------------------------


async function readLocalMeta(): Promise<Record<string, SessionLocalMeta>> {
  const r = await getPlatform().storage.get([LOCAL_META_KEY]);
  const v = r[LOCAL_META_KEY];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, SessionLocalMeta>;
  }
  return {};
}

async function writeLocalMeta(
  meta: Record<string, SessionLocalMeta>,
): Promise<void> {
  await getPlatform().storage.set({ [LOCAL_META_KEY]: meta });
}

function pickLocalFields(s: SessionMeta): SessionLocalMeta {
  const out: SessionLocalMeta = {};
  if (s.pinned) out.pinned = true;
  if (s.archived) out.archived = true;
  if (s.titleManual) out.titleManual = true;
  return out;
}

function localMetaEqual(a: SessionLocalMeta, b: SessionLocalMeta): boolean {
  return (
    Boolean(a.pinned) === Boolean(b.pinned) &&
    Boolean(a.archived) === Boolean(b.archived) &&
    Boolean(a.titleManual) === Boolean(b.titleManual)
  );
}

// ---------------------------------------------------------------------------
// Mapping helpers between SessionMeta / SessionMessage and Hermes shapes
// ---------------------------------------------------------------------------


function hermesSessionToMeta(
  s: HermesSession,
  local: SessionLocalMeta | undefined,
): SessionMeta {
  // Hermes stores timestamps as float seconds; the existing UI works in
  // ms. ``last_active`` falls back to ``started_at`` for a fresh session
  // with no messages yet.
  const createdAt = secToMs(s.started_at);
  const updatedAt = secToMs(s.last_active ?? s.started_at);
  return {
    id: s.id,
    title: s.title ?? "",
    createdAt,
    updatedAt,
    messageCount: s.message_count ?? 0,
    pinned: local?.pinned,
    archived: local?.archived,
    titleManual: local?.titleManual,
    source: s.source,
  };
}

/**
 * One tool-call chip restored from a Hermes ``tool_calls`` JSON payload.
 * Schema matches the panel's ``HermesToolProgress`` so it slots straight
 * onto a ``UiMessage`` and is picked up by the shared execution-row renderer
 * without further translation.
 *
 * We restore ``tool``, ``toolCallId``, arguments (as the folded ``label``)
 * and a constant ``status`` of ``completed``. The original ``startedAt`` /
 * ``durationMs`` data was stamped by the live engine and isn't persisted in
 * SessionDB, so the row has no duration after reload.
 */
interface RestoredToolProgress {
  tool: string;
  toolCallId: string;
  status: "completed";
  label?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: boolean;
}

function decodeStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function asArgumentRecord(value: unknown): Record<string, unknown> | undefined {
  const decoded = decodeStoredValue(value);
  return decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? decoded as Record<string, unknown>
    : undefined;
}

function storedResultFailed(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const record = result as Record<string, unknown>;
  return (
    record.success === false ||
    Boolean(record.error) ||
    (typeof record.exit_code === "number" && record.exit_code !== 0)
  );
}

/**
 * Pull the id, name, and arguments from one entry of the assistant row's
 * ``tool_calls`` JSON array. The shape is whatever the gateway
 * persisted — usually OpenAI-style ``{id, type, function: {name, ...}}``
 * but we accept several spellings to tolerate older rows.
 */
function readToolCallEntry(
  raw: unknown,
  resultsByCallId: ReadonlyMap<string, unknown>,
): RestoredToolProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const id = (typeof t.id === "string" && t.id)
    || (typeof t.tool_call_id === "string" && t.tool_call_id)
    || null;
  if (!id) return null;
  let tool = "";
  const fn = t.function;
  if (fn && typeof fn === "object" && typeof (fn as Record<string, unknown>).name === "string") {
    tool = (fn as { name: string }).name;
  } else if (typeof t.name === "string") {
    tool = t.name;
  } else if (typeof t.tool === "string") {
    tool = t.tool;
  } else if (typeof t.tool_name === "string") {
    tool = t.tool_name;
  }
  const fnArgs =
    fn && typeof fn === "object"
      ? (fn as Record<string, unknown>).arguments
      : undefined;
  const args = fnArgs ?? t.arguments ?? t.input;
  const structuredArgs = asArgumentRecord(args);
  const result = resultsByCallId.get(id);
  let label = "";
  if (typeof args === "string") {
    label = args.trim();
  } else if (args != null) {
    try {
      label = JSON.stringify(args, null, 2);
    } catch {
      label = "";
    }
  }
  return {
    tool: tool || "tool",
    toolCallId: id,
    status: "completed",
    ...(label ? { label } : {}),
    ...(structuredArgs ? { args: structuredArgs } : {}),
    ...(result !== undefined ? { result } : {}),
    ...(storedResultFailed(result) ? { error: true } : {}),
  };
}

/**
 * Normalise a Hermes message row into the extension's UiMessage-shaped
 * object. ``content`` in storage can be a plain string OR a JSON-decoded
 * list of multimodal parts; ChatMessage today only types ``content:
 * string``, so we stringify parts. When the panel grows real multimodal
 * rendering, this is the right place to widen.
 *
 * ``uiId`` becomes the canonical Hermes row id (as ``hermes:<n>``) so
 * the React keys are stable across reload.
 *
 * Extra fields (``hermesToolProgress``, ``streamVerbose``) live on
 * ``UiMessage`` (the panel-side extension of ChatMessage) but aren't
 * typed on ``SessionMessage`` — we attach them via the index signature
 * and let the panel renderer pick them up.
 */
function hermesMessageToSession(
  m: HermesMessage,
  resultsByCallId: ReadonlyMap<string, unknown>,
): SessionMessage {
  let content = "";
  if (typeof m.content === "string") {
    content = m.content;
  } else if (Array.isArray(m.content)) {
    try {
      content = JSON.stringify(m.content);
    } catch {
      content = "";
    }
  }
  const msg: SessionMessage & Record<string, unknown> = {
    role: m.role as SessionMessage["role"],
    content,
    uiId: `hermes:${m.id}`,
  };

  // Reasoning trace was either streamed (``reasoning``) or block-form
  // (``reasoning_content``). On reload the panel renders this as a chip
  // via ``UiMessage.reasoning`` (not ``streamVerbose`` — that path is
  // reserved for backward-compatible tool-argument details).
  const reasoning = (typeof m.reasoning_content === "string" && m.reasoning_content)
    || (typeof m.reasoning === "string" && m.reasoning)
    || "";
  if (reasoning) {
    msg.reasoning = reasoning;
  }

  // Synthesize the tool-progress chips array from the persisted
  // ``tool_calls`` JSON. Each entry was a live "running" event in the
  // engine's hermesToolProgress; on reload we only know they finished
  // (the matching role=tool rows are filtered out below in loadMessages).
  if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
    const restored: RestoredToolProgress[] = [];
    for (const tc of m.tool_calls) {
      const entry = readToolCallEntry(tc, resultsByCallId);
      if (entry) restored.push(entry);
    }
    if (restored.length > 0) {
      msg.hermesToolProgress = restored;
    }
  }

  return msg;
}

// ---------------------------------------------------------------------------
// loadIndex
// ---------------------------------------------------------------------------


export async function loadIndex(): Promise<SessionMeta[]> {
  const res = await listHermesSessions({
    limit: LIST_FETCH_PAGE,
    offset: 0,
    excludeSources: HIDDEN_SESSION_SOURCES,
  });
  if (!res.ok) {
    console.warn("[hermes-sessions] listHermesSessions failed:", res);
    // Reset the saved snapshot so the next saveIndex doesn't decide some
    // session "disappeared" and skip an actual creation: we now know
    // nothing about Hermes state.
    _lastSavedIndex = null;
    return [];
  }
  const local = await readLocalMeta();
  _lastSavedLocalMeta = local;
  const out = res.sessions.map((s) =>
    hermesSessionToMeta(s, local[s.id]),
  );
  // Sort newest-first so the History drawer and tab list see a stable
  // order. SessionDB returns by started_at; we re-sort by updatedAt
  // since that's what the UI buckets by.
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  // Snapshot for diff-in-saveIndex.
  _lastSavedIndex = new Map(out.map((s) => [s.id, { ...s }]));
  return out;
}

// ---------------------------------------------------------------------------
// saveIndex — diff against last snapshot, emit targeted API calls
// ---------------------------------------------------------------------------


export async function saveIndex(index: SessionMeta[]): Promise<void> {
  const prevMap = _lastSavedIndex ?? new Map<string, SessionMeta>();
  const localMeta = { ..._lastSavedLocalMeta };
  let localChanged = false;

  for (const cur of index) {
    const prev = prevMap.get(cur.id);
    if (!prev) {
      // New session — POST to Hermes. ``title`` is optional; non-empty
      // strings go through, empty stays unset to avoid the auto-derived
      // "New chat" clashing across multiple fresh sessions (Hermes
      // titles are unique).
      const create = await createHermesSession({
        id: cur.id,
        source: getLocalSource(),
        title: cur.title?.trim() ? cur.title : undefined,
      });
      if (create.ok) {
        _ensuredSessions.add(cur.id);
        if (create.title_error) {
          console.warn(
            "[hermes-sessions] title conflict on create:",
            create.title_error,
          );
        }
      } else {
        console.warn("[hermes-sessions] createHermesSession failed:", create);
      }
    } else if ((cur.title || "") !== (prev.title || "")) {
      // Title changed — PATCH. 409 means another session owns that
      // title; surface as a warning but keep the local title (the user
      // will see it un-synced; they can rename to resolve).
      const upd = await updateHermesSession(cur.id, {
        title: cur.title || "",
      });
      if (upd.ok === false && upd.status !== 404) {
        console.warn(
          "[hermes-sessions] updateHermesSession title failed:",
          upd,
        );
      }
    }

    const desired = pickLocalFields(cur);
    const before = localMeta[cur.id] ?? {};
    if (!localMetaEqual(before, desired)) {
      localChanged = true;
      if (
        !desired.pinned &&
        !desired.archived &&
        !desired.titleManual
      ) {
        delete localMeta[cur.id];
      } else {
        localMeta[cur.id] = desired;
      }
    }
  }

  // Sessions present in the prev snapshot but not in the new one were
  // removed by use-sessions.remove(), which independently calls
  // dropMessages → deleteHermesSession. No API call to make here, but
  // clean up local sidecar entries for them.
  for (const id of prevMap.keys()) {
    if (!index.some((s) => s.id === id) && localMeta[id]) {
      delete localMeta[id];
      localChanged = true;
    }
  }

  if (localChanged) {
    await writeLocalMeta(localMeta);
    _lastSavedLocalMeta = localMeta;
  }

  _lastSavedIndex = new Map(index.map((s) => [s.id, { ...s }]));
}

// ---------------------------------------------------------------------------
// loadMessages
// ---------------------------------------------------------------------------


export async function loadMessages(id: string): Promise<SessionMessage[]> {
  if (!id) return [];
  const res = await getHermesMessages(id);
  if (res.ok === false) {
    if (res.status !== 404) {
      console.warn("[hermes-sessions] getHermesMessages failed:", res);
    }
    return [];
  }
  const resultsByCallId = new Map<string, unknown>();
  for (const message of res.messages) {
    if (message.role !== "tool" || !message.tool_call_id) continue;
    resultsByCallId.set(message.tool_call_id, decodeStoredValue(message.content));
  }

  // Skip role=tool rows entirely. Each tool result is already represented
  // as a chip on the *preceding assistant message* via the synthesized
  // ``hermesToolProgress`` (from that assistant's ``tool_calls`` field).
  // Rendering role=tool rows as their own UiMessages was the cause of
  // the ``[tool] {raw json}`` bubbles the panel showed before this fix.
  const messages = res.messages
    .filter((m) => m.role !== "tool")
    .map((message) => hermesMessageToSession(message, resultsByCallId));
  _ensuredSessions.add(id);
  return messages;
}

// ---------------------------------------------------------------------------
// saveMessages — diff vs in-memory set, append the new ones
// ---------------------------------------------------------------------------


async function ensureSessionRowExists(id: string): Promise<void> {
  // Idempotent: SessionDB's INSERT OR IGNORE makes re-creates safe.
  // We still keep the local ``_ensuredSessions`` Set as a fastpath (it
  // gates other store internals like ``loadMessages``); the shared
  // ``ensureHermesSession`` has its own process-local cache too, but
  // they cover different scopes so we maintain both.
  if (_ensuredSessions.has(id)) return;
  await ensureHermesSession(id, getLocalSource());
  _ensuredSessions.add(id);
}

export async function saveMessages(
  id: string,
  _messages: SessionMessage[],
): Promise<void> {
  // ---------------------------------------------------------------
  // No append from the extension side — api_server already persists
  // every user/assistant/tool message that goes through
  // ``/v1/chat/completions`` (see ``gateway/platforms/api_server.py``).
  // The extension passing the same X-Hermes-Session-Id header means
  // api_server's writes land under our session row already; a parallel
  // ``appendHermesMessage`` from here would double every row in
  // state.db and the panel would render each message twice on reload.
  //
  // We still call ``ensureSessionRowExists`` so a brand-new panel
  // session that the user creates but hasn't yet sent a message in is
  // visible in the Hermes session list. SessionDB.create_session is
  // INSERT-OR-IGNORE so the call is idempotent.
  // ---------------------------------------------------------------
  if (!id) return;
  await ensureSessionRowExists(id);
}

// ---------------------------------------------------------------------------
// dropMessages → delete session entirely (Hermes deletes session + msgs)
// ---------------------------------------------------------------------------


export async function dropMessages(id: string): Promise<void> {
  if (!id) return;
  const res = await deleteHermesSession(id);
  if (res.ok === false && res.status !== 404) {
    console.warn("[hermes-sessions] deleteHermesSession failed:", res);
  }
  _ensuredSessions.delete(id);
  forgetEnsuredHermesSession(id);

  // Clean up the sidecar entry too.
  const local = await readLocalMeta();
  if (local[id]) {
    delete local[id];
    await writeLocalMeta(local);
    _lastSavedLocalMeta = local;
  }
}

// ---------------------------------------------------------------------------
// Factory helpers (signatures retained verbatim from the old store)
// ---------------------------------------------------------------------------


/** Build a fresh metadata record. Caller is responsible for inserting it. */
export function newSessionMeta(
  opts: { id?: string; title?: string } = {},
): SessionMeta {
  const now = Date.now();
  return {
    id: opts.id ?? shortId("sess"),
    title: opts.title ?? "",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    source: getLocalSource(),
  };
}

/**
 * Heuristic for the auto-generated session title. Takes the first user
 * message, normalises whitespace, and truncates with an ellipsis.
 */
export function deriveTitleFromMessages(
  messages: SessionMessage[],
  fallback = "New chat",
): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser?.content) return fallback;
  const cleaned = firstUser.content.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  const max = 40;
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1) + "…";
}
