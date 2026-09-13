import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Eye } from "lucide-react";
import { ToolChip } from "../bubble/tool-chip";
import type { ToolProgress } from "@amiba/app-runtime/core";
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
import type { ToolCallOwnerProps, ImageAttachmentRef } from "@amiba/extension-sdk";
import { SemanticToolRow } from "../bubble/semantic-tool-row";
import { ToolImageEvidenceProvider } from "../bubble/tool-image-evidence";

const attachment = { attachmentId: "host-image" as ImageAttachmentRef["attachmentId"], mediaType: "image/png" as const, width: 1, height: 1, bytes: 90 };
const owner: ToolCallOwnerProps = {
  callId: "image-call", toolName: "read_image", openFile: vi.fn(),
  block: { kind: "tool-result", callId: "image-call", seq: 2, time: 200, callTime: 100,
    call: { name: "read_image", argsRaw: "{}" }, isError: false,
    callView: null, resultView: null, subCalls: [], content: [{ type: "image", attachment }],
  },
};
const spec = { icon: Eye, action: "inspect", quietSuccess: true };
const row = (props = owner) => <SemanticToolRow spec={spec} tag="image" owner={props} t={key => key} />;

describe("tool image evidence within the native fold", () => {
  it("preserves the original DOM when no image renderer is registered", () => {
    const baseline = render(row());
    const html = baseline.container.innerHTML;
    baseline.unmount();
    const actual = render(<ToolImageEvidenceProvider callId={owner.callId}>{row()}</ToolImageEvidenceProvider>);
    expect(actual.container.innerHTML).toBe(html);
    expect(screen.getByRole("button", { name: "inspect" })).toBeDisabled();
  });
  it("renders on expansion only and removes the added affordance on unload", () => {
    const gallery = vi.fn(images => <div data-testid="gallery">{images[0].attachment.attachmentId}</div>);
    const view = render(<ToolImageEvidenceProvider callId={owner.callId} render={gallery}>{row()}</ToolImageEvidenceProvider>);
    expect(gallery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "inspect" }));
    expect(screen.getByTestId("gallery")).toHaveTextContent("host-image");
    expect(gallery).toHaveBeenCalledWith([{ attachment }]);
    view.rerender(<ToolImageEvidenceProvider callId={owner.callId}>{row()}</ToolImageEvidenceProvider>);
    expect(screen.queryByTestId("gallery")).toBeNull();
    expect(screen.getByRole("button", { name: "inspect" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "inspect" })).not.toHaveAttribute("aria-expanded");
  });
  it("does not offer a gallery for a different call or a text-only result", () => {
    const gallery = vi.fn(() => <div>unexpected</div>);
    const view = render(<ToolImageEvidenceProvider callId="parent" render={gallery}>{row()}</ToolImageEvidenceProvider>);
    expect(screen.getByRole("button", { name: "inspect" })).toBeDisabled();
    view.rerender(<ToolImageEvidenceProvider callId={owner.callId} render={gallery}>{row({ ...owner, block: { ...owner.block, kind: "tool-result", content: [] } as ToolCallOwnerProps["block"] })}</ToolImageEvidenceProvider>);
    expect(screen.getByRole("button", { name: "inspect" })).toBeDisabled();
    expect(gallery).not.toHaveBeenCalled();
  });
  it("keeps original evidence and controls when the gallery throws", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<ToolImageEvidenceProvider callId={owner.callId} render={() => { throw new Error("gallery unavailable"); }}>
        <SemanticToolRow spec={{ icon: Eye, action: "inspect", evidence: () => <div>original evidence</div> }} tag="image" owner={owner} t={key => key} />
      </ToolImageEvidenceProvider>);
      fireEvent.click(screen.getByRole("button", { name: "inspect" }));
      expect(screen.getByText("original evidence")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "inspect" })).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(screen.getByRole("button", { name: "inspect" }));
      expect(screen.queryByText("original evidence")).toBeNull();
    } finally { errors.mockRestore(); }
  });
  it("recovers a failed gallery replacement without resetting the native fold or evidence", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failing = () => { throw new Error("gallery unavailable"); };
      const native = <SemanticToolRow spec={{ icon: Eye, action: "inspect", evidence: () => <input aria-label="native evidence" defaultValue="original" /> }} tag="image" owner={owner} t={key => key} />;
      const view = render(<ToolImageEvidenceProvider callId={owner.callId} render={failing}>{native}</ToolImageEvidenceProvider>);
      fireEvent.click(screen.getByRole("button", { name: "inspect" }));
      const input = screen.getByRole("textbox", { name: "native evidence" });
      fireEvent.change(input, { target: { value: "retained edit" } });
      const replacement = vi.fn(images => <div data-testid="recovered-gallery">{images[0].attachment.attachmentId}</div>);
      view.rerender(<ToolImageEvidenceProvider callId={owner.callId} render={replacement}>{native}</ToolImageEvidenceProvider>);
      expect(screen.getByTestId("recovered-gallery")).toHaveTextContent("host-image");
      expect(screen.getByRole("textbox", { name: "native evidence" })).toBe(input);
      expect(input).toHaveValue("retained edit");
      expect(screen.getByRole("button", { name: "inspect" })).toHaveAttribute("aria-expanded", "true");
      view.rerender(<ToolImageEvidenceProvider callId={owner.callId}>{native}</ToolImageEvidenceProvider>);
      expect(screen.queryByTestId("recovered-gallery")).toBeNull();
      expect(input).toHaveValue("retained edit");
    } finally { errors.mockRestore(); }
  });
  it("adds image evidence to an unclaimed tool without replacing its original result", () => {
    const event: ToolProgress = { toolCallId: owner.callId, tool: "custom_image_tool", status: "completed", result: { text: "original generic result" }, wire: {
      call: { argsRaw: "{}", turn: 1, step: 1, time: 100, callView: null },
      result: { seq: 2, time: 200, isError: false, resultView: null, content: [{ type: "image", attachment }] },
    } };
    const gallery = vi.fn(() => <div>generic gallery</div>);
    const view = render(<ToolImageEvidenceProvider callId={owner.callId} render={gallery}><ToolChip event={event} /></ToolImageEvidenceProvider>);
    expect(gallery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /custom_image_tool/ }));
    expect(screen.getByText("generic gallery")).toBeInTheDocument();
    expect(screen.getByText("original generic result")).toBeInTheDocument();
    view.rerender(<ToolImageEvidenceProvider callId={owner.callId}><ToolChip event={event} /></ToolImageEvidenceProvider>);
    expect(screen.queryByText("generic gallery")).toBeNull();
    expect(screen.getByText("original generic result")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /custom_image_tool/ })).toHaveAttribute("aria-expanded", "true");
  });
  it("keeps summaries non-interactive and never invokes the gallery there", () => {
    const gallery = vi.fn(() => <div>unexpected</div>);
    render(<ToolImageEvidenceProvider callId={owner.callId} render={gallery}>{row({ ...owner, presentation: "summary" })}</ToolImageEvidenceProvider>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(gallery).not.toHaveBeenCalled();
  });
});
