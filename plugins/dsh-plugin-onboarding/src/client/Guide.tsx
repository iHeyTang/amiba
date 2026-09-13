import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  usePluginT,
} from "@amiba/ui/plugin";
import type { GuideMood } from "./contracts.js";
import type { Progress, ProgressStore } from "./progress.js";
import { guideI18n } from "./i18n.js";
export interface StepSource {
  getSnapshot(): readonly { id: string; label: string }[];
  subscribe(listener: () => void): () => void;
}
export type GuideProps = PropsRenderSlots<
  "amiba.onboarding.step" | "amiba.onboarding.companion"
> & {
  store: ProgressStore;
  steps: StepSource;
  close(): void;
  openSection(id: string): void;
  revisit?: boolean;
};
export function Guide({
  store,
  steps,
  close,
  openSection,
  renderSlot,
  revisit = false,
}: GuideProps) {
  const { t } = usePluginT(guideI18n);
  const rows = useSyncExternalStore(steps.subscribe, steps.getSnapshot);
  const [progress, setProgress] = useState<Progress>();
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [dialogue, setDialogue] = useState<{
    message: string;
    mood: GuideMood;
    stepId?: string;
  }>();
  useEffect(() => {
    let live = true;
    setError(false);
    store
      .read()
      .then((data) => {
        if (live)
          setProgress(revisit ? { completed: [], finished: false } : data);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [store, revisit, retry]);
  useEffect(() => {
    if (progress?.finished) close();
  }, [progress?.finished, close]);
  const active = started
    ? rows.find((row) => !progress?.completed.includes(row.id))
    : undefined;
  const say = useCallback(
    (message: string, mood: GuideMood = "waiting") =>
      setDialogue({ message, mood, stepId: active?.id }),
    [active?.id],
  );
  const complete = useCallback(
    async (skipped = false) => {
      if (!active || busy) return;
      setBusy(true);
      setError(false);
      try {
        await store.mark(active.id, skipped);
        setProgress(
          (current) =>
            current && {
              ...current,
              completed: [...new Set([...current.completed, active.id])],
              skipped: [
                ...(current.skipped ?? []).filter((id) => id !== active.id),
                ...(skipped ? [active.id] : []),
              ],
            },
        );
      } catch (e) {
        setError(true);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [active?.id, busy, store],
  );
  async function finish() {
    setBusy(true);
    setError(false);
    try {
      await store.finish();
      close();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  if (progress?.finished) return null;
  // Do not flash the welcome modal for returning users while reading settings.
  if (!progress && !error) return null;
  const ready = started && !active;
  const currentDialogue =
    dialogue?.stepId === active?.id ? dialogue : undefined;
  const working = busy || currentDialogue?.mood === "loading";
  const mood = error
    ? "failed"
    : busy
      ? "loading"
      : ready
        ? "completed"
        : (currentDialogue?.mood ?? "idle");
  const message = error
    ? t("guide.error")
    : ready
      ? t(
          !rows.length
            ? "guide.none"
            : progress?.skipped?.length
              ? "guide.deferred"
              : "guide.ready",
        )
      : (currentDialogue?.message ?? t(started ? "guide.step" : "guide.hello"));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !working) close();
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] max-w-2xl flex-col overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("guide.title")}</DialogTitle>
          <DialogDescription>{t("guide.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-4 py-3">
          <div className="flex h-28 w-28 shrink-0 items-center justify-center">
            {renderSlot("amiba.onboarding.companion", { mood })}
          </div>
          <p
            role={error ? "alert" : "status"}
            className="rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed"
          >
            {message}
          </p>
        </div>
        {started && rows.length > 0 && (
          <ol
            aria-label={t("guide.settings")}
            className="flex flex-wrap gap-3 text-xs text-muted-foreground"
          >
            {rows.map((row, index) => (
              <li
                key={row.id}
                aria-current={active?.id === row.id ? "step" : undefined}
                className={
                  active?.id === row.id ? "font-medium text-foreground" : ""
                }
              >
                {progress?.skipped?.includes(row.id)
                  ? "–"
                  : progress?.completed.includes(row.id)
                    ? "✓"
                    : index + 1}{" "}
                · {row.label}
              </li>
            ))}
          </ol>
        )}
        {active &&
          renderSlot(
            "amiba.onboarding.step",
            { complete, say, openSection },
            { only: active.id },
          )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button variant="ghost" disabled={working} onClick={close}>
            {t("guide.later")}
          </Button>
          {!progress ? (
            <Button onClick={() => setRetry((n) => n + 1)}>
              {t("guide.retry")}
            </Button>
          ) : !started ? (
            <Button onClick={() => setStarted(true)}>{t("guide.start")}</Button>
          ) : ready ? (
            <Button disabled={working} onClick={() => void finish()}>
              {t("guide.done")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              disabled={working}
              onClick={() => void complete(true).catch(() => {})}
            >
              {t("guide.skip")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
