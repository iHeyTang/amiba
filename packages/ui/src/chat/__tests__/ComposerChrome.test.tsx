import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { AttachmentButton } from "../useComposerAttachments";
import { MicrophoneButton } from "../useVoiceRecorder";

describe("composer chrome", () => {
  it("starts with a two-line writing surface", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const composerSource = readFileSync(
      resolve(here, "../Composer.tsx"),
      "utf8",
    );

    expect(composerSource).toContain(': "min-h-[3.75rem] px-3 py-2.5"');
  });

  it("does not embed prompt-template quick actions", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const composerSource = readFileSync(
      resolve(here, "../Composer.tsx"),
      "utf8",
    );

    expect(composerSource).not.toContain("quickActions");
    expect(composerSource).not.toContain("ComposerQuickActions");
    expect(composerSource).not.toContain("QuickActionChips");
  });

  it("keeps floating notices outside composer layout flow", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const composerSource = readFileSync(
      resolve(here, "../Composer.tsx"),
      "utf8",
    );

    expect(composerSource).toContain(
      'className="pointer-events-none absolute inset-x-2 top-full',
    );
  });

  it("uses quiet borderless attachment and voice controls", () => {
    const { rerender } = render(<AttachmentButton onClick={() => {}} />);

    const attachment = screen.getByRole("button", {
      name: "sidepanel.attach",
    });
    expect(attachment).toHaveClass(
      "h-7",
      "w-7",
      "rounded-full",
      "hover:bg-muted/60",
    );
    expect(attachment).not.toHaveClass("border");
    expect(attachment.querySelector("svg")).toHaveClass("lucide-plus");

    rerender(<MicrophoneButton recording={false} onClick={() => {}} />);

    const microphone = screen.getByRole("button", {
      name: "composer.voice.startRecording",
    });
    expect(microphone).toHaveClass(
      "h-7",
      "w-7",
      "rounded-full",
      "hover:bg-muted/60",
    );
    expect(microphone).not.toHaveClass("border");
  });
});
