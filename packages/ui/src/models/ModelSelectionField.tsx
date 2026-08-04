import {
  hermesModelGateway,
  type HermesModelPickerGroup,
  type HermesVirtualCapabilityPickerGroup,
} from "@amiba/core";
import { useT } from "@amiba/i18n";
import { Bot, Loader2, Workflow } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button, cn } from "../primitives";
import { ModelIcon } from "./ModelIcon";
import {
  ModelPickerDialog,
  type ModelPickerGroup,
  type ModelPickerStatus,
} from "./ModelPickerDialog";
import { resolveCatalogModelDisplayName } from "./model-display";

export interface ModelSelectionValue {
  model: string;
  provider: string;
}

export function ModelSelectionField({
  value,
  onChange,
  disabled = false,
  className,
  profileId,
  allowReset = true,
  displayName,
  includeVirtualCapabilities = true,
  pickerDescription,
  pickerTitle,
  resetDescription,
  resetLabel,
  searchPlaceholder,
}: {
  value: ModelSelectionValue | null;
  onChange: (value: ModelSelectionValue | null) => void;
  disabled?: boolean;
  className?: string;
  profileId?: string;
  allowReset?: boolean;
  displayName?: string;
  includeVirtualCapabilities?: boolean;
  pickerDescription?: string;
  pickerTitle?: string;
  resetDescription?: string;
  resetLabel?: string;
  searchPlaceholder?: string;
}) {
  const { t } = useT();
  const [groups, setGroups] = useState<HermesModelPickerGroup[]>([]);
  const [capabilities, setCapabilities] = useState<
    HermesVirtualCapabilityPickerGroup[]
  >([]);
  const [status, setStatus] = useState<ModelPickerStatus>("idle");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    const snapshot = await hermesModelGateway.picker.read(profileId);
    setGroups(snapshot.groups);
    setCapabilities(snapshot.capabilities ?? []);
    setStatus(snapshot.ok ? "ready" : "error");
  }, [profileId]);

  const pickerGroups = useMemo<ModelPickerGroup[]>(
    () => [
      ...groups.map((group) => ({
        id: `provider:${group.provider}`,
        kind: "provider" as const,
        label: group.label,
        models: group.models.map((entry) => ({
          description: entry.description ?? entry.supplemental?.description,
          metadata: entry.metadata,
          model: entry.id,
          supplemental: entry.supplemental,
        })),
        provider: group.provider,
      })),
      ...(includeVirtualCapabilities
        ? capabilities.map((capability) => ({
            id: `virtual:${capability.capability}`,
            kind: "virtual" as const,
            label:
              capability.capability === "moa"
                ? t("options.models.virtual.moaTitle")
                : capability.label,
            models: capability.models.map((entry) => ({
              description: entry.description ?? entry.supplemental?.description,
              metadata: entry.metadata,
              model: entry.id,
              supplemental: entry.supplemental,
            })),
            provider: capability.provider,
          }))
        : []),
    ],
    [capabilities, groups, includeVirtualCapabilities, t],
  );

  const selectedEntry =
    groups
      .find((group) => group.provider === value?.provider)
      ?.models.find((entry) => entry.id === value?.model) ??
    capabilities
      .find((group) => group.provider === value?.provider)
      ?.models.find((entry) => entry.id === value?.model);
  const label =
    value && selectedEntry
      ? resolveCatalogModelDisplayName(selectedEntry)
      : displayName ||
        value?.model ||
        resetLabel ||
        t("modelSelection.inherit");
  const isVirtual = capabilities.some(
    (group) =>
      group.provider === value?.provider &&
      group.models.some((entry) => entry.id === value?.model),
  );

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          void load();
        }}
        className={cn(
          "h-9 w-full justify-start rounded-xl px-3 font-normal shadow-none",
          className,
        )}
      >
        {status === "loading" && groups.length === 0 ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !value?.model ? (
          <Bot className="h-4 w-4 text-muted-foreground" />
        ) : isVirtual ? (
          <Workflow className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ModelIcon
            className="h-4 w-4"
            provider={value?.provider || ""}
            model={value?.model || ""}
          />
        )}
        <span className="min-w-0 truncate text-xs">{label}</span>
        {value?.provider && (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
            {value.provider}
          </span>
        )}
      </Button>
      <ModelPickerDialog
        description={pickerDescription}
        groups={pickerGroups}
        onOpenChange={setOpen}
        onSelect={(provider, model) => {
          onChange({ provider, model });
          setOpen(false);
        }}
        open={open}
        resetOption={
          allowReset
            ? {
                label: resetLabel || t("modelSelection.inherit"),
                description:
                  resetDescription || t("modelSelection.inherit.description"),
                selected: !value?.model,
                onSelect: () => {
                  onChange(null);
                  setOpen(false);
                },
              }
            : undefined
        }
        selected={value ?? undefined}
        searchPlaceholder={searchPlaceholder}
        status={status}
        title={pickerTitle}
      />
    </>
  );
}
