import {
  hermesModelGateway,
  type HermesModelPickerGroup,
  type HermesSelectedModelSummary,
  type HermesVirtualCapabilityPickerGroup,
} from "@amiba/core";
import { useT } from "@amiba/i18n";
import { Loader2, Workflow } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ModelIcon,
  ModelPickerDialog,
  resolveCatalogModelDisplayName,
  type ModelPickerGroup,
  type ModelPickerStatus,
} from "../models";
import { cn, type DialogOverlayVariant } from "../primitives";

export interface ComposerModelPickerProps {
  dialogSize?: "default" | "tall";
  disabled?: boolean;
  overlayVariant?: DialogOverlayVariant;
  profileId?: string;
  refreshKey?: number;
}

interface CurrentModel {
  model: string;
  provider: string;
}

/**
 * Composer-local model selector backed by a searchable command modal.
 *
 * It reads Hermes's real provider catalog and writes the same main-model
 * setting as Settings → Models. The OpenAI-compatible `/v1/models` endpoint
 * is deliberately not used here because it advertises the gateway alias
 * (`hermes-agent`), not the underlying inference models.
 */
export function ComposerModelPicker({
  dialogSize = "default",
  disabled = false,
  overlayVariant = "dimmed",
  profileId,
  refreshKey = 0,
}: ComposerModelPickerProps) {
  const { t } = useT();
  const [groups, setGroups] = useState<HermesModelPickerGroup[]>([]);
  const [capabilities, setCapabilities] = useState<
    HermesVirtualCapabilityPickerGroup[]
  >([]);
  const [current, setCurrent] = useState<CurrentModel>({
    model: "",
    provider: "",
  });
  const [rememberedCurrent, setRememberedCurrent] =
    useState<HermesSelectedModelSummary | null>(null);
  const [loadState, setLoadState] = useState<ModelPickerStatus>("idle");
  const [saving, setSaving] = useState(false);
  const [selectionError, setSelectionError] = useState(false);
  const [open, setOpen] = useState(false);
  const loadGenerationRef = useRef(0);

  const loadModels = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    setLoadState("loading");
    const snapshot = await hermesModelGateway.picker.read(profileId);
    if (generation !== loadGenerationRef.current) return;
    if (snapshot.current.model) setCurrent(snapshot.current);
    setGroups(snapshot.groups);
    setCapabilities(snapshot.capabilities ?? []);
    setLoadState(snapshot.ok ? "ready" : "error");
  }, [profileId]);

  useLayoutEffect(() => {
    let active = true;
    void hermesModelGateway.picker.readCurrent(profileId).then((snapshot) => {
      if (!active) return;
      if (snapshot.current.model) setCurrent(snapshot.current);
      setRememberedCurrent(snapshot.summary ?? null);
    });
    void loadModels();
    const unwatch = hermesModelGateway.display.watch(() => {
      void loadModels();
    });
    return () => {
      active = false;
      unwatch();
    };
  }, [loadModels, profileId, refreshKey]);

  useEffect(
    () => () => {
      loadGenerationRef.current += 1;
    },
    [],
  );

  const currentCapability = capabilities.find(
    (capability) =>
      capability.provider === current.provider &&
      capability.models.some((model) => model.id === current.model),
  );
  const currentEntry =
    currentCapability?.models.find((entry) => entry.id === current.model) ??
    groups
      .find((group) => group.provider === current.provider)
      ?.models.find((entry) => entry.id === current.model) ??
    (rememberedCurrent?.provider === current.provider &&
    rememberedCurrent.model === current.model
      ? rememberedCurrent.entry
      : undefined);
  const currentCapabilityLabel =
    currentCapability?.capability === "moa"
      ? t("options.models.virtual.moaTitle")
      : currentCapability?.label;
  const currentDisplayName = currentEntry
    ? resolveCatalogModelDisplayName(currentEntry)
    : current.model;
  const currentLabel = currentCapability
    ? `${currentCapabilityLabel} · ${currentDisplayName}`
    : currentDisplayName;
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
      ...capabilities.map((capability) => ({
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
      })),
    ],
    [capabilities, groups, t],
  );

  const selectModel = async (provider: string, model: string) => {
    if (!provider || !model || saving) return;
    if (provider === current.provider && model === current.model) {
      setOpen(false);
      return;
    }

    setSelectionError(false);
    setSaving(true);
    const patch = {
      provider,
      model,
      base_url: null,
    };
    const result = profileId
      ? await hermesModelGateway.main.write(patch, profileId)
      : await hermesModelGateway.main.write(patch);

    if (result.ok) {
      const nextCurrent = {
        provider: result.provider || provider,
        model: result.model || model,
      };
      const selectedEntry =
        capabilities
          .find((capability) => capability.provider === provider)
          ?.models.find((entry) => entry.id === model) ??
        groups
          .find((group) => group.provider === provider)
          ?.models.find((entry) => entry.id === model);
      setCurrent(nextCurrent);
      setRememberedCurrent(
        selectedEntry
          ? {
              provider: nextCurrent.provider,
              model: nextCurrent.model,
              entry: selectedEntry,
              updatedAt: Date.now(),
            }
          : null,
      );
      setLoadState("ready");
      setOpen(false);
    } else {
      setSelectionError(true);
    }
    setSaving(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (next && (disabled || saving)) return;
    setOpen(next);
    if (next) {
      setSelectionError(false);
      void loadModels();
    }
  };

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-invalid={selectionError || undefined}
        aria-label={t("sidepanel.modelPicker.label")}
        className={cn(
          "inline-flex h-7 min-w-0 max-w-[min(11rem,42vw)] items-center gap-1.5 rounded-full px-2",
          "text-[11px] font-medium text-muted-foreground transition-colors",
          "hover:bg-muted/60 hover:text-foreground",
          "focus:outline-none focus-visible:bg-muted/60 focus-visible:text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
          selectionError && "text-destructive hover:text-destructive",
        )}
        disabled={disabled || saving}
        onClick={() => handleOpenChange(true)}
        title={t(
          selectionError
            ? "sidepanel.modelPicker.switchFailed"
            : "sidepanel.modelPicker.label",
        )}
        type="button"
      >
        {loadState === "loading" && !current.model ? (
          <Loader2 aria-hidden className="h-3 w-3 shrink-0 animate-spin" />
        ) : currentCapability ? (
          <Workflow aria-hidden className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ModelIcon
            className="h-3.5 w-3.5"
            model={current.model}
            provider={current.provider}
          />
        )}
        <span className="min-w-0 truncate">
          {currentLabel ||
            t(
              loadState === "error"
                ? "sidepanel.modelPicker.loadFailed"
                : "sidepanel.modelPicker.loading",
            )}
        </span>
      </button>

      <ModelPickerDialog
        dialogSize={dialogSize}
        errorMessage={
          selectionError ? t("sidepanel.modelPicker.switchFailed") : undefined
        }
        groups={pickerGroups}
        onOpenChange={handleOpenChange}
        onSelect={(provider, model) => void selectModel(provider, model)}
        open={open}
        overlayVariant={overlayVariant}
        saving={saving}
        selected={current}
        status={loadState}
      />
    </>
  );
}
