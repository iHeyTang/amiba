import { companionActions } from "../mofli-capabilities.generated.js";
import type {
  SurfaceActivitySnapshot,
  SurfaceInteractionSnapshot,
} from "@amiba/extension-sdk";

export type CompanionScene =
  | "welcome"
  | "cheering"
  | "impatient"
  | "loading"
  | "idle"
  | "typing"
  | "thinking"
  | "responding"
  | "tooling"
  | "waiting"
  | "completed"
  | "failed"
  | "interrupted";
export function companionScene(
  state?: SurfaceActivitySnapshot,
  input?: SurfaceInteractionSnapshot,
): CompanionScene {
  if (state && !["idle", "completed"].includes(state.phase))
    return state.phase as CompanionScene;
  if (input?.input.active || input?.input.composing) return "typing";
  if (state?.phase === "completed" && !state.restored) return "completed";
  return "idle";
}
// Published 0.1.1 supports expressions, but has no authored companion action table.
const expressions: Record<
  CompanionScene,
  readonly (readonly [number, number])[]
> = {
  welcome: [[3, 4]],
  cheering: [[1.8, 3]],
  impatient: [[2.2, 2]],
  idle: [[12, -1]],
  loading: [
    [3, 1],
    [2, 9],
  ],
  typing: [
    [3, 1],
    [2, 11],
  ],
  thinking: [
    [3, 1],
    [2, 9],
    [3, 1],
  ],
  responding: [
    [4, 1],
    [2, -1],
  ],
  tooling: [
    [5, 1],
    [2, 11],
  ],
  waiting: [
    [3, 11],
    [3, -1],
  ],
  completed: [
    [1.4, 3],
    [2, 4],
    [3, -1],
  ],
  failed: [
    [2, 10],
    [3, 7],
    [3, -1],
  ],
  interrupted: [
    [1.5, 2],
    [2, -1],
  ],
};
function publishedPose(
  scene: CompanionScene,
  elapsed: number,
  reduced: boolean,
) {
  const steps = expressions[scene];
  const duration = steps.reduce((sum, [seconds]) => sum + seconds, 0);
  if (
    ["completed", "failed", "interrupted"].includes(scene) &&
    elapsed >= duration
  )
    return publishedPose("idle", elapsed - duration, reduced);
  let time = reduced ? 0 : Math.max(0, elapsed) % duration;
  let expression = -1;
  for (const [seconds, value] of steps) {
    if (time < seconds) {
      expression = value;
      break;
    }
    time -= seconds;
  }
  return {
    state: 0,
    expression,
    action: `expression-${scene}`,
    followsPointer: scene === "idle" || scene === "waiting",
  };
}
/** Four authored body actions per scene. Index offset preserves existing saved poses. */
export function companionPose(
  scene: CompanionScene,
  elapsed: number,
  spatial = false,
  reducedMotion = false,
) {
  const guideAction = {
    welcome: "happy-dance",
    cheering: "victory-hop",
    impatient: "brake-rock",
  }[scene as "welcome" | "cheering" | "impatient"];
  if (guideAction) {
    const index = companionActions.findIndex(
      (action) => action.id === guideAction,
    );
    if (index >= 0)
      return {
        state: index + (spatial ? 8 : 14),
        expression: companionActions[index].expression + (spatial ? 1 : 0),
        action: guideAction,
        followsPointer: false,
      };
    return publishedPose(scene, elapsed, reducedMotion);
  }
  const terminal = ["completed", "failed", "interrupted"].includes(scene);
  const candidates = companionActions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => action.scene === scene);
  if (!candidates.length) return publishedPose(scene, elapsed, reducedMotion);
  const duration = candidates.reduce(
    (sum, { action }) => sum + action.duration,
    0,
  );
  if (terminal && elapsed >= duration)
    return companionPose("idle", elapsed - duration, spatial, reducedMotion);
  let local = reducedMotion ? 0 : Math.max(0, elapsed) % duration;
  let selected = candidates[0];
  for (const entry of candidates) {
    selected = entry;
    if (local < entry.action.duration) break;
    local -= entry.action.duration;
  }
  const expression = selected.action.expression;
  return {
    state: selected.index + (spatial ? 8 : 14),
    expression: spatial ? expression + 1 : expression,
    action: selected.action.id,
    // Task choreography owns attention. Terminal scenes recurse to idle above,
    // so pointer attention resumes when their authored feedback has finished.
    followsPointer: scene === "idle" || scene === "waiting",
  };
}
