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
 * official `renderSlot("amiba.composer.modelPicker", owner)` dispatch —
 * there is no marker component and no DOM slot side-channel anymore.
 *
 * The full `Composer` cannot be mounted under jsdom (pre-existing: its
 * Lexical editor hangs, which is why `ComposerChrome.test.tsx` also asserts
 * against the source), so the wiring is verified at source level, the same
 * way that suite does.
 */
describe("Composer model-picker render prop", () => {
  it("renders the picker node from modelPicker.render with the computed owner props", () => {
    const composer = source("../Composer.tsx");
    // The render call receives the whole owner contract the old marker
    // channel carried: session, draft selection plumbing, the engine-native
    // agentModels pass-through, and picker chrome.
    const renderCall = composer.match(
      /\{modelPicker\s*\?\s*modelPicker\.render\(\{([\s\S]*?)\}\)\s*:\s*null\}/u,
    );
    expect(renderCall).not.toBeNull();
    const ownerProps = renderCall?.[1] ?? "";
    expect(ownerProps).toContain("sessionId: permissionSessionId ?? null");
    expect(ownerProps).toContain("draftSelection: modelPicker.draftSelection");
    expect(ownerProps).toContain(
      "onDraftSelectionChange: modelPicker.onDraftSelectionChange",
    );
    expect(ownerProps).toContain("agentModels: slotAgentModels");
    expect(ownerProps).toContain("disabled");
    expect(ownerProps).toContain("dialogSize: pickerDialogSize");
    expect(ownerProps).toContain("overlayVariant: pickerOverlayVariant");
    expect(ownerProps).toContain("refreshKey: pickerRefreshKey");
  });

  it("degrades inertly: no render prop, no picker, no marker leftovers", () => {
    const composer = source("../Composer.tsx");
    // Optional prop + `: null` branch — a surface that passes nothing
    // (Quick-Ask mounts ChatSurface with no DSH runtime) renders NOTHING
    // where the chip would sit: no placeholder, no reserved space, no crash.
    expect(composer).toContain("modelPicker?: {");
    expect(composer).toMatch(
      /\{modelPicker\s*\?\s*modelPicker\.render\(\{[\s\S]*?\}\)\s*:\s*null\}/u,
    );
    // The marker component and its DOM side-channel are gone for good.
    expect(composer).not.toContain("ComposerModelPickerSlot");
    expect(composer).not.toContain("data-amiba-dsh-slot");
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
    // the host renderer.
    expect(homeView).toContain("render: modelPicker,");
    expect(homeView).toContain("draftSelection: draftModelSelection");
    expect(homeView).toContain(
      "onDraftSelectionChange: setDraftModelSelection",
    );
  });
});
