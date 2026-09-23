import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import { describe, expect, it } from "vitest";

import { AMIBA_ROOT_SLOTS } from "@amiba/extension-sdk";

describe("Amiba root slot contract", () => {
  it("publishes unique amiba.* vendor slots and leaves official seats to the official vocabulary", () => {
    expect(new Set(AMIBA_ROOT_SLOTS).size).toBe(AMIBA_ROOT_SLOTS.length);
    // amiba.agentPreset.section stays in the public vocabulary although its
    // runtime declaration lives on dsh-plugin-agent-preset's section entry.
    expect(AMIBA_ROOT_SLOTS).toEqual(
      expect.arrayContaining([
        "amiba.workspace.navigation",
        "amiba.workspace.view",
        "amiba.agentPreset.section",
        "amiba.conversation.question",
      ]),
    );
    // Official-equivalent seats use the OFFICIAL names (`settings.section`
    // from dsh-client-ui-settings, `shell.overlay` from dsh-client-ui-layout,
    // the four adopted conversation.* seats — header utilities, header
    // actions, input.model, input.plan — from dsh-client-ui-conversation, and
    // conversation.input.overlay from dsh-client-ui-input-trigger).
    // The amiba.* array must not shadow any of them, and the retired vendor
    // header seat must stay gone.
    expect(AMIBA_ROOT_SLOTS).not.toContain("amiba.chat.header.after");
    for (const official of [
      "conversation.session.header.utilities",
      "conversation.session.header.actions",
      "conversation.input.model",
      "conversation.input.plan",
      "conversation.input.overlay",
    ]) {
      expect(AMIBA_ROOT_SLOTS).not.toContain(`amiba.${official}`);
      expect(AMIBA_ROOT_SLOTS).not.toContain(official);
    }
    for (const slot of AMIBA_ROOT_SLOTS) {
      expect(slot).toMatch(/^amiba\./u);
    }
  });
});

it("empty-state visual lists candidates and supports unloading", async () => {
  const { SlotCore } = await import("@deepseek-ai/dsh-client-ui-slots");
  const core = new SlotCore();
  const root = core.register({ name: "root", children: {
    "amiba.emptyState.visual": { kind: "list", scope: "root" },
  } }, ({ renderSlot }: PropsRenderSlots<"amiba.emptyState.visual">) => { void renderSlot; return null; });
  const dispose = core.register({ name: "amiba.emptyState.visual", id: "one" }, ({ defaultVisual }) => defaultVisual);
  expect(core.entriesOfSlot("amiba.emptyState.visual")).toHaveLength(1);
  const second = core.register({ name: "amiba.emptyState.visual", id: "two" }, () => null);
  expect(core.entriesOfSlot("amiba.emptyState.visual")).toHaveLength(2);
  second();
  dispose();
  expect(core.entriesOfSlot("amiba.emptyState.visual")).toHaveLength(0);
  root();
});
