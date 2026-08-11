export const HERMES_PATCH_COMPATIBILITY = Object.freeze({
  APPLY: "apply",
  RETIRE: "retire",
  CONFLICT: "conflict",
});

export function classifyHermesPatchCompatibility({
  verifierPasses,
  patchApplies,
}) {
  if (verifierPasses) return HERMES_PATCH_COMPATIBILITY.RETIRE;
  if (patchApplies) return HERMES_PATCH_COMPATIBILITY.APPLY;
  return HERMES_PATCH_COMPATIBILITY.CONFLICT;
}
