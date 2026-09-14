import { expect, it, vi } from "vitest";
import {
  SlotCore,
  type PropsRenderSlots,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import { apply } from "./index.js";
it("declares extension slots once, accepts contributed steps, and removes them on unload", () => {
  const core = new SlotCore();
  const root = core.register(
    {
      name: "root",
      children: {
        "shell.overlay": { kind: "list", scope: "root" },
        "settings.onboarding": { kind: "list", scope: "root" },
        "settings.section": { kind: "list", scope: "root" },
      },
    },
    ({
      renderSlot,
    }: PropsRenderSlots<
      "shell.overlay" | "settings.onboarding" | "settings.section"
    >) => {
      void renderSlot;
      return null;
    },
  );
  const ctx = {
    slots: {
      register: core.register.bind(core),
      getVersion: core.getVersion.bind(core),
      entriesOfSlot: core.entriesOfSlot.bind(core),
      subscribe: core.subscribe.bind(core),
      inject: (_name: string, fn: () => () => void) => fn(),
    },
    get: () => ({ api: {} }),
    layout: { openSettings: vi.fn() },
  };
  const off = apply(ctx as unknown as ClientContext);
  const extra = core.register(
    { name: "amiba.onboarding.step", id: "third-party", order: 20 },
    () => null,
  );
  expect(core.entriesOfSlot("amiba.onboarding.step")).toHaveLength(1);
  expect(core.entriesOfSlot("settings.onboarding")).toHaveLength(1);
  off();
  extra();
  expect(core.entriesOfSlot("amiba.onboarding.step")).toHaveLength(0);
  expect(core.entriesOfSlot("shell.overlay")).toHaveLength(0);
  root();
});
