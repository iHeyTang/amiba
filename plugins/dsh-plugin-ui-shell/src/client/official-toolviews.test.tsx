// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolCallOwnerProps } from "@amiba/extension-sdk";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OFFICIAL_TOOLVIEWS,
  renderOfficialToolFallback,
} from "./official-toolviews";
import {
  TOOLVIEWS as browser,
  createToolviews,
} from "../../../dsh-plugin-browser-core/src/client/toolviews";
import { TOOLVIEWS as resources } from "../../../dsh-plugin-resources/src/client/toolviews";
import { TOOLVIEWS as steward } from "../../../dsh-plugin-steward/src/client/toolviews";
import { ToolChip } from "../../../../packages/ui/src/chat/bubble/tool-chip";
import { ToolCallSeatProvider } from "../../../../packages/ui/src/chat/bubble/tool-call-seat";
import { zhCN } from "./locales/zh-CN";
import { en } from "./locales/en";

vi.mock("@amiba/i18n", async (original) => ({
  ...(await original<typeof import("@amiba/i18n")>()),
  useT: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
function owner(
  name: string,
  args: Record<string, unknown> = {},
  error = false,
): ToolCallOwnerProps {
  return {
    callId: "c1",
    toolName: name,
    openFile: () => {},
    block: {
      kind: "tool-result",
      seq: 2,
      time: 2000,
      callId: "c1",
      call: { name, argsRaw: JSON.stringify(args) },
      callTime: 1000,
      content: [
        { type: "text", text: error ? "permission denied" : "result evidence" },
      ],
      isError: error,
      callView: null,
      resultView: null,
      subCalls: [],
    },
  };
}
const added = [
  "pwsh",
  "run_code",
  "exit_plan_mode",
  "workflow",
  "str_replace_editor",
  "report",
  "subagent_codex",
  "subagent_claude_code",
  "cordis_inspect_list",
  "cordis_inspect_query",
  "cordis_inspect_self",
  "cordis_define",
  "cordis_run",
  "cordis_stop",
  "cordis_undefine",
];
describe("tool views", () => {
  it("keeps intrinsic Bash semantics when the session-scoped slot falls back", () => {
    render(
      <>
        {renderOfficialToolFallback(
          owner("bash", { command: "pwd" }),
          <span>generic</span>,
        )}
      </>,
    );
    expect(screen.getByText("shell.tool.runCommand")).toBeTruthy();
    expect(screen.queryByText("generic")).toBeNull();
  });
  it("leaves unknown/plugin tools to their owner and the generic fallback", () => {
    render(
      <>
        {renderOfficialToolFallback(
          owner("custom_plugin_tool"),
          <span>generic</span>,
        )}
      </>,
    );
    expect(screen.getByText("generic")).toBeTruthy();
  });
  it("keeps report contents under the actual output argument", () => {
    const View = OFFICIAL_TOOLVIEWS.find((e) => e.key === "report")!.component;
    render(<View {...owner("report", { output: "Finished investigating" })} />);
    expect(screen.getByText("Finished investigating")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByText("Finished investigating").length).toBe(2);
  });

  it.each(added)(
    "renders a semantic row and failure evidence for %s",
    (name) => {
      const View = OFFICIAL_TOOLVIEWS.find(
        (entry) => entry.key === name,
      )!.component;
      render(<View {...owner(name, {}, true)} />);
      expect(screen.queryByText("sidepanel.trace.actions.useTool")).toBeNull();
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByText("permission denied")).toBeTruthy();
    },
  );
  it.each(["view", "create", "str_replace", "insert"])(
    "describes editor command %s",
    (command) => {
      const View = OFFICIAL_TOOLVIEWS.find(
        (e) => e.key === "str_replace_editor",
      )!.component;
      render(
        <View
          {...owner("str_replace_editor", {
            command,
            path: "/tmp/example.txt",
            old_str: "before",
            new_str: "after",
            file_text: "created",
          })}
        />,
      );
      expect(
        screen.getByText(
          command === "view"
            ? "shell.tool.readFile"
            : command === "create"
              ? "shell.tool.writeFile"
              : "shell.tool.editFile",
        ),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button"));
      if (command === "str_replace") {
        expect(screen.getByText("-before")).toBeTruthy();
        expect(screen.getByText("+after")).toBeTruthy();
      }
    },
  );
  it("dispatches a real Bash wire record through the seat", () => {
    render(
      <ToolCallSeatProvider
        render={({ owner: call, fallback }) => {
          const View = OFFICIAL_TOOLVIEWS.find(
            (e) => e.key === call.toolName,
          )?.component;
          return View ? <View {...call} /> : fallback;
        }}
      >
        <ToolChip
          event={{
            tool: "bash",
            toolCallId: "c1",
            status: "completed",
            args: { command: "printf hello" },
            wire: {
              call: {
                argsRaw: '{"command":"printf hello"}',
                turn: 1,
                step: 1,
                time: 1000,
                callView: null,
              },
              result: {
                seq: 2,
                time: 2000,
                content: [{ type: "text", text: "hello" }],
                isError: false,
                resultView: null,
              },
            },
          }}
        />
      </ToolCallSeatProvider>,
    );
    expect(screen.getByText("shell.tool.runCommand")).toBeTruthy();
    expect(screen.queryByText("sidepanel.trace.actions.useTool")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(
      document.querySelector("[data-tool-detail=bash]")?.textContent,
    ).toContain("hello");
  });
  it.each(
    [...browser, ...resources, ...steward].map(
      (e) => [e.key, e.component] as const,
    ),
  )("renders localized plugin action for %s", (key, View) => {
    document.documentElement.lang = "zh-CN";
    render(
      <View
        {...owner(key, {
          query: "project",
          target: "#submit",
          attachmentId: "att-1",
        })}
      />,
    );
    expect(screen.queryByText("sidepanel.trace.actions.useTool")).toBeNull();
    expect(screen.queryByText(key)).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("result evidence")).toBeTruthy();
  });
  it("loads screenshots only on expansion under their owning session and releases the URL", async () => {
    const create = vi.fn(() => "blob:test-image");
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }),
    );
    const load = vi.fn(async () => ({
      data: new Uint8Array([1, 2]),
      mediaType: "image/png",
    }));
    const View = createToolviews(load).find(
      (e) => e.key === "amiba_browser_screenshot",
    )!.component;
    const call = owner("amiba_browser_screenshot");
    if ("kind" in call.block)
      call.block = {
        ...call.block,
        content: [
          {
            type: "image",
            attachment: {
              attachmentId: "att-screenshot",
              mediaType: "image/png",
            },
          },
        ],
      } as never;
    const { unmount } = render(<View {...call} sessionId="session-a" />);
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("img").getAttribute("src")).toBe(
        "blob:test-image",
      ),
    );
    expect(load).toHaveBeenCalledWith("session-a", "att-screenshot");
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:test-image");
    vi.unstubAllGlobals();
  });
  it("shows workflow identity and script using the runtime argument shape", () => {
    const View = OFFICIAL_TOOLVIEWS.find(
      (e) => e.key === "workflow",
    )!.component;
    render(
      <View
        {...owner("workflow", {
          meta: { name: "verify" },
          script: "return 42;",
        })}
      />,
    );
    expect(screen.getByText("verify")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("return 42;")).toBeTruthy();
  });
  it("covers every product-owned tool registration", () => {
    for (const [path, views, pattern] of [
      ["browser-core/src/index.ts", browser, /name: "(amiba_browser_[^"]+)"/g],
      ["steward/src/tools.ts", steward, /name: "(steward_[^"]+)"/g],
      ["resources/src/index.ts", resources, /name: "(amiba_resource_[^"]+)"/g],
    ] as const) {
      const sources = path === "steward/src/tools.ts"
        ? [path, "steward/src/registry-extension.ts"] : [path];
      const source = sources.map(file => readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), "../../../dsh-plugin-" + file),
        "utf8",
      )).join("\n");
      const names = [...source.matchAll(pattern)].map((m) => m[1]);
      expect(names.length).toBeGreaterThan(0);
      expect(views.map((e) => e.key).sort()).toEqual(
        [...new Set(names)].sort(),
      );
    }
  });
  it("has bilingual copy for every fixed runtime action", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });
});

it("renders the official tool semantics inline for an execution summary", () => {
  const View = OFFICIAL_TOOLVIEWS.find(entry => entry.key === "glob")!.component;
  const {container} = render(<button><View {...owner("glob", {pattern:"**/package.json"})} presentation="summary" /></button>);
  expect(screen.getByText("**/package.json")).toBeTruthy();
  expect(screen.queryByText("sidepanel.trace.actions.useTool")).toBeNull();
  expect(container.querySelectorAll("button")).toHaveLength(1);
});
