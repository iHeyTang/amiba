// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createElement, type ComponentType, type ReactNode } from "react";
import { SlotCore } from "@deepseek-ai/dsh-client-ui-slots";
import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import { apply } from "../../../dsh-plugin-runtime-inventory/src/client/index.js";

// This test owns generic slot registration, not the built-in browser cards.
// Those controllers require the real ModuleLoader/connection and are exercised
// by the installed desktop compatibility smoke.
vi.mock("../../../dsh-plugin-runtime-inventory/src/client/builtin-config-cards.js", () => ({
  registerBuiltinConfigCards: () => {},
}));

afterEach(cleanup);

it("joins real slot registrations to served Host namespaces and releases the contribution tree", async () => {
  document.documentElement.lang = "en";
  const slots = new SlotCore();
  const disposeRoot = slots.register(
    {
      name: "root",
      children: {
        "settings.section": { kind: "list", scope: "root" },
      },
    },
    ({ renderSlot }: PropsRenderSlots<"settings.section">) => {
      void renderSlot;
      return null;
    },
  );
  const disposers: Array<() => void> = [];
  const describeListeners = new Set<() => void>();
  let served: string[] = [];
  const ensure = vi.fn(async () => {});
  const describe = {
    getSnapshot: () => ({ view: { namespaces: served.map((ns) => ({ ns })) } }),
    subscribe: (listener: () => void) => {
      describeListeners.add(listener);
      return () => {
        describeListeners.delete(listener);
      };
    },
    ensure,
  };
  // The harness supplies only Cordis fiber plumbing. Declaration, keyed
  // registration, winner election, ordering and notifications use SlotCore.
  const context = {
    slots: Object.assign(slots, {
      inject: (_name: string, callback: () => Generator<() => void>) => {
        for (const dispose of callback()) disposers.push(dispose);
      },
    }),
    settingsScope: { describe: () => describe },
    remote: {
      pluginInventory: {
        list: async () => ({ ok: true, value: { entries: [] } }),
      },
    },
    inject: (_names: string[], callback: (ctx: unknown) => unknown) =>
      Promise.resolve(callback(context)),
  };
  await apply(context as unknown as ClientContext);
  expect(slots.spec("settings.plugins.tab")?.kind).toBe("list");
  expect(slots.spec("settings.plugin.item")?.kind).toBe("keyed");

  function dispatch(
    name: string,
    _owner = {},
    select: { only?: string; entryKey?: string } = {},
  ): ReactNode {
    return slots
      .entriesOfSlot(name)
      .filter(
        (entry) =>
          (select.only === undefined || entry.options.id === select.only) &&
          (select.entryKey === undefined ||
            entry.options.key === select.entryKey),
      )
      .map((entry, index) =>
        createElement(
          entry.component as ComponentType<Record<string, unknown>>,
          {
            key: entry.options.key ?? entry.options.id ?? index,
            ...entry.inject?.(),
            renderSlot: dispatch,
          },
        ),
      );
  }
  render(<>{dispatch("settings.section")}</>);
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(ensure).not.toHaveBeenCalled();

  let disposeCard!: () => void;
  await act(async () => {
    disposeCard = slots.register(
      { name: "settings.plugin.item", key: "external.config" },
      () => <button>Save external config</button>,
    );
  });
  expect(ensure).toHaveBeenCalled();
  expect(screen.queryByRole("tablist")).toBeNull();
  await act(async () => {
    served = ["external.config"];
    for (const listener of describeListeners) listener();
  });
  fireEvent.click(screen.getByRole("tab", { name: "Configuration" }));
  expect(
    screen.getByRole("button", { name: "Save external config" }),
  ).toBeTruthy();

  await act(async () => {
    served = [];
    for (const listener of describeListeners) listener();
  });
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Save external config" }),
  ).toBeNull();
  await act(async () => disposeCard());
  cleanup();
  await waitFor(() => expect(describeListeners.size).toBe(0));
  for (const dispose of disposers.reverse()) dispose();
  expect(slots.spec("settings.plugins.tab")).toBeUndefined();
  expect(slots.spec("settings.plugin.item")).toBeUndefined();
  disposeRoot();
});
