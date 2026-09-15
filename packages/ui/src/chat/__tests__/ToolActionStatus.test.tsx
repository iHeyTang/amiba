import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installOfficialLocale } from "@amiba/i18n";
import { Terminal } from "lucide-react";
import { ToolRowFrame } from "../bubble/tool-row-frame";

let uninstall: (() => void) | undefined;
afterEach(() => uninstall?.());

describe("tool action tense", () => {
  it.each([
    ["zh", "执行", "正在执行", "已执行", "失败 · 执行"],
    ["en", "Run command", "In progress · Run command", "Completed · Run command", "Failed · Run command"],
  ])("keeps the action and target while changing its %s status", (locale, action, running, completed, failed) => {
    uninstall = installOfficialLocale({ getSnapshot: () => ({ active: locale }), subscribe: () => () => {} });
    const row = (status: "running" | "completed" | "failed") => <ToolRowFrame
      icon={Terminal} action={action} actionStatus={status} running={status === "running"}
      failed={status === "failed"} target="pnpm test" ariaLabel={`${action} pnpm test`} />;
    const { rerender } = render(row("running"));
    expect(screen.getByText(running)).toHaveClass("agent-thinking-text");
    expect(screen.getByRole("button", { name: `${running} pnpm test` })).toBeInTheDocument();
    rerender(row("completed"));
    expect(screen.getByText(completed)).not.toHaveClass("agent-thinking-text");
    expect(screen.getByRole("button", { name: `${completed} pnpm test` })).toBeInTheDocument();
    rerender(row("failed"));
    expect(screen.getByText(failed)).not.toHaveClass("agent-thinking-text");
    expect(screen.queryByText(completed)).not.toBeInTheDocument();
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
  });
});
