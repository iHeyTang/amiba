import { useT } from "@amiba/i18n";
import { Command } from "cmdk";
import { Check, Loader2, RotateCcw, Workflow } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  cn,
} from "../primitives";
import { ModelSummary, ModelSummaryOption } from "./ModelSummary";
import {
  resolveModelPreviewMetadata,
  type ModelMetadata,
} from "./model-metadata";

export type ModelPickerStatus = "idle" | "loading" | "ready" | "error";

export interface ModelPickerOption {
  description?: string;
  keywords?: string[];
  label?: string;
  metadata?: ModelMetadata;
  model: string;
  supplemental?: {
    description?: string;
    metadata: ModelMetadata;
    source: string;
  };
}

export interface ModelPickerGroup {
  id: string;
  kind?: "provider" | "virtual";
  label: string;
  models: ModelPickerOption[];
  provider: string;
}

export interface ModelPickerResetOption {
  description?: string;
  label: string;
  onSelect: () => void;
  selected?: boolean;
}

export interface ModelPickerDialogProps {
  description?: string;
  errorMessage?: string;
  groups: ModelPickerGroup[];
  onOpenChange: (open: boolean) => void;
  onSelect: (provider: string, model: string) => void;
  open: boolean;
  resetOption?: ModelPickerResetOption;
  searchPlaceholder?: string;
  selected?: {
    model: string;
    provider: string;
  };
  saving?: boolean;
  status?: ModelPickerStatus;
  title?: string;
}

/**
 * Shared model-selection surface used by both the composer and Settings.
 * Callers own catalog loading and persistence; this component owns the
 * searchable command-modal interaction and model identity presentation.
 */
export function ModelPickerDialog({
  description,
  errorMessage,
  groups,
  onOpenChange,
  onSelect,
  open,
  resetOption,
  searchPlaceholder,
  selected,
  saving = false,
  status = "ready",
  title,
}: ModelPickerDialogProps) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filteredGroups = useMemo(
    () =>
      groups
        .map((group) => {
          if (!normalizedQuery) return group;
          const groupMatches = `${group.label} ${group.provider}`
            .toLocaleLowerCase()
            .includes(normalizedQuery);
          return {
            ...group,
            models: group.models.filter((option) => {
              if (groupMatches) return true;
              return [
                option.model,
                option.label,
                option.description,
                ...(option.keywords ?? []),
              ]
                .filter(Boolean)
                .join(" ")
                .toLocaleLowerCase()
                .includes(normalizedQuery);
            }),
          };
        })
        .filter((group) => group.models.length > 0),
    [groups, normalizedQuery],
  );

  const providerGroups = filteredGroups.filter(
    (group) => group.kind !== "virtual",
  );
  const virtualGroups = filteredGroups.filter(
    (group) => group.kind === "virtual",
  );
  const virtualModelCount = virtualGroups.reduce(
    (count, group) => count + group.models.length,
    0,
  );
  const hasModels = filteredGroups.length > 0;
  const dialogTitle = title ?? t("sidepanel.modelPicker.label");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label={dialogTitle}
        className={cn(
          "block max-w-lg gap-0 overflow-hidden rounded-2xl p-0 sm:rounded-2xl",
          "[&_[cmdk-group]]:py-1",
          "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5",
          "[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground/70",
          "[&_[cmdk-item]]:mx-1 [&_[cmdk-item]]:flex [&_[cmdk-item]]:min-h-10 [&_[cmdk-item]]:w-[calc(100%-0.5rem)]",
          "[&_[cmdk-item]]:cursor-pointer [&_[cmdk-item]]:items-center [&_[cmdk-item]]:overflow-hidden",
          "[&_[cmdk-item]]:rounded-lg [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-1.5 [&_[cmdk-item]]:text-sm [&_[cmdk-item]]:text-foreground/85",
          "[&_[cmdk-item][data-selected=true]]:bg-secondary [&_[cmdk-item][data-selected=true]]:text-secondary-foreground",
          "[&_[cmdk-item][data-disabled=true]]:cursor-not-allowed [&_[cmdk-item][data-disabled=true]]:opacity-50",
        )}
        data-model-picker-modal="true"
        hideDefaultClose
      >
        <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
        <DialogDescription className="sr-only">
          {description ?? t("sidepanel.modelPicker.description")}
        </DialogDescription>
        <Command
          className="flex max-h-[min(68vh,32rem)] w-full min-w-0 flex-col"
          shouldFilter={false}
        >
          <div className="flex items-center border-b border-border px-4">
            <Command.Input
              autoFocus
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              data-testid="model-picker-input"
              onValueChange={setQuery}
              placeholder={
                searchPlaceholder ?? t("sidepanel.modelPicker.search")
              }
              value={query}
            />
            {saving ? (
              <Loader2
                aria-label={t("common.loading")}
                className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
              />
            ) : null}
          </div>

          <Command.List className="overflow-y-auto p-2">
            {resetOption ? (
              <Command.Group>
                <ModelCommandItem
                  disabled={saving}
                  icon={
                    <RotateCcw
                      aria-hidden
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                    />
                  }
                  isCurrent={Boolean(resetOption.selected)}
                  label={resetOption.label}
                  description={resetOption.description}
                  model=""
                  onSelect={resetOption.onSelect}
                  provider=""
                  value={`reset ${resetOption.label} ${
                    resetOption.description ?? ""
                  }`}
                />
              </Command.Group>
            ) : null}

            {!hasModels ? (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                {status === "loading" ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                    {t("sidepanel.modelPicker.loading")}
                  </span>
                ) : status === "error" ? (
                  t("sidepanel.modelPicker.loadFailed")
                ) : (
                  t("sidepanel.modelPicker.noMatches")
                )}
              </div>
            ) : (
              <>
                {providerGroups.map((group) => (
                  <ModelCommandGroup
                    disabled={saving}
                    group={group}
                    key={group.id}
                    onSelect={onSelect}
                    selected={selected}
                  />
                ))}

                {virtualGroups.length > 0 ? (
                  <>
                    {providerGroups.length > 0 ? (
                      <div className="mx-1 my-2 h-px bg-border/55" />
                    ) : null}
                    <ModelSectionLabel
                      count={virtualModelCount}
                      icon={<Workflow className="h-3.5 w-3.5" />}
                      label={t("sidepanel.modelPicker.virtualCapabilities")}
                    />
                    {virtualGroups.map((group) => (
                      <ModelCommandGroup
                        disabled={saving}
                        group={group}
                        key={group.id}
                        onSelect={onSelect}
                        selected={selected}
                      />
                    ))}
                  </>
                ) : null}
              </>
            )}

            {errorMessage ? (
              <div
                className="mx-2 mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
                role="alert"
              >
                {errorMessage}
              </div>
            ) : null}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function ModelCommandGroup({
  disabled,
  group,
  onSelect,
  selected,
}: {
  disabled: boolean;
  group: ModelPickerGroup;
  onSelect: (provider: string, model: string) => void;
  selected: ModelPickerDialogProps["selected"];
}) {
  return (
    <Command.Group
      heading={
        <ProviderHeading label={group.label} provider={group.provider} />
      }
    >
      {group.models.map((option) => (
        <ModelCommandItem
          disabled={disabled}
          icon={
            group.kind === "virtual" ? (
              <Workflow aria-hidden className="h-4 w-4 shrink-0" />
            ) : undefined
          }
          isCurrent={
            selected?.provider === group.provider &&
            selected.model === option.model
          }
          key={`${group.id}/${option.model}`}
          label={option.label ?? option.model}
          description={option.description ?? option.supplemental?.description}
          metadata={resolveModelPreviewMetadata(
            option.metadata,
            option.supplemental?.metadata,
          )}
          model={option.model}
          onSelect={() => onSelect(group.provider, option.model)}
          provider={group.provider}
          value={`${option.model} ${option.label ?? ""} ${group.label} ${
            group.provider
          }`}
        />
      ))}
    </Command.Group>
  );
}

function ModelSectionLabel({
  count,
  icon,
  label,
}: {
  count: number;
  icon: ReactNode;
  label: string;
}) {
  return (
    <div
      className="flex h-8 items-center gap-2 px-3 text-[11px] font-medium text-muted-foreground"
      data-model-picker-section
    >
      {icon}
      <span>{label}</span>
      <span className="ml-auto tabular-nums text-[10px] text-muted-foreground/70">
        {count}
      </span>
    </div>
  );
}

function ProviderHeading({
  label,
  provider,
}: {
  label: string;
  provider: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2 normal-case tracking-normal">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 font-mono text-[9px] font-normal text-muted-foreground/50">
        {provider}
      </span>
    </span>
  );
}

function ModelCommandItem({
  disabled,
  description,
  icon,
  isCurrent,
  label,
  metadata,
  model,
  onSelect,
  provider,
  value,
}: {
  disabled: boolean;
  description?: string;
  icon?: ReactNode;
  isCurrent: boolean;
  label: string;
  metadata?: ModelMetadata;
  model: string;
  onSelect: () => void;
  provider: string;
  value: string;
}) {
  return (
    <Command.Item
      aria-current={isCurrent ? "true" : undefined}
      data-current={isCurrent || undefined}
      disabled={disabled}
      onSelect={onSelect}
      value={value}
    >
      {model ? (
        <ModelSummary
          action={
            isCurrent ? (
              <Check
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-foreground"
              />
            ) : undefined
          }
          className="min-w-0 flex-1"
          displayName={label !== model ? label : description}
          icon={icon}
          metadata={metadata}
          model={model}
          provider={provider}
          variant="picker"
        />
      ) : (
        <ModelSummaryOption
          action={
            isCurrent ? (
              <Check
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-foreground"
              />
            ) : undefined
          }
          className="min-w-0 flex-1"
          description={description}
          icon={icon}
          label={label}
          variant="picker"
        />
      )}
    </Command.Item>
  );
}
