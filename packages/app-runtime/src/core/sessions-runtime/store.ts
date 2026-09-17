import { getPlatform, type AgentSessionHistoryEntry, type AgentSubagentAddress } from "@amiba/app-runtime/platform";
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

/** History page size used when loading a session's full event log. */
const SESSION_HISTORY_PAGE_SIZE = 1000;

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

function pickLocalFields(session: SessionMeta): SessionLocalMeta {
  const result: SessionLocalMeta = {};
  const address = retainedAddress(session.id, session.subagentAddress);
  if (address) result.subagentAddress = address;
  if (session.unread) result.unread = true;
  if (session.readAt !== undefined) result.readAt = session.readAt;
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
    a.readAt === b.readAt &&
    Boolean(a.titleManual) === Boolean(b.titleManual) &&
    JSON.stringify(a.agent ?? null) === JSON.stringify(b.agent ?? null) &&
    a.parentSessionId === b.parentSessionId &&
    JSON.stringify(a.subagentAddress ?? null) === JSON.stringify(b.subagentAddress ?? null) &&
    a.branchMessageId === b.branchMessageId
  );
}

/** Persisted addresses are hints, never authority to resume a root Agent. */
function retainedAddress(id: string, value: unknown): AgentSubagentAddress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const address = value as Partial<AgentSubagentAddress>;
  if (address.childSessionId !== id || typeof address.parentSessionId !== "string" ||
      !address.parentSessionId || address.parentSessionId === id ||
      (address.mode !== "one-shot" && address.mode !== "continuable")) return undefined;
  return { parentSessionId: address.parentSessionId, childSessionId: id, mode: address.mode };
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
    subagentAddress: retainedAddress(summary.sessionId, sidecar?.subagentAddress),
    title: summary.title ?? "",
    createdAt: summary.updatedAt,
    updatedAt: summary.updatedAt,
    archived: archivedIds.has(summary.sessionId) ? true : undefined,
    unread: sidecar?.unread,
    readAt: sidecar?.readAt,
    titleManual: sidecar?.titleManual,
    parentSessionId: summary.parentSessionId ?? sidecar?.parentSessionId,
    origin: summary.origin,
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
  subagent?: AgentSubagentAddress,
): Promise<SessionMeta | undefined> {
  if (subagent && !retainedAddress(id, subagent)) throw new Error("Invalid subagent navigation address");
  const [summaries, local, archivedIds] = await Promise.all([
    sessionsAdapter().list(),
    readLocalMeta(),
    loadArchivedSessionIds(),
  ]);
  const address = retainedAddress(id, subagent ?? local[id]?.subagentAddress);
  const summary = summaries.find((item) => item.sessionId === id);
  if (address && summary?.parentSessionId && summary.parentSessionId !== address.parentSessionId) {
    throw new Error("Subagent navigation address conflicts with the Host parent");
  }
  if (!summary && !address) return undefined;
  // Catalog children may intentionally have no root-list row. The address
  // supplies identity only; transcript reads still go through Host validation.
  const meta = toSessionMeta(summary ?? {
    sessionId: id, updatedAt: 0, running: false, blank: false,
    origin: "subagent", parentSessionId: address!.parentSessionId,
  }, local[id], archivedIds);
  return address ? { ...meta, subagentAddress: address, parentSessionId: address.parentSessionId } : meta;
}

export async function loadIndex(): Promise<SessionMeta[]> {
  const local = await readLocalMeta();
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
  // One Set instead of `index.some(...)` inside the cleanup loop below —
  // with hundreds of sessions that was an O(n·m) scan on every index write.
  const indexIds = new Set(index.map((session) => session.id));

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
    if (!indexIds.has(id) && local[id]) {
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

export async function loadMessages(id: string, subagent?: AgentSubagentAddress): Promise<SessionMessage[]> {
  if (!id) return [];
  const events: AgentSessionHistoryEntry[] = [];
  let beforeSeq: number | undefined;
  for (;;) {
    const page = await sessionsAdapter().history(id, {
      ...(subagent ? { subagent } : {}),
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      // Large pages: the DSH history endpoint accepts any positive integer
      // and paginates the full (decompressed) log per call, so a bigger page
      // directly cuts the number of full-log decodes. A long session that
      // previously needed ~19 sequential round trips now needs ~4.
      maxMessages: SESSION_HISTORY_PAGE_SIZE,
    });
    events.push(...page.events);
    if (!page.hasMore || page.events.length === 0) break;
    const nextBefore = Math.min(...page.events.map((entry) => entry.event.seq));
    if (nextBefore === beforeSeq) break;
    beforeSeq = nextBefore;
  }
  const messages = projectRuntimeSessionHistory(events);
  return messages;
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
