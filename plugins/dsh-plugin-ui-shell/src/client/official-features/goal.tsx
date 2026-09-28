import { ComposerDockSheet, ComposerDockIconButton } from "@amiba/ui";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Check, Pause, Pencil, Play, Target, X } from "lucide-react";
import { useT } from "@amiba/i18n";
import { Input } from "@amiba/ui/primitives";
import type {
  GoalDock as OfficialGoalDock,
  GoalActionResult,
} from "@deepseek-ai/dsh-client-ui-goal/client";

type Props = Parameters<typeof OfficialGoalDock>[0];
export function GoalDock({
  useProjection,
  useGoalActivation,
  onEdit,
  onPause,
  onResume,
  onClear,
  t,
}: Props) {
  const goal = useProjection("goal")?.goal;
  const activation = useGoalActivation((next) =>
    next.id === goal?.id && next.revision === goal?.revision
      ? next.activation
      : undefined,
  );
  // Key the local interaction state to the addressed goal, so late mutations
  // cannot overwrite a replacement goal's form or failure state.
  if (!goal || goal.phase === "complete") return null;
  return (
    <GoalStrip
      key={goal.id}
      goal={goal}
      activation={activation}
      onEdit={onEdit}
      onPause={onPause}
      onResume={onResume}
      onClear={onClear}
      t={t}
    />
  );
}
type StripProps = Pick<
  Props,
  "onEdit" | "onPause" | "onResume" | "onClear" | "t"
> & {
  goal: Parameters<
    typeof import("@deepseek-ai/dsh-client-ui-goal/client").GoalBar
  >[0]["goal"];
  activation?: Parameters<
    typeof import("@deepseek-ai/dsh-client-ui-goal/client").GoalBar
  >[0]["activation"];
};
function GoalStrip({
  goal,
  activation,
  onEdit,
  onPause,
  onResume,
  onClear,
  t,
}: StripProps) {
  const { t: uiT } = useT();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [cleared, setCleared] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(
    action: () => Promise<GoalActionResult>,
    done?: () => void,
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      const result = await action();
      if (alive.current) {
        if (result.ok) done?.();
        else setFailure(result.error.message);
      }
    } catch (error) {
      if (alive.current) setFailure(String(error));
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }
  if (!goal || cleared) return null;
  const label = t(
    goal.phase === "active"
      ? activation === "disarmed"
        ? "phase.active.disarmed"
        : "phase.active"
      : goal.phase === "blocked"
        ? "phase.blocked"
        : "phase.paused",
  );
  const iconButton = (
    key: "pause" | "resume" | "edit" | "clear" | "save" | "cancel",
    Icon: typeof X,
    action: () => void,
    disabled = pending,
  ) => (
    <ComposerDockIconButton
      type="button"
      destructive={key === "clear"}
      aria-label={t(`action.${key}`)}
      title={t(`action.${key}`)}
      disabled={disabled}
      onClick={action}
    >
      <Icon className="h-3.5 w-3.5" />
    </ComposerDockIconButton>
  );
  return (
    <ComposerDockSheet region="context">
      <div className="px-4 text-xs" data-amiba-goal>
        <div className="flex min-w-0 items-center gap-2">
          <Target className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {editing ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                if (draft.trim())
                  void run(
                    () => onEdit(draft.trim()),
                    () => setEditing(false),
                  );
              }}
            >
              <Input
                autoFocus
                aria-label={t("objective.aria")}
                value={draft}
                disabled={pending}
                className="h-8"
                onChange={(event) => setDraft(event.target.value)}
              />
              {iconButton(
                "save",
                Check,
                () => {
                  if (draft.trim())
                    void run(
                      () => onEdit(draft.trim()),
                      () => setEditing(false),
                    );
                },
                pending || !draft.trim(),
              )}
              {iconButton("cancel", X, () => setEditing(false))}
            </form>
          ) : (
            <>
              <span className="shrink-0 text-muted-foreground">{label}</span>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 rounded text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                aria-expanded={expanded}
                aria-controls={detailsId}
                aria-label={uiT(expanded ? "sidepanel.goal.collapse" : "sidepanel.goal.expand")}
                title={uiT(expanded ? "sidepanel.goal.collapse" : "sidepanel.goal.expand")}
                onClick={() => setExpanded(value => !value)}
              >
                <span className="min-w-0 flex-1 truncate">{goal.objective}</span>
                {expanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </button>
              <div className="flex shrink-0 items-center gap-1">
                {goal.phase === "active" &&
                  activation === "armed" &&
                  iconButton("pause", Pause, () => void run(onPause))}
                {(goal.phase === "paused" ||
                  (goal.phase === "active" && activation === "disarmed")) &&
                  iconButton("resume", Play, () => void run(onResume))}
                {iconButton("edit", Pencil, () => {
                  setDraft(goal.objective);
                  setEditing(true);
                })}
                {iconButton(
                  "clear",
                  X,
                  () => void run(onClear, () => setCleared(true)),
                )}
              </div>
            </>
          )}
        </div>
        {expanded && !editing && (
          <div id={detailsId} className="py-2 text-xs leading-relaxed" data-goal-details="">
            <p className="select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{goal.objective}</p>
            {goal.blockedReason?.message && <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{goal.blockedReason.message}</p>}
          </div>
        )}
        {failure && (
          <p role="alert" className="mt-1 text-destructive">
            {failure}
          </p>
        )}
      </div>
    </ComposerDockSheet>
  );
}
