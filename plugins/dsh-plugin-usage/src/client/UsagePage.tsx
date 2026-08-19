/**
 * Usage page shell — the content the plugin's "usage" settings section
 * renders. Replaces the Tokens-only `TokensPage` shell: since the T9
 * surgery the section owns two views, Tokens (provider-reported token
 * usage) and Tools (the tool-activity ledger), switched by a chip strip.
 *
 * The Settings shell (`settings.section` scaffold) still owns the
 * page title and scroll host; each tab supplies its own ScrollArea and
 * all content, so the switcher stays pinned while the view scrolls.
 */

import { ChipSwitcher, PageContent, usePluginT } from "@amiba/ui/plugin";
import { useState } from "react";

import { usageToolsI18n } from "./i18n.js";
import { TokensTab } from "./TokensTab.js";
import { ToolsActivityTab } from "./ToolsActivityTab.js";
import type { UsageListFn } from "./token-usage.js";
import type { ToolActivityReadFn } from "./tool-usage.js";

const VIEWS = ["tokens", "tools"] as const;
type UsageView = (typeof VIEWS)[number];

export function UsagePage({
  list,
  readToolActivity,
}: {
  list: UsageListFn;
  readToolActivity: ToolActivityReadFn;
}) {
  const { t } = usePluginT(usageToolsI18n);
  const [view, setView] = useState<UsageView>("tokens");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <PageContent size="md" padding="none" className="px-7 pt-4">
        <ChipSwitcher
          options={VIEWS}
          value={view}
          onChange={setView}
          formatLabel={(v) =>
            v === "tokens" ? t("usage.tab.tokens") : t("usage.tab.tools")
          }
        />
      </PageContent>
      {view === "tokens" ? (
        <TokensTab list={list} />
      ) : (
        <ToolsActivityTab read={readToolActivity} />
      )}
    </div>
  );
}
