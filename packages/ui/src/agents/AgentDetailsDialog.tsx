import type { ReactElement } from "react";
import type { AgentPreset } from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import { Fingerprint } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  type DialogOverlayVariant,
} from "../primitives";

export function AgentDetailsDialog({
  profile,
  name,
  trigger,
  overlayVariant,
}: {
  profile: AgentPreset;
  name: string;
  trigger: ReactElement;
  overlayVariant?: DialogOverlayVariant;
}) {
  const { t } = useT();
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        size="md"
        overlayVariant={overlayVariant}
        className="flex max-h-[80vh] flex-col gap-0 overflow-hidden p-0"
        data-agent-details-modal
      >
        <div className="flex shrink-0 items-center gap-3 px-6 pb-5 pt-6 pr-12">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/50">
            <Fingerprint className="h-6 w-6 text-muted-foreground" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="break-words text-base font-semibold leading-snug">
              {name}
            </DialogTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("sidepanel.agentPicker.executionIdentity")}
            </p>
          </div>
        </div>
        <DialogDescription className="sr-only">
          {t("sidepanel.agentPicker.details.description")}
        </DialogDescription>
        <div className="min-h-0 overflow-y-auto px-6 pb-6">
          <div className="flex items-start gap-4 rounded-lg bg-muted/40 px-3 py-2.5 text-xs">
            <span className="shrink-0 text-muted-foreground">
              {t("sidepanel.agentPicker.details.id")}
            </span>
            <code className="min-w-0 break-all text-foreground">
              {profile.id}
            </code>
          </div>
          <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
            {profile.description?.trim() ||
              t("sidepanel.agentPicker.details.noDescription")}
          </p>
          {profile.broken && (
            <p className="mt-4 whitespace-pre-wrap break-words text-sm text-destructive">
              {profile.broken}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
