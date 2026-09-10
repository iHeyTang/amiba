import { useT } from "@amiba/i18n";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../primitives";
import { ModelIcon } from "./ModelIcon";
import { ModelInfoCard } from "./ModelInfoCard";
import { useModelSummaryItems } from "./ModelSummary";
import type { ModelMetadata } from "./model-metadata";

export interface ModelDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: string;
  provider: string;
  providerName?: string;
  name?: string;
  description?: string;
  metadata?: ModelMetadata;
}

export function ModelDetailsDialog({
  open, onOpenChange, model, provider, providerName, name, description, metadata,
}: ModelDetailsDialogProps) {
  const { t } = useT();
  const items = useModelSummaryItems(metadata);
  const hasMetadata = items.capabilities.length > 0 || items.limits.length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="flex max-h-[80vh] flex-col gap-0 overflow-hidden p-0" data-model-details-modal>
        <div className="flex shrink-0 items-center gap-3 px-6 pb-5 pt-6 pr-12">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/50">
            <ModelIcon className="h-6 w-6" model={model} provider={provider} />
          </span>
          <div className="min-w-0">
            <DialogTitle className="break-words text-base font-semibold leading-snug">{name || model}</DialogTitle>
            <p className="mt-1 text-xs text-muted-foreground">{providerName || provider}</p>
          </div>
        </div>
        <DialogDescription className="sr-only">{t("options.models.details.dialogDescription")}</DialogDescription>
        <div className="min-h-0 overflow-y-auto px-6 pb-6">
          <div className="flex items-start gap-4 rounded-lg bg-muted/40 px-3 py-2.5 text-xs">
            <span className="shrink-0 text-muted-foreground">Model ID</span>
            <code className="min-w-0 break-all text-foreground">{model}</code>
          </div>
          {description?.trim() && <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{description.trim()}</p>}
          {hasMetadata && <div className="mt-5 border-t border-border/50 pt-4">
            <ModelInfoCard className="border-0 bg-transparent p-0" model={model} provider={provider} metadata={metadata} showIdentity={false} />
          </div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
