import type { ReactNode } from "react";

/**
 * Shared hierarchy for the top-level sections on the model settings page.
 *
 * Top-level sections use a 12px radius and a quiet border. Nested lists and
 * editors intentionally use the smaller `rounded-lg` treatment so hierarchy
 * remains visible without stacking card-on-card decoration.
 */
export const MODEL_SETTINGS_SECTION_CLASS = "space-y-4" as const;

export const MODEL_SETTINGS_SURFACE_CLASS =
  "amiba-card-surface overflow-hidden rounded-xl border border-border/70 bg-background" as const;

export function ModelSettingsSectionHeader({
  accessory,
  description,
  title,
}: {
  accessory?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3"
      data-model-settings-section-header
    >
      <div className="min-w-0 max-w-2xl">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {accessory ? <div className="shrink-0">{accessory}</div> : null}
    </div>
  );
}
