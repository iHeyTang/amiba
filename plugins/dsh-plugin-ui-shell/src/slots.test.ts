import { describe, expect, it } from "vitest";

import { AMIBA_ROOT_SLOTS } from "@amiba/extension-sdk";

describe("Amiba root slot contract", () => {
  it("publishes unique semantic children for navigation, workspaces, chat, settings, and overlays", () => {
    expect(new Set(AMIBA_ROOT_SLOTS).size).toBe(AMIBA_ROOT_SLOTS.length);
    expect(AMIBA_ROOT_SLOTS).toEqual(
      expect.arrayContaining([
        "amiba.workspace.navigation",
        "amiba.workspace.view",
        "amiba.chat.header.after",
        "amiba.settings.section",
        "amiba.shell.overlay",
      ]),
    );
  });
});
