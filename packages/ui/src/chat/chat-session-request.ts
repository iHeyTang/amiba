/**
 * Programmatic "start a chat session with this prompt" primitive.
 *
 * Multiple UI surfaces need to enqueue a chat turn without going through
 * the Composer (one-click install buttons, Quick-Ask, future "import
 * this", "summarize that" actions). They all funnel through one storage
 * key — `HOME_PENDING_PROMPT_KEY` — that ChatSurface's drain effect
 * reads on mount and on subscribe-tick. This module is the canonical
 * writer for that key.
 *
 * Design intent
 * -------------
 *
 *   - **Single transactional write.** Some surfaces also need to push
 *     defaults into companion settings alongside the pending prompt.
 *     Combining them into one `storage.set()` avoids the half-state
 *     where autosend fires before the companion key has landed.
 *
 *   - **Mode: "current" | "new".** "current" preserves the long-standing
 *     HomeView behavior — let `ensureActive()` in send() reuse the
 *     already-selected empty session if there is one, mint a fresh one
 *     otherwise. "new" forces a brand new session up-front; use it for
 *     discrete one-shot actions (install flows, system tasks) that
 *     should never get bundled into whatever conversation the user was
 *     in the middle of. Without "new", an install-button click landing
 *     into a stale active session looks like nothing happened — the
 *     submit succeeds but the user is staring at the empty composer of
 *     a session they hadn't opened.
 *
 *   - **Hook + pure split.** `useChatSessionRequester` binds against
 *     `useSessions()` so it can call `createNew()` for the "new" mode;
 *     surfaces outside a session-provider subtree fall back to
 *     `queueChatPrompt` directly and accept the "current" semantics.
 */
import { useCallback } from "react";

import {
  HOME_PENDING_PROMPT_KEY,
  useSessions,
  type AgentExecutionContext,
  type SessionsController,
} from "@amiba/app-runtime/core";
import { getPlatform, type AgentModelSelection } from "@amiba/app-runtime/platform";

import type { PendingPromptAttachment } from "./internal/capabilities";

/**
 * Wire shape stored under `HOME_PENDING_PROMPT_KEY`. Matches what every
 * hand-off surface writes today (HomeView composer, Quick-Ask, snip,
 * URL inbox) so a single drainer in ChatSurface handles them all.
 */
interface PendingPromptPayload {
  text?: string;
  attachments?: PendingPromptAttachment[];
  sourceApp?: string;
  workspacePath?: string;
  agent?: AgentExecutionContext;
  modelSelection?: AgentModelSelection;
  ts: number;
}

export interface ChatSessionRequest {
  /**
   * Prefilled message. At least one of `text` or `attachments` must be
   * provided. Attachment-only hand-offs (e.g. a screen snip without
   * OCR) are valid and supported — autosend won't fire in that case
   * (ChatSurface's autosend gates on `input.trim()` being non-empty),
   * so the user gets the prefilled attachments and types a prompt.
   */
  text?: string;
  /**
   * Optional attachments. Opaque ids must point at already-settled files; the
   * autosend path doesn't wait for in-progress uploads to finish.
   */
  attachments?: PendingPromptAttachment[];
  /**
   * Human-readable origin badge ("Safari", "Brain installer", …) shown
   * above the composer until the user starts editing.
   */
  sourceApp?: string;
  /**
   * Draft workspace selected on the id-less home surface. The receiving chat
   * binds it only after ``ensureActive()`` creates the real conversation.
   */
  workspacePath?: string;
  /** DSH Agent Preset for the new task. */
  agent?: AgentExecutionContext;
  /** Model selected on the id-less new-task surface for the first turn. */
  modelSelection?: AgentModelSelection;
  /**
   * Extra storage keys to write in the same atomic patch as the pending
   * prompt. Use for "set this companion setting only when the user
   * hasn't customized it" type defaults. Resolve any
   * conditional logic at the caller before passing in — this layer
   * doesn't reason about defaults, it just merges.
   */
  storagePatch?: Record<string, unknown>;
}

/**
 * Pure write — no React, no session controller. Writes the pending
 * prompt and any companion settings atomically. Caller is responsible
 * for navigation (`onOpenChat()`) afterwards if the host view isn't
 * already the chat surface.
 *
 * Use this from contexts that can't / don't want to mint a fresh session
 * (the original HomeView composer hand-off — `ensureActive()` in send()
 * picks the right session). Most other surfaces should prefer the hook
 * with `mode: "new"`.
 */
export async function queueChatPrompt(req: ChatSessionRequest): Promise<void> {
  const text = req.text?.trim() ?? "";
  const attachments =
    req.attachments?.filter((a) => a.attachmentId) ?? undefined;
  const hasAttachments = !!attachments && attachments.length > 0;
  if (!text && !hasAttachments) {
    throw new Error(
      "queueChatPrompt: at least one of `text` or `attachments` is required.",
    );
  }
  const payload: PendingPromptPayload = {
    // Omit empty fields so the drain side's "anything to do?" check stays
    // simple — `text === undefined` is its signal for attachment-only.
    text: text || undefined,
    attachments: hasAttachments ? attachments : undefined,
    sourceApp: req.sourceApp,
    workspacePath: req.workspacePath?.trim() || undefined,
    agent: req.agent,
    modelSelection: req.modelSelection,
    ts: Date.now(),
  };
  await getPlatform().storage.set({
    ...req.storagePatch,
    [HOME_PENDING_PROMPT_KEY]: payload,
  });
}

export type ChatSessionMode = "current" | "new";

/**
 * Hook variant. Returns a function that mints a fresh session (when
 * `mode === "new"`) and then writes the pending prompt. The session
 * mint happens BEFORE the storage write so the drain effect's
 * `sessions.activeId`-keyed re-run lands on the new id, and the
 * subscribe-tick re-fire backstops the race where the activeId flip
 * happens before the prompt write completes.
 *
 * Caller still owns navigation (`onOpenChat?.()`) — this hook makes no
 * assumption about whether the host is already in chat view.
 */
export function useChatSessionRequester(): (
  req: ChatSessionRequest & { mode?: ChatSessionMode },
) => Promise<string | void> {
  const sessions: SessionsController = useSessions();
  return useCallback(
    async (req) => {
      let sessionId: string | undefined;
      if (req.mode === "new") {
        // Mint + activate up-front. ChatSurface's drain effect re-runs
        // on activeId change; if that drain races ahead of the prompt
        // write, the subscribe handler will tick it again as soon as
        // the write lands.
        sessionId = await sessions.createNew(req.agent);
      }
      await queueChatPrompt(req);
      return sessionId;
    },
    [sessions],
  );
}
