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
          moduleName: "@amiba/dsh-plugin-memory",
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

    expect(await screen.findByText("dsh-plugin-memory")).toBeInTheDocument();
    expect(screen.getByText("dsh-schedule")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Amiba/ }));
    expect(screen.getByText("dsh-plugin-memory")).toBeInTheDocument();
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
