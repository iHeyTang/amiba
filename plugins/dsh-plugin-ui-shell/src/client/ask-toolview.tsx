import type { ToolCallOwnerProps } from "@amiba/extension-sdk";
import { useT } from "@amiba/i18n";
import { ToolRowFrame } from "@amiba/ui/plugin";
import { MessageCircleQuestion } from "lucide-react";

/**
 * Amiba's occupant of the keyed `tool.call.toolview` seat for the official
 * `ask_user_question` tool — the FIRST registrant of the seat, and the
 * pattern for every plugin-owned tool that wants a bespoke timeline row:
 * register your tool's wire name into the seat and compose the row from
 * `@amiba/ui`'s generic `ToolRowFrame`, so it stays visually identical to
 * the built-in rows.
 *
 * Behavior mirrors the official AskQuestionRow spec: 等待回答 while the wait
 * is open, an answered x/y summary that expands into a question → answer
 * review, and a NEUTRAL dismissed state — the cancelled outcome is a user
 * choice the wire encodes as a tool error, not a failure.
 */

interface AskAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseAnswers(text: string): AskAnswer[] | null {
  const answers = recordOf(parseJson(text))?.answers;
  if (!Array.isArray(answers)) return null;
  const items: AskAnswer[] = [];
  for (const entry of answers) {
    const record = recordOf(entry);
    if (!record || typeof record.id !== "string") return null;
    items.push({
      id: record.id,
      selected: Array.isArray(record.selected)
        ? record.selected.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      ...(typeof record.custom === "string" ? { custom: record.custom } : {}),
    });
  }
  return items;
}

function questionTextById(argsRaw: string | undefined): Map<string, string> {
  const byId = new Map<string, string>();
  const questions = argsRaw ? recordOf(parseJson(argsRaw))?.questions : null;
  if (Array.isArray(questions)) {
    for (const entry of questions) {
      const record = recordOf(entry);
      if (
        record &&
        typeof record.id === "string" &&
        typeof record.question === "string"
      ) {
        byId.set(record.id, record.question);
      }
    }
  }
  return byId;
}

/** Question → answer review: selected options as quiet chips, custom answers as text. */
function AskAnswersReview({
  answers,
  questions,
  skippedLabel,
}: {
  answers: AskAnswer[];
  questions: Map<string, string>;
  skippedLabel: string;
}) {
  return (
    <div className="mt-1 w-full max-w-2xl min-w-0">
      <section className="overflow-hidden rounded-lg border border-border/40 bg-muted/[0.06] px-2.5 py-2">
        <div className="space-y-2">
          {answers.map((answer, index) => {
            const custom = (answer.custom ?? "").trim();
            const skipped = answer.selected.length === 0 && custom === "";
            return (
              <div key={answer.id || index} className="min-w-0">
                <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                  {questions.get(answer.id) ?? answer.id}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  {answer.selected.map((label) => (
                    <span
                      key={label}
                      className="rounded-md bg-primary/[0.08] px-1.5 py-0.5 text-[11px] font-medium leading-snug text-foreground/85 ring-1 ring-primary/25"
                    >
                      {label}
                    </span>
                  ))}
                  {custom !== "" && (
                    <span className="min-w-0 break-words text-[11px] leading-relaxed text-foreground/85">
                      {custom}
                    </span>
                  )}
                  {skipped && (
                    <span className="text-[11px] text-muted-foreground/60">
                      {skippedLabel}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function AskUserQuestionToolview({ block }: ToolCallOwnerProps) {
  const { t } = useT();
  // RunningToolCall carries no `kind`; the settled node is 'tool-result'.
  const settled = "kind" in block ? block : null;
  const argsRaw = "kind" in block ? block.call?.argsRaw : block.argsRaw;
  const resultText = settled
    ? settled.content
        .map((item) =>
          recordOf(item)?.type === "text"
            ? String((item as { text?: unknown }).text ?? "")
            : "",
        )
        .join("")
    : "";

  const cancelled =
    settled !== null &&
    settled.isError &&
    (settled.error?.code === "ASK_CANCELLED" ||
      /cancelled ask_user_question/i.test(resultText));
  const answers =
    settled && !settled.isError ? parseAnswers(resultText) : null;
  const answered =
    answers?.filter(
      (answer) =>
        answer.selected.length > 0 || (answer.custom ?? "").trim() !== "",
    ).length ?? 0;
  const failed = settled !== null && settled.isError && !cancelled;
  const running = settled === null;

  const target = cancelled
    ? t("shell.ask.cancelled")
    : running
      ? t("shell.ask.waiting")
      : answers && answers.length > 0
        ? t("shell.ask.answered", { answered, total: answers.length })
        : "";
  const durationMs =
    settled && settled.callTime != null
      ? Math.max(0, settled.time - settled.callTime)
      : undefined;

  const detail =
    answers && answers.length > 0 ? (
      <AskAnswersReview
        answers={answers}
        questions={questionTextById(argsRaw ?? undefined)}
        skippedLabel={t("shell.ask.skipped")}
      />
    ) : failed && resultText ? (
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-destructive/25 bg-destructive/[0.04] px-3 py-2 font-mono text-[11px] leading-relaxed text-destructive [overflow-wrap:anywhere]">
        {resultText}
      </pre>
    ) : undefined;

  return (
    <ToolRowFrame
      icon={MessageCircleQuestion}
      action={t("shell.ask.action")}
      target={target || undefined}
      {...(durationMs === undefined ? {} : { durationMs })}
      running={running}
      failed={failed}
      ariaLabel={[t("shell.ask.action"), target].filter(Boolean).join(" ")}
      detail={detail}
    />
  );
}
