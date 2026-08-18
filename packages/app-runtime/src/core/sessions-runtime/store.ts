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

async function readRuntimeHiddenSessions(): Promise<Set<string>> {
  const value = (
    await getPlatform().storage.get([RUNTIME_HIDDEN_SESSIONS_KEY])
  )[RUNTIME_HIDDEN_SESSIONS_KEY];
  return new Set(
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [],
  );
}

async function hideRuntimeSession(id: string): Promise<void> {
  const hidden = await readRuntimeHiddenSessions();
  hidden.add(id);
  await getPlatform().storage.set({
    [RUNTIME_HIDDEN_SESSIONS_KEY]: [...hidden],
  });
}

function pickLocalFields(session: SessionMeta): SessionLocalMeta {
  const result: SessionLocalMeta = {};
  if (session.pinned) result.pinned = true;
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
    Boolean(a.pinned) === Boolean(b.pinned) &&
    Boolean(a.archived) === Boolean(b.archived) &&
    Boolean(a.unread) === Boolean(b.unread) &&
    Boolean(a.titleManual) === Boolean(b.titleManual) &&
    JSON.stringify(a.agent ?? null) === JSON.stringify(b.agent ?? null) &&
    a.parentSessionId === b.parentSessionId &&
    a.branchMessageId === b.branchMessageId
  );
}

export async function loadIndex(): Promise<SessionMeta[]> {
  const [summaries, local, hidden] = await Promise.all([
    sessionsAdapter().list(),
    readLocalMeta(),
    readRuntimeHiddenSessions(),
  ]);
  lastSavedLocalMeta = local;
  const result = summaries
    .filter((summary) => !summary.blank && !hidden.has(summary.sessionId))
    .map((summary): SessionMeta => {
      const sidecar = local[summary.sessionId];
      return {
        id: summary.sessionId,
        title: summary.title ?? "",
        createdAt: summary.updatedAt,
        updatedAt: summary.updatedAt,
        pinned: sidecar?.pinned,
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
    })
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
    if (before && current.title.trim() && current.title !== before.title) {
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
