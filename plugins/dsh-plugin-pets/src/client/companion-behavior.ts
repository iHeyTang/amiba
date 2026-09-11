import type { SurfaceActivitySnapshot, SurfaceInteractionSnapshot } from "@amiba/extension-sdk";

export type CompanionScene = "idle" | "typing" | "thinking" | "responding" | "tooling" | "waiting" | "completed" | "failed" | "interrupted";
export function companionScene(state?: SurfaceActivitySnapshot, input?: SurfaceInteractionSnapshot): CompanionScene {
  if (state && !["idle", "completed"].includes(state.phase)) return state.phase as CompanionScene;
  if (input?.input.active || input?.input.composing) return "typing";
  if (state?.phase === "completed" && !state.restored) return "completed";
  return "idle";
}
// Grove's shared expression vocabulary. Keep the body in its idle state;
// business events select expressions, never the showroom's shape sequence.
const sequences: Record<CompanionScene, readonly (readonly [number, number])[]> = {
  idle: [[12, -1]],
  typing: [[3, 1], [2, 11]],
  thinking: [[3, 1], [2, 9], [3, 1]],
  responding: [[4, 1], [2, -1]],
  tooling: [[5, 1], [2, 11]],
  waiting: [[3, 11], [3, -1]],
  completed: [[1.4, 3], [2, 4], [3, -1]],
  failed: [[2, 10], [3, 7], [3, -1]],
  interrupted: [[1.5, 2], [2, -1]],
};
export function companionExpression(scene: CompanionScene, elapsed: number): number {
  const steps = sequences[scene];
  const duration = steps.reduce((n, [seconds]) => n + seconds, 0);
  const once = ["completed", "failed", "interrupted"].includes(scene);
  if (once && elapsed >= duration) return -1;
  let local = Math.max(0, elapsed) % duration;
  for (const [seconds, expression] of steps) {
    if (local < seconds) return expression;
    local -= seconds;
  }
  return -1;
}
