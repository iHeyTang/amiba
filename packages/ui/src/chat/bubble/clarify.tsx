import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Streamdown } from "streamdown";

import type {
  UserQuestionAnswerItem,
  UserQuestionItem,
  UserQuestionOption,
  UserQuestionRequest,
} from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";

import { Button, Input, cn } from "../../primitives";

/**
 * The user-questions surface over DSH's ask_user_question waits. Mirrors the
 * official dsh-client-ui-user-questions SEMANTICS (that plugin is disabled in
 * our bundles — the whole conversation UI is ours) in Amiba's own design
 * language:
 *
 *  - one takeover, two shapes: a request narrowing to a plan review renders
 *    as a decision card; everything else takes the stepper flow;
 *  - the stepper shows ONE question at a time — picking a single-select
 *    option advances, the primary button reads 下一题 until the last
 *    question's 提交, and a pager walks back for edits.
 */

interface PlanReview {
  id: string;
  question: string;
  plan: string;
  approve: UserQuestionOption;
  decline?: UserQuestionOption;
}

/**
 * Port of the official narrowing: the plan-review card is one decision over
 * one plan and claims a request only when two buttons can express every
 * answer the request allows — a single question declaring the intent,
 * carrying the plan as `detail`, single-select, at most one option besides
 * the approve label. Anything else stays with the generic stepper, as does
 * any malformed intent (the client sits downstream of a wire boundary).
 */
export function planReviewOf(
  questions: UserQuestionItem[],
): PlanReview | undefined {
  if (questions.length !== 1) return undefined;
  const question = questions[0];
  const intent = question.intent;
  if (intent?.kind !== "plan-review" || question.detail === undefined) {
    return undefined;
  }
  if (question.multiSelect === true) return undefined;
  const options = question.options ?? [];
  if (options.length > 2) return undefined;
  const approve = options.find((option) => option.label === intent.approve);
  if (approve === undefined) return undefined;
  const decline = options.find((option) => option.label !== intent.approve);
  return {
    id: question.id,
    question: question.question,
    plan: question.detail,
    approve,
    ...(decline === undefined ? {} : { decline }),
  };
}

/** Split the conventional "(推荐)"/"(Recommended)" suffix off an option label. */
function parseRecommendedLabel(label: string): {
  label: string;
  recommended: boolean;
} {
  const suffix =
    /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
  return suffix.test(label)
    ? { label: label.replace(suffix, ""), recommended: true }
    : { label, recommended: false };
}

function isComposing(event: KeyboardEvent<HTMLInputElement>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

interface QuestionDraft {
  selected: string[];
  custom: string;
  skipped: boolean;
}

const emptyDraft = (): QuestionDraft => ({
  selected: [],
  custom: "",
  skipped: false,
});

const answered = (draft: QuestionDraft): boolean =>
  draft.selected.length > 0 || draft.custom.trim() !== "";
const completed = (draft: QuestionDraft): boolean =>
  answered(draft) || draft.skipped;

export interface ClarifyBannerProps {
  request: UserQuestionRequest;
  inFlight: boolean;
  error: string | null;
  onRespond: (answers: UserQuestionAnswerItem[]) => void;
  /** Reject the whole wait — DSH resolves the ask tool call as cancelled. */
  onCancel?: () => void;
}

export function ClarifyBanner(props: ClarifyBannerProps) {
  const review = useMemo(
    () => planReviewOf(props.request.questions),
    [props.request],
  );
  if (props.request.questions.length === 0) return null;
  return review === undefined ? (
    <QuestionStepper key={props.request.requestId} {...props} />
  ) : (
    <PlanReviewCard
      key={props.request.requestId}
      review={review}
      {...props}
    />
  );
}

function PlanReviewCard({
  review,
  inFlight,
  error,
  onRespond,
  onCancel,
}: ClarifyBannerProps & { review: PlanReview }) {
  const { t } = useT();
  const decide = (label: string) =>
    onRespond([{ id: review.id, selected: [label] }]);
  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-amber-500/40 bg-background shadow-sm">
      <div className="flex items-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2.5">
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-amber-700/90 dark:text-amber-300/90">
          {t("sidepanel.clarify.plan.header")}
        </p>
      </div>
      <div className="max-h-[min(48vh,400px)] overflow-y-auto px-4 py-3">
        <Streamdown mode="static" className="chat-md break-words text-sm">
          {review.plan}
        </Streamdown>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border/45 bg-muted/20 px-4 py-2.5">
        {error ? (
          <p className="mr-auto min-w-0 truncate text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {onCancel ? (
          <Button
            className="h-8 shrink-0 gap-1.5 text-muted-foreground"
            disabled={inFlight}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t("sidepanel.clarify.plan.discuss")}
          </Button>
        ) : null}
        {review.decline ? (
          <Button
            className="h-8 shrink-0"
            disabled={inFlight}
            onClick={() => decide(review.decline!.label)}
            size="sm"
            title={review.decline.description}
            type="button"
            variant="outline"
          >
            {t("sidepanel.clarify.plan.decline")}
          </Button>
        ) : null}
        <Button
          className="h-8 shrink-0"
          disabled={inFlight}
          onClick={() => decide(review.approve.label)}
          size="sm"
          title={review.approve.description}
          type="button"
        >
          {inFlight ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("sidepanel.clarify.plan.approve")}
        </Button>
      </div>
    </div>
  );
}

function QuestionStepper({
  request,
  inFlight,
  error,
  onRespond,
  onCancel,
}: ClarifyBannerProps) {
  const { t } = useT();
  const questions = request.questions;
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() =>
    questions.map(emptyDraft),
  );
  const [stepError, setStepError] = useState<string | null>(null);

  // A same-id replay (baseline re-delivery) keeps drafts; a NEW request
  // remounts via the key on ClarifyBanner, so this only guards length drift.
  useEffect(() => {
    setDrafts((current) =>
      current.length === questions.length
        ? current
        : questions.map(emptyDraft),
    );
  }, [questions]);

  const question = questions[index];
  const draft = drafts[index] ?? emptyDraft();
  const hasOptions = (question.options?.length ?? 0) > 0;
  const isLast = index === questions.length - 1;

  const updateDraft = (update: (current: QuestionDraft) => QuestionDraft) => {
    setDrafts((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? update(item) : item,
      ),
    );
    setStepError(null);
  };

  const submitDrafts = (values: QuestionDraft[]) => {
    const missing = values.findIndex((item) => !completed(item));
    if (missing >= 0) {
      setIndex(missing);
      setStepError(t("sidepanel.clarify.incomplete"));
      return;
    }
    onRespond(
      questions.map((item, itemIndex) => {
        const value = values[itemIndex];
        if (value.skipped) return { id: item.id, selected: [] };
        const custom = value.custom.trim();
        return {
          id: item.id,
          selected:
            custom === "" || item.multiSelect === true ? value.selected : [],
          ...(custom === "" ? {} : { custom }),
        };
      }),
    );
  };

  const continueFlow = () => {
    if (!answered(draft)) {
      setStepError(t("sidepanel.clarify.unanswered"));
      return;
    }
    if (!isLast) {
      setIndex((current) => current + 1);
      setStepError(null);
      return;
    }
    submitDrafts(drafts);
  };

  const choose = (label: string) => {
    if (question.multiSelect === true) {
      updateDraft((current) => ({
        ...current,
        selected: current.selected.includes(label)
          ? current.selected.filter((item) => item !== label)
          : [...current.selected, label],
        skipped: false,
      }));
      return;
    }
    updateDraft(() => ({ selected: [label], custom: "", skipped: false }));
    // Picking a single-select answer IS the step's confirmation — advance,
    // like the official flow (the pager walks back for edits).
    if (!isLast) setIndex((current) => current + 1);
  };

  const skipQuestion = () => {
    const next = drafts.map((item, itemIndex) =>
      itemIndex === index
        ? { selected: [], custom: "", skipped: true }
        : item,
    );
    setDrafts(next);
    setStepError(null);
    if (!isLast) {
      setIndex((current) => current + 1);
      return;
    }
    submitDrafts(next);
  };

  const feedback = stepError ?? error;

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm">
      {/* Fixed header strip — stays visible while the question scrolls. */}
      <div className="flex items-center gap-2 border-b border-border/45 px-4 py-2.5">
        <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
          {t("sidepanel.clarify.label")}
        </p>
        {onCancel ? (
          <button
            aria-label={t("sidepanel.clarify.dismiss")}
            className="ml-auto flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            disabled={inFlight}
            onClick={onCancel}
            title={t("sidepanel.clarify.dismiss")}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {/* One question per step; the card owns the scroll so a long option
          list can't push the footer (and the composer below) off-screen. */}
      <div className="max-h-[min(48vh,400px)] overflow-y-auto px-4 py-3">
        <section key={`${request.requestId}:${index}`}>
          {question.header ? (
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
              {question.header}
            </p>
          ) : null}
          <p className="mt-1 text-sm font-medium leading-relaxed">
            {question.question}
          </p>
          {question.detail ? (
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              <Streamdown mode="static" className="chat-md break-words">
                {question.detail}
              </Streamdown>
            </div>
          ) : null}

          {hasOptions ? (
            <div
              className="mt-2.5 grid gap-1.5"
              role={question.multiSelect === true ? "group" : "radiogroup"}
            >
              {(question.options ?? []).map((choice, choiceIndex) => {
                const active = draft.selected.includes(choice.label);
                const display = parseRecommendedLabel(choice.label);
                return (
                  <button
                    aria-checked={active}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                      active
                        ? "border-primary/45 bg-primary/[0.08]"
                        : "border-border/60 hover:bg-accent/60",
                    )}
                    disabled={inFlight}
                    key={`${choice.label}-${choiceIndex}`}
                    onClick={() => choose(choice.label)}
                    role={question.multiSelect === true ? "checkbox" : "radio"}
                    type="button"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] font-medium transition-colors",
                        question.multiSelect
                          ? "rounded-[5px]"
                          : "rounded-full",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/35 text-muted-foreground/70",
                      )}
                    >
                      {active ? (
                        <Check className="h-3 w-3" strokeWidth={3} />
                      ) : question.multiSelect ? null : (
                        choiceIndex + 1
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block leading-snug">
                        {display.label}
                        {display.recommended ? (
                          <span className="ml-1.5 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-semibold text-primary">
                            {t("sidepanel.clarify.recommended")}
                          </span>
                        ) : null}
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
            aria-label={t("sidepanel.clarify.customAnswer")}
            autoFocus={!hasOptions}
            className="mt-2.5 h-8 border-0 bg-muted/35 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-1"
            disabled={inFlight}
            onChange={(event) => {
              const value = event.target.value;
              updateDraft((current) => ({
                ...current,
                selected:
                  question.multiSelect === true ? current.selected : [],
                custom: value,
                skipped: false,
              }));
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || isComposing(event)) return;
              event.preventDefault();
              continueFlow();
            }}
            placeholder={t("sidepanel.clarify.customAnswer")}
            value={draft.custom}
          />
        </section>
      </div>

      {/* Fixed footer: pager on the left, skip + next/submit on the right. */}
      <div className="flex items-center gap-3 border-t border-border/45 bg-muted/20 px-4 py-2.5">
        {questions.length > 1 ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              aria-label={t("sidepanel.clarify.prev")}
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              disabled={index === 0 || inFlight}
              onClick={() => {
                setIndex(index - 1);
                setStepError(null);
              }}
              type="button"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-0.5 text-xs tabular-nums text-muted-foreground">
              {index + 1} / {questions.length}
            </span>
            <button
              aria-label={t("sidepanel.clarify.next")}
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              disabled={isLast || inFlight}
              onClick={() => {
                setIndex(index + 1);
                setStepError(null);
              }}
              type="button"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        {feedback ? (
          <p className="min-w-0 flex-1 truncate text-right text-xs text-destructive">
            {feedback}
          </p>
        ) : (
          <span className="flex-1" />
        )}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            className="h-8"
            disabled={inFlight}
            onClick={skipQuestion}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("sidepanel.clarify.skip")}
          </Button>
          <Button
            className="h-8"
            disabled={inFlight || !answered(draft)}
            onClick={continueFlow}
            size="sm"
            type="button"
          >
            {inFlight ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {isLast
              ? t("sidepanel.clarify.submit")
              : t("sidepanel.clarify.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
