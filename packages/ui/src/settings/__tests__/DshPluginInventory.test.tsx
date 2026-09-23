import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { DshPluginInventoryView } from "../DshPluginInventory";
import {
  SettingsPageChromeProvider,
  useSettingsPageChrome,
} from "../page-chrome";

/** Reproduces the scaffold's head-actions host: the section renders in the
 *  same tree as the scaffold, so SettingsPageActions resolves the host from
 *  plain React context. */
function ActionsHost() {
  const { setActionsHost } = useSettingsPageChrome();
  return <div data-testid="actions-host" ref={setActionsHost} />;
}

function Chrome({ children }: { children: ReactNode }) {
  return (
    <SettingsPageChromeProvider>
      <ActionsHost />
      {children}
    </SettingsPageChromeProvider>
  );
}

describe("DshPluginInventoryView", () => {
  it("renders the actual DSH loader snapshot and filters by ownership", async () => {
    document.documentElement.lang = "zh-CN";
    const list = vi.fn().mockResolvedValue({
      entries: [
        {
          entryId: "amiba-memory",
          moduleName: "@amiba/dsh-plugin-memory-memos",
          enabled: true,
          fiberPhase: "active",
        },
        {
          entryId: "schedule",
          moduleName: "@deepseek-ai/dsh-schedule",
          enabled: true,
          fiberPhase: "active",
        },
      ],
    });

    render(
      <Chrome>
        <DshPluginInventoryView adapter={{ list }} />
      </Chrome>,
    );

    expect(
      await screen.findByText("dsh-plugin-memory-memos"),
    ).toBeInTheDocument();
    expect(screen.getByText("dsh-schedule")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /内部/ }));
    expect(screen.getByText("dsh-plugin-memory-memos")).toBeInTheDocument();
    expect(screen.getByText("dsh-schedule")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /外部/ }));
    expect(screen.queryByText("dsh-schedule")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "刷新插件清单" }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("keeps profile package management in the DSH Plugins section", async () => {
    document.documentElement.lang = "zh-CN";
    const installArchive = vi.fn().mockResolvedValue(null);
    render(
      <DshPluginInventoryView
        adapter={{
          list: vi.fn().mockResolvedValue({ entries: [] }),
          management: {
            list: vi.fn().mockResolvedValue({
              packages: [
                {
                  packageName: "@example/dsh-plugin-demo",
                  requestedSpec: "1.0.0",
                  version: "1.0.0",
                  bundle: true,
                },
                {
                  packageName: "@example/dsh-plugin-local",
                  requestedSpec: "file:.amiba/plugin-archives/local.tgz",
                  version: "1.0.0",
                  bundle: true,
                },
              ],
            }),
            installRegistry: vi.fn(),
            installArchive,
            remove: vi.fn(),
            update: vi.fn(),
          },
        }}
      />,
    );

    expect(
      await screen.findByText("@example/dsh-plugin-demo"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "更新 @example/dsh-plugin-demo",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "更新 @example/dsh-plugin-local",
      }),
    ).toBeDisabled();
    expect(
      screen.getByPlaceholderText(/@scope\/dsh-plugin-example/u),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "安装本地 .tgz" }),
    );
    await waitFor(() => expect(installArchive).toHaveBeenCalledOnce());
  });

  it("follows the document language contract after the DSH slot is mounted", async () => {
    document.documentElement.lang = "en";
    render(
      <Chrome>
        <DshPluginInventoryView
          adapter={{
            list: vi.fn().mockResolvedValue({ entries: [] }),
          }}
        />
      </Chrome>,
    );

    expect(
      await screen.findByRole("button", { name: "Refresh plugin inventory" }),
    ).toBeInTheDocument();

    document.documentElement.lang = "zh-CN";

    expect(
      await screen.findByRole("button", { name: "刷新插件清单" }),
    ).toBeInTheDocument();
  });
});

it("merges package entries and distinguishes bundled browser from an external development plugin", async () => {
  document.documentElement.lang = "zh-CN";
  const browser = "@amiba/dsh-plugin-browser-provider-electron";
  const computer = "@amiba-plugins/dsh-plugin-computer-use";
  render(
    <DshPluginInventoryView
      adapter={{
        list: async () => ({
          entries: [
            {
              moduleName: browser,
              entryId: "browser",
              enabled: true,
              fiberPhase: "active",
            },
            {
              moduleName: computer,
              entryId: "computer-a",
              enabled: true,
              fiberPhase: "active",
            },
            {
              moduleName: computer,
              entryId: "computer-b",
              enabled: true,
              fiberPhase: "failed",
            },
          ],
        }),
        management: {
          list: async () => ({
            packages: [
              {
                packageName: browser,
                requestedSpec: "link:/runtime/browser",
                bundle: true,
                source: "internal",
                mutable: false,
              },
              {
                packageName: computer,
                requestedSpec: "link:/projects/computer",
                bundle: true,
                source: "external",
                development: true,
                mutable: false,
              },
            ],
          }),
          installRegistry: vi.fn(),
          installArchive: vi.fn(),
          remove: vi.fn(),
          update: vi.fn(),
        },
      }}
    />,
  );
  expect(
    await screen.findByRole("button", { name: "全部 2" }),
  ).toBeInTheDocument();
  expect(screen.getAllByText(computer)).toHaveLength(1);
  expect(screen.getByText("开发连接")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: `移除 ${browser}` }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: `移除 ${computer}` }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "外部 1" }));
  expect(screen.queryByText(browser)).not.toBeInTheDocument();
  expect(screen.getByText(computer)).toBeInTheDocument();
  expect(screen.getByText("失败")).toBeInTheDocument();
});

it("filters provider independently from internal/external origin", async () => {
  document.documentElement.lang = "zh-CN";
  render(
    <DshPluginInventoryView
      adapter={{
        list: async () => ({ entries: [] }),
        management: {
          list: async () => ({
            packages: [
              {
                packageName: "@vendor/builtin",
                requestedSpec: "1",
                bundle: true,
                source: "internal",
                provider: "third-party",
                author: "Alice",
                mutable: false,
              },
              {
                packageName: "@vendor/installed",
                requestedSpec: "1",
                bundle: true,
                source: "external",
                provider: "third-party",
                author: "Alice",
              },
              {
                packageName: "@amiba/browser",
                requestedSpec: "1",
                bundle: true,
                source: "internal",
                provider: "amiba",
                mutable: false,
              },
            ],
          }),
          installRegistry: vi.fn(),
          installArchive: vi.fn(),
          remove: vi.fn(),
          update: vi.fn(),
        },
      }}
    />,
  );
  await screen.findByText("@amiba/browser");
  await userEvent.click(screen.getByRole("combobox", { name: "提供方" }));
  await userEvent.click(
    await screen.findByRole("option", { name: "第三方", exact: true }),
  );
  expect(screen.queryByText("@amiba/browser")).not.toBeInTheDocument();
  expect(screen.getAllByText("第三方 · Alice")).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "内部 2" }));
  expect(screen.getByText("@vendor/builtin")).toBeInTheDocument();
  expect(screen.queryByText("@vendor/installed")).not.toBeInTheDocument();
});

it("shows one package row and reveals the distinct module states on expansion", async () => {
  document.documentElement.lang = "zh-CN";
  const packageName = "@deepseek-ai/dsh-web-app";
  const list = vi.fn().mockResolvedValue({
    entries: [
      {
        moduleName: `${packageName}/startup`,
        entryId: "start",
        enabled: true,
        fiberPhase: "active",
      },
      {
        moduleName: `${packageName}/settings`,
        entryId: "settings",
        enabled: false,
        fiberPhase: null,
      },
    ],
  });
  render(<DshPluginInventoryView adapter={{ list }} />);
  await screen.findByRole("button", { name: "全部 1" });
  expect(screen.getByText("2 个模块")).toBeInTheDocument();
  expect(screen.queryByText(`${packageName}/startup`)).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: `展开模块 ${packageName}` }),
  );
  expect(screen.getByText(`${packageName}/startup`)).toBeInTheDocument();
  expect(screen.getByText(`${packageName}/settings`)).toBeInTheDocument();
  expect(screen.getByText("已停用")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: `收起模块 ${packageName}` }),
  );
  expect(screen.queryByText(`${packageName}/startup`)).not.toBeInTheDocument();
  await userEvent.type(
    screen.getByRole("textbox", { name: "搜索模块或 Loader entry" }),
    "startup",
  );
  expect(screen.getByText("dsh-web-app")).toBeInTheDocument();
});
