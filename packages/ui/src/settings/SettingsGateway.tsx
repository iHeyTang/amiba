import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../primitives";
import { Input } from "../primitives";
import { Label } from "../primitives";
import { Separator } from "../primitives";
import { ModelIcon } from "../models";
import {
  BACKPLANE_KEY_STORAGE_KEY,
  BRIDGE_URL,
  BRIDGE_URL_STORAGE_KEY,
  DEFAULT_HERMES_MODEL,
  fetchHermesModelIds,
} from "@amiba/core";
import { useT } from "@amiba/i18n";
import { getPlatform } from "@amiba/platform";

import type { BridgeCapability } from "./capabilities";

const KEYS = {
  model: "settings.chat.model",
  backplaneKey: BACKPLANE_KEY_STORAGE_KEY,
  bridgeUrl: BRIDGE_URL_STORAGE_KEY,
};

/** Side-panel chat → backplane → Hermes gateway (proxied). */
export function SettingsGateway({ bridge }: { bridge?: BridgeCapability } = {}) {
  const { t } = useT();
  const [model, setModel] = useState(DEFAULT_HERMES_MODEL);
  const [backplaneKey, setBackplaneKey] = useState("");
  const [bridgeUrl, setBridgeUrl] = useState(BRIDGE_URL);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await getPlatform().storage.get([
        KEYS.model,
        KEYS.backplaneKey,
        KEYS.bridgeUrl,
      ]);
      if (typeof r[KEYS.model] === "string") setModel(r[KEYS.model] as string);
      if (typeof r[KEYS.backplaneKey] === "string") {
        setBackplaneKey(r[KEYS.backplaneKey] as string);
      }
      if (
        typeof r[KEYS.bridgeUrl] === "string" &&
        (r[KEYS.bridgeUrl] as string).trim()
      ) {
        setBridgeUrl(r[KEYS.bridgeUrl] as string);
      }
    })();
  }, []);

  async function save() {
    await getPlatform().storage.set({
      [KEYS.model]: model.trim() || DEFAULT_HERMES_MODEL,
      [KEYS.backplaneKey]: backplaneKey.trim(),
      [KEYS.bridgeUrl]: bridgeUrl.trim() || BRIDGE_URL,
    });
    try {
      await bridge?.refresh();
    } catch {
      /* ignore */
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function refreshModels() {
    setModelsLoading(true);
    setModelsError(null);
    const ac = new AbortController();
    const timeoutId = window.setTimeout(() => ac.abort(), 20_000);
    try {
      const r = await fetchHermesModelIds(ac.signal);
      if (r.ok === false) {
        setModelIds([]);
        setModelsError(r.message);
      } else {
        setModelIds(r.ids);
        if (r.ids.length === 0) {
          setModelsError(t("options.gateway.model.noModels"));
        } else {
          setModelsError(null);
        }
      }
    } catch (e) {
      setModelIds([]);
      setModelsError(String((e as Error)?.message || e));
    } finally {
      window.clearTimeout(timeoutId);
      setModelsLoading(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">
          {t("options.gateway.section.chat")}
        </h3>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="model">{t("options.gateway.model.label")}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={modelsLoading}
              onClick={() => void refreshModels()}
              title={t("options.gateway.model.fromGateway.tooltip")}
            >
              {modelsLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {t("options.gateway.model.fromGateway")}
            </Button>
          </div>
          <div className="relative">
            <ModelIcon
              className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              model={model}
              provider=""
            />
            <Input
              id="model"
              list="settings-model-datalist"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={DEFAULT_HERMES_MODEL}
              className="pl-9 font-mono text-xs"
              autoComplete="off"
            />
          </div>
          <datalist id="settings-model-datalist">
            {modelIds.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          {modelsError && (
            <p className="text-[11px] text-destructive">{modelsError}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void save()}>{t("options.gateway.save")}</Button>
          {saved && (
            <span className="text-xs text-[hsl(var(--success))]">
              {t("options.gateway.saved")}
            </span>
          )}
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">
          {t("options.gateway.backplaneKey.title")}
        </h3>
        <div className="space-y-1.5">
          <Label htmlFor="backplaneKey">
            {t("options.gateway.backplaneKey.label")}
          </Label>
          <Input
            id="backplaneKey"
            type="password"
            value={backplaneKey}
            onChange={(e) => setBackplaneKey(e.target.value)}
            placeholder={t("options.gateway.backplaneKey.placeholder")}
          />
          <p className="text-[11px] text-muted-foreground">
            {t("options.gateway.backplaneKey.help")}
          </p>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">
          {t("options.gateway.bridge.title")}
        </h3>
        <div className="space-y-1.5">
          <Label htmlFor="bridgeUrl">{t("options.gateway.bridge.url.label")}</Label>
          <Input
            id="bridgeUrl"
            value={bridgeUrl}
            onChange={(e) => setBridgeUrl(e.target.value)}
            placeholder={BRIDGE_URL}
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            {t("options.gateway.bridge.url.help")}
          </p>
        </div>
      </section>
    </div>
  );
}
