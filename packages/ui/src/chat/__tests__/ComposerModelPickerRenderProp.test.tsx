import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function source(relative: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(here, relative), "utf8");
}

/**
 * The composer's model picker rides a render prop backed by the host's
 * official renderSlot dispatch, seat-split per render: the official
 * session-scoped `conversation.input.model` while the composer has a
 * session id (owner `{ locked }` only — engine data is the occupant's own
 * wire concern), the vendor session-less `amiba.composer.modelPicker` hero
 * seat otherwise.
 *
 * The full `Composer` cannot be mounted under jsdom (pre-existing: its
 * Lexical editor hangs, which is why `ComposerChrome.test.tsx` also asserts
 * against the source), so the wiring is verified at source level, the same
 * way that suite does.
 */
describe("Composer model-picker render prop", () => {
  it("dispatches the official session seat with the locked-only owner share", () => {
    const composer = source("../Composer.tsx");
    const sessionCall = composer.match(
      /permissionSessionId\s*\?\s*modelPicker\.render\(\{([\s\S]*?)\}\)/u,
    );
    expect(sessionCall).not.toBeNull();
    const sessionRequest = sessionCall?.[1] ?? "";
    expect(sessionRequest).toContain('seat: "session"');
    expect(sessionRequest).toContain("owner: { locked: disabled }");
    // The retired owner members must not ride the official seat.
    expect(sessionRequest).not.toContain("agentModels");
    expect(sessionRequest).not.toContain("sessionId:");
  });

  it("dispatches the hero seat with the draft owner share while session-less", () => {
    const composer = source("../Composer.tsx");
    const heroCall = composer.match(
      /modelPicker\.render\(\{\s*seat: "hero",\s*owner: \{([\s\S]*?)\},\s*\}\)/u,
    );
    expect(heroCall).not.toBeNull();
    const heroOwner = heroCall?.[1] ?? "";
    expect(heroOwner).toContain("draftSelection: modelPicker.draftSelection");
    expect(heroOwner).toContain(
      "onDraftSelectionChange: modelPicker.onDraftSelectionChange",
    );
    expect(heroOwner).toContain("disabled");
    expect(heroOwner).toContain("dialogSize: pickerDialogSize");
    expect(heroOwner).toContain("overlayVariant: pickerOverlayVariant");
    expect(heroOwner).toContain("refreshKey: pickerRefreshKey");
    // Engine data is no longer an owner concern on either seat.
    expect(heroOwner).not.toContain("agentModels");
  });

  it("degrades inertly: no render prop, no picker, no marker leftovers", () => {
    const composer = source("../Composer.tsx");
    // Optional prop + `: null` branch — a surface that passes nothing
    // (Quick-Ask mounts ChatSurface with no DSH runtime) renders NOTHING
    // where the chip would sit: no placeholder, no reserved space, no crash.
    expect(composer).toContain("modelPicker?: {");
    expect(composer).toMatch(/\{modelPicker\s*\?[\s\S]*?:\s*null\}/u);
    // The marker component and its DOM side-channel are gone for good, and
    // the retired host-wired engine pass-through must not come back.
    expect(composer).not.toContain("ComposerModelPickerSlot");
    expect(composer).not.toContain("data-amiba-dsh-slot");
    expect(composer).not.toContain("slotAgentModels");
  });

  it("threads the render prop host-side: ChatSurface slots and HomeView draft state", () => {
    const chatSurface = source("../ChatSurface.tsx");
    // ChatSurface forwards slots.modelPicker verbatim; absent renderer →
    // undefined prop → Composer's inert branch.
    expect(chatSurface).toMatch(
      /slots\?\.modelPicker \? \{ render: slots\.modelPicker \} : undefined/u,
    );
    const homeView = source("../../home/HomeView.tsx");
    // HomeView keeps its pre-session draft-selection state and joins it to
    // the host renderer (its composer is session-less, so its requests
    // always land on the hero seat).
    expect(homeView).toContain("render: modelPicker,");
    expect(homeView).toContain("draftSelection: draftModelSelection");
    expect(homeView).toContain(
      "onDraftSelectionChange: setDraftModelSelection",
    );
  });
});
