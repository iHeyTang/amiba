import { getPlatform, type AgentSessionHistoryEntry } from "@amiba/app-runtime/platform";
import { shortId } from "@amiba/app-runtime/utils";

import {
  normalizeAgentContext,
  normalizeAgentProfileId,
  type AgentExecutionContext,
} from "../agent-context";
import { projectRuntimeSessionHistory } from "../runtime-session-history";
import { SOURCE_LOCAL } from "../channels";
import {
  LOCAL_META_KEY,
  type SessionLocalMeta,
  type SessionMessage,
  type SessionMeta,
} from "../sessions";

export { SOURCE_LOCAL };

const RUNTIME_HIDDEN_SESSIONS_KEY = "sessions.runtime-hidden";
let lastSavedIndex: Map<string, SessionMeta> | null = null;
let lastSavedLocalMeta: Record<string, SessionLocalMeta> = {};

function sessionsAdapter() {
  const adapter = getPlatform().agentSessions;
  if (!adapter) throw new Error("DSH sessions are unavailable.");
  return adapter;
}

function runtimeErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

async function readLocalMeta(): Promise<Record<string, SessionLocalMeta>> {
  const value = (await getPlatform().storage.get([LOCAL_META_KEY]))[
    LOCAL_META_KEY
  ];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, SessionLocalMeta>)
    : {};
}

async function writeLocalMeta(
  meta: Record<string, SessionLocalMeta>,
): Promise<void> {
  await getPlatform().storage.set({ [LOCAL_META_KEY]: meta });
}

/**
 * A deletion is a local tombstone (DSH has no destructive delete), and it
 * carries the time it was made. Anything the session does on the host AFTER
 * that time — a plugin resuming it, another client writing a turn — is new
 * activity the user never deleted, so the tombstone stops applying. Without
 * the timestamp a resumed session became invisible forever: alive on the
 * host, gone from every list, and unreachable even by id.
 */
type SessionTombstone = { id: string; hiddenAt: number };

type TombstoneRead = {
  /** id → deletion time. */
  tombstones: Map<string, number>;
  /** A legacy or malformed entry was given a time and must be written back. */
  migrated: boolean;
};

function parseTombstones(value: unknown, now: number): TombstoneRead {
  const tombstones = new Map<string, number>();
  let migrated = false;
  if (!Array.isArray(value)) return { tombstones, migrated };
  for (const entry of value) {
    // Legacy shape: a bare id with no recorded time. Adopt `now`, which keeps
    // the deletion in force until the session's next activity.
    if (typeof entry === "string") {
      if (!entry) continue;
      tombstones.set(entry, now);
      migrated = true;
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const { id, hiddenAt } = entry as Partial<SessionTombstone>;
    if (typeof id !== "string" || !id) continue;
    if (typeof hiddenAt === "number" && Number.isFinite(hiddenAt)) {
      tombstones.set(id, hiddenAt);
    } else {
      tombstones.set(id, now);
      migrated = true;
    }
  }
  return { tombstones, migrated };
}

async function readTombstones(): Promise<TombstoneRead> {
  const value = (
    await getPlatform().storage.get([RUNTIME_HIDDEN_SESSIONS_KEY])
  )[RUNTIME_HIDDEN_SESSIONS_KEY];
  return parseTombstones(value, Date.now());
}

async function writeTombstones(
  tombstones: Map<string, number>,
): Promise<void> {
  const value: SessionTombstone[] = [...tombstones].map(([id, hiddenAt]) => ({
    id,
    hiddenAt,
  }));
  await getPlatform().storage.set({ [RUNTIME_HIDDEN_SESSIONS_KEY]: value });
}

async function hideRuntimeSession(id: string): Promise<void> {
  const { tombstones } = await readTombstones();
  tombstones.set(id, Date.now());
  await writeTombstones(tombstones);
}

function pickLocalFields(session: SessionMeta): SessionLocalMeta {
  const result: SessionLocalMeta = {};
  if (session.archived) result.archived = true;
  if (session.unread) result.unread = true;
  if (session.titleManual) result.titleManual = true;
  if (session.agent) result.agent = normalizeAgentContext(session.agent);
  if (session.parentSessionId) result.parentSessionId = session.parentSessionId;
  if (session.branchMessageId != null) {
    result.branchMessageId = session.branchMessageId;
  }
  return result;
}

function localMetaEqual(a: SessionLocalMeta, b: SessionLocalMeta): boolean {
  return (
    Boolean(a.archived) === Boolean(b.archived) &&
    Boolean(a.unread) === Boolean(b.unread) &&
    Boolean(a.titleManual) === Boolean(b.titleManual) &&
    JSON.stringify(a.agent ?? null) === JSON.stringify(b.agent ?? null) &&
    a.parentSessionId === b.parentSessionId &&
    a.branchMessageId === b.branchMessageId
  );
}

type SessionSummaryLike = Awaited<
  ReturnType<ReturnType<typeof sessionsAdapter>["list"]>
>[number];

/** One host summary + its local sidecar → the renderer's SessionMeta. */
function toSessionMeta(
  summary: SessionSummaryLike,
  sidecar: SessionLocalMeta | undefined,
): SessionMeta {
  return {
    id: summary.sessionId,
    title: summary.title ?? "",
    createdAt: summary.updatedAt,
    updatedAt: summary.updatedAt,
    archived: sidecar?.archived,
    unread: sidecar?.unread,
    titleManual: sidecar?.titleManual,
    parentSessionId: summary.parentSessionId ?? sidecar?.parentSessionId,
    source: SOURCE_LOCAL,
    agent: {
      profileId: normalizeAgentProfileId(
        summary.agentPreset ?? sidecar?.agent?.profileId,
      ),
    },
  };
}

/**
 * Resolve ONE session by id, including blank ones the history list drops.
 * A host or plugin may create a session before the user ever types (the
 * steward's conversation, for instance); opening it by id must still
 * surface its real identity — above all the agent preset it already runs —
 * or the composer falls back to the roster default and the first submit is
 * rejected by the host as a preset change.
 *
 * This is the explicit open-by-id path: every caller reaches it because a
 * user or a plugin asked for THIS session. So a tombstone does not hide the
 * session here — opening it is itself the undo, and the tombstone is lifted.
 */
export async function loadSessionMeta(
  id: string,
): Promise<SessionMeta | undefined> {
  const [summaries, local, { tombstones, migrated }] = await Promise.all([
    sessionsAdapter().list(),
    readLocalMeta(),
    readTombstones(),
  ]);
  const summary = summaries.find((item) => item.sessionId === id);
  if (!summary) return undefined;
  if (tombstones.delete(id) || migrated) await writeTombstones(tombstones);
  return toSessionMeta(summary, local[id]);
}

export async function loadIndex(): Promise<SessionMeta[]> {
  const [summaries, local, { tombstones, migrated }] = await Promise.all([
    sessionsAdapter().list(),
    readLocalMeta(),
    readTombstones(),
  ]);
  lastSavedLocalMeta = local;
  let tombstonesChanged = migrated;
  const result = summaries
    .filter((summary) => {
      if (summary.blank) return false;
      const hiddenAt = tombstones.get(summary.sessionId);
      if (hiddenAt === undefined) return true;
      // Activity after the deletion means the session lived on: show it
      // again and forget the tombstone.
      if (summary.updatedAt <= hiddenAt) return false;
      tombstones.delete(summary.sessionId);
      tombstonesChanged = true;
      return true;
    })
    .map((summary) => toSessionMeta(summary, local[summary.sessionId]))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (tombstonesChanged) await writeTombstones(tombstones);
  lastSavedIndex = new Map(
    result.map((session) => [session.id, { ...session }]),
  );
  return result;
}

export async function searchIndex(query: string): Promise<SessionMeta[]> {
  const needle = query.trim();
  if (!needle) return [];
  const [matches, index] = await Promise.all([
    sessionsAdapter().search(needle),
    loadIndex(),
  ]);
  const byId = new Map(index.map((session) => [session.id, session]));
  return matches.flatMap((match) => {
    const session = byId.get(match.sessionId);
    return session ? [{ ...session, searchSnippet: match.snippet }] : [];
  });
}

export async function saveIndex(index: SessionMeta[]): Promise<void> {
  const previous = lastSavedIndex ?? new Map<string, SessionMeta>();
  const local = { ...lastSavedLocalMeta };
  const retryRename = new Set<string>();
  let localChanged = false;

  for (const current of index) {
    const before = previous.get(current.id);
    // Only MANUAL titles write back as a DSH rename. A rename carries the
    // `user` source, which PINS the title server-side and permanently
    // supersedes the runtime's automatic session-title generation — the
    // locally derived first-sentence placeholder must never do that.
    if (
      before &&
      current.titleManual &&
      current.title.trim() &&
      current.title !== before.title
    ) {
      try {
        await sessionsAdapter().rename(current.id, current.title);
      } catch (error) {
        // The UI derives a title as soon as the user message is committed,
        // while the desktop engine creates the matching DSH session in
        // parallel. Keep the previous title in our comparison snapshot so the
        // next projection write retries the rename after creation completes.
        retryRename.add(current.id);
        if (runtimeErrorCode(error) !== "session-not-found") {
          console.warn("[agent-sessions] rename failed:", error);
        }
      }
    }
    const desired = pickLocalFields(current);
    const prior = local[current.id] ?? {};
    if (!localMetaEqual(prior, desired)) {
      localChanged = true;
      if (Object.keys(desired).length === 0) delete local[current.id];
      else local[current.id] = desired;
    }
  }

  for (const id of previous.keys()) {
    if (!index.some((session) => session.id === id) && local[id]) {
      delete local[id];
      localChanged = true;
    }
  }
  if (localChanged) {
    await writeLocalMeta(local);
    lastSavedLocalMeta = local;
  }
  lastSavedIndex = new Map(
    index.map((session) => [
      session.id,
      retryRename.has(session.id)
        ? { ...session, title: previous.get(session.id)?.title ?? "" }
        : { ...session },
    ]),
  );
}

export async function loadMessages(id: string): Promise<SessionMessage[]> {
  if (!id) return [];
  const events: AgentSessionHistoryEntry[] = [];
  let beforeSeq: number | undefined;
  for (;;) {
    const page = await sessionsAdapter().history(id, {
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      maxMessages: 200,
    });
    events.push(...page.events);
    if (!page.hasMore || page.events.length === 0) break;
    const nextBefore = Math.min(...page.events.map((entry) => entry.event.seq));
    if (nextBefore === beforeSeq) break;
    beforeSeq = nextBefore;
  }
  return projectRuntimeSessionHistory(events);
}

/** DSH persists the canonical event log; UI message snapshots are not written. */
export async function saveMessages(
  _id: string,
  _messages: SessionMessage[],
): Promise<void> {}

/** DSH has no destructive delete RPC; removal is a recoverable local tombstone. */
export async function dropMessages(id: string): Promise<void> {
  if (id) await hideRuntimeSession(id);
}

export function newSessionMeta(
  options: {
    id?: string;
    title?: string;
    agent?: AgentExecutionContext;
  } = {},
): SessionMeta {
  const now = Date.now();
  return {
    id: options.id ?? shortId("sess"),
    title: options.title ?? "",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    source: SOURCE_LOCAL,
    ...(options.agent ? { agent: normalizeAgentContext(options.agent) } : {}),
  };
}

export function deriveTitleFromMessages(
  messages: SessionMessage[],
  fallback = "New chat",
): string {
  const first = messages.find((message) => message.role === "user")?.content;
  const cleaned = first?.replace(/\s+/gu, " ").trim() ?? "";
  if (!cleaned) return fallback;
  return cleaned.length <= 40 ? cleaned : `${cleaned.slice(0, 39)}…`;
}
