import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  EllipsisVertical,
  Loader2,
  Pencil,
  Plus,
  Save,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

import {
  buildHermesModelPickerGroups,
  hermesModelGateway,
  isHermesModelSlotEnabled,
  type HermesMoaConfigResponse,
  type HermesMoaModelSlot,
  type HermesMoaPreset,
  type HermesModelProviderView,
  type HermesSelectedModelSummary,
  type HermesVirtualCapabilityStatus,
  type HermesVirtualCapabilityView,
} from "@amiba/core";
import { useT } from "@amiba/i18n";

import {
  ModelPickerDialog,
  ModelSummary,
  resolveCatalogModelDisplayName,
  type ModelPickerGroup,
  type ModelPickerStatus,
} from "../models";
import { resolveModelPreviewMetadata } from "../models/model-metadata";
import {
  Badge,
  Button,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  cn,
} from "../primitives";

export interface VirtualCapabilitiesPanelProps {
  config: HermesMoaConfigResponse | null;
  capability?: HermesVirtualCapabilityView;
  modelSummaries?: HermesSelectedModelSummary[];
  providerCatalogStatus?: ModelPickerStatus;
  providers: HermesModelProviderView[];
  profileId?: string;
  scopeControl?: ReactNode;
  onSaved: (config: HermesMoaConfigResponse) => void;
}

function clonePreset(preset: HermesMoaPreset): HermesMoaPreset {
  return {
    ...preset,
    reference_models: preset.reference_models.map((slot) => ({ ...slot })),
    aggregator: { ...preset.aggregator },
  };
}

function cloneConfig(config: HermesMoaConfigResponse): HermesMoaConfigResponse {
  return {
    ...config,
    presets: Object.fromEntries(
      Object.entries(config.presets).map(([name, preset]) => [
        name,
        clonePreset(preset),
      ]),
    ),
    reference_models: config.reference_models.map((slot) => ({ ...slot })),
    aggregator: { ...config.aggregator },
  };
}

function capabilityStatus(
  preset: HermesMoaPreset,
  providers: HermesModelProviderView[],
): HermesVirtualCapabilityStatus {
  if (!preset.enabled) return "disabled";
  if (!isHermesModelSlotEnabled(preset.aggregator, providers)) {
    return "unavailable";
  }
  return preset.reference_models
    .filter((slot) => slot.enabled !== false)
    .every((slot) => isHermesModelSlotEnabled(slot, providers))
    ? "ready"
    : "degraded";
}

type FanoutMode = "user_turn" | "per_iteration" | "every_n";

function parseFanout(value: HermesMoaPreset["fanout"]): {
  mode: FanoutMode;
  everyN: number;
} {
  if (value?.startsWith("every_n:")) {
    const everyN = Number(value.slice("every_n:".length));
    return {
      mode: "every_n",
      everyN: Number.isInteger(everyN) && everyN >= 2 ? everyN : 3,
    };
  }
  return {
    mode: value === "per_iteration" ? "per_iteration" : "user_turn",
    everyN: 3,
  };
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function withReasoningEffort(
  slot: HermesMoaModelSlot,
  reasoningEffort: string,
): HermesMoaModelSlot {
  const next = { ...slot };
  if (reasoningEffort === "provider_default") {
    delete next.reasoning_effort;
    return next;
  }
  next.reasoning_effort = reasoningEffort as NonNullable<
    HermesMoaModelSlot["reasoning_effort"]
  >;
  return next;
}

const REASONING_OPTIONS = [
  ["provider_default", "options.models.virtual.reasoning.provider_default"],
  ["none", "options.models.virtual.reasoning.none"],
  ["minimal", "options.models.virtual.reasoning.minimal"],
  ["low", "options.models.virtual.reasoning.low"],
  ["medium", "options.models.virtual.reasoning.medium"],
  ["high", "options.models.virtual.reasoning.high"],
  ["xhigh", "options.models.virtual.reasoning.xhigh"],
  ["max", "options.models.virtual.reasoning.max"],
  ["ultra", "options.models.virtual.reasoning.ultra"],
] as const;

function statusVariant(
  status: HermesVirtualCapabilityStatus,
): "success" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "ready":
      return "success";
    case "degraded":
      return "warning";
    case "unavailable":
      return "destructive";
    default:
      return "secondary";
  }
}

function statusKey(status: HermesVirtualCapabilityStatus) {
  switch (status) {
    case "ready":
      return "options.models.virtual.status.ready" as const;
    case "degraded":
      return "options.models.virtual.status.degraded" as const;
    case "unavailable":
      return "options.models.virtual.status.unavailable" as const;
    default:
      return "options.models.virtual.status.disabled" as const;
  }
}

function statusDotClass(status: HermesVirtualCapabilityStatus | null): string {
  switch (status) {
    case "ready":
      return "bg-[hsl(var(--success))]";
    case "degraded":
      return "bg-amber-500";
    case "unavailable":
      return "bg-destructive";
    default:
      return "bg-muted-foreground/35";
  }
}

interface PresetActionsMenuProps {
  name: string;
  busy: boolean;
  canDelete: boolean;
  onCopy: () => void;
  onDelete: () => void;
}

function PresetActionsMenu({
  name,
  busy,
  canDelete,
  onCopy,
  onDelete,
}: PresetActionsMenuProps) {
  const { t } = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }, []);

  const openMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = 156;
    const height = 80;
    const spaceBelow = window.innerHeight - rect.bottom;
    setPosition({
      left: Math.max(
        8,
        Math.min(rect.right - width, window.innerWidth - width - 8),
      ),
      top:
        spaceBelow >= height + 8
          ? rect.bottom + 5
          : Math.max(8, rect.top - height - 5),
    });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };
    const onWindowChange = () => closeMenu();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    const focusTimer = window.setTimeout(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [closeMenu, open]);

  const runAndClose = (action: () => void) => {
    closeMenu();
    action();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1/2 h-6 w-11 -translate-y-1/2 justify-end rounded-md bg-secondary pr-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/preset:opacity-100 group-focus-within/preset:opacity-100 data-[state=open]:opacity-100"
        data-state={open ? "open" : "closed"}
        disabled={busy}
        aria-label={t("options.models.virtual.presetActionsNamed", { name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <EllipsisVertical aria-hidden className="h-3.5 w-3.5" />
      </Button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={t("options.models.virtual.presetActions")}
              className="fixed z-50 w-[156px] rounded-lg border border-border/70 bg-popover p-1 text-popover-foreground shadow-popover"
              style={position}
              onKeyDown={onMenuKeyDown}
            >
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-foreground/85 transition-colors hover:bg-muted/70"
                onClick={() => runAndClose(onCopy)}
              >
                <Copy
                  aria-hidden
                  className="h-3.5 w-3.5 text-muted-foreground"
                />
                {t("options.models.virtual.copyPreset")}
              </button>
              <div aria-hidden className="mx-1 my-0.5 h-px bg-border/50" />
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-destructive transition-colors hover:bg-destructive/8 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!canDelete}
                onClick={() => runAndClose(onDelete)}
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
                {t("options.models.virtual.deletePreset")}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

interface SlotEditorProps {
  label: string;
  slot: HermesMoaModelSlot;
  pickerGroups: ModelPickerGroup[];
  modelSummaries: HermesSelectedModelSummary[];
  providerCatalogStatus: ModelPickerStatus;
  providers: HermesModelProviderView[];
  reference?: boolean;
  removable?: boolean;
  onChange: (slot: HermesMoaModelSlot) => void;
  onRemove?: () => void;
}

function SlotEditor({
  label,
  slot,
  pickerGroups,
  modelSummaries,
  providerCatalogStatus,
  providers,
  reference = false,
  removable = false,
  onChange,
  onRemove,
}: SlotEditorProps) {
  const { t } = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedProvider = providers.find(
    (provider) => provider.id === slot.provider,
  );
  const selectedModel = selectedProvider?.models.find(
    (model) => model.id === slot.model,
  );
  const rememberedModel = modelSummaries.find(
    (summary) =>
      summary.provider === slot.provider && summary.model === slot.model,
  )?.entry;
  const selectedModelEntry = selectedModel ?? rememberedModel;
  const selectedModelName = selectedModelEntry
    ? resolveCatalogModelDisplayName(selectedModelEntry)
    : slot.model;
  const selectedModelMetadata = resolveModelPreviewMetadata(
    selectedModelEntry?.metadata,
    selectedModelEntry?.supplemental?.metadata,
  );
  const slotEnabled = !reference || slot.enabled !== false;
  const availabilityKnown = providerCatalogStatus === "ready";
  const ready =
    availabilityKnown &&
    slotEnabled &&
    isHermesModelSlotEnabled(slot, providers);
  const reasoningEffort = slot.reasoning_effort ?? "provider_default";

  return (
    <>
      <div
        className="border-b border-border/60 last:border-b-0"
        data-moa-slot-item
      >
        <div
          className={cn(
            "grid items-center gap-3 px-4 py-3 transition-opacity sm:grid-cols-[8rem_minmax(0,1fr)_auto]",
            !slotEnabled && "opacity-55",
          )}
          data-moa-slot-row
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              data-moa-slot-status
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                !slotEnabled
                  ? "bg-muted-foreground/30"
                  : !availabilityKnown
                    ? "bg-muted-foreground/30"
                    : ready
                      ? "bg-[hsl(var(--success))]"
                      : "bg-amber-500",
              )}
            />
            <span className="text-xs font-medium text-foreground">{label}</span>
          </div>
          <button
            type="button"
            aria-label={t("options.models.config.pickerTitle", { task: label })}
            className="min-w-0 rounded-xl bg-transparent px-2 py-1.5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
            data-moa-model-slot
            onClick={() => setPickerOpen(true)}
          >
            <ModelSummary
              action={
                <ChevronRight
                  aria-hidden
                  className="h-3.5 w-3.5 text-muted-foreground"
                />
              }
              className="items-center"
              displayName={selectedModelName}
              metadata={selectedModelMetadata}
              model={slot.model}
              provider={slot.provider}
              variant="picker"
            />
          </button>
          <div className="flex self-center items-center justify-end gap-1">
            {reference ? (
              <Switch
                aria-label={t("options.models.virtual.referenceEnabledNamed", {
                  name: label,
                })}
                checked={slotEnabled}
                className="mr-1 scale-90"
                onCheckedChange={(enabled) => onChange({ ...slot, enabled })}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground"
              aria-label={t("options.models.virtual.slotSettingsNamed", {
                name: label,
              })}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((current) => !current)}
            >
              <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
            </Button>
            {removable ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground"
                aria-label={t("options.models.virtual.removeReference")}
                onClick={onRemove}
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
        {settingsOpen ? (
          <div
            className="grid gap-3 border-t border-border/45 bg-muted/[0.1] px-4 py-3 sm:grid-cols-2 sm:pl-[9.75rem]"
            data-moa-slot-settings
          >
            <label className="text-[10px] text-muted-foreground">
              <span className="mb-1.5 block font-medium text-foreground">
                {t("options.models.virtual.reasoningEffort")}
              </span>
              <Select
                value={reasoningEffort}
                onValueChange={(value) =>
                  onChange(withReasoningEffort(slot, value))
                }
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONING_OPTIONS.map(([value, key]) => (
                    <SelectItem key={value} value={value} className="text-xs">
                      {t(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {reference ? (
              <label className="text-[10px] text-muted-foreground">
                <span className="mb-1.5 block font-medium text-foreground">
                  {t("options.models.virtual.referenceOutputLimit")}
                </span>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  className="h-8 text-xs"
                  placeholder={t(
                    "options.models.virtual.inheritPresetOutputLimit",
                  )}
                  value={slot.max_tokens ?? ""}
                  onChange={(event) => {
                    const maxTokens = optionalNumber(event.target.value);
                    const next = { ...slot };
                    if (maxTokens && maxTokens > 0) {
                      next.max_tokens = Math.round(maxTokens);
                    } else {
                      delete next.max_tokens;
                    }
                    onChange(next);
                  }}
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
      <ModelPickerDialog
        description={t("options.models.config.pickerDescription")}
        groups={pickerGroups}
        onOpenChange={setPickerOpen}
        onSelect={(provider, model) => {
          onChange({ ...slot, provider, model });
          setPickerOpen(false);
        }}
        open={pickerOpen}
        searchPlaceholder={t("options.models.config.searchForTask", {
          task: label,
        })}
        selected={slot}
        status={providerCatalogStatus}
        title={t("options.models.config.pickerTitle", { task: label })}
      />
    </>
  );
}

export function VirtualCapabilitiesPanel({
  config,
  capability,
  modelSummaries = [],
  providerCatalogStatus = "ready",
  providers,
  profileId,
  scopeControl,
  onSaved,
}: VirtualCapabilitiesPanelProps) {
  const { t } = useT();
  const [draft, setDraft] = useState<HermesMoaConfigResponse | null>(null);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [newPresetName, setNewPresetName] = useState("");
  const [creatingPreset, setCreatingPreset] = useState(false);
  const [editingPresetName, setEditingPresetName] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [dirtyPreset, setDirtyPreset] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedPreset, setSavedPreset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config?.ok) return;
    const next = cloneConfig(config);
    setDraft(next);
    setSelectedPreset((current) =>
      current && next.presets[current] ? current : next.default_preset,
    );
    setEditingPresetName(false);
    setPresetNameDraft("");
    setDirtyPreset(null);
  }, [config]);

  const presetNames = useMemo(
    () => Object.keys(draft?.presets ?? {}),
    [draft?.presets],
  );
  const pickerGroups = useMemo<ModelPickerGroup[]>(
    () =>
      buildHermesModelPickerGroups(providers).map((group) => ({
        id: `provider:${group.provider}`,
        kind: "provider",
        label: group.label,
        provider: group.provider,
        models: group.models.map((model) => ({
          description: model.description ?? model.supplemental?.description,
          label: resolveCatalogModelDisplayName(model),
          metadata: model.metadata,
          model: model.id,
          supplemental: model.supplemental,
        })),
      })),
    [providers],
  );
  const preset = draft?.presets[selectedPreset];
  const status: HermesVirtualCapabilityStatus | null =
    providerCatalogStatus === "ready"
      ? preset
        ? capabilityStatus(preset, providers)
        : (capability?.presets[0]?.status ?? "unavailable")
      : preset?.enabled === false
        ? "disabled"
        : null;
  const fanout = parseFanout(preset?.fanout);

  function updatePreset(update: (current: HermesMoaPreset) => HermesMoaPreset) {
    if (!draft || !preset) return;
    setDraft({
      ...draft,
      presets: {
        ...draft.presets,
        [selectedPreset]: update(preset),
      },
    });
    setDirtyPreset(selectedPreset);
    setSavedPreset(null);
  }

  function updateGlobal(
    update: (current: HermesMoaConfigResponse) => HermesMoaConfigResponse,
  ) {
    if (!draft) return;
    setDraft(update(draft));
    setDirtyPreset(selectedPreset);
    setSavedPreset(null);
  }

  function addPreset() {
    const name = newPresetName.trim();
    if (!draft || !preset || !name || draft.presets[name]) return;
    setDraft({
      ...draft,
      presets: {
        ...draft.presets,
        [name]: clonePreset(preset),
      },
    });
    setSelectedPreset(name);
    setNewPresetName("");
    setCreatingPreset(false);
    setDirtyPreset(name);
    setSavedPreset(null);
  }

  function copyPreset() {
    if (!draft || !preset || dirtyPreset) return;
    let name = t("options.models.virtual.copyName", {
      name: selectedPreset,
    });
    let copyNumber = 2;
    while (draft.presets[name]) {
      name = t("options.models.virtual.copyNameIndexed", {
        name: selectedPreset,
        number: copyNumber,
      });
      copyNumber += 1;
    }
    setDraft({
      ...draft,
      presets: {
        ...draft.presets,
        [name]: clonePreset(preset),
      },
    });
    setSelectedPreset(name);
    setEditingPresetName(false);
    setPresetNameDraft("");
    setDirtyPreset(name);
    setSavedPreset(null);
    setError(null);
  }

  function renamePreset(nextName: string): boolean {
    const name = nextName.trim();
    if (!draft || !preset) return false;
    if (!name) {
      setError(t("options.models.virtual.presetNameRequired"));
      return false;
    }
    if (name === selectedPreset) {
      setEditingPresetName(false);
      setPresetNameDraft("");
      return true;
    }
    if (draft.presets[name]) {
      setError(t("options.models.virtual.presetNameExists"));
      return false;
    }
    const presets = Object.fromEntries(
      Object.entries(draft.presets).map(([presetName, value]) => [
        presetName === selectedPreset ? name : presetName,
        value,
      ]),
    );
    setDraft({
      ...draft,
      presets,
      default_preset:
        draft.default_preset === selectedPreset ? name : draft.default_preset,
      active_preset:
        draft.active_preset === selectedPreset ? name : draft.active_preset,
    });
    setSelectedPreset(name);
    setEditingPresetName(false);
    setPresetNameDraft("");
    setDirtyPreset(name);
    setSavedPreset(null);
    setError(null);
    return true;
  }

  function cancelPresetRename() {
    setEditingPresetName(false);
    setPresetNameDraft("");
    setError(null);
  }

  async function deletePreset() {
    if (!draft || presetNames.length <= 1 || dirtyPreset) return;
    const presets = { ...draft.presets };
    delete presets[selectedPreset];
    const fallback = Object.keys(presets)[0] ?? "";
    const nextDraft = {
      ...draft,
      presets,
      default_preset:
        draft.default_preset === selectedPreset
          ? fallback
          : draft.default_preset,
      active_preset:
        draft.active_preset === selectedPreset ? "" : draft.active_preset,
    };
    setSaving(true);
    setError(null);
    const result = await hermesModelGateway.virtualCapabilities.writeMoa(
      {
        default_preset: nextDraft.default_preset,
        active_preset: nextDraft.active_preset,
        presets: nextDraft.presets,
        privacy_filter: nextDraft.privacy_filter,
      },
      profileId,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.models.virtual.saveFailed"));
      return;
    }
    setDraft(cloneConfig(result));
    setSelectedPreset(fallback);
    setSavedPreset(null);
    onSaved(result);
  }

  async function savePreset() {
    if (!draft) return;
    const presetName = selectedPreset;
    setSaving(true);
    setError(null);
    const result = await hermesModelGateway.virtualCapabilities.writeMoa(
      {
        default_preset: draft.default_preset,
        active_preset: draft.active_preset,
        presets: draft.presets,
        privacy_filter: draft.privacy_filter,
      },
      profileId,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.models.virtual.saveFailed"));
      return;
    }
    setDraft(cloneConfig(result));
    setDirtyPreset(null);
    setSavedPreset(presetName);
    onSaved(result);
    window.setTimeout(
      () =>
        setSavedPreset((current) => (current === presetName ? null : current)),
      1500,
    );
  }

  if (!config) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-10 text-xs text-muted-foreground">
        <Loader2 aria-hidden className="mr-2 h-3.5 w-3.5 animate-spin" />
        {t("options.models.virtual.loading")}
      </div>
    );
  }

  if (!config.ok || !draft || !preset) {
    return (
      <div className="min-h-0 flex-1 p-6">
        <div className="mx-auto max-w-3xl rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
          {config.error || t("options.models.virtual.unavailable")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <aside
        className="flex min-h-0 w-52 shrink-0 flex-col border-r border-border/60 bg-muted/10"
        data-moa-preset-sidebar
      >
        {scopeControl ? (
          <div className="flex h-10 shrink-0 items-center px-2">
            {scopeControl}
          </div>
        ) : null}
        <div className="flex h-11 shrink-0 items-center justify-between px-3">
          <span className="text-[11px] font-semibold text-foreground">
            {t("options.models.virtual.preset")}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full text-muted-foreground"
            disabled={saving || Boolean(dirtyPreset)}
            aria-label={t("options.models.virtual.addPreset")}
            onClick={() => setCreatingPreset(true)}
          >
            <Plus aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>

        {creatingPreset ? (
          <form
            className="shrink-0 space-y-2 px-2 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              addPreset();
            }}
          >
            <Input
              autoFocus
              value={newPresetName}
              onChange={(event) => setNewPresetName(event.target.value)}
              placeholder={t("options.models.virtual.newPreset")}
              className="h-8 font-mono text-[11px]"
            />
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px]"
                onClick={() => {
                  setCreatingPreset(false);
                  setNewPresetName("");
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-7 px-2 text-[10px]"
                disabled={
                  !newPresetName.trim() ||
                  Boolean(draft.presets[newPresetName.trim()])
                }
              >
                {t("options.models.virtual.addPreset")}
              </Button>
            </div>
          </form>
        ) : null}

        <ScrollArea className="min-h-0 flex-1">
          <nav
            className="p-1.5"
            aria-label={t("options.models.virtual.preset")}
          >
            {presetNames.map((name) => {
              const itemStatus =
                providerCatalogStatus === "ready"
                  ? capabilityStatus(draft.presets[name], providers)
                  : draft.presets[name]?.enabled === false
                    ? "disabled"
                    : null;
              const selected = name === selectedPreset;
              return (
                <div
                  key={name}
                  className={cn(
                    "group/preset relative flex h-8 w-full items-center rounded-md transition-colors",
                    selected
                      ? "bg-secondary text-secondary-foreground"
                      : "text-foreground/80 hover:bg-accent/70 hover:text-foreground",
                    dirtyPreset && !selected && "cursor-not-allowed opacity-45",
                  )}
                  data-moa-preset-row
                >
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
                    disabled={saving || Boolean(dirtyPreset && !selected)}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => {
                      setSelectedPreset(name);
                      setSavedPreset(null);
                      setError(null);
                    }}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        statusDotClass(itemStatus),
                      )}
                    />
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="min-w-0 truncate font-mono text-[11px]">
                        {name}
                      </span>
                      {dirtyPreset === name ? (
                        <span
                          aria-label={t("options.models.virtual.unsaved")}
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                          data-moa-preset-unsaved
                          title={t("options.models.virtual.unsaved")}
                        />
                      ) : null}
                    </span>
                    {presetNames.length > 1 && draft.default_preset === name ? (
                      <span className="text-[9px] text-muted-foreground/75">
                        {t("options.models.virtual.defaultPreset")}
                      </span>
                    ) : null}
                  </button>
                  {selected && !dirtyPreset ? (
                    <PresetActionsMenu
                      name={name}
                      busy={saving || Boolean(dirtyPreset)}
                      canDelete={presetNames.length > 1}
                      onCopy={copyPreset}
                      onDelete={() => void deletePreset()}
                    />
                  ) : null}
                </div>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          <section className="overflow-hidden rounded-xl border border-border/70 bg-background">
            <div
              className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-2"
              data-moa-preset-toolbar
            >
              {editingPresetName ? (
                <form
                  className="min-w-0"
                  onSubmit={(event) => {
                    event.preventDefault();
                    renamePreset(presetNameDraft);
                  }}
                >
                  <Input
                    autoFocus
                    aria-label={t("options.models.virtual.renamePreset")}
                    className="h-8 w-48 rounded-lg font-mono text-xs"
                    value={presetNameDraft}
                    onChange={(event) => setPresetNameDraft(event.target.value)}
                    onBlur={() => {
                      const nextName = presetNameDraft.trim();
                      if (
                        !nextName ||
                        (nextName !== selectedPreset &&
                          Boolean(draft.presets[nextName]))
                      ) {
                        cancelPresetRename();
                        return;
                      }
                      renamePreset(nextName);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelPresetRename();
                      }
                    }}
                  />
                </form>
              ) : (
                <button
                  type="button"
                  className="group/title -ml-1.5 inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
                  aria-label={t("options.models.virtual.renamePresetNamed", {
                    name: selectedPreset,
                  })}
                  disabled={saving}
                  onClick={() => {
                    setPresetNameDraft(selectedPreset);
                    setEditingPresetName(true);
                    setError(null);
                  }}
                >
                  <span className="min-w-0 truncate font-mono text-xs font-medium text-foreground">
                    {selectedPreset}
                  </span>
                  <Pencil
                    aria-hidden
                    className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
                  />
                </button>
              )}
              {presetNames.length > 1 ? (
                draft.default_preset === selectedPreset ? (
                  <Badge variant="secondary" className="text-[9px] font-normal">
                    {t("options.models.virtual.defaultPreset")}
                  </Badge>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[10px]"
                    disabled={saving || Boolean(dirtyPreset)}
                    onClick={() => {
                      setDraft({ ...draft, default_preset: selectedPreset });
                      setDirtyPreset(selectedPreset);
                      setSavedPreset(null);
                    }}
                  >
                    {t("options.models.virtual.setDefault")}
                  </Button>
                )
              ) : null}
              {status ? (
                <Badge
                  variant={statusVariant(status)}
                  className="text-[9px] font-normal"
                >
                  {t(statusKey(status))}
                </Badge>
              ) : null}
              <div
                className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground"
                data-moa-preset-toggle
                title={t("options.models.virtual.enabledHint")}
              >
                <span>{t("options.models.virtual.enabled")}</span>
                <Switch
                  aria-label={t("options.models.virtual.enabled")}
                  checked={preset.enabled}
                  onCheckedChange={(enabled) =>
                    updatePreset((current) => ({ ...current, enabled }))
                  }
                />
              </div>
            </div>

            {error ? (
              <p
                className="mx-3 mb-3 rounded-lg bg-destructive/5 px-3 py-2 text-[11px] text-destructive"
                data-moa-warning
              >
                {error}
              </p>
            ) : status === "unavailable" || status === "degraded" ? (
              <div
                className="mx-3 mb-3 flex items-start gap-2 rounded-lg bg-amber-500/[0.055] px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300"
                data-moa-warning
              >
                <AlertTriangle
                  aria-hidden
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                {t(
                  status === "unavailable"
                    ? "options.models.virtual.unavailableHint"
                    : "options.models.virtual.degradedHint",
                )}
              </div>
            ) : null}
          </section>

          <section>
            <div className="mb-2">
              <h3 className="text-xs font-semibold text-foreground">
                {t("options.models.virtual.pipelineTitle")}
              </h3>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {t("options.models.virtual.pipelineDescription")}
              </p>
            </div>
            <div
              className="overflow-hidden rounded-xl border border-border/70"
              data-moa-pipeline
            >
              {preset.reference_models.map((slot, index) => (
                <SlotEditor
                  key={`${index}:${slot.provider}:${slot.model}`}
                  label={t("options.models.virtual.reference", {
                    number: index + 1,
                  })}
                  slot={slot}
                  pickerGroups={pickerGroups}
                  modelSummaries={modelSummaries}
                  providerCatalogStatus={providerCatalogStatus}
                  providers={providers}
                  reference
                  removable={preset.reference_models.length > 1}
                  onRemove={() =>
                    updatePreset((current) => ({
                      ...current,
                      reference_models: current.reference_models.filter(
                        (_, candidate) => candidate !== index,
                      ),
                    }))
                  }
                  onChange={(next) =>
                    updatePreset((current) => ({
                      ...current,
                      reference_models: current.reference_models.map(
                        (candidate, candidateIndex) =>
                          candidateIndex === index ? next : candidate,
                      ),
                    }))
                  }
                />
              ))}
              <div
                className="grid min-h-12 grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-4 py-1"
                data-moa-add-reference-row
              >
                <button
                  type="button"
                  className="group flex h-10 min-w-0 items-center gap-2 rounded-lg text-left text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
                  onClick={() =>
                    updatePreset((current) => ({
                      ...current,
                      reference_models: [
                        ...current.reference_models,
                        { ...current.aggregator, enabled: true },
                      ],
                    }))
                  }
                >
                  <span
                    className="flex w-1.5 items-center justify-center"
                    data-moa-add-reference-icon
                  >
                    <Plus
                      aria-hidden
                      className="h-3.5 w-3.5 max-w-none shrink-0"
                    />
                  </span>
                  <span
                    className="min-w-0 truncate text-xs font-medium"
                    data-moa-add-reference-label
                  >
                    {t("options.models.virtual.addReference")}
                  </span>
                </button>
                <span aria-hidden />
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  {t("options.models.virtual.parallel")}
                  <ArrowDown aria-hidden className="h-3 w-3" />
                </span>
              </div>
              <SlotEditor
                label={t("options.models.virtual.aggregator")}
                slot={preset.aggregator}
                pickerGroups={pickerGroups}
                modelSummaries={modelSummaries}
                providerCatalogStatus={providerCatalogStatus}
                providers={providers}
                onChange={(aggregator) =>
                  updatePreset((current) => ({ ...current, aggregator }))
                }
              />
            </div>
          </section>

          <details className="group overflow-hidden rounded-xl border border-border/70 bg-background">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
              <span>{t("options.models.virtual.advancedTitle")}</span>
              <span className="ml-auto hidden text-[10px] font-normal tabular-nums text-muted-foreground/70 sm:inline">
                {t(
                  fanout.mode === "per_iteration"
                    ? "options.models.virtual.fanout.perIteration"
                    : fanout.mode === "every_n"
                      ? "options.models.virtual.fanout.everyN"
                      : "options.models.virtual.fanout.userTurn",
                  fanout.mode === "every_n"
                    ? { count: fanout.everyN }
                    : undefined,
                )}
                {" · "}
                {preset.reference_max_tokens
                  ? t("options.models.virtual.referenceMaxTokensValue", {
                      count: preset.reference_max_tokens,
                    })
                  : t("options.models.virtual.unlimited")}
              </span>
              <ChevronDown
                aria-hidden
                className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="grid gap-x-4 gap-y-4 border-t border-border/60 p-4 sm:grid-cols-2">
              <div className="text-[10px] text-muted-foreground">
                <span className="mb-1.5 block font-medium text-foreground">
                  {t("options.models.virtual.fanout.label")}
                </span>
                <Select
                  value={fanout.mode}
                  onValueChange={(mode: FanoutMode) =>
                    updatePreset((current) => ({
                      ...current,
                      fanout:
                        mode === "every_n" ? `every_n:${fanout.everyN}` : mode,
                    }))
                  }
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user_turn" className="text-xs">
                      {t("options.models.virtual.fanout.userTurn")}
                    </SelectItem>
                    <SelectItem value="per_iteration" className="text-xs">
                      {t("options.models.virtual.fanout.perIteration")}
                    </SelectItem>
                    <SelectItem value="every_n" className="text-xs">
                      {t("options.models.virtual.fanout.everyN", { count: 3 })}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {fanout.mode === "every_n" ? (
                <label className="text-[10px] text-muted-foreground">
                  <span className="mb-1.5 block font-medium text-foreground">
                    {t("options.models.virtual.fanout.interval")}
                  </span>
                  <Input
                    type="number"
                    min="2"
                    step="1"
                    className="h-8 text-xs"
                    value={fanout.everyN}
                    onChange={(event) => {
                      const value = Math.max(
                        2,
                        Math.round(Number(event.target.value) || 2),
                      );
                      updatePreset((current) => ({
                        ...current,
                        fanout: `every_n:${value}`,
                      }));
                    }}
                  />
                </label>
              ) : (
                <div className="hidden sm:block" aria-hidden />
              )}
              <label className="text-[10px] text-muted-foreground">
                <span className="mb-1.5 block font-medium text-foreground">
                  {t("options.models.virtual.referenceMaxTokens")}
                </span>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  className="h-8 text-xs"
                  placeholder={t("options.models.virtual.unlimited")}
                  value={preset.reference_max_tokens ?? ""}
                  onChange={(event) => {
                    const value = optionalNumber(event.target.value);
                    updatePreset((current) => ({
                      ...current,
                      reference_max_tokens:
                        value && value > 0 ? Math.round(value) : null,
                    }));
                  }}
                />
              </label>
              <label className="text-[10px] text-muted-foreground">
                <span className="mb-1.5 block font-medium text-foreground">
                  {t("options.models.virtual.referenceTimeout")}
                </span>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  className="h-8 text-xs"
                  placeholder={t("options.models.virtual.inheritHermes")}
                  value={preset.reference_timeout ?? ""}
                  onChange={(event) => {
                    const value = optionalNumber(event.target.value);
                    updatePreset((current) => ({
                      ...current,
                      reference_timeout: value && value > 0 ? value : null,
                    }));
                  }}
                />
              </label>
              <div className="text-[10px] text-muted-foreground">
                <span className="mb-1.5 block font-medium text-foreground">
                  {t("options.models.virtual.degradedPolicy")}
                </span>
                <Select
                  value={preset.degraded_reference_policy ?? "loud"}
                  onValueChange={(value: "loud" | "silent") =>
                    updatePreset((current) => ({
                      ...current,
                      degraded_reference_policy: value,
                    }))
                  }
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="loud" className="text-xs">
                      {t("options.models.virtual.degraded.loud")}
                    </SelectItem>
                    <SelectItem value="silent" className="text-xs">
                      {t("options.models.virtual.degraded.silent")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-[10px] text-muted-foreground">
                <span className="mb-1.5 block font-medium text-foreground">
                  {t("options.models.virtual.privacyFilter")}
                </span>
                <Select
                  value={draft.privacy_filter || "off"}
                  onValueChange={(value: "off" | "display" | "full") =>
                    updateGlobal((current) => ({
                      ...current,
                      privacy_filter: value === "off" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off" className="text-xs">
                      {t("options.models.virtual.privacy.off")}
                    </SelectItem>
                    <SelectItem value="display" className="text-xs">
                      {t("options.models.virtual.privacy.display")}
                    </SelectItem>
                    <SelectItem value="full" className="text-xs">
                      {t("options.models.virtual.privacy.full")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="text-[10px] text-muted-foreground">
                <span className="block font-medium text-foreground">
                  {t("options.models.virtual.referenceTemperature")}
                </span>
                <span className="mt-0.5 block leading-relaxed">
                  {t("options.models.virtual.referenceTemperatureHint")}
                </span>
                <Input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  className="mt-2 h-8 text-xs"
                  placeholder={t("options.models.virtual.providerDefault")}
                  value={preset.reference_temperature ?? ""}
                  onChange={(event) => {
                    const value = optionalNumber(event.target.value);
                    updatePreset((current) => ({
                      ...current,
                      reference_temperature: value,
                    }));
                  }}
                />
              </label>
              <label className="text-[10px] text-muted-foreground">
                <span className="block font-medium text-foreground">
                  {t("options.models.virtual.aggregatorTemperature")}
                </span>
                <span className="mt-0.5 block leading-relaxed">
                  {t("options.models.virtual.aggregatorTemperatureHint")}
                </span>
                <Input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  className="mt-2 h-8 text-xs"
                  placeholder={t("options.models.virtual.providerDefault")}
                  value={preset.aggregator_temperature ?? ""}
                  onChange={(event) => {
                    const value = optionalNumber(event.target.value);
                    updatePreset((current) => ({
                      ...current,
                      aggregator_temperature: value,
                    }));
                  }}
                />
              </label>
            </div>
          </details>

          <div className="flex items-center gap-2 pt-1" data-moa-preset-actions>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 rounded-lg px-2.5 text-[10px]"
              disabled={saving || dirtyPreset !== selectedPreset}
              onClick={() => void savePreset()}
            >
              {saving ? (
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
              ) : savedPreset === selectedPreset ? (
                <Check aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <Save aria-hidden className="h-3.5 w-3.5" />
              )}
              {savedPreset === selectedPreset
                ? t("options.models.virtual.saved")
                : t("options.models.virtual.save")}
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
