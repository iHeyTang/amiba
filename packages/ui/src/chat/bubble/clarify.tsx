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

import { cn } from "../../primitives";
import { ComposerDockSheet } from "../ComposerDockSheet";

/**
 * The user-questions surface over DSH's ask_user_question waits. Mirrors the
 * official dsh-client-ui-user-questions SEMANTICS (that plugin is disabled in
 * our bundles — the whole conversation UI is ours) inside the unified
 * composer dock sheet:
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

/**
 * Slim, airy action buttons — hairline ghosts, not filled pills; only the
 * one primary action carries the accent, and even that stays h-7/rounded-md
 * so the sheet reads light.
 */
const quietButton =
  "inline-flex h-7 select-none items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-[background-color,color,border-color,opacity] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";
const quietNeutral =
  "text-muted-foreground hover:bg-muted/50 hover:text-foreground";
const quietPrimary =
  "bg-primary text-primary-foreground shadow-none hover:bg-primary/90 disabled:hover:bg-primary";

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
    <PlanReviewCard key={props.request.requestId} review={review} {...props} />
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
    <ComposerDockSheet tone="warn">
      <div className="flex items-center gap-2 px-4 pt-2.5">
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-warning" />
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-foreground/60">
          {t("sidepanel.clarify.plan.header")}
        </p>
      </div>
      <div className="mx-4 mt-2 max-h-[min(42vh,360px)] overflow-y-auto rounded-lg border border-border/45 bg-muted/25 px-3 py-2.5">
        <Streamdown mode="static" className="chat-md break-words text-xs">
          {review.plan}
        </Streamdown>
      </div>
      <div className="mt-2 flex items-center gap-2 px-4 pb-1">
        {error ? (
          <p className="min-w-0 flex-1 truncate text-[11px] text-destructive">
            {error}
          </p>
        ) : (
          <span className="flex-1" />
        )}
        {onCancel ? (
          <button
            className={cn(quietButton, quietNeutral)}
            disabled={inFlight}
            onClick={onCancel}
            type="button"
          >
            <Pencil className="h-3 w-3" />
            {t("sidepanel.clarify.plan.discuss")}
          </button>
        ) : null}
        {review.decline ? (
          <button
            className={cn(
              quietButton,
              "text-destructive/85 hover:bg-destructive/[0.06] hover:text-destructive",
            )}
            disabled={inFlight}
            onClick={() => decide(review.decline!.label)}
            title={review.decline.description}
            type="button"
          >
            {t("sidepanel.clarify.plan.decline")}
          </button>
        ) : null}
        <button
          className={cn(quietButton, quietPrimary)}
          disabled={inFlight}
          onClick={() => decide(review.approve.label)}
          title={review.approve.description}
          type="button"
        >
          {inFlight ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t("sidepanel.clarify.plan.approve")}
        </button>
      </div>
    </ComposerDockSheet>
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
      current.length === questions.length ? current : questions.map(emptyDraft),
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
      itemIndex === index ? { selected: [], custom: "", skipped: true } : item,
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
    <ComposerDockSheet>
      {/* Header strip: label left, pager + dismiss right. */}
      <div className="flex items-center gap-2 px-4 pt-2.5">
        <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 text-primary/80" />
        <p className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-[0.08em] text-foreground/60">
          {t("sidepanel.clarify.label")}
        </p>
        {questions.length > 1 ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              aria-label={t("sidepanel.clarify.prev")}
              className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent"
              disabled={index === 0 || inFlight}
              onClick={() => {
                setIndex(index - 1);
                setStepError(null);
              }}
              type="button"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-0.5 text-[11px] tabular-nums text-muted-foreground/70">
              {index + 1}/{questions.length}
            </span>
            <button
              aria-label={t("sidepanel.clarify.next")}
              className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent"
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
        {onCancel ? (
          <button
            aria-label={t("sidepanel.clarify.dismiss")}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
            disabled={inFlight}
            onClick={onCancel}
            title={t("sidepanel.clarify.dismiss")}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {/* One question per step; the sheet owns the scroll so a long option
          list can't push the composer off-screen. */}
      <div className="max-h-[min(42vh,360px)] overflow-y-auto px-4 pb-1 pt-2">
        <section key={`${request.requestId}:${index}`}>
          {question.header ? (
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
              {question.header}
            </p>
          ) : null}
          <p className="mt-0.5 text-[13px] font-medium leading-relaxed text-foreground/90">
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
              className="mt-2 flex flex-col gap-1"
              role={question.multiSelect === true ? "group" : "radiogroup"}
            >
              {(question.options ?? []).map((choice, choiceIndex) => {
                const active = draft.selected.includes(choice.label);
                const display = parseRecommendedLabel(choice.label);
                return (
                  <button
                    aria-checked={active}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                      active
                        ? "border-primary/45 bg-primary/[0.06] text-foreground"
                        : "border-border/50 bg-transparent text-foreground/80 hover:bg-muted/40 hover:text-foreground",
                    )}
                    disabled={inFlight}
                    key={`${choice.label}-${choiceIndex}`}
                    onClick={() => choose(choice.label)}
                    role={question.multiSelect === true ? "checkbox" : "radio"}
                    type="button"
                  >
                    <span
                      className={cn(
                        "mt-px flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] font-medium transition-colors",
                        question.multiSelect ? "rounded-[5px]" : "rounded-full",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30 text-muted-foreground/60",
                      )}
                    >
                      {active ? (
                        <Check className="h-3 w-3" strokeWidth={3} />
                      ) : question.multiSelect ? null : (
                        choiceIndex + 1
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium leading-snug">
                        {display.label}
                        {display.recommended ? (
                          <span className="ml-1.5 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-semibold text-primary">
                            {t("sidepanel.clarify.recommended")}
                          </span>
                        ) : null}
                      </span>
                      {choice.description ? (
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                          {choice.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Explicit hairline border: DSH ships bare `input {}` element
              rules, so an unbordered input would inherit their heavy edge. */}
          <input
            aria-label={t("sidepanel.clarify.customAnswer")}
            autoFocus={!hasOptions}
            className="mt-2 h-8 w-full appearance-none rounded-lg border border-border/50 bg-transparent px-3 text-xs text-foreground shadow-none outline-none transition-colors placeholder:text-muted-foreground/55 focus:border-ring/60 focus-visible:ring-1 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={inFlight}
            onChange={(event) => {
              const value = event.target.value;
              updateDraft((current) => ({
                ...current,
                selected: question.multiSelect === true ? current.selected : [],
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

      {/* Footer: feedback left, skip + next/submit right. */}
      <div className="flex items-center gap-2 px-4 pb-1 pt-1">
        {feedback ? (
          <p className="min-w-0 flex-1 truncate text-[11px] text-destructive">
            {feedback}
          </p>
        ) : (
          <span className="flex-1" />
        )}
        <button
          className={cn(quietButton, quietNeutral)}
          disabled={inFlight}
          onClick={skipQuestion}
          type="button"
        >
          {t("sidepanel.clarify.skip")}
        </button>
        <button
          className={cn(quietButton, quietPrimary)}
          disabled={inFlight || !answered(draft)}
          onClick={continueFlow}
          type="button"
        >
          {inFlight ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {isLast ? t("sidepanel.clarify.submit") : t("sidepanel.clarify.next")}
        </button>
      </div>
    </ComposerDockSheet>
  );
}
