import { useState, useSyncExternalStore, useRef } from "react";
import { usePluginT } from "@amiba/ui/plugin";
import { petsI18n } from "./i18n.js";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@amiba/ui/plugin";
import {
  Plus,
  Upload,
  Download,
  Sparkles,
  ArrowLeft,
  PawPrint,
} from "lucide-react";
import { grovePack } from "@mofli/grove";
import type { Activity, PetConfig } from "@mofli/core";
import { makeConfig } from "../model.js";
import { PetView } from "./PetView.js";
import type { PetLibraryClient } from "./library.js";
export function PetPage({
  library,
  startChat,
  chromeHeightPx,
  topBarLeftInset,
}: PropsRuntime<"amiba.workspace.view"> & {
  library: PetLibraryClient;
  startChat(): void;
}) {
  const state = useSyncExternalStore(library.subscribe, library.getSnapshot);
  const { t } = usePluginT(petsI18n);
  const [id, setId] = useState<string>(),
    [name, setName] = useState("Mofli"),
    [config, setConfig] = useState<PetConfig>(() =>
      makeConfig({ name: "Mofli", skinId: grovePack.skins[1].id }),
    );
  const [activity, setActivity] = useState<Activity>("idle"),
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
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      data-testid="pets-page"
    >
      <header
        className="flex shrink-0 items-center justify-between border-b px-6"
        style={{
          minHeight: Math.max(chromeHeightPx ?? 0, 64),
          paddingLeft: Math.max(topBarLeftInset ?? 0, 24),
        }}
      >
        <div className="flex items-center gap-2">
          <PawPrint className="h-4 w-4" />
          <h1 className="text-sm font-semibold">{t("pets.pets")}</h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={startChat}>
            <Sparkles className="mr-2 h-4 w-4" />
            {t("pets.create.with.agent")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => setStudio(await library.studio()))
            }
          >
            {t("pets.open.studio")}
          </Button>
        </div>
      </header>
      {(error || state.error) && (
        <p role="alert" className="px-6 py-3 text-sm text-destructive">
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
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="space-y-2 border-r p-4">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={reset}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("pets.new.pet")}
            </Button>
            {state.loading ? (
              <p className="p-2 text-sm text-muted-foreground">
                {t("pets.loading")}
              </p>
            ) : !state.library.pets.length ? (
              <p className="px-2 py-6 text-sm leading-6 text-muted-foreground">
                {t(
                  "pets.your.companions.will.live.here.start.with.a.skin.or.create.one.together.with.agent",
                )}
              </p>
            ) : (
              state.library.pets.map((p) => (
                <button
                  key={p.id}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-3 text-left text-sm ${id === p.id ? "bg-accent" : "hover:bg-muted"}`}
                  onClick={() => {
                    setId(p.id);
                    setName(p.name);
                    setConfig(p.config);
                    setError("");
                  }}
                >
                  <span className="truncate">{p.name}</span>
                  {p.id === state.library.activeId && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t("pets.active")}
                    </span>
                  )}
                </button>
              ))
            )}
            <p className="px-2 pt-5 text-xs leading-5 text-muted-foreground">
              {t(
                "pets.choose.pets.for.your.preferred.surfaces.in.settings.general",
              )}
            </p>
          </aside>
          <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
            <div className="flex min-h-[240px] items-center justify-center rounded-xl bg-muted/30">
              <PetView
                config={config}
                name={name}
                debug={debug}
                previewActivity={activity}
                className="h-64 w-64"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1">
                {(["idle", "working", "waiting", "success"] as Activity[]).map(
                  (a, i) => (
                    <Button
                      key={a}
                      variant={activity === a ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setActivity(a)}
                    >
                      {t(
                        [
                          "pets.idle",
                          "pets.working",
                          "pets.waiting",
                          "pets.success",
                        ][i],
                      )}
                    </Button>
                  ),
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={debug}
                onClick={() => setDebug(!debug)}
              >
                {t("pets.rig.guides")}
                {debug ? " ✓" : ""}
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pet-name">{t("pets.name")}</Label>
                <Input
                  id="pet-name"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("pets.skin")}</Label>
                <Select
                  value={config.skin.id}
                  onValueChange={(skinId) =>
                    setConfig(makeConfig({ name, skinId }))
                  }
                >
                  <SelectTrigger aria-label={t("pets.skin")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {grovePack.skins.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">
                {t("pets.accessories")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {Array.from(
                  new Set(grovePack.attachments.map((p) => p.attachment.mount)),
                ).map((mount) => (
                  <div key={mount} className="w-full space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {(
                        {
                          "head.crown": t("pets.crown"),
                          "head.forehead": t("pets.forehead"),
                          "head.sides": t("pets.sides"),
                          "head.cheeks": t("pets.cheeks"),
                          "head.lower.front": t("pets.neckwear"),
                          "head.lower.sides": t("pets.pendants"),
                          "character.orbit": t("pets.surroundings"),
                        } as Record<string, string>
                      )[mount] ?? t("pets.accessories")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {grovePack.attachments
                        .filter((p) => p.attachment.mount === mount)
                        .map(({ name: partName, attachment }) => {
                          const selected = config.attachments.some(
                            (p) => p.type === attachment.id,
                          );
                          return (
                            <Button
                              size="sm"
                              variant={selected ? "secondary" : "outline"}
                              key={attachment.id}
                              aria-pressed={selected}
                              onClick={() => {
                                try {
                                  setConfig(
                                    makeConfig({
                                      name,
                                      config: {
                                        ...config,
                                        attachments: selected
                                          ? config.attachments.filter(
                                              (p) => p.type !== attachment.id,
                                            )
                                          : [
                                              ...config.attachments,
                                              {
                                                id: attachment.id,
                                                type: attachment.id,
                                                version: 1,
                                              },
                                            ],
                                      },
                                    }),
                                  );
                                  setError("");
                                } catch (e) {
                                  setError(String(e));
                                }
                              }}
                            >
                              {partName}
                            </Button>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const saved = await library.save({ id, name, config });
                    const next = saved.pets;
                    if (!id) setId(next[next.length - 1]?.id);
                  })
                }
              >
                {t("pets.save.pet")}
              </Button>
              {id && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      library.activate(
                        state.library.activeId === id ? null : id,
                      ),
                    )
                  }
                >
                  {state.library.activeId === id
                    ? t("pets.pause.companionship")
                    : t("pets.use.as.companion")}
                </Button>
              )}
              <Button variant="ghost" onClick={() => file.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                {t("pets.import")}
              </Button>
              <Button variant="ghost" onClick={download}>
                <Download className="mr-2 h-4 w-4" />
                {t("pets.export")}
              </Button>
              {id && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await library.remove(id);
                      reset();
                    })
                  }
                >
                  {t("pets.delete")}
                </Button>
              )}
            </div>
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
          </main>
        </div>
      )}
    </section>
  );
}
