import type { HermesCatalogModelEntry } from "@amiba/core";

/**
 * Resolve the human-facing name for a model.
 *
 * Candidates are ordered by trust by the caller. Empty values and values that
 * merely repeat the model id are ignored, leaving the exact id as the fallback.
 */
export function resolveModelDisplayName(
  modelId: string,
  ...candidates: Array<string | null | undefined>
): string {
  const normalizedId = modelId.trim();
  for (const candidate of candidates) {
    const name = candidate?.trim();
    if (!name) continue;
    if (name.toLocaleLowerCase() === normalizedId.toLocaleLowerCase()) continue;
    return name;
  }
  return normalizedId;
}

/** Provider/Hermes names win; supplemental catalog names only fill gaps. */
export function resolveCatalogModelDisplayName(
  entry: Pick<HermesCatalogModelEntry, "description" | "id" | "supplemental">,
): string {
  return resolveModelDisplayName(
    entry.id,
    entry.description,
    entry.supplemental?.description,
  );
}
