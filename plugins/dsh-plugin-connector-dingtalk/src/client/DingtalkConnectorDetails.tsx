import { Bot, FileText, QrCode, Radio, ShieldCheck, Wrench } from "lucide-react";

import { usePluginT } from "@amiba/ui/plugin";

import { dingtalkI18n } from "./i18n.js";

const FEATURES = [
  { icon: FileText, key: "documents" },
  { icon: QrCode, key: "onboarding" },
  { icon: Radio, key: "stream" },
  { icon: Bot, key: "messaging" },
  { icon: ShieldCheck, key: "approval" },
  { icon: Wrench, key: "tools" },
] as const;

export function DingtalkConnectorDetails() {
  const { t } = usePluginT(dingtalkI18n);
  return (
    <div className="space-y-8" data-provider-details="dingtalk">
      <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
        {t("options.connect.dsh.dingtalk.detail.summary")}
      </p>
      <section aria-labelledby="dingtalk-capabilities" className="space-y-3">
        <h2
          className="text-[15px] font-semibold tracking-[-0.01em]"
          id="dingtalk-capabilities"
        >
          {t("options.connect.dsh.detail.capabilities")}
        </h2>
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, key }) => (
            <div
              className="flex items-start gap-3 rounded-lg px-2 py-2.5"
              key={key}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {t(`options.connect.dsh.dingtalk.detail.${key}.title`)}
                </span>
                <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">
                  {t(`options.connect.dsh.dingtalk.detail.${key}.description`)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
