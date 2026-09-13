import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import {
  Button,
  Dialog,
  DialogContent,
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
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const renderActions = useCallback(
    (actions: ReactNode) =>
      actionsHost ? createPortal(actions, actionsHost) : null,
    [actionsHost],
  );
  const [progressHost, setProgressHost] = useState<HTMLDivElement | null>(null);
  const renderProgress = useCallback(
    (content: ReactNode) =>
      progressHost ? createPortal(content, progressHost) : null,
    [progressHost],
  );
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
        hideDefaultClose
        className={`flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0 transition-none ${started ? "h-[min(760px,90vh)]" : "h-[min(480px,90vh)]"}`}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{t("guide.settings")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("guide.description")}
        </DialogDescription>
        <aside
          className={`flex flex-col px-6 pt-6 sm:px-8 ${started ? "shrink-0 pb-2" : "min-h-0 flex-1"}`}
        >
          {started ? (
            <div ref={setProgressHost} className="pt-1" />
          ) : (
            <div className="flex items-center gap-2 text-xs tracking-wide text-muted-foreground">
              <span className="font-semibold text-foreground">AMIBA</span>
              <span aria-hidden="true">/</span>
              {t("guide.companionLabel")}
            </div>
          )}
          <div
            className={`flex gap-4 ${started ? "items-center pt-5" : "min-h-0 flex-1 flex-col items-center justify-center py-6 text-center"}`}
          >
            <div className="flex h-28 w-28 shrink-0 items-center justify-center">
              {renderSlot("amiba.onboarding.companion", { mood })}
            </div>
            <p
              role={error ? "alert" : "status"}
              className={`text-sm leading-relaxed ${started ? "rounded-2xl bg-muted/40 px-4 py-4" : "max-w-full whitespace-pre-line rounded-[28px] bg-muted/40 px-8 py-3 leading-7 [text-wrap:balance]"}`}
            >
              {message}
            </p>
          </div>
        </aside>
        <div
          className={`flex min-h-0 min-w-0 flex-col px-6 pb-5 sm:px-8 ${started ? "flex-1 pt-2" : "shrink-0"}`}
        >
          {started && (
            <div
              data-guide-scroll
              className="min-h-0 flex-1 overflow-y-auto pb-6 pt-1"
            >
              {ready && (
                <div className="flex h-full flex-col justify-center gap-4">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {t("guide.finishTitle")}
                  </h2>
                  <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                    {t("guide.finishBody")}
                  </p>
                </div>
              )}
              {started && rows.length > 1 && (
                <ol
                  aria-label={t("guide.settings")}
                  className="flex flex-wrap gap-3 text-xs text-muted-foreground"
                >
                  {rows.map((row, index) => (
                    <li
                      key={row.id}
                      aria-current={active?.id === row.id ? "step" : undefined}
                      className={
                        active?.id === row.id
                          ? "font-medium text-foreground"
                          : ""
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
                  {
                    complete,
                    say,
                    openSection,
                    renderActions,
                    renderProgress,
                    backToWelcome: () => {
                      setDialogue(undefined);
                      setStarted(false);
                    },
                  },
                  { only: active.id },
                )}
            </div>
          )}
          <footer
            className="flex shrink-0 flex-wrap items-center gap-2 border-t pt-4"
            aria-label={t("guide.navigation")}
          >
            <div className="flex items-center gap-1">
              <Button variant="ghost" disabled={working} onClick={close}>
                {t("guide.later")}
              </Button>
              {active && rows.length > 1 && (
                <Button
                  variant="ghost"
                  disabled={working}
                  onClick={() => void complete(true).catch(() => {})}
                >
                  {t("guide.skip")}
                </Button>
              )}
            </div>
            <div
              ref={setActionsHost}
              className="ml-auto flex items-center gap-2"
            >
              {!progress ? (
                <Button onClick={() => setRetry((n) => n + 1)}>
                  {t("guide.retry")}
                </Button>
              ) : !started ? (
                <Button onClick={() => setStarted(true)}>
                  {t("guide.start")}
                </Button>
              ) : ready ? (
                <Button disabled={working} onClick={() => void finish()}>
                  {t("guide.done")}
                </Button>
              ) : null}
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
