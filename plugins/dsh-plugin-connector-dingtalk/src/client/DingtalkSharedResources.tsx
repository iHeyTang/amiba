import { useEffect, useRef, useState } from "react";
import { Button, Input, usePluginT } from "@amiba/ui/plugin";
import type { ConnectSettingsHost } from "@amiba/dsh-plugin-connector-core/client";
import { conversationI18n } from "./i18n-conversations.js";
type Management = NonNullable<ConnectSettingsHost["conversations"]>;
type View = Awaited<ReturnType<Management["manage"]>>;
type Choice = { reference: string; title: string; description?: string };
export function DingtalkSharedResources({ management, chatKey, grants, saved }: {
  management: Management; chatKey: string; grants: View["sharedResources"]; saved(view: View): void;
}) {
  const { t } = usePluginT(conversationI18n);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Choice[]>([]);
  const [selected, setSelected] = useState<string[]>(grants.map(item => item.reference));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [searched, setSearched] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [success, setSuccess] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { setSelected(grants.map(item => item.reference)); }, [grants]);
  const choices = [...new Map<string, Choice>([...grants, ...results].map(item => [item.reference, item])).values()];
  const dirty = selected.length !== grants.length || selected.some(reference => !grants.some(item => item.reference === reference));
  async function search() {
    if (!management.searchResources || !query.trim()) return;
    const request = ++generation.current;
    setBusy(true); setFailed(false); setSuccess(false);
    try {
      const result = await management.searchResources(chatKey, query.trim());
      if (generation.current !== request) return;
      // Keep unsaved choices visible across searches.
      setResults(previous => [...new Map([...previous.filter(item => selected.includes(item.reference)), ...result.items].map(item => [item.reference, item])).values()]);
      setUnavailable(result.unavailable); setSearched(true);
    } catch { if (generation.current === request) setFailed(true); }
    finally { if (generation.current === request) setBusy(false); }
  }
  async function save() {
    if (!management.shareResources) return;
    const request = ++generation.current;
    setBusy(true); setFailed(false); setSuccess(false);
    try {
      const result = await management.shareResources(chatKey, selected);
      if (generation.current !== request) return;
      saved(result); setSuccess(true);
    } catch { if (generation.current === request) setFailed(true); }
    finally { if (generation.current === request) setBusy(false); }
  }
  return <section className="space-y-3" aria-label={t("sharing.title")}>
    <div><h3 className="text-sm font-medium">{t("sharing.title")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("sharing.hint")}</p></div>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void search(); }}>
      <Input value={query} onChange={event => setQuery(event.target.value)} maxLength={100} aria-label={t("sharing.query")} placeholder={t("sharing.query")} disabled={busy} />
      <Button type="submit" variant="outline" disabled={busy || !query.trim() || !management.searchResources}>{t("sharing.search")}</Button>
    </form>
    {busy ? <p role="status" className="text-sm text-muted-foreground">{t("sharing.busy")}</p> : null}
    {failed ? <p role="alert" className="text-sm text-destructive">{t("sharing.failed")}</p> : null}
    {unavailable ? <p className="text-sm text-muted-foreground">{t("sharing.unavailable")}</p> : null}
    {!choices.length ? <p className="text-sm text-muted-foreground">{t(searched ? "sharing.noResults" : "sharing.empty")}</p> : <ul className="max-h-64 space-y-2 overflow-y-auto">{choices.map(item => <li key={item.reference}>
      <label className="flex cursor-pointer items-start gap-3 rounded-md py-1 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={selected.includes(item.reference)} disabled={busy} onChange={event => {
        setSuccess(false); setSelected(previous => event.target.checked ? [...previous, item.reference] : previous.filter(reference => reference !== item.reference));
      }} /><span className="min-w-0"><span className="break-words">{item.title}</span>{item.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span> : null}</span></label>
    </li>)}</ul>}
    <Button variant="outline" size="sm" disabled={busy || !dirty || !management.shareResources} onClick={() => void save()}>{t("sharing.save")}</Button>
    {success ? <p role="status" className="text-sm text-muted-foreground">{t("sharing.saved")}</p> : null}
  </section>;
}
