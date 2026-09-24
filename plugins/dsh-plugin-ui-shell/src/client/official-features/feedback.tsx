import { MessageActionButton } from "@amiba/ui";
import { useEffect, useRef, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  TooltipProvider,
} from "@amiba/ui/primitives";
import type {
  FeedbackDialogProps,
  MessageFeedbackActionProps,
} from "@deepseek-ai/dsh-client-ui-message-feedback/client";

export function FeedbackActions({
  messageId,
  ensure,
  current,
  retract,
  openDialog,
  useFeedback,
  t,
}: MessageFeedbackActionProps) {
  const item = useFeedback((view) => view.items.get(messageId));
  const loadFailed = useFeedback((view) => view.status === "error");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    busy.current = false;
    setPending(false);
    setFailure(null);
    return () => {
      generation.current++;
    };
  }, [messageId]);
  async function choose(rating: "positive" | "negative") {
    if (busy.current) return;
    busy.current = true;
    const version = generation.current;
    setPending(true);
    setFailure(null);
    try {
      const loaded = await ensure();
      if (version !== generation.current) return;
      if (!loaded.ok || current(messageId)?.rating !== rating)
        openDialog(messageId, rating);
      else {
        const result = await retract(messageId, rating);
        if (version === generation.current && !result.ok)
          setFailure(
            t(
              result.error.code === "version-conflict"
                ? "error.conflict"
                : "error.generic",
            ),
          );
      }
    } catch {
      if (version === generation.current) setFailure(t("error.generic"));
    } finally {
      if (version === generation.current) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  const seed = () => {
    void ensure().catch(() => {});
  };
  return (
    <TooltipProvider delayDuration={180} skipDelayDuration={80}>
    <span
      className="inline-flex items-center gap-1"
      onPointerEnter={seed}
      onFocus={seed}
    >
      {(["positive", "negative"] as const).map((rating) => {
        const active = item?.rating === rating;
        const label = t(
          rating === "positive"
            ? active
              ? "action.likeActive"
              : "action.like"
            : active
              ? "action.dislikeActive"
              : "action.dislike",
        );
        const Icon = rating === "positive" ? ThumbsUp : ThumbsDown;
        return (
          <MessageActionButton
            key={rating}
            label={label}
            pressed={active}
            disabled={pending}
            onClick={() => void choose(rating)}
            icon={<Icon />}
          />
        );
      })}
      {(failure || loadFailed) && (
        <span role="alert" className="text-xs text-destructive">
          {failure ?? t("error.load")}
        </span>
      )}
    </span>
    </TooltipProvider>
  );
}

const categories = [
  "task-result",
  "instruction-following",
  "product-interaction",
  "service-stability",
  "resource-cost",
  "security-privacy-permission",
  "other",
] as const;
export function FeedbackDialog({
  useDialog,
  edit,
  submit,
  dismiss,
  dismissToast,
  t,
}: FeedbackDialogProps) {
  const state = useDialog((s) => s);
  useEffect(() => {
    if (!state.toast) return;
    const timer = setTimeout(() => dismissToast(state.toast), 4000);
    return () => {
      clearTimeout(timer);
      dismissToast(state.toast);
    };
  }, [state.toast, dismissToast]);
  return (
    <>
      {state.toast > 0 && (
        <div role="status" className="px-3 py-2 text-xs text-muted-foreground">
          {t("toast.recorded")}
        </div>
      )}
      <Dialog
        open={state.target !== null}
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
      >
        <DialogContent size="compact">
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.hint")}</DialogDescription>
          </DialogHeader>
          <div
            role="group"
            aria-label={t("dialog.categories")}
            className="flex flex-wrap gap-2"
          >
            {categories.map((category) => (
              <Button
                key={category}
                size="sm"
                variant={state.category === category ? "secondary" : "ghost"}
                aria-pressed={state.category === category}
                disabled={state.submitting}
                onClick={() =>
                  edit({
                    category: state.category === category ? null : category,
                  })
                }
              >
                {t(`category.${category}`)}
              </Button>
            ))}
          </div>
          <Textarea
            aria-label={t("dialog.detail")}
            placeholder={t("dialog.hint")}
            value={state.text}
            readOnly={state.submitting}
            onChange={(event) => edit({ text: event.target.value })}
          />
          {state.failure && (
            <p role="alert" className="text-sm text-destructive">
              {t(
                state.failure === "version-conflict"
                  ? "error.conflict"
                  : state.failure === "note-too-large"
                    ? "error.noteTooLarge"
                    : "error.generic",
              )}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={dismiss}>
              {t("close")}
            </Button>
            <Button disabled={state.submitting} onClick={() => void submit()}>
              {t(state.submitting ? "submitting" : "submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
