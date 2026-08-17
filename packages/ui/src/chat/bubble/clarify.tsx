import { Check, Loader2, MessageCircleQuestion } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  UserQuestionAnswerItem,
  UserQuestionRequest,
} from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";

import { Button, Input, cn } from "../../primitives";

export function ClarifyBanner({
  request,
  inFlight,
  error,
  onRespond,
}: {
  request: UserQuestionRequest;
  inFlight: boolean;
  error: string | null;
  onRespond: (answers: UserQuestionAnswerItem[]) => void;
}) {
  const { t } = useT();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});

  useEffect(() => {
    setSelected({});
    setCustom({});
  }, [request.requestId]);

  const answers = useMemo<UserQuestionAnswerItem[]>(
    () =>
      request.questions.map((question) => ({
        id: question.id,
        selected: selected[question.id] ?? [],
        ...(custom[question.id]?.trim()
          ? { custom: custom[question.id].trim() }
          : {}),
      })),
    [custom, request.questions, selected],
  );
  const complete =
    answers.length > 0 &&
    answers.every((answer) => answer.selected.length > 0 || answer.custom);

  function choose(questionId: string, choice: string, multiSelect: boolean) {
    setCustom((current) => ({ ...current, [questionId]: "" }));
    setSelected((current) => {
      const values = current[questionId] ?? [];
      return {
        ...current,
        [questionId]: multiSelect
          ? values.includes(choice)
            ? values.filter((value) => value !== choice)
            : [...values, choice]
          : [choice],
      };
    });
  }

  function writeCustom(questionId: string, value: string) {
    setCustom((current) => ({ ...current, [questionId]: value }));
    if (value) {
      setSelected((current) => ({ ...current, [questionId]: [] }));
    }
  }

  if (request.questions.length === 0) return null;

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm">
      {/* Fixed header strip — stays visible while the questions scroll. */}
      <div className="flex items-center gap-2 border-b border-border/45 px-4 py-2.5">
        <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
          {t("sidepanel.clarify.label")}
        </p>
        {request.questions.length > 1 ? (
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground/60">
            {request.questions.length}
          </span>
        ) : null}
      </div>

      {/* The questions own the scroll: the banner sits above the composer,
          so unbounded content would push the whole footer off-screen. */}
      <div className="max-h-[min(48vh,400px)] overflow-y-auto px-4 py-3">
        <div className="grid gap-4">
          {request.questions.map((question, questionIndex) => {
            const activeChoices = selected[question.id] ?? [];
            const choices = question.options ?? [];
            return (
              <section
                className={cn(
                  questionIndex > 0 && "border-t border-border/45 pt-4",
                )}
                key={question.id}
              >
                {question.header ? (
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
                    {question.header}
                  </p>
                ) : null}
                <p className="mt-1 text-sm font-medium leading-relaxed">
                  {question.question}
                </p>
                {question.detail ? (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {question.detail}
                  </p>
                ) : null}

                {choices.length > 0 ? (
                  <div className="mt-2.5 grid gap-1.5">
                    {choices.map((choice) => {
                      const active = activeChoices.includes(choice.label);
                      return (
                        <button
                          className={cn(
                            "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                            active
                              ? "border-primary/45 bg-primary/[0.08]"
                              : "border-border/60 hover:bg-accent/60",
                          )}
                          disabled={inFlight}
                          key={choice.label}
                          onClick={() =>
                            choose(
                              question.id,
                              choice.label,
                              question.multiSelect === true,
                            )
                          }
                          type="button"
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border transition-colors",
                              question.multiSelect
                                ? "rounded-[5px]"
                                : "rounded-full",
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-muted-foreground/35",
                            )}
                          >
                            {active ? (
                              <Check className="h-3 w-3" strokeWidth={3} />
                            ) : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block leading-snug">
                              {choice.label}
                            </span>
                            {choice.description ? (
                              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                                {choice.description}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <Input
                  aria-label={`${t("sidepanel.clarify.customAnswer")} ${questionIndex + 1}`}
                  className="mt-2.5 h-8 border-0 bg-muted/35 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-1"
                  disabled={inFlight}
                  onChange={(event) =>
                    writeCustom(question.id, event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && complete) onRespond(answers);
                  }}
                  placeholder={t("sidepanel.clarify.customAnswer")}
                  value={custom[question.id] ?? ""}
                />
              </section>
            );
          })}
        </div>
      </div>

      {/* Fixed footer — the confirm affordance never scrolls away. */}
      <div className="flex items-center justify-end gap-3 border-t border-border/45 bg-muted/20 px-4 py-2.5">
        {error ? (
          <p className="mr-auto min-w-0 truncate text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <Button
          className="h-8 shrink-0"
          disabled={inFlight || !complete}
          onClick={() => onRespond(answers)}
          size="sm"
          type="button"
        >
          {inFlight ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {request.questions.length > 1
            ? t("sidepanel.clarify.send")
            : t("sidepanel.clarify.confirmSelection")}
        </Button>
      </div>
    </div>
  );
}
