import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ComposerModelPickerSlot } from "../ComposerModelPickerSlot";

const noopAgentModels = {
  directory: async () => null,
  select: async (_sessionId: string, selection: never) => ({
    selected: selection,
  }),
};

function composerSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(here, "../Composer.tsx"), "utf8");
}

/**
 * The composer no longer owns a model picker: it mounts the generic
 * `amiba.composer.modelPicker` slot marker and the model-plane plugin
 * contributes the actual chip. Outside a DSH plugin runtime (or with no
 * contribution registered) the marker must render NOTHING — no placeholder,
 * no crash — where the chip used to be.
 *
 * The marker component is mounted directly here; the full `Composer` cannot
 * be mounted under jsdom (pre-existing: its Lexical editor hangs, which is
 * why `ComposerChrome.test.tsx` also asserts against the source), so the
 * Composer-side wiring is verified at source level, the same way that suite
 * does.
 */
describe("Composer model-picker slot", () => {
  it("renders an empty generic slot marker when nothing contributes", () => {
    const { container } = render(
      <ComposerModelPickerSlot
        sessionId={null}
        agentModels={noopAgentModels}
      />,
    );

    const marker = container.querySelector(
      '[data-amiba-dsh-slot="amiba.composer.modelPicker"]',
    );
    expect(marker).not.toBeNull();
    // Empty and layout-inert: no children, `display: contents` box.
    expect(marker?.childElementCount).toBe(0);
    expect(marker?.className).toContain("contents");
    expect(marker?.getAttribute("data-amiba-dsh-slot-instance")).toBeTruthy();
    // No picker chip of its own — the marker contributes zero UI.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("mirrors picker state into the marker's serialized attribute", () => {
    const { container, rerender } = render(
      <ComposerModelPickerSlot
        sessionId="session-9"
        agentModels={noopAgentModels}
        draftSelection={{ provider: "deepseek", model: "model-a" }}
      />,
    );

    const marker = container.querySelector(
      '[data-amiba-dsh-slot="amiba.composer.modelPicker"]',
    );
    const state = JSON.parse(
      marker?.getAttribute("data-amiba-dsh-model-picker-state") ?? "{}",
    ) as Record<string, unknown>;
    expect(state.sessionId).toBe("session-9");
    expect(state.draftSelection).toEqual({
      provider: "deepseek",
      model: "model-a",
    });

    // A draft change re-serializes, so the ui-shell's MutationObserver
    // notices and re-renders the portal with a fresh owner snapshot.
    rerender(
      <ComposerModelPickerSlot
        sessionId="session-9"
        agentModels={noopAgentModels}
        draftSelection={{ provider: "deepseek", model: "model-b" }}
      />,
    );
    const next = JSON.parse(
      marker?.getAttribute("data-amiba-dsh-model-picker-state") ?? "{}",
    ) as Record<string, unknown>;
    expect(next.draftSelection).toEqual({
      provider: "deepseek",
      model: "model-b",
    });
  });

  it("exposes the full owner props (functions included) via the marker property getter", () => {
    const onDraftSelectionChange = () => {};
    const { container } = render(
      <ComposerModelPickerSlot
        sessionId={null}
        agentModels={noopAgentModels}
        onDraftSelectionChange={onDraftSelectionChange}
      />,
    );

    const marker = container.querySelector(
      '[data-amiba-dsh-slot="amiba.composer.modelPicker"]',
    ) as HTMLElement & {
      __amibaComposerModelPickerProps?: () => Record<string, unknown>;
    };
    const props = marker.__amibaComposerModelPickerProps?.();
    expect(props?.sessionId).toBeNull();
    expect(props?.agentModels).toBe(noopAgentModels);
    expect(props?.onDraftSelectionChange).toBe(onDraftSelectionChange);
  });

  it("is what Composer mounts where the host-owned picker used to render", () => {
    const source = composerSource();
    expect(source).toContain("<ComposerModelPickerSlot");
    expect(source).toContain(
      'import { ComposerModelPickerSlot } from "./ComposerModelPickerSlot"',
    );
    // The plane-coupled picker import is gone from the composer.
    expect(source).not.toContain("ComposerModelPicker from");
    expect(source).not.toContain('from "./ComposerModelPicker"');
    // The slot only mounts when the surface opts into a model picker.
    expect(source).toMatch(/\{modelPicker \? \(\s*<ComposerModelPickerSlot/);
  });
});
