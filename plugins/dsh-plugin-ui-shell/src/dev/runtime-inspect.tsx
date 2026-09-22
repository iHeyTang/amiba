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
  const [done, setDone] = useState(true);
  const [example, setExample] = useState("service");
  const [dark, setDark] = useState(false);
  return (
    <main style={{ maxWidth: 680, margin: "24px auto", padding: "0 8px 40px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>AI 正在了解什么？</h1>
      <p
        style={{
          marginTop: 8,
          fontSize: 13,
          color: "hsl(var(--muted-foreground))",
        }}
      >
        这里只展示一次查询。切换示例查看不同查询，点击按钮对比进行中和完成后。
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
          {done ? "查看进行中" : "查看已完成"}
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
      <div style={{ marginTop: 20, fontSize: 13 }}>
        <label>
          查询示例：
          <select
            value={example}
            onChange={(event) => setExample(event.target.value)}
            style={{
              background: "hsl(var(--background))",
              padding: 6,
              border: "1px solid hsl(var(--border))",
              borderRadius: 4,
            }}
          >
            <option value="service">应用功能说明</option>
            <option value="theme">主题样式变量</option>
          </select>
        </label>
      </div>
      <Example
        title={`${done ? "已" : "正在"}查询${example === "service" ? "应用功能说明" : "主题样式变量"}`}
        args={example === "service" ? serviceArgs : tokenArgs}
        text={done ? (example === "service" ? service : tokens) : ""}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Demo />);
