import type { AgentModelSelection } from "@amiba/app-runtime/platform";
import type { IApiClient } from "@deepseek-ai/dsh-api-remotes/client";
import {
  ModelIcon,
  ModelPickerDialog,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  usePluginT,
  type DialogOverlayVariant,
  type ModelPickerGroup,
  type ModelPickerStatus,
} from "@amiba/ui/plugin";
import { BrainCircuit, Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { pickerI18n } from "./i18n-picker.js";

// ---------------------------------------------------------------------------
// Plugin-local model-plane shapes. These mirror the plugin's own Remote wire
// contract (`../remote.js` zod schemas) — the plane vocabulary lives with the
// plugin now, NOT in `@amiba/app-runtime/platform`. The single allowed
// platform import above is `AgentModelSelection`: the engine-native selection
// shape. Engine DATA comes over the OFFICIAL wire faces (`session.models` /
// `session.selectModel` via `ctx.get("connection").api.sessions` — the same
// calls the official ui-model-selection plugin makes), never through owner
// props: the former host-wired engine pass-through is retired.
// ---------------------------------------------------------------------------

export interface ComposerPickerEffort {
  id: string;
  name: string;
  description?: string;
}

export interface ComposerPickerModel {
  id: string;
  name: string;
  description?: string;
  reasoning?: {
    efforts: ComposerPickerEffort[];
    defaultEffort?: string;
  };
}

export interface ComposerPickerModelGroup {
  id: string;
  name: string;
  models: ComposerPickerModel[];
}

export interface ComposerPickerCatalogSnapshot {
  groups: ComposerPickerModelGroup[];
  /** Product default used before an execution session is materialized. */
  defaultSelection?: AgentModelSelection;
}

/** The picker's catalog source: the plugin's own typed Model Plane Remote. */
export interface ComposerPickerCatalog {
  snapshot(): Promise<ComposerPickerCatalogSnapshot>;
}

/**
 * Session-bound engine face over the official wire. Present only on the
 * official `conversation.input.model` seat; the draft (hero) seat has no
 * session and therefore no engine.
 */
export interface ComposerPickerEngine {
  /** Fresh advisory directory truth for the bound session (throws on wire failure). */
  directory(): Promise<{ current: AgentModelSelection; routable: boolean }>;
  select(
    selection: AgentModelSelection,
  ): Promise<{ selected: AgentModelSelection }>;
}

/** The two official session wire faces this picker consumes. */
export type SessionModelWire = Pick<
  IApiClient["sessions"],
  "models" | "selectModel"
>;

type WireSessionId = Parameters<
  SessionModelWire["models"]
>[0]["sessionId"];

function wireError(face: string, error: { code: string; message: string }): Error {
  return new Error(`${face} failed: ${error.code}: ${error.message}`);
}

/**
 * Bind the official wire to one session — the exact calls the disabled
 * official ui-model-selection plugin makes for the same seat
 * (`session.models` / `session.selectModel`).
 */
export function makeSessionModelEngine(
  wire: SessionModelWire,
  sessionId: WireSessionId,
): ComposerPickerEngine {
  return {
    directory: async () => {
      const { result } = await wire.models({ sessionId });
      if (!result.ok) throw wireError("session.models", result.error);
      const { current, routable } = result.value;
      return { current, routable };
    },
    select: async (selection) => {
      const { result } = await wire.selectModel({
        sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selection.reasoningEffort }),
      });
      if (!result.ok) throw wireError("session.selectModel", result.error);
      return { selected: result.value.selected };
    },
  };
}

export interface DshComposerModelPickerProps {
  /** Injected by the plugin's slot registration (never host-supplied). */
  catalog: ComposerPickerCatalog;
  /** Session-bound engine over the official wire; absent = draft (session-less) mode. */
  engine?: ComposerPickerEngine;
  draftSelection?: AgentModelSelection;
  onDraftSelectionChange?: (selection: AgentModelSelection) => void;
  dialogSize?: "default" | "tall";
  disabled?: boolean;
  overlayVariant?: DialogOverlayVariant;
  refreshKey?: number;
}

function pickerGroups(groups: ComposerPickerModelGroup[]): ModelPickerGroup[] {
  return groups.map((group) => ({
    id: `dsh:${group.id}`,
    label: group.name,
    provider: group.id,
    models: group.models.map((model) => ({
      model: model.id,
      label: model.name,
      description: model.description,
      keywords: model.reasoning?.efforts.flatMap((effort) => [
        effort.id,
        effort.name,
      ]),
    })),
  }));
}

export function DshComposerModelPicker({
  catalog,
  engine,
  dialogSize = "default",
  disabled = false,
  overlayVariant = "dimmed",
  refreshKey = 0,
  draftSelection,
  onDraftSelectionChange,
}: DshComposerModelPickerProps) {
  const { t } = usePluginT(pickerI18n);
  const [groups, setGroups] = useState<ComposerPickerModelGroup[]>([]);
  const [current, setCurrent] = useState<AgentModelSelection | null>(
    draftSelection ?? null,
  );
  const [materialized, setMaterialized] = useState(false);
  const [loadState, setLoadState] = useState<ModelPickerStatus>("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoadState("loading");
    setError(null);
    try {
      const [snapshot, directory] = await Promise.all([
        catalog.snapshot(),
        engine ? engine.directory() : Promise.resolve(null),
      ]);
      if (generation !== generationRef.current) return;
      setGroups(snapshot.groups);
      if (directory) {
        setCurrent(directory.current);
        setMaterialized(true);
        setLoadState(directory.routable ? "ready" : "error");
        if (!directory.routable)
          setError(t("sidepanel.modelPicker.loadFailed"));
      } else {
        const initialSelection = draftSelection ?? snapshot.defaultSelection;
        setCurrent(initialSelection ?? null);
        if (!draftSelection && initialSelection && onDraftSelectionChange) {
          onDraftSelectionChange(initialSelection);
        }
        setMaterialized(false);
        setLoadState("ready");
      }
    } catch (caught) {
      if (generation !== generationRef.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoadState("error");
    }
  }, [
    catalog,
    draftSelection,
    engine,
    onDraftSelectionChange,
    t,
  ]);

  useEffect(() => {
    void load();
    return () => {
      generationRef.current += 1;
    };
  }, [load, refreshKey]);

  const displayGroups = useMemo(() => pickerGroups(groups), [groups]);
  const currentGroup = groups.find((group) => group.id === current?.provider);
  const currentModel = currentGroup?.models.find(
    (model) => model.id === current?.model,
  );
  const efforts = currentModel?.reasoning?.efforts ?? [];
  const effectiveEffortId =
    current?.reasoningEffort ?? currentModel?.reasoning?.defaultEffort;
  const currentEffort = efforts.find(
    (effort) => effort.id === effectiveEffortId,
  );
  const label = currentModel?.name ?? t("sidepanel.modelPicker.label");

  async function commitSelection(
    selection: AgentModelSelection,
  ): Promise<boolean> {
    if (!engine || !materialized) {
      if (!onDraftSelectionChange) {
        setError(t("sidepanel.modelPicker.loadFailed"));
        return false;
      }
      setCurrent(selection);
      onDraftSelectionChange(selection);
      setLoadState("ready");
      setError(null);
      return true;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await engine.select(selection);
      setCurrent(result.selected);
      setLoadState("ready");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function selectModel(provider: string, modelId: string) {
    const model = groups
      .find((group) => group.id === provider)
      ?.models.find((candidate) => candidate.id === modelId);
    const availableEfforts = model?.reasoning?.efforts ?? [];
    const preservedEffort =
      current?.provider === provider && current.model === modelId
        ? availableEfforts.find(
            (effort) => effort.id === current.reasoningEffort,
          )?.id
        : undefined;
    const reasoningEffort =
      preservedEffort ??
      model?.reasoning?.defaultEffort ??
      (availableEfforts.length === 1 ? availableEfforts[0]?.id : undefined);
    const selection: AgentModelSelection = {
      provider,
      model: modelId,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    };
    if (await commitSelection(selection)) {
      setOpen(false);
    }
  }

  async function selectEffort(reasoningEffort: string) {
    if (!current || !currentModel) return;
    if (
      !currentModel.reasoning?.efforts.some(
        (effort) => effort.id === reasoningEffort,
      )
    ) {
      return;
    }
    if (
      await commitSelection({
        provider: current.provider,
        model: current.model,
        reasoningEffort,
      })
    ) {
      setEffortOpen(false);
    }
  }

  function changeOpen(next: boolean) {
    if (next && (disabled || saving)) return;
    setOpen(next);
    if (next) void load();
  }

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-invalid={Boolean(error) || undefined}
        aria-label={label}
        className={cn(
          "inline-flex h-7 min-w-0 max-w-[min(11rem,42vw)] items-center gap-1.5 rounded-full px-2",
          "text-[11px] font-medium text-muted-foreground transition-colors",
          "hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:bg-muted/60 focus-visible:text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "text-destructive hover:text-destructive",
        )}
        disabled={disabled || saving}
        onClick={() => changeOpen(true)}
        title={error ?? label}
        type="button"
      >
        {loadState === "loading" && !current ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <ModelIcon
            className="h-3.5 w-3.5"
            model={current?.model ?? ""}
            provider={current?.provider ?? ""}
          />
        )}
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <ModelPickerDialog
        dialogSize={dialogSize}
        errorMessage={error ?? undefined}
        groups={displayGroups}
        onOpenChange={changeOpen}
        onSelect={(provider, model) => void selectModel(provider, model)}
        open={open}
        overlayVariant={overlayVariant}
        saving={saving}
        selected={
          current
            ? {
                provider: current.provider,
                model: current.model,
              }
            : undefined
        }
        status={loadState}
      />

      {efforts.length > 1 ? (
        <Popover open={effortOpen} onOpenChange={setEffortOpen}>
          <PopoverTrigger asChild>
            <button
              aria-expanded={effortOpen}
              aria-haspopup="menu"
              aria-label={`${t("sidepanel.modelPicker.reasoningEffort")}: ${
                currentEffort?.name ?? effectiveEffortId ?? ""
              }`}
              className={cn(
                "inline-flex h-7 min-w-0 max-w-[7rem] items-center gap-1.5 rounded-full px-2",
                "text-[11px] font-medium text-muted-foreground transition-colors",
                "hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:bg-muted/60 focus-visible:text-foreground",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
              disabled={disabled || saving}
              title={t("sidepanel.modelPicker.reasoningEffort")}
              type="button"
            >
              <BrainCircuit aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {currentEffort?.name ?? effectiveEffortId}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            aria-label={t("sidepanel.modelPicker.reasoningEffort")}
            className="space-y-0.5"
            role="menu"
            side="top"
            size="compact"
          >
            <div className="px-2 pb-1 pt-0.5 text-[10px] text-muted-foreground">
              {t("sidepanel.modelPicker.reasoningEffort")}
            </div>
            {efforts.map((effort) => {
              const selected = effort.id === effectiveEffortId;
              return (
                <button
                  aria-checked={selected}
                  className={cn(
                    "flex min-h-8 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left",
                    "text-xs text-foreground/85 transition-colors hover:bg-accent focus:outline-none focus-visible:bg-accent",
                  )}
                  disabled={saving}
                  key={effort.id}
                  onClick={() => void selectEffort(effort.id)}
                  role="menuitemradio"
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{effort.name}</span>
                    {effort.description ? (
                      <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                        {effort.description}
                      </span>
                    ) : null}
                  </span>
                  {selected ? (
                    <Check
                      aria-hidden
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    />
                  ) : null}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
