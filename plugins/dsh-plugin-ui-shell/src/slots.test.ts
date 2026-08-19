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
        "amiba.settings.content.overlay",
        "amiba.agentPreset.section",
      ]),
    );
    // Official-equivalent seats use the OFFICIAL names (`settings.section`
    // from dsh-client-ui-settings, `shell.overlay` from dsh-client-ui-layout,
    // `conversation.session.header.utilities` and `conversation.input.model`
    // from dsh-client-ui-conversation) — the amiba.* array must not shadow
    // them, and the retired vendor header seat must stay gone.
    expect(AMIBA_ROOT_SLOTS).not.toContain("amiba.chat.header.after");
    for (const slot of AMIBA_ROOT_SLOTS) {
      expect(slot).toMatch(/^amiba\./u);
    }
  });
});
