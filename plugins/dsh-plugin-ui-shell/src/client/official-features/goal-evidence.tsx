import { useT } from "@amiba/i18n";
import {
  CodeEvidence,
  CompactArguments,
  recordOf,
  stringValue,
  type SemanticEvidenceContext,
} from "@amiba/ui/plugin";

const actions = {
  edit: "shell.goal.edit",
  pause: "shell.goal.pause",
  resume: "shell.goal.resume",
  complete: "shell.goal.complete",
  blocked: "shell.goal.blocked",
} as const;
export function goalAction(args: Record<string, unknown>) {
  return (
    actions[String(args.action) as keyof typeof actions] ??
    "shell.tool.manageGoal"
  );
}
const phases = {
  active: "shell.goal.phase.active",
  paused: "shell.goal.phase.paused",
  complete: "shell.goal.phase.complete",
  blocked: "shell.goal.phase.blocked",
} as const;
/** Amiba evidence chrome over the official goal tool's stable JSON result. */
export function GoalEvidence({ args, text }: SemanticEvidenceContext) {
  const { t } = useT();
  if (!text) return <CompactArguments value={args} />;
  let result: Record<string, unknown>;
  try {
    result = recordOf(JSON.parse(text)) ?? {};
  } catch {
    return <CodeEvidence text={text} />;
  }
  if (!("goal" in result)) return <CodeEvidence text={text} />;
  if (result.goal === null)
    return (
      <p className="text-xs text-muted-foreground">{t("shell.goal.empty")}</p>
    );
  const goal = recordOf(result.goal) ?? {};
  const objective = stringValue(goal, "objective");
  if (!objective) return <CodeEvidence text={text} />;
  const phase = stringValue(goal, "phase");
  const phaseKey = phases[phase as keyof typeof phases];
  const reason = stringValue(recordOf(goal.blockedReason) ?? {}, "message");
  return (
    <div className="space-y-2 text-xs" data-amiba-goal-evidence>
      <div className="flex items-center justify-between gap-3 text-muted-foreground">
        <span>{t("shell.goal.objective")}</span>
        {phase && (
          <span className="rounded-md bg-muted/50 px-1.5 py-0.5">
            {phaseKey ? t(phaseKey) : phase}
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-foreground">
        {objective}
      </p>
      {reason && (
        <p className="whitespace-pre-wrap break-words text-muted-foreground">
          {reason}
        </p>
      )}
    </div>
  );
}
