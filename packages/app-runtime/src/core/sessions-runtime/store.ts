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

/**
 * Legacy local-delete tombstones (`[{ id, hiddenAt }]`, or bare ids before
 * that). Amiba no longer deletes sessions at all — DSH has no destructive
 * delete and its archive is the real, host-owned equivalent — so this key is
 * only ever READ once, by the migration below, and then dropped.
 */
const RUNTIME_HIDDEN_SESSIONS_KEY = "sessions.runtime-hidden";
/** Set once the legacy archive/tombstone drain has run. */
const ARCHIVE_MIGRATION_KEY = "sessions.archive-migrated";
let lastSavedIndex: Map<string, SessionMeta> | null = null;
let lastSavedLocalMeta: Record<string, SessionLocalMeta> = {};

function sessionsAdapter() {
  const adapter = getPlatform().agentSessions;
  if (!adapter) throw new Error("DSH sessions are unavailable.");
  return adapter;
}

/**
 * The archive set lives on DSH's workspace registry — `workspace.list`
 * returns it as the reconnect baseline and `workspace.archiveSession`
 * returns the full updated set — so the workspaces adapter, not the sessions
 * one, is the archive's platform face.
 */
function workspacesAdapter() {
  const adapter = getPlatform().agentWorkspaces;
  if (!adapter) throw new Error("DSH workspaces are unavailable.");
  return adapter;
}

/** Registry-global archive set, as the host currently knows it. */
export async function loadArchivedSessionIds(): Promise<Set<string>> {
  const { archivedSessionIds } = await workspacesAdapter().list();
  return new Set(archivedSessionIds);
}

/**
 * Archive one session on the host and return the full updated set. There is
 * no unarchive RPC yet ("a future unarchive restores its position"), so this
 * is deliberately one-way.
 */
export async function archiveSession(id: string): Promise<Set<string>> {
  const { archivedSessionIds } = await workspacesAdapter().archiveSession(id);
  return new Set(archivedSessionIds);
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

/** Ids in a legacy `sessions.runtime-hidden` value, in either stored shape. */
function legacyHiddenIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    // Oldest shape: a bare id. Later shape: `{ id, hiddenAt }`.
    if (typeof entry === "string") {
      if (entry) ids.push(entry);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const { id } = entry as { id?: unknown };
    if (typeof id === "string" && id) ids.push(id);
  }
  return ids;
}

/**
 * One-time drain of the two legacy local keys into DSH's own archive.
 *
 * Both of them meant "the user does not want to see this session": the
 * sidecar's `archived` flag and the delete tombstone. DSH now owns that
 * decision, so every id in either key is archived on the host once, and the
 * legacy keys are then cleared — the sidecar keeps its remaining fields
 * (unread / titleManual / agent / parentSessionId / branchMessageId).
 *
 * The drain is the ONLY record that those sessions were ever hidden, so it
 * must never destroy that record on a pass the host could not answer:
 *
 *   - `session-not-found` is a real host answer for a log DSH never had —
 *     the id counts as HANDLED and is dropped.
 *   - any other per-id failure keeps that id in the legacy key it came from,
 *     so the next load retries just that id.
 *   - the marker is written only once nothing is left pending; a pass that
 *     handled nothing at all (a wholesale RPC/transport failure, e.g. the DSH
 *     connection not yet up on the first post-upgrade load) writes nothing —
 *     legacy keys and marker stay exactly as they were.
 *
 * A failure is always logged and never propagated: it must not make the whole
 * session index unloadable.
 */
async function migrateLegacyArchiveState(
  local: Record<string, SessionLocalMeta>,
): Promise<Record<string, SessionLocalMeta>> {
  const storage = getPlatform().storage;
  const stored = await storage.get([
    ARCHIVE_MIGRATION_KEY,
    RUNTIME_HIDDEN_SESSIONS_KEY,
  ]);
  if (stored[ARCHIVE_MIGRATION_KEY]) return local;

  const localPending = new Set<string>();
  for (const [id, meta] of Object.entries(local)) {
    if ((meta as { archived?: boolean } | undefined)?.archived) {
      localPending.add(id);
    }
  }
  const hiddenPending = new Set(
    legacyHiddenIds(stored[RUNTIME_HIDDEN_SESSIONS_KEY]),
  );

  const unhandled = new Set<string>();
  let handledAny = false;
  for (const id of new Set([...localPending, ...hiddenPending])) {
    try {
      await archiveSession(id);
      handledAny = true;
    } catch (error) {
      // A host that answers "no such session" IS reachable, and the id has
      // nothing left to archive — treat it as drained.
      if (runtimeErrorCode(error) === "session-not-found") handledAny = true;
      else unhandled.add(id);
      console.warn(
        `[agent-sessions] archive migration skipped ${JSON.stringify(id)}:`,
        error,
      );
    }
  }

  // Nothing got through: assume the host, not the ids, is the problem and
  // leave every legacy key untouched so the next load retries the whole set.
  if (unhandled.size > 0 && !handledAny) return local;

  const next: Record<string, SessionLocalMeta> = {};
  for (const [id, meta] of Object.entries(local)) {
    const { archived, ...rest } = (meta ?? {}) as SessionLocalMeta & {
      archived?: boolean;
    };
    // Keep the flag only where the host refused it — that id is retried.
    const kept: SessionLocalMeta = unhandled.has(id)
      ? ({ ...rest, ...(archived ? { archived } : {}) } as SessionLocalMeta)
      : (rest as SessionLocalMeta);
    if (Object.keys(kept).length > 0) next[id] = kept;
  }
  const hiddenLeft = [...hiddenPending].filter((id) => unhandled.has(id));
  await storage.set({
    [LOCAL_META_KEY]: next,
    ...(hiddenLeft.length > 0 ? { [RUNTIME_HIDDEN_SESSIONS_KEY]: hiddenLeft } : {}),
    // Only a fully drained pass ends the migration; anything left pending
    // keeps the marker off so the next load picks the remainder back up.
    ...(unhandled.size === 0 ? { [ARCHIVE_MIGRATION_KEY]: true } : {}),
  });
  if (hiddenLeft.length === 0) {
    await storage.remove(RUNTIME_HIDDEN_SESSIONS_KEY);
  }
  return next;
}

function pickLocalFields(session: SessionMeta): SessionLocalMeta {
  const result: SessionLocalMeta = {};
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

/**
 * One host summary + the host archive set + its local sidecar → the
 * renderer's SessionMeta. `archived` is projected from the host set alone.
 */
function toSessionMeta(
  summary: SessionSummaryLike,
  sidecar: SessionLocalMeta | undefined,
  archivedIds: ReadonlySet<string>,
): SessionMeta {
  return {
    id: summary.sessionId,
    title: summary.title ?? "",
    createdAt: summary.updatedAt,
    updatedAt: summary.updatedAt,
    archived: archivedIds.has(summary.sessionId) ? true : undefined,
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
 * An archived session stays openable: archiving hides a session from the
 * active list, it does not take it away.
 */
export async function loadSessionMeta(
  id: string,
): Promise<SessionMeta | undefined> {
  const [summaries, local, archivedIds] = await Promise.all([
    sessionsAdapter().list(),
    readLocalMeta(),
    loadArchivedSessionIds(),
  ]);
  const summary = summaries.find((item) => item.sessionId === id);
  if (!summary) return undefined;
  return toSessionMeta(summary, local[id], archivedIds);
}

export async function loadIndex(): Promise<SessionMeta[]> {
  // The drain runs BEFORE the archive set is read, so a session it archives
  // is already projected as archived by this very load.
  const local = await migrateLegacyArchiveState(await readLocalMeta());
  const [summaries, archivedIds] = await Promise.all([
    sessionsAdapter().list(),
    loadArchivedSessionIds(),
  ]);
  lastSavedLocalMeta = local;
  const result = summaries
    .filter((summary) => !summary.blank)
    .map((summary) =>
      toSessionMeta(summary, local[summary.sessionId], archivedIds),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
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
