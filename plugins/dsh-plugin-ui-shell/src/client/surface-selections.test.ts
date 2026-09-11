import { expect, it } from "vitest";
import {
  SlotCore,
  type PropsRenderSlots,
} from "@deepseek-ai/dsh-client-ui-slots";
import { createSurfaceSelections } from "./surface-selections.js";
import type { StorageAdapter } from "@amiba/app-runtime/platform";

it("persists explicit selection, keeps missing choices and restores candidates after reload", async () => {
  const core = new SlotCore();
  core.register(
    {
      name: "root",
      children: {
        "amiba.emptyState.visual": { kind: "list", scope: "root" },
        "amiba.composer.accessory": { kind: "list", scope: "root" },
        "amiba.message.decoration": { kind: "list", scope: "root" },
      },
    },
    ({
      renderSlot,
    }: PropsRenderSlots<
      | "amiba.emptyState.visual"
      | "amiba.composer.accessory"
      | "amiba.message.decoration"
    >) => {
      void renderSlot;
      return null;
    },
  );
  let saved: Record<string, unknown> = {};
  const storage = {
    get: async () => saved,
    set: async (value: Record<string, unknown>) => {
      saved = value;
    },
  } as StorageAdapter;
  const state = createSurfaceSelections(core, storage);
  const a = core.register(
      { name: "amiba.emptyState.visual", id: "a", label: "A" },
      () => null,
    ),
    b = core.register(
      { name: "amiba.emptyState.visual", id: "b", label: "B" },
      () => null,
    );
  await state.set("amiba.emptyState.visual", "b");
  expect(state.getSnapshot().choices["amiba.emptyState.visual"]).toBe("b");
  b();
  expect(
    state.getSnapshot().rows["amiba.emptyState.visual"].map((r) => r.id),
  ).toEqual(["a"]);
  expect(state.getSnapshot().choices["amiba.emptyState.visual"]).toBe("b");
  const reloaded = createSurfaceSelections(core, storage);
  await reloaded.set("amiba.composer.accessory", "");
  expect(reloaded.getSnapshot().choices["amiba.emptyState.visual"]).toBe("b");
  await reloaded.set("amiba.emptyState.visual", "");
  expect(
    reloaded.getSnapshot().choices["amiba.emptyState.visual"],
  ).toBeUndefined();
  a();
});
it("reports failed writes without applying an unpersisted selection", async () => {
  const core = new SlotCore();
  const state = createSurfaceSelections(core, {
    get: async () => ({}),
    set: async () => {
      throw new Error("disk full");
    },
  } as unknown as StorageAdapter);
  await expect(state.set("amiba.emptyState.visual", "x")).rejects.toThrow(
    "disk full",
  );
  expect(state.getSnapshot().choices).toEqual({});
  expect(state.getSnapshot().error).toContain("disk full");
});
