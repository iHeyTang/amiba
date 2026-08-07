import { Command } from "cmdk";
import { Check, Fingerprint, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { HermesProfile } from "@amiba/core";
import { useT } from "@amiba/i18n";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  cn,
} from "../primitives";
import { AgentIdentity } from "./AgentIdentity";

export function AgentPickerDialog({
  error,
  loading,
  onOpenChange,
  onSelect,
  open,
  profiles,
  selectedProfileId,
}: {
  error?: string | null;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (profile: HermesProfile) => void;
  open: boolean;
  profiles: HermesProfile[];
  selectedProfileId: string;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      normalized
        ? profiles.filter((profile) =>
            [profile.name, profile.description, profile.model, profile.provider]
              .filter(Boolean)
              .join(" ")
              .toLocaleLowerCase()
              .includes(normalized),
          )
        : profiles,
    [normalized, profiles],
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label={t("sidepanel.agentPicker.label")}
        className={cn(
          "block gap-0 overflow-hidden p-0",
          "[&_[cmdk-item]]:mx-1 [&_[cmdk-item]]:flex [&_[cmdk-item]]:min-h-12",
          "[&_[cmdk-item]]:w-[calc(100%-0.5rem)] [&_[cmdk-item]]:cursor-pointer",
          "[&_[cmdk-item]]:items-center [&_[cmdk-item]]:rounded-xl [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-2",
          "[&_[cmdk-item][data-selected=true]]:bg-secondary",
        )}
        hideDefaultClose
        size="compact"
      >
        <DialogTitle className="sr-only">
          {t("sidepanel.agentPicker.label")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("sidepanel.agentPicker.description")}
        </DialogDescription>
        <Command
          className="flex max-h-[min(68vh,30rem)] w-full flex-col"
          shouldFilter={false}
        >
          <div className="flex h-12 items-center gap-2 border-b border-border px-4">
            <Fingerprint className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onValueChange={setQuery}
              placeholder={t("sidepanel.agentPicker.search")}
              value={query}
            />
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          <Command.List className="overflow-y-auto p-2">
            {!loading && filtered.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                {error || t("sidepanel.agentPicker.empty")}
              </div>
            ) : null}
            {filtered.map((profile) => {
              const selected = profile.name === selectedProfileId;
              return (
                <Command.Item
                  key={profile.name}
                  onSelect={() => onSelect(profile)}
                  value={`${profile.name} ${profile.description}`}
                >
                  <AgentIdentity
                    className="min-w-0 flex-1"
                    profile={profile}
                    showDescription
                  />
                  <span className="ml-3 flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
                    {profile.model ? (
                      <span className="max-w-28 truncate">{profile.model}</span>
                    ) : null}
                    {selected ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : null}
                  </span>
                </Command.Item>
              );
            })}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
