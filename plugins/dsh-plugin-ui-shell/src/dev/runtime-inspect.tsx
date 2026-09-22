import { useState } from "react";
import { createRoot } from "react-dom/client";
import { installMessageCatalog } from "@amiba/i18n";
import { RuntimeInspectEvidence } from "../client/runtime-inspect-evidence";
import { en, zhCN } from "../client/locales";
import "./surfaces.css";

installMessageCatalog({ en, "zh-CN": zhCN });
const serviceArgs = {
  platform: "client",
  provider: "Service",
  method: "listService",
};
const tokenArgs = {
  platform: "client",
  provider: "Theme",
  method: "listTokens",
};
const service = JSON.stringify(
  {
    ...serviceArgs,
    data: {
      mode: "service",
      service: {
        key: "layout",
        description:
          "Panel navigation and geometry actions exposed through ctx.layout.",
        access: {
          optional: {
            expression: 'ctx.get("layout")',
            requiresUndefinedCheck: true,
          },
          hardDependency: { inject: ["layout"] },
        },
        methods: [
          { name: "openPanel", description: "Open a panel in the workspace." },
          { name: "closePanel", description: "Close a workspace panel." },
        ],
      },
    },
  },
  null,
  2,
);
const tokens = JSON.stringify(
  {
    ...tokenArgs,
    data: [
      { name: "background", value: "#ffffff" },
      { name: "foreground", value: "#18181b" },
      { name: "primary", value: "#7755ee" },
      ...Array.from({ length: 22 }, (_, index) => ({
        name: `spacing-${index + 1}`,
        value: `${(index + 1) * 4}px`,
      })),
    ],
  },
  null,
  2,
);
function Example({
  title,
  args,
  text,
}: {
  title: string;
  args: Record<string, unknown>;
  text: string;
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <div
        style={{
          fontSize: 14,
          marginBottom: 10,
          color: "hsl(var(--foreground) / .75)",
        }}
      >
        ⌕ {title}{" "}
        <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
          {text ? "13ms" : "3s"}
        </span>
      </div>
      <div
        style={{
          borderLeft: "1px solid hsl(var(--border) / .5)",
          marginLeft: 6,
          paddingLeft: 16,
        }}
      >
        <RuntimeInspectEvidence args={args} text={text} block={{} as never} />
      </div>
    </section>
  );
}
function Demo() {
  const [done, setDone] = useState(false);
  const [dark, setDark] = useState(false);
  return (
    <main style={{ maxWidth: 680, margin: "24px auto", padding: "0 8px 40px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>运行环境 · 工具卡片</h1>
      <p
        style={{
          marginTop: 8,
          fontSize: 13,
          color: "hsl(var(--muted-foreground))",
        }}
      >
        实际 UI 组件，使用演示数据。可切换完成状态、展开详情和原始 JSON。
      </p>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}
      >
        <button
          style={{
            fontSize: 12,
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
            padding: "6px 12px",
          }}
          onClick={() => setDone((value) => !value)}
        >
          {done ? "重新查看" : "模拟查询完成"}
        </button>
        <button
          style={{
            fontSize: 12,
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
            padding: "6px 12px",
          }}
          onClick={() => {
            document.documentElement.className = dark ? "light" : "dark";
            setDark(!dark);
          }}
        >
          {dark ? "浅色" : "深色"}
        </button>
      </div>
      <Example
        title={done ? "已查看运行环境" : "正在查看运行环境"}
        args={serviceArgs}
        text={done ? service : ""}
      />
      <Example title="已查看运行环境" args={serviceArgs} text={service} />
      <Example title="已查看运行环境" args={tokenArgs} text={tokens} />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Demo />);
