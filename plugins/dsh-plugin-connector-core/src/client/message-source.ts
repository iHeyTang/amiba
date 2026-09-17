import type { MessageSourceContribution } from "@amiba/dsh-plugin-ui-shell/client";
import type { ConnectorMessageSource } from "../remote.js";

export function createConnectorMessageSource(load: () => Promise<ConnectorMessageSource[]>): {
  face: MessageSourceContribution;
  dispose(): void;
} {
  let sources = new Map<string, ConnectorMessageSource>();
  let disposed = false;
  let loading = false;
  const listeners = new Set<() => void>();
  const refresh = async () => {
    if (disposed || loading) return;
    loading = true;
    try {
      const rows = await load();
      if (disposed) return;
      const next = new Map(rows.map(row => [row.id, row]));
      if (JSON.stringify([...sources]) !== JSON.stringify([...next])) {
        sources = next;
        for (const listener of listeners) listener();
      }
    } catch {
      // Keep readable names during reconnects; unknown ids use the generic label.
    } finally { loading = false; }
  };
  void refresh();
  // Don't poll for source names while the window is hidden; refresh on
  // visibility so the labels are current when the user comes back.
  const onVisibility = () => {
    if (!document.hidden) void refresh();
  };
  const timer = setInterval(() => {
    if (document.hidden) return;
    void refresh();
  }, 15000);
  document.addEventListener("visibilitychange", onVisibility);
  return {
    face: {
      resolve: id => {
        if (!id.startsWith("amiba-message:")) return undefined;
        const zh = document.documentElement.lang.toLowerCase().startsWith("zh");
        const row = sources.get(id);
        if (!row) return zh ? "外部消息" : "External messages";
        const platform = row.provider === "lark" ? (zh ? "飞书" : "Lark")
          : row.provider === "dingtalk" ? (zh ? "钉钉" : "DingTalk")
          : row.providerName;
        const account = row.accountName.trim();
        if (!platform) return account || (zh ? "外部消息" : "External messages");
        return !account || account === platform || account === row.providerName ? platform : `${platform} · ${account}`;
      },
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      listeners.clear();
    },
  };
}
