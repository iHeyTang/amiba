import { Button, PageContent, ScrollArea, usePluginT } from "@amiba/ui/plugin";
import type { ConversationView } from "@amiba/dsh-plugin-session-features";
import { useEffect, useRef, useState } from "react";
import type { ConversationSettingsInput } from "../remote.js";
type ScopedConversationSettingsInput = Omit<
  ConversationSettingsInput,
  "stewardId"
>;
import { stewardI18n } from "./i18n.js";

export interface StewardSettingsProps {
  embedded?: boolean;
  settings(input: ScopedConversationSettingsInput): Promise<ConversationView>;
  openSession(sessionId: string): void;
}

export function StewardSettings({
  settings,
  openSession,
  embedded = false,
}: StewardSettingsProps) {
  const { t, language } = usePluginT(stewardI18n);
  const [view, setView] = useState<ConversationView>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setView(undefined);
    setBusy(true);
    setFailed(false);
    void settings({ action: "status" })
      .then((result) => {
        if (request === generation.current) setView(result);
      })
      .catch(() => {
        if (request === generation.current) setFailed(true);
      })
      .finally(() => {
        if (request === generation.current) setBusy(false);
      });
    return () => {
      generation.current++;
    };
  }, [settings]);
  const change = async (input: ScopedConversationSettingsInput) => {
    const request = ++generation.current;
    setBusy(true);
    setFailed(false);
    try {
      const result = await settings(input);
      if (request === generation.current) setView(result);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const content = (
    <>
      {!embedded ? (
        <header className="space-y-2">
          <h2 className="text-lg font-semibold">{t("steward.nav")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("steward.settingsHint")}
          </p>
        </header>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("steward.settingsFailed")}{" "}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void change({ action: "status" })}
          >
            {t("steward.retry")}
          </Button>
        </p>
      ) : null}
      {busy && !view ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("steward.loading")}
        </p>
      ) : null}
      {view ? (
        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-medium">
              {t("steward.conversations")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("steward.conversationHint")}
            </p>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>{t("steward.cadence")}</span>
              <select
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={view.policy.cadence}
                disabled={busy}
                onChange={(event) =>
                  void change({
                    action: "configure",
                    cadence: event.target
                      .value as ConversationView["policy"]["cadence"],
                  })
                }
              >
                {(["daily", "weekly", "manual"] as const).map((cadence) => (
                  <option key={cadence} value={cadence}>
                    {t(`steward.${cadence}`)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              {t("steward.cadenceHint")} · {view.policy.timeZone}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={
                busy || view.pendingNewConversation || !view.currentSessionId
              }
              onClick={() => void change({ action: "new" })}
            >
              {t("steward.newConversation")}
            </Button>
            {view.pendingNewConversation ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t("steward.pendingConversation")}
              </p>
            ) : null}
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("steward.history")}</h3>
            {view.history.length ? (
              <ul className="max-h-64 overflow-y-auto space-y-1">
                {view.history.map((segment) => (
                  <li key={segment.sessionId}>
                    <Button
                      variant="ghost"
                      className="h-auto w-full justify-between py-2 text-sm font-normal"
                      onClick={() => openSession(segment.sessionId)}
                    >
                      <time
                        dateTime={new Date(segment.createdAt).toISOString()}
                      >
                        {new Intl.DateTimeFormat(language, {
                          timeZone: view.policy.timeZone,
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(segment.createdAt)}
                      </time>
                      {segment.sessionId === view.currentSessionId ? (
                        <span className="text-xs text-muted-foreground">
                          {t("steward.current")}
                        </span>
                      ) : null}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("steward.noHistory")}
              </p>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
  if (embedded)
    return (
      <div
        className="space-y-6 border-t border-border pt-5"
        data-steward-settings
      >
        {content}
      </div>
    );
  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-steward-settings
    >
      <ScrollArea className="min-h-0 flex-1">
        <PageContent size="md" bodyClassName="space-y-6">
          {content}
        </PageContent>
      </ScrollArea>
    </div>
  );
}
