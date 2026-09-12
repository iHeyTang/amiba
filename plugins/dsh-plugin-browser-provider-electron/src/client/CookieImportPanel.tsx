import { useEffect, useRef, useState } from "react";
import {
  AppWindow,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Chrome,
  Compass,
  Globe2,
  Loader2,
  LockKeyhole,
  Shield,
  X,
} from "lucide-react";
import type {
  CookieImportAdapter,
  CookieImportResult,
  CookieSite,
  CookieSource,
} from "../shared/cookie-import.js";
import { cookieErrorKey, useCookieImportT } from "./cookie-import-locales.js";

const secondary =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40";
const primary =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40";
function BrowserIcon({
  browser,
  className = "h-5 w-5",
}: {
  browser?: string;
  className?: string;
}) {
  const Icon =
    browser === "Chrome"
      ? Chrome
      : browser === "Brave"
        ? Shield
        : browser === "Edge"
          ? Compass
          : Globe2;
  return <Icon className={className} strokeWidth={1.6} aria-hidden="true" />;
}
export function CookieImportPanel({
  importer,
  onClose,
  onVisit,
}: {
  importer: CookieImportAdapter;
  onClose(): void;
  onVisit(domain: string): void;
}) {
  const { t } = useCookieImportT();
  const [sources, setSources] = useState<CookieSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [supported, setSupported] = useState(true);
  const [sites, setSites] = useState<CookieSite[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [scope, setScope] = useState<"all" | "custom">("all");
  const [loading, setLoading] = useState(true);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CookieImportResult | null>(null);
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSourceId("");
    setSources([]);
    setSites([]);
    setSelected(new Set());
    importer
      .sources()
      .then((value) => {
        if (cancelled) return;
        setSources(value.sources);
        setSupported(value.supported);
        setSourceId(value.sources[0]?.id ?? "");
      })
      .catch((cause) => {
        if (!cancelled) setError(cookieErrorKey(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [importer, revision]);
  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    setSitesLoading(true);
    setError("");
    setSites([]);
    setSelected(new Set());
    setResult(null);
    setQuery("");
    importer
      .sites(sourceId)
      .then((value) => {
        if (!cancelled) setSites(value);
      })
      .catch((cause) => {
        if (!cancelled) setError(cookieErrorKey(cause));
      })
      .finally(() => {
        if (!cancelled) setSitesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [importer, sourceId]);
  const source = sources.find((item) => item.id === sourceId);
  const browsers = [...new Set(sources.map((item) => item.browser))];
  const matching = sites.filter((site) =>
    site.domain.toLowerCase().includes(query.toLowerCase()),
  );
  const resultSites =
    scope === "all" ? sites : sites.filter((site) => selected.has(site.domain));
  const run = async () => {
    if (
      !sourceId ||
      inFlight.current ||
      (scope === "custom" && (!selected.size || selected.size > 100))
    )
      return;
    inFlight.current = true;
    setRunning(true);
    setError("");
    try {
      const value = await importer.run(
        sourceId,
        scope === "all" ? null : [...selected],
        overwrite,
      );
      if (alive.current) setResult(value);
    } catch (cause) {
      if (alive.current) setError(cookieErrorKey(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) setRunning(false);
    }
  };
  const canImport =
    !loading &&
    !!sourceId &&
    (scope === "all" || (!sitesLoading && selected.size > 0));
  const resultTitle = result?.imported
    ? "done"
    : result?.preserved
      ? "unchanged"
      : "nothing";
  const importAction = (
    <div className="mt-6">
      <button
        className={primary}
        disabled={!canImport}
        onClick={() => void run()}
      >
        {t(scope === "all" ? "run" : "runSelected")}
        <ArrowRight className="h-4 w-4" />
      </button>
      <p className="mt-2 text-center text-[11px] leading-5 text-muted-foreground">
        {overwrite
          ? t("replaceHint")
          : scope === "all"
            ? t("allHint")
            : t("customHint", { count: selected.size })}
      </p>
    </div>
  );
  return (
    <section
      data-cookie-import
      aria-label={t("title")}
      className="absolute inset-0 z-20 flex min-h-0 flex-col overflow-y-auto bg-background text-foreground"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 px-5 pt-4">
        <span className="text-[10px] font-medium tracking-widest text-muted-foreground">
          {t("eyebrow")}
        </span>
        <button
          type="button"
          className={secondary + " -mr-2"}
          onClick={onClose}
          disabled={running}
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pb-6 pt-6 sm:px-8">
        <div
          className="mb-7 flex items-center justify-center gap-4"
          aria-hidden="true"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-muted/20">
            <BrowserIcon browser={source?.browser} className="h-7 w-7" />
          </div>
          <div className="flex items-center gap-2 text-muted-foreground/50">
            <span className="w-5 border-t border-dashed border-current" />
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            <span className="w-5 border-t border-dashed border-current" />
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {result && (result.imported > 0 || result.preserved > 0) ? (
              <Check className="h-7 w-7" />
            ) : (
              <AppWindow className="h-7 w-7" strokeWidth={1.6} />
            )}
          </div>
        </div>
        <div className="mb-7 text-center">
          <h2
            className="text-xl font-semibold tracking-tight"
            role={result || running ? "status" : undefined}
          >
            {t(running ? "running" : result ? resultTitle : "title")}
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-xs leading-6 text-muted-foreground">
            {t(
              running
                ? "runningHint"
                : result
                  ? resultTitle + "Hint"
                  : "description",
              { browser: source?.browser ?? "" },
            )}
          </p>
        </div>
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl bg-destructive/5 px-4 py-3 text-xs leading-5 text-destructive"
          >
            {t(error)}
            {!sourceId && (
              <button
                className={secondary}
                onClick={() => setRevision((value) => value + 1)}
              >
                {t("retry")}
              </button>
            )}
          </div>
        )}
        {running ? (
          <div className="flex flex-1 items-start justify-center py-5">
            <Loader2
              className="h-6 w-6 animate-spin text-primary"
              aria-hidden="true"
            />
          </div>
        ) : result ? (
          <>
            {result.failed > 0 && (
              <p className="mb-4 text-xs leading-5 text-muted-foreground">
                {t("partial")}
              </p>
            )}
            <button className={primary} onClick={onClose}>
              {t("start")}
              <ArrowRight className="h-4 w-4" />
            </button>
            <details className="mt-5 border-t border-border/50 pt-4">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {t("details")}
              </summary>
              <p className="mb-2 mt-4 text-[10px] text-muted-foreground">
                {t("detailUnit")}
              </p>
              <dl className="space-y-2 text-xs">
                {(
                  [
                    ["imported", "imported"],
                    ["preserved", "preserved"],
                    ["expired", "expired"],
                    ["unsupported", "skipped"],
                    ["failed", "failed"],
                  ] as const
                ).map(([field, label]) => (
                  <div
                    key={field}
                    className="flex items-center justify-between"
                  >
                    <dt className="text-muted-foreground">{t(label)}</dt>
                    <dd className="tabular-nums">{result[field]}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 max-h-48 overflow-auto">
                {resultSites.map((site) => (
                  <div
                    key={site.domain}
                    className="flex items-center justify-between gap-2 py-1 text-xs"
                  >
                    <span className="truncate">{site.domain}</span>
                    <button
                      className={secondary + " shrink-0"}
                      onClick={() => onVisit(site.domain)}
                    >
                      {t("verify")}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </details>
            <button
              className={secondary + " mt-3"}
              onClick={() => {
                setResult(null);
                setAdvanced(false);
              }}
            >
              {t("again")}
            </button>
          </>
        ) : loading ? (
          <div
            className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : !supported || !sources.length ? (
          <div className="rounded-xl bg-muted/30 p-5 text-center">
            <p className="text-sm font-medium">{t("emptyTitle")}</p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              {t(supported ? "empty" : "unsupported")}
            </p>
            {supported && (
              <button
                className={secondary + " mt-3"}
                onClick={() => setRevision((value) => value + 1)}
              >
                {t("retry")}
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="mb-2.5 text-xs font-medium">{t("choose")}</p>
            <div className="space-y-2" role="group" aria-label={t("choose")}>
              {browsers.map((browser) => {
                const active = source?.browser === browser;
                return (
                  <button
                    type="button"
                    aria-pressed={active}
                    key={browser}
                    onClick={() => {
                      if (!active)
                        setSourceId(
                          sources.find((item) => item.browser === browser)!.id,
                        );
                    }}
                    className={
                      "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring " +
                      (active
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/60 hover:bg-muted/30")
                    }
                  >
                    <BrowserIcon browser={browser} />
                    <span className="min-w-0 flex-1 text-sm font-medium">
                      {browser}
                    </span>
                    <span
                      className={
                        "flex h-4 w-4 items-center justify-center rounded-full border " +
                        (active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border")
                      }
                    >
                      {active && (
                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 truncate text-[11px] text-muted-foreground">
              {t("profileHint", { profile: source?.profile ?? "" })}
            </p>
            {!advanced && importAction}
            <div className="mt-5 border-t border-border/50">
              <button
                type="button"
                aria-expanded={advanced}
                aria-controls="cookie-advanced"
                className={secondary + " mt-2 w-full justify-between px-0"}
                onClick={() => setAdvanced((value) => !value)}
              >
                <span>{t("advanced")}</span>
                {advanced ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              {advanced && (
                <div id="cookie-advanced" className="space-y-4 pb-3 pt-2">
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    {t("advancedHint")}
                  </p>
                  <div>
                    <label
                      htmlFor="cookie-source"
                      className="text-xs font-medium"
                    >
                      {t("source")}
                    </label>
                    <select
                      id="cookie-source"
                      value={sourceId}
                      onChange={(event) => setSourceId(event.target.value)}
                      className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs"
                    >
                      {sources.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.browser} · {item.profile}
                        </option>
                      ))}
                    </select>
                  </div>
                  <fieldset>
                    <legend className="mb-2 text-xs font-medium">
                      {t("scope")}
                    </legend>
                    <div className="flex flex-wrap gap-4">
                      {(["all", "custom"] as const).map((value) => (
                        <label
                          key={value}
                          className="flex items-center gap-2 text-xs"
                        >
                          <input
                            type="radio"
                            name="cookie-scope"
                            value={value}
                            checked={scope === value}
                            onChange={() => setScope(value)}
                            className="accent-primary"
                          />
                          {t(value)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {scope === "custom" && (
                    <div>
                      <input
                        aria-label={t("search")}
                        placeholder={t("search")}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs"
                      />
                      <div className="my-2 flex flex-wrap items-center justify-between gap-1 text-xs">
                        <span className="text-muted-foreground">
                          {t("selected", { count: selected.size })}
                        </span>
                        <div>
                          <button
                            className={secondary}
                            disabled={
                              !matching.length ||
                              new Set([
                                ...selected,
                                ...matching.map((site) => site.domain),
                              ]).size > 100
                            }
                            onClick={() =>
                              setSelected(
                                new Set([
                                  ...selected,
                                  ...matching.map((site) => site.domain),
                                ]),
                              )
                            }
                          >
                            {t("select")}
                          </button>
                          <button
                            className={secondary}
                            disabled={!selected.size}
                            onClick={() => setSelected(new Set())}
                          >
                            {t("clear")}
                          </button>
                        </div>
                      </div>
                      <div className="max-h-48 overflow-auto rounded-lg border border-border/50">
                        {sitesLoading ? (
                          <p className="p-3 text-xs text-muted-foreground">
                            {t("loadingSites")}
                          </p>
                        ) : !matching.length ? (
                          <p className="p-3 text-xs text-muted-foreground">
                            {t("noSites")}
                          </p>
                        ) : (
                          matching.map((site) => (
                            <label
                              key={site.domain}
                              className="flex items-center gap-2.5 border-b border-border/30 px-3 py-2 text-xs last:border-0 hover:bg-muted/30"
                            >
                              <input
                                type="checkbox"
                                className="accent-primary"
                                checked={selected.has(site.domain)}
                                disabled={
                                  !selected.has(site.domain) &&
                                  selected.size >= 100
                                }
                                onChange={(event) =>
                                  setSelected((previous) => {
                                    const next = new Set(previous);
                                    if (event.target.checked)
                                      next.add(site.domain);
                                    else next.delete(site.domain);
                                    return next;
                                  })
                                }
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {site.domain}
                              </span>
                              <span className="text-muted-foreground tabular-nums">
                                {site.count}
                              </span>
                            </label>
                          ))
                        )}
                      </div>
                      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
                        {t("limit")}
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={overwrite}
                        onChange={(event) => setOverwrite(event.target.checked)}
                        className="accent-primary"
                      />
                      {t("overwrite")}
                    </label>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      {t("keep")}
                    </p>
                  </div>
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    {t("technical")}
                  </p>
                </div>
              )}
            </div>
            {advanced && importAction}
          </>
        )}
        {!running && !result && (
          <div className="mt-auto pt-7 text-center text-[10px] leading-5 text-muted-foreground">
            <p className="flex items-center justify-center gap-1.5">
              <LockKeyhole className="h-3 w-3 shrink-0" />
              {t("local")}
            </p>
            <p>{t("permission")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
