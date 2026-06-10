import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { TranslateFn } from "@amiba/i18n";
import { shortId } from "@amiba/utils";
import {
  classify,
  isAttachmentReadOk,
  readBlobAsAttachment,
  type Attachment,
  type AttachmentReadResult,
  useSessions,
} from "@amiba/core";

import type { ChatSurfaceCapabilities } from "./capabilities";

/**
 * "Learn mode" is the extension-only record-replay capability — user hits
 * Record, demonstrates a flow in the browser, hits Stop, and the resulting
 * trace lands as a JSON attachment in the composer. The capability layer
 * (chrome-side) owns the actual recording; this hook owns the UI-side
 * pieces: state, refresh / start / stop wrappers, and the composer
 * attachment hand-off after stop.
 *
 * Returns `undefined`-shaped affordances when `capabilities.learn` is
 * absent (desktop) — render-side just checks `recording`/`stopBusy` for
 * the visible button row and `start` / `stopAndAttach` as the click
 * handlers; both no-op when no capability is wired.
 */
export interface UseLearnModeArgs {
  /** Pulled directly from the surface's capabilities object. Either may
   * be absent — `pageContext` is needed by `start` to know which tab to
   * record; `learn` is needed by everything. */
  learn: ChatSurfaceCapabilities["learn"];
  pageContext: ChatSurfaceCapabilities["pageContext"];
  /** From `useSessions()` — we need `ensureActive` for the attachment
   * upload to bind the trace blob to the current session. */
  sessions: ReturnType<typeof useSessions>;
  /** Attachment glue from `useComposerAttachments(...)`. We push the
   * captured trace into the composer's attachment list. */
  attachmentControls: {
    setAttachments: Dispatch<SetStateAction<Attachment[]>>;
    setAttachmentBusy: (v: boolean) => void;
    setAttachmentError: (v: string | null) => void;
  };
  /** Surface-level "page error" banner. Used for the few cases where
   * Learn can fail in a way the user can act on (no active tab, stale
   * recording, bridge missing). */
  setPageError: (v: string | null) => void;
  /** i18n. */
  t: TranslateFn;
}

export interface UseLearnModeResult {
  recording: boolean;
  eventCount: number;
  /** True while Stop is round-tripping the trace through the engine.
   * Distinct from `recording` so the button can show "processing…" copy. */
  stopBusy: boolean;
  /** Begin recording on the active browser tab. No-op without
   * `pageContext` + `learn` capabilities. */
  start: () => Promise<void>;
  /** Stop recording, fetch the trace, and attach it to the composer as
   * `learn-trace-<ts>.json`. */
  stopAndAttach: () => Promise<void>;
}

/** Bounded wait wrapper. Used for the stop + upload paths since both
 * cross the extension bridge and can hang if the SW is asleep. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      reject(new Error(`${label} (exceeded ${Math.round(ms / 1000)}s)`));
    }, ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function useLearnMode(args: UseLearnModeArgs): UseLearnModeResult {
  const {
    learn,
    pageContext,
    sessions,
    attachmentControls,
    setPageError,
    t,
  } = args;
  const { setAttachments, setAttachmentBusy, setAttachmentError } =
    attachmentControls;

  const [recording, setRecording] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [stopBusy, setStopBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!learn) return;
    try {
      const r = await learn.getStatus();
      setRecording(!!r.active);
      setEventCount(typeof r.eventCount === "number" ? r.eventCount : 0);
    } catch {
      // Engine not ready yet.
    }
  }, [learn]);

  const start = useCallback(async (): Promise<void> => {
    if (!learn || !pageContext) return;
    try {
      const tab = await pageContext.getActiveBrowserTab();
      if (tab?.id === undefined) {
        setPageError(
          "Cannot start recording: no active web tab detected. Open the page you want to demo, then click “Record actions”.",
        );
        return;
      }
      const r = await learn.start(tab.id);
      if (!r?.ok) {
        setPageError(r?.error || t("sidepanel.permission.failedRecordStart"));
        return;
      }
      await refresh();
    } catch (e) {
      setPageError(String((e as Error)?.message || e));
    }
  }, [learn, pageContext, setPageError, t, refresh]);

  const stopAndAttach = useCallback(async (): Promise<void> => {
    if (!learn) return;
    setStopBusy(true);
    let trace: unknown = null;
    try {
      const r = (await withTimeout(
        learn.stop(),
        25_000,
        "Stop-recording request timed out (the extension background may be asleep)",
      )) as { ok?: boolean; trace?: unknown; error?: string };
      if (!r?.ok) {
        setPageError(r?.error || t("sidepanel.permission.failedRecordStop"));
        return;
      }
      if (!r.trace) {
        setPageError(
          "No active recording, or the session has expired. Click “Record actions” first, demonstrate, then click “Stop and attach”.",
        );
        await refresh();
        return;
      }
      trace = r.trace;
    } catch (e) {
      setPageError(String((e as Error)?.message || e));
      return;
    } finally {
      // Clear before attachment upload: the put can hang for a long time
      // when the bridge isn't connected, and we don't want the Stop
      // button stuck in perpetual "processing…" while we wait on it.
      setStopBusy(false);
    }

    await refresh();

    setAttachmentBusy(true);
    setAttachmentError(null);
    const sessionId = sessions.ready
      ? await sessions.ensureActive()
      : "default";
    const name = `learn-trace-${Date.now()}.json`;
    const blob = new Blob([JSON.stringify(trace, null, 2)], {
      type: "application/json",
    });
    const pendingUiId = shortId("att");
    const pending: Attachment = {
      uiId: pendingUiId,
      name,
      mime: "application/json",
      size: blob.size,
      kind: classify(name, "application/json"),
      uploading: true,
    };
    setAttachments((prev) => [...prev, pending]);
    try {
      const read = (await withTimeout(
        readBlobAsAttachment({
          blob,
          name,
          mime: "application/json",
          options: { sessionId, uiId: pendingUiId },
        }),
        130_000,
        "Recorded-trace upload timed out (keep Hermes online; large traces are slower)",
      )) as AttachmentReadResult;
      if (!isAttachmentReadOk(read)) {
        const hint =
          read.error.includes("No Hermes plugin peer") ||
          read.error.includes("role=agent")
            ? "Extension is connected to the bridge, but Hermes hasn't joined as the plugin (agent side missing). Start Hermes and load this browser plugin."
            : "Check that Hermes is running, the bridge is connected, and the gateway is healthy.";
        setAttachmentError(`${read.name}: ${read.error} ${hint}`);
        setAttachments((prev) => prev.filter((a) => a.uiId !== pendingUiId));
        return;
      }
      setAttachments((prev) =>
        prev.map((a) => (a.uiId === pendingUiId ? read.attachment : a)),
      );
      setPageError(null);
    } catch (e) {
      setAttachmentError(String((e as Error)?.message || e));
      setAttachments((prev) => prev.filter((a) => a.uiId !== pendingUiId));
    } finally {
      setAttachmentBusy(false);
    }
    await refresh();
  }, [
    learn,
    sessions,
    setAttachments,
    setAttachmentBusy,
    setAttachmentError,
    setPageError,
    t,
    refresh,
  ]);

  // Learn status: the capability emits state-change events when the
  // recording in the engine flips. Refresh once on mount; subscribe for
  // the rest of the lifetime.
  useEffect(() => {
    void refresh();
    if (!learn) return;
    return learn.onStateChange((status) => {
      setRecording(!!status.active);
      setEventCount(typeof status.eventCount === "number" ? status.eventCount : 0);
    });
  }, [learn, refresh]);

  return { recording, eventCount, stopBusy, start, stopAndAttach };
}
