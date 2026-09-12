import { LarkSharedResources } from "./LarkSharedResources.js";
import { useEffect, useRef, useState } from "react";
import { Button, usePluginT } from "@amiba/ui/plugin";
import type { ConnectSettingsHost } from "@amiba/dsh-plugin-connector-core/client";
import { conversationI18n } from "./i18n-conversations.js";

type Management = NonNullable<ConnectSettingsHost["conversations"]>;
type View = Awaited<ReturnType<Management["manage"]>>;
type Input = Parameters<Management["manage"]>[1];

export function LarkConversationSettings({ host }: { host: ConnectSettingsHost }) {
  const { t, language } = usePluginT(conversationI18n);
  const management = host.conversations;
  const [selected, setSelected] = useState("");
  const key = management?.items.some(item => item.key === selected) ? selected : management?.items[0]?.key ?? "";
  const manage = management?.manage;
  const [view, setView] = useState<View>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setView(undefined);
    setFailed(false);
    if (!manage || !key) { setBusy(false); return; }
    setBusy(true);
    void manage(key, { action: "status" }).then(result => {
      if (request === generation.current) setView(result);
    }).catch(() => { if (request === generation.current) setFailed(true); })
      .finally(() => { if (request === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [manage, key]);
  async function change(input: Input) {
    if (!manage || !key) return;
    const request = ++generation.current;
    setBusy(true);
    setFailed(false);
    try {
      const result = await manage(key, input);
      if (request === generation.current) setView(result);
    } catch { if (request === generation.current) setFailed(true); }
    finally { if (request === generation.current) setBusy(false); }
  }
  return <section className="space-y-4" aria-label={t("conversations.title")}>
    <div className="space-y-1"><h2 className="text-sm font-medium">{t("conversations.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("conversations.access")}</p>
      {host.connect.pairing ? <p className="text-sm text-muted-foreground">{t("conversations.pairing")}</p> : null}
    </div>
    {!management ? <p className="text-sm text-muted-foreground">{t("conversations.unavailable")}</p> : <>
      {management.items.length ? <label className="flex items-center justify-between gap-4 text-sm"><span>{t("conversations.chat")}</span>
        <select className="min-w-0 max-w-[70%] rounded-md border border-input bg-background px-3 py-2" value={key} onChange={event => setSelected(event.target.value)}>
          {management.items.map((item, index) => <option key={item.key} value={item.key}>{item.title || `${t(item.kind === "group" ? "conversations.group" : "conversations.private")} ${index + 1}`}</option>)}
        </select></label> : <p className="text-sm text-muted-foreground">{t("conversations.empty")}</p>}
      {failed ? <p role="alert" className="text-sm text-destructive">{t("conversations.failed")} <Button variant="ghost" size="sm" disabled={busy} onClick={() => void change({ action: "status" })}>{t("conversations.retry")}</Button></p> : null}
      {busy && !view ? <p role="status" className="text-sm text-muted-foreground">{t("conversations.loading")}</p> : null}
      {view ? <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t(view.access === "shared" ? "conversations.shared" : "conversations.owner")}</p>
        <div className="space-y-2"><label className="flex items-center justify-between gap-4 text-sm"><span>{t("conversations.cadence")}</span>
          <select className="rounded-md border border-input bg-background px-3 py-2" value={view.policy.cadence} disabled={busy} onChange={event => void change({ action: "configure", cadence: event.target.value as View["policy"]["cadence"] })}>
            {(["daily", "weekly", "manual"] as const).map(cadence => <option key={cadence} value={cadence}>{t(`conversations.${cadence}`)}</option>)}
          </select></label>
          <p className="text-xs text-muted-foreground">{t("conversations.cadenceHint")} · {view.policy.timeZone}</p>
          <Button variant="outline" size="sm" disabled={busy || view.pendingNewConversation} onClick={() => void change({ action: "new" })}>{t("conversations.new")}</Button>
          {view.pendingNewConversation ? <p role="status" className="text-sm text-muted-foreground">{t("conversations.pending")}</p> : null}
        </div>
        {view.access === "shared" ? <LarkSharedResources key={key} management={management} chatKey={key} grants={view.sharedResources} saved={setView} /> : null}
        <details className="space-y-2"><summary className="cursor-pointer text-sm font-medium">{t("conversations.history")}</summary>
          <ul className="max-h-64 space-y-1 overflow-y-auto">{view.history.map(segment => <li key={segment.sessionId}><Button variant="ghost" className="h-auto w-full justify-between py-2 text-sm font-normal" onClick={() => window.dispatchEvent(new CustomEvent("amiba:open-session", { detail: { sessionId: segment.sessionId } }))}>
            <time dateTime={new Date(segment.createdAt).toISOString()}>{new Intl.DateTimeFormat(language, { timeZone: view.policy.timeZone, dateStyle: "medium", timeStyle: "short" }).format(segment.createdAt)}</time>
            {segment.sessionId === view.currentSessionId ? <span className="text-xs text-muted-foreground">{t("conversations.current")}</span> : null}
          </Button></li>)}</ul>
        </details>
      </div> : null}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => {
        const request = ++generation.current;
        setBusy(true); setFailed(false);
        void management.refresh().then(() => {
          if (request === generation.current) return change({ action: "status" });
        }).catch(() => { if (request === generation.current) setFailed(true); })
          .finally(() => { if (request === generation.current) setBusy(false); });
      }}>{t("conversations.refresh")}</Button>
    </>}
  </section>;
}
