import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";

import type { HermesCatalogModelEntry } from "@amiba/core";
import { useT } from "@amiba/i18n";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../primitives";
import { ModelIcon } from "./ModelIcon";
import { ModelInfoCard } from "./ModelInfoCard";
import { resolveCatalogModelDisplayName } from "./model-display";
import {
  mergeModelMetadata,
  resolveModelPreviewMetadata,
} from "./model-metadata";

export interface ModelCatalogEntryCardProps {
  action?: ReactNode;
  className?: string;
  current?: boolean;
  entry: HermesCatalogModelEntry;
  provider: string;
  visible?: boolean;
}

/**
 * Catalog row with source-aware precedence:
 *
 * - the always-visible card is driven by a capability/specification allowlist,
 *   regardless of whether a value came from the provider or a supplemental
 *   catalog;
 * - provider/Hermes values win conflicts;
 * - complete supplemental/reference information stays in the details dialog
 *   with its source noted in the footer.
 */
export function ModelCatalogEntryCard({
  action,
  className,
  current = false,
  entry,
  provider,
  visible = true,
}: ModelCatalogEntryCardProps) {
  const { t } = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const supplemental = entry.supplemental;
  const previewMetadata = resolveModelPreviewMetadata(
    entry.metadata,
    supplemental?.metadata,
  );
  const detailMetadata = mergeModelMetadata(
    supplemental?.metadata,
    entry.metadata,
  );
  const hasDetailMetadata = Object.keys(detailMetadata).length > 0;
  const displayName = resolveCatalogModelDisplayName(entry);

  const cardAction = (
    <span className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
        aria-label={t("options.models.details.openFor", {
          name: entry.id,
        })}
        title={t("options.models.details.openFor", {
          name: entry.id,
        })}
        onClick={() => setDetailsOpen(true)}
      >
        <Info aria-hidden className="h-3.5 w-3.5" />
      </Button>
      {action}
    </span>
  );

  return (
    <>
      <ModelInfoCard
        action={cardAction}
        className={className}
        current={current}
        description={displayName !== entry.id ? displayName : undefined}
        metadata={previewMetadata}
        model={entry.id}
        provider={provider}
        visible={visible}
      />

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="flex max-h-[82vh] flex-col gap-0 overflow-hidden p-0" size="lg">
          <DialogHeader className="border-b border-border/60 px-5 py-4 pr-12">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/45">
                <ModelIcon
                  className="h-5 w-5"
                  model={entry.id}
                  provider={provider}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <DialogTitle className="truncate text-sm">
                    {displayName}
                  </DialogTitle>
                  {displayName !== entry.id ? (
                    <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                      {entry.id}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <DialogDescription className="sr-only">
              {t("options.models.details.dialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto p-5">
            {hasDetailMetadata ? (
              <ModelInfoCard
                className="border-0 bg-transparent p-0"
                metadata={detailMetadata}
                model={entry.id}
                provider={provider}
                showIdentity={false}
              />
            ) : (
              <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-border/70 bg-muted/15 px-4 py-3 text-[10px] leading-relaxed text-muted-foreground">
                <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t("options.models.details.noSupplemental")}</span>
              </div>
            )}
          </div>
          {supplemental ? (
            <footer className="border-t border-border/40 px-5 py-2.5 text-[9px] leading-relaxed text-muted-foreground/70">
              {t("options.models.details.referenceNote", {
                source: supplemental.source,
              })}
            </footer>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
