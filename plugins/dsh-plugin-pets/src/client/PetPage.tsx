import { useDesktopPet } from "./desktop.js";
import {
  useState,
  useSyncExternalStore,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { usePluginT } from "@amiba/ui/plugin";
import { petsI18n } from "./i18n.js";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { Button, Input, Label, Switch, SettingsPageActions, PaneHeaderBar, PageContent, ScrollArea } from "@amiba/ui/plugin";
import {
  Plus,
  Upload,
  Download,
  Sparkles,
  ArrowLeft,
  PawPrint,
  Check,
  Monitor,
  ScanLine,
  ArrowUpRight,
  Trash2,
} from "lucide-react";
import { grovePack } from "../model.js";
import type { CompanionScene } from "./companion-behavior.js";
import type { PetConfig } from "@mofli/core";
import { makeConfig } from "../model.js";
import { PetThumbnail } from "./PetThumbnail.js";
import { PetView } from "./PetView.js";
import type { PetLibraryClient } from "./library.js";
export function PetPage({
  library,
  startChat,
  chromeHeightPx,
  topBarLeftInset,
  sidebarCollapsed,
  inSettings = false,
}: Partial<Pick<PropsRuntime<"amiba.workspace.view">, "chromeHeightPx" | "topBarLeftInset" | "sidebarCollapsed">> & {
  inSettings?: boolean;
  library: PetLibraryClient;
  startChat(): void;
}) {
  const { api: desktopApi, enabled: desktopEnabled } = useDesktopPet();
  const state = useSyncExternalStore(library.subscribe, library.getSnapshot);
  const { t } = usePluginT(petsI18n);
  const [id, setId] = useState<string>(),
    [name, setName] = useState("Mofli"),
    [config, setConfig] = useState<PetConfig>(() =>
      makeConfig({ name: "Mofli", skinId: grovePack.skins[1].id }),
    );
  const [activity, setActivity] = useState<CompanionScene>("idle"),
    [debug, setDebug] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [studio, setStudio] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setId(undefined);
    setName("Mofli");
    setConfig(makeConfig({ name: "Mofli", skinId: grovePack.skins[1].id }));
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "pet.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const [wardrobe, setWardrobe] = useState<"skin" | "accessories">("skin");
  const [mount, setMount] = useState("head.crown");
  const initialized = useRef(false);
  useEffect(() => {
    if (state.loading || initialized.current) return;
    initialized.current = true;
    const current =
      state.library.pets.find((p) => p.id === state.library.activeId) ??
      state.library.pets[0];
    if (current) {
      setId(current.id);
      setName(current.name);
      setConfig(current.config);
    }
  }, [state.loading, state.library]);
  const skins = useMemo(
    () =>
      grovePack.skins.map((skin) => ({
        ...skin,
        config: makeConfig({ name: skin.name, skinId: skin.id }),
      })),
    [],
  );
  const mounts = [
    "head.crown",
    "head.forehead",
    "head.sides",
    "head.cheeks",
    "head.lower.front",
    "head.lower.sides",
    "character.orbit",
  ];
  const mountLabels: Record<string, string> = {
    "head.crown": t("pets.crown"),
    "head.forehead": t("pets.forehead"),
    "head.sides": t("pets.sides"),
    "head.cheeks": t("pets.cheeks"),
    "head.lower.front": t("pets.neckwear"),
    "head.lower.sides": t("pets.pendants"),
    "character.orbit": t("pets.surroundings"),
  };
  const parts = useMemo(
    () =>
      grovePack.attachments
        .filter((p) => p.attachment.mount === mount)
        .map((part) => {
          try {
            return {
              ...part,
              config: makeConfig({
                name,
                config: {
                  ...config,
                  attachments: [
                    {
                      id: part.attachment.id,
                      type: part.attachment.id,
                      version: 1,
                    },
                  ],
                },
              }),
            };
          } catch {
            return { ...part, config: undefined };
          }
        }),
    [config, mount, name],
  );
  const saved = state.library.pets.find((p) => p.id === id);
  const dirty =
    !saved ||
    saved.name !== name ||
    JSON.stringify(saved.config) !== JSON.stringify(config);
  const choosePart = (type: string) => {
    try {
      const selected = config.attachments.some((p) => p.type === type);
      setConfig(
        makeConfig({
          name,
          config: {
            ...config,
            attachments: selected
              ? config.attachments.filter((p) => p.type !== type)
              : [...config.attachments, { id: type, type, version: 1 }],
          },
        }),
      );
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const actions = <>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={startChat}>
            <Sparkles className="h-3.5 w-3.5" />{t("pets.create.with.agent")}
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" disabled={busy} onClick={() => void run(async () => setStudio(await library.studio()))}>
            {t("pets.open.studio")}<ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        </>;
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      data-testid="pets-page"
    >
      {inSettings ? <SettingsPageActions>{actions}</SettingsPageActions> : <PaneHeaderBar
        className="app-drag"
        heightPx={chromeHeightPx ?? 40}
        leftInset={sidebarCollapsed ? topBarLeftInset : 0}
        bordered
        leading={<><PawPrint className="h-4 w-4 shrink-0 text-muted-foreground" /><h1 className="truncate text-[13px] font-medium tracking-tight text-foreground/75">{t("pets.pets")}</h1></>}
        trailing={actions}
      />}
      {(error || state.error) && (
        <p role="alert" className="border-b px-6 py-3 text-sm text-destructive">
          {error || state.error}
        </p>
      )}
      {studio ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-4 border-b px-4 py-2">
            <Button variant="ghost" size="sm" onClick={() => setStudio("")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("pets.back.to.pets")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t(
                "pets.export.pet.json.from.studio.then.import.it.into.your.library",
              )}
            </span>
          </div>
          <iframe
            title="Mofli Studio"
            src={studio}
            className="min-h-0 w-full flex-1 border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
          />
        </div>
      ) : (
        <>
          <ScrollArea className="min-h-0 flex-1">
            <PageContent size="lg" padding="compact">
              <aside
                aria-label={t("pets.library")}
                className="mb-6 flex items-center gap-2 overflow-x-auto pb-2"
              >
                {state.loading && (
                  <span className="text-sm text-muted-foreground">
                    {t("pets.loading")}
                  </span>
                )}
                {state.library.pets.map((p) => (
                  <button
                    key={p.id}
                    data-pet-record={p.id}
                    aria-pressed={id === p.id}
                    className={`flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${id === p.id ? "border-primary/25 bg-primary/5" : "border-transparent hover:bg-muted/60"}`}
                    onClick={() => {
                      setId(p.id);
                      setName(p.name);
                      setConfig(p.config);
                      setError("");
                    }}
                  >
                    <PetThumbnail config={p.config} className="h-10 w-10" />
                    <span className="min-w-0">
                      <span className="block max-w-32 truncate text-sm font-medium">
                        {p.name}
                      </span>
                      {p.id === state.library.activeId && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="h-1 w-1 rounded-full bg-primary" />
                          {t("pets.active")}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
                <Button
                  variant="ghost"
                  className="shrink-0 rounded-xl text-muted-foreground"
                  onClick={reset}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t("pets.new.pet")}
                </Button>
              </aside>
              <div className="flex flex-wrap items-start gap-6 lg:gap-8">
                <div className="min-w-0 flex-[1_1_340px]">
                  <div
                    className="relative overflow-hidden rounded-2xl bg-muted/35 dark:bg-zinc-800"
                    data-pet-preview
                  >
                    <div className="absolute left-5 right-5 top-5 z-10 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                        {t("pets.preview")}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        aria-label={t("pets.rig.guides")}
                        title={t("pets.rig.guides")}
                        aria-pressed={debug}
                        onClick={() => setDebug(!debug)}
                      >
                        <ScanLine className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex h-[280px] items-center justify-center px-6 pt-6 lg:h-[320px]">
                      <PetView
                        config={config}
                        name={name}
                        debug={debug}
                        previewScene={activity}
                        className="h-72 w-full max-w-sm"
                      />
                    </div>
                    <div className="px-5 pb-5 text-center">
                      <p className="mb-4 text-xs text-muted-foreground">
                        {t("pets.preview.hint")}
                      </p>
                      <div
                        className="inline-flex max-w-full flex-wrap justify-center rounded-lg bg-background/80 p-1"
                        role="group"
                        aria-label={t("pets.preview.state")}
                      >
                        {(["idle", "loading", "typing", "thinking", "responding", "tooling", "waiting", "completed", "failed", "interrupted"] as CompanionScene[]).map((a) => (
                          <button
                            key={a}
                            aria-pressed={activity === a}
                            className={`rounded-md px-4 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activity === a ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                            onClick={() => setActivity(a)}
                          >
                            {t(`pets.scene.${a}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {desktopApi && (
                    <div className="mt-4 flex items-center gap-3 px-1 py-2">
                      <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1">
                        <Label htmlFor="pet-desktop">{t("pets.desktop")}</Label>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("pets.desktop.hint")}
                        </p>
                      </div>
                      <Switch
                        id="pet-desktop"
                        checked={desktopEnabled}
                        disabled={
                          busy || (!desktopEnabled && !state.library.activeId)
                        }
                        onCheckedChange={(value) =>
                          void run(() => desktopApi.setEnabled(value))
                        }
                      />
                    </div>
                  )}
                  <p className="mt-3 px-1 text-xs leading-5 text-muted-foreground">
                    {t(
                      "pets.choose.pets.for.your.preferred.surfaces.in.settings.general",
                    )}
                  </p>
                </div>
                <div className="min-w-0 flex-[1_1_300px] space-y-6 xl:max-w-[380px]">
                  <div className="space-y-2">
                    <Label
                      htmlFor="pet-name"
                      className="text-xs text-muted-foreground"
                    >
                      {t("pets.name")}
                    </Label>
                    <Input
                      id="pet-name"
                      value={name}
                      maxLength={80}
                      className="h-11 rounded-lg text-base font-medium"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div>
                    <div
                      className="mb-4 flex gap-5 border-b border-border/60"
                      role="group"
                      aria-label={t("pets.appearance")}
                    >
                      {(["skin", "accessories"] as const).map((tab) => (
                        <button
                          key={tab}
                          aria-pressed={wardrobe === tab}
                          onClick={() => setWardrobe(tab)}
                          className={`border-b-2 pb-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${wardrobe === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                        >
                          {t(tab === "skin" ? "pets.skin" : "pets.accessories")}
                          {tab === "accessories" &&
                            config.attachments.length > 0 && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {config.attachments.length}
                              </span>
                            )}
                        </button>
                      ))}
                    </div>
                    {wardrobe === "skin" ? (
                      <div
                        className="grid grid-cols-3 gap-2.5"
                        aria-label={t("pets.skin")}
                      >
                        {skins.map((skin) => (
                          <button
                            key={skin.id}
                            data-pet-skin={skin.id}
                            aria-pressed={config.skin.id === skin.id}
                            onClick={() => setConfig(skin.config)}
                            className={`relative rounded-xl border p-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${config.skin.id === skin.id ? "border-primary/40 bg-primary/5" : "border-border/50 hover:bg-muted/40"}`}
                          >
                            <PetThumbnail config={skin.config} />
                            <span className="mt-1 block truncate pb-1 text-xs">
                              {skin.name}
                            </span>
                            {config.skin.id === skin.id && (
                              <Check className="absolute right-2 top-2 h-3 w-3 text-primary" />
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <>
                        <div
                          className="mb-4 flex flex-wrap gap-1.5"
                          role="group"
                          aria-label={t("pets.accessories")}
                        >
                          {mounts
                            .filter((m) =>
                              grovePack.attachments.some(
                                (p) => p.attachment.mount === m,
                              ),
                            )
                            .map((m) => (
                              <button
                                key={m}
                                aria-pressed={mount === m}
                                onClick={() => setMount(m)}
                                className={`rounded-md px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mount === m ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                              >
                                {mountLabels[m]}
                              </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-3 gap-2.5">
                          {parts.map((part) => {
                            const selected = config.attachments.some(
                              (p) => p.type === part.attachment.id,
                            );
                            return (
                              <button
                                key={part.attachment.id}
                                disabled={!part.config}
                                aria-pressed={selected}
                                onClick={() => choosePart(part.attachment.id)}
                                className={`relative rounded-xl border p-2 text-center transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary/40 bg-primary/5" : "border-border/50 hover:bg-muted/40"}`}
                              >
                                {part.config && (
                                  <PetThumbnail config={part.config} />
                                )}
                                <span className="mt-1 block pb-1 text-[11px] leading-4">
                                  {part.name}
                                </span>
                                {selected && (
                                  <Check className="absolute right-2 top-2 h-3 w-3 text-primary" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-4 text-xs leading-5 text-muted-foreground">
                          {t("pets.accessories.hint")}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </PageContent>
          </ScrollArea>
          <footer className="shrink-0 border-t border-border/60 bg-background">
            <PageContent size="lg" padding="compact" className="py-3" bodyClassName="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => file.current?.click()}
                >
                  <Upload className="mr-2 h-3.5 w-3.5" />
                  {t("pets.import")}
                </Button>
                <Button variant="ghost" size="sm" onClick={download}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  {t("pets.export")}
                </Button>
                {id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title={t("pets.delete")}
                    aria-label={t("pets.delete")}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await library.remove(id);
                        reset();
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="mr-2 hidden text-xs text-muted-foreground sm:inline">
                  {t(dirty ? "pets.unsaved" : "pets.saved")}
                </span>
                {id && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        library.activate(
                          state.library.activeId === id ? null : id,
                        ),
                      )
                    }
                  >
                    {t(
                      state.library.activeId === id
                        ? "pets.pause.companionship"
                        : "pets.use.as.companion",
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    void run(async () => {
                      const saved = await library.save({ id, name, config });
                      if (!id) setId(saved.pets[saved.pets.length - 1]?.id);
                    })
                  }
                >
                  {t("pets.save.pet")}
                </Button>
              </div>
            </PageContent>
          </footer>
        </>
      )}
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f)
            void run(async () => {
              if (f.size > 200_000)
                throw new Error(t("pets.file.is.too.large"));
              const config = makeConfig({
                name,
                config: JSON.parse(await f.text()),
              });
              setConfig(config);
              setId(undefined);
              setName(config.skin.name);
            });
        }}
      />
    </section>
  );
}
