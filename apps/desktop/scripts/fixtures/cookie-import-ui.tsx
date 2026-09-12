import React from "react";
import { createRoot } from "react-dom/client";
import { CookieImportPanel } from "../../../../plugins/dsh-plugin-browser-provider-electron/src/client/CookieImportPanel.js";
const importer = {
  sources: async () => ({
    supported: true,
    sources: [
      { id: "synthetic", browser: "Chrome", profile: "测试配置" },
      { id: "second", browser: "Edge", profile: "工作配置" },
    ],
  }),
  sites: async () => [
    { domain: "example.test", count: 3 },
    { domain: "work.test", count: 8 },
    { domain: "design.test", count: 2 },
  ],
  run: async (_id: string, domains: string[] | null, overwrite: boolean) => {
    if (domains !== null || overwrite)
      throw new Error("Fixture selection mismatch");
    return { imported: 3, preserved: 0, expired: 0, unsupported: 0, failed: 0 };
  },
};
createRoot(document.getElementById("root")!).render(
  <CookieImportPanel
    importer={importer}
    onClose={() => {}}
    onVisit={() => {}}
  />,
);
