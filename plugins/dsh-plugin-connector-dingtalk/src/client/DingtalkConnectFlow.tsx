import { useEffect, useState } from "react";
import { Button, usePluginT } from "@amiba/ui/plugin";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";
import type { ConnectView } from "@amiba/dsh-plugin-connector-core";
import type { DingtalkPersonalRemote } from "../personal-remote.js";
import { DingtalkWizard } from "./DingtalkWizard.js";
import { DingtalkPersonalSettings } from "./DingtalkPersonalSettings.js";
import { personalI18n } from "./i18n-personal.js";
export function DingtalkConnectFlow({
  host,
  remote,
}: {
  host: ConnectWizardHost;
  remote: DingtalkPersonalRemote;
}) {
  const [connect, setConnect] = useState<ConnectView>();
  const { t } = usePluginT(personalI18n);
  useEffect(() => {
    if (!connect) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const details = await host.adapter.details(connect.id);
        if (!stopped) setConnect(details.connect);
      } catch {
        /* Keep existing progress on transient refresh failure. */
      }
    };
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [connect?.id, host.adapter]);

  if (!connect) return <DingtalkWizard host={{ ...host, done: setConnect }} />;
  return (
    <div className="max-w-2xl space-y-4">
      <DingtalkPersonalSettings
        autoStart
        host={{
          connect,
          settings: {},
          save: async (settings) => {
            await host.adapter.update(connect.id, { settings });
          },
        }}
        remote={remote}
        onDone={() => host.done(connect)}
      />
      <Button
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => host.done(connect)}
      >
        {t("dingtalk.personal.later")}
      </Button>
    </div>
  );
}
