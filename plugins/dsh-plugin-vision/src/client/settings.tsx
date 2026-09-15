import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  usePluginT,
  ModelPickerDialog,
  ModelIcon,
  ModelIdentityName,
  type ModelPickerGroup,
} from "@amiba/ui/plugin";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "../remote.js";

type Api = ClientContext["remote"]["amibaVisionUi"];

interface VisionModel {
  provider: string;
  providerName: string;
  model: string;
  name: string;
  description?: string;
}

interface Catalog {
  models: VisionModel[];
  selection: { provider: string; model: string } | null;
  revision: number;
}

const copy = {
  "zh-CN": {
    "vision.settings": "视觉识别",
    "vision.label": "视觉识别",
    "vision.auto": "由 Agent 按需选择",
    "vision.picker": "选择识图模型",
    "vision.search": "搜索服务商或模型…",
    "vision.refresh": "刷新能力",
    "vision.empty": "还没有声明支持图片输入的模型，请先配置一个能识图的服务商。",
    "vision.error": "读取或保存失败，请刷新后重试。",
    "vision.loading": "正在读取视觉能力…",
    "vision.hint": "主模型看不到图片时，Agent 会用 vision_recognize 把图片交给这里选定的模型。",
  },
  en: {
    "vision.settings": "Vision",
    "vision.label": "Vision",
    "vision.auto": "Let the Agent choose",
    "vision.picker": "Choose a vision model",
    "vision.search": "Search providers or models…",
    "vision.refresh": "Refresh capabilities",
    "vision.empty": "No configured model declares image input yet.",
    "vision.error": "Could not read or save. Refresh and try again.",
    "vision.loading": "Loading vision capabilities…",
    "vision.hint": "When your own model cannot accept an image, the Agent hands it to the model assigned here through vision_recognize.",
  },
};

export function VisionSettings({
  api,
  onModelsChange,
}: { api: Api } & Partial<PropsRuntime<"amiba.models.extension">>) {
  const { t } = usePluginT(copy);
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function refresh() {
    setBusy(true);
    setError(false);
    try {
      const result = await api.catalog();
      if (!result.ok) throw new Error();
      setCatalog(JSON.parse(result.value));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function select(value: string) {
    if (!catalog) return;
    setBusy(true);
    setError(false);
    try {
      const result = await api.setDefault(
        value === "auto" ? "null" : value,
        catalog.revision,
      );
      if (!result.ok) throw new Error();
      await refresh();
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [api]);

  // Report the derived candidate set so the model plane can show these routes
  // wherever it lists what this installation can do.
  useEffect(() => {
    if (!catalog) return;
    const grouped = new Map<string, { id: string; name: string; available: boolean; models: Array<{ id: string; name: string; description?: string; supported: boolean }> }>();
    for (const row of catalog.models) {
      const group = grouped.get(row.provider) ?? {
        id: row.provider,
        name: row.providerName,
        available: true,
        models: [],
      };
      group.models.push({
        id: row.model,
        name: row.name,
        ...(row.description === undefined ? {} : { description: row.description }),
        supported: true,
      });
      grouped.set(row.provider, group);
    }
    onModelsChange?.("vision", [...grouped.values()]);
  }, [catalog, onModelsChange]);
  useEffect(() => () => onModelsChange?.("vision", []), [onModelsChange]);

  const saved = catalog?.selection ?? null;
  const selected = saved
    ? catalog?.models.find(
        (row) => row.provider === saved.provider && row.model === saved.model,
      )
    : undefined;
  const groups: ModelPickerGroup[] = [
    ...new Set((catalog?.models ?? []).map((row) => row.provider)),
  ].map((provider) => ({
    id: provider,
    provider,
    label:
      catalog?.models.find((row) => row.provider === provider)?.providerName ??
      provider,
    models: (catalog?.models ?? [])
      .filter((row) => row.provider === provider)
      .map((row) => ({
        model: row.model,
        label: row.name,
        ...(row.description === undefined ? {} : { description: row.description }),
      })),
  }));

  return (
    <div aria-label={t("vision.settings")}>
      <div
        data-model-assignment="vision"
        className="grid items-center gap-3 border-t border-border/60 bg-background px-4 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]"
      >
        <span id="vision-assignment-label" className="text-xs font-medium text-foreground">
          {t("vision.label")}
        </span>
        <button
          type="button"
          aria-labelledby="vision-assignment-label vision-assignment-value"
          disabled={busy || !catalog}
          onClick={() => setOpen(true)}
          className="flex h-9 min-w-0 items-center gap-2.5 rounded-md border border-input bg-background px-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saved && (
            <ModelIcon
              className="h-4 w-4 shrink-0 text-muted-foreground"
              model={saved.model}
              provider={saved.provider}
            />
          )}
          <span id="vision-assignment-value" className="min-w-0 flex-1 text-xs">
            {selected ? (
              <ModelIdentityName
                className="flex"
                displayName={selected.name}
                model={selected.model}
                variant="standard"
              />
            ) : (
              <span className="block truncate">{t("vision.auto")}</span>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        </button>
      </div>
      <p className="px-4 pb-3 text-[11px] text-muted-foreground">{t("vision.hint")}</p>
      <ModelPickerDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) {
            setOpen(false);
            setError(false);
          }
        }}
        title={t("vision.picker")}
        searchPlaceholder={t("vision.search")}
        groups={groups}
        selected={saved ?? undefined}
        saving={busy}
        status="ready"
        errorMessage={error ? t("vision.error") : undefined}
        resetOption={{
          label: t("vision.auto"),
          selected: saved === null,
          onSelect: () => {
            if (!busy) void select("auto");
          },
        }}
        onSelect={(provider, model) => {
          if (!busy) void select(JSON.stringify({ provider, model }));
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {error ? (
            <p role="alert" className="text-destructive">
              {t("vision.error")}
            </p>
          ) : !catalog ? (
            <p role="status">{t("vision.loading")}</p>
          ) : catalog.models.length === 0 ? (
            <p>{t("vision.empty")}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {t("vision.refresh")}
        </button>
      </div>
    </div>
  );
}
