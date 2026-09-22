import { useState } from "react";
import { createRoot } from "react-dom/client";
import { installMessageCatalog } from "@amiba/i18n";
import { RuntimeInspectEvidence } from "../client/runtime-inspect-evidence";
import { en, zhCN } from "../client/locales";
import fixtures from "./runtime-inspect-fixtures.json";
import "./surfaces.css";

installMessageCatalog({ en, "zh-CN": zhCN });
const buttonStyle = {
  fontSize: 12,
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  padding: "6px 12px",
};
function Demo() {
  const [selected, setSelected] = useState("client-service");
  const [done, setDone] = useState(true);
  const [dark, setDark] = useState(false);
  const fixture = fixtures.find((item) => item.id === selected)!;
  return (
    <main style={{ maxWidth: 760, margin: "24px auto", padding: "0 8px 40px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>运行环境查询 · 统一排版</h1>
      <p
        style={{
          marginTop: 8,
          fontSize: 13,
          color: "hsl(var(--muted-foreground))",
        }}
      >
        18
        种结构样例。静态目录来自当前运行时源码，动态数据按实际返回结构构造；这里不是实时查询。
      </p>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}
      >
        <button style={buttonStyle} onClick={() => setDone((value) => !value)}>
          {done ? "查看进行中" : "查看已完成"}
        </button>
        <button
          style={buttonStyle}
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
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            style={{
              maxWidth: "100%",
              background: "hsl(var(--background))",
              padding: 6,
              border: "1px solid hsl(var(--border))",
              borderRadius: 4,
            }}
          >
            {fixtures.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <section style={{ marginTop: 28 }}>
        <div style={{ fontSize: 14, marginBottom: 10 }}>
          ⌕ {done ? "已查看运行环境" : "正在查看运行环境"}{" "}
          <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
            {done ? "13ms" : "3s"}
          </span>
        </div>
        <div
          style={{
            borderLeft: "1px solid hsl(var(--border) / .5)",
            marginLeft: 6,
            paddingLeft: 16,
          }}
        >
          <RuntimeInspectEvidence
            key={`${selected}-${done}`}
            args={fixture.args}
            text={done ? JSON.stringify(fixture.result, null, 2) : ""}
            block={{} as never}
          />
        </div>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Demo />);
