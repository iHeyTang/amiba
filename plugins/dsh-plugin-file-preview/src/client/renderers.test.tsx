import { afterEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import type { WorkspaceFileDocument } from "@amiba/app-runtime/platform";
import { selectFileRenderer, type FilePreviewRenderer } from "./renderers";
import { defaultFileRenderers, ImagePreview } from "./defaults";
const file: WorkspaceFileDocument = {
  path: "/test.png",
  relativePath: "test.png",
  name: "test.PNG",
  size: 12,
  content: "",
  modifiedAt: 0,
  revision: "1",
  truncated: false,
  binary: true,
  mimeType: "image/png",
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("file renderer selection", () => {
  it("supports image built-ins, unknown binaries, and text fallback", () => {
    expect(selectFileRenderer(defaultFileRenderers, file)?.id).toBe(
      "amiba.image",
    );
    expect(
      selectFileRenderer(defaultFileRenderers, {
        ...file,
        name: "a.bin",
        mimeType: undefined,
      }),
    ).toBeUndefined();
    expect(
      selectFileRenderer(defaultFileRenderers, {
        ...file,
        name: "README",
        mimeType: undefined,
        binary: false,
      })?.id,
    ).toBe("amiba.text");
  });
  it("allows a plugin to add PDF and override built-ins with deterministic priority", () => {
    const pdf: FilePreviewRenderer = {
      id: "pdf",
      order: 0,
      mimeTypes: ["application/pdf"],
      component: () => null,
    };
    expect(
      selectFileRenderer([...defaultFileRenderers, pdf], {
        ...file,
        name: "report.pdf",
        mimeType: "application/pdf",
      }),
    ).toBe(pdf);
    const custom = { ...pdf, id: "custom", extensions: [".PNG"] };
    expect(selectFileRenderer([...defaultFileRenderers, custom], file)).toBe(
      custom,
    );
    expect(selectFileRenderer(defaultFileRenderers, file)?.id).toBe(
      "amiba.image",
    );
  });
});
it("decodes bytes into an image, switches sizing, and revokes the object URL", async () => {
  const create = vi.fn(() => "blob:test");
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  const readBytes = vi
    .fn()
    .mockResolvedValue({ base64: "aGVsbG8=", mimeType: "image/png" });
  const view = render(<ImagePreview document={file} readBytes={readBytes} />);
  const image = await screen.findByRole("img", { name: "test.PNG" });
  expect(image).toHaveAttribute("src", "blob:test");
  expect(readBytes).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button"));
  expect(image.className).toContain("max-w-none");
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:test");
});
it("reports decoding and read failures", async () => {
  const view = render(
    <ImagePreview
      document={file}
      readBytes={() => Promise.reject(new Error("Too large"))}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Too large");
  view.unmount();
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:test",
    revokeObjectURL: vi.fn(),
  });
  render(
    <ImagePreview
      document={file}
      readBytes={async () => ({
        path: file.path,
        size: 5,
        revision: "1",
        base64: "aGVsbG8=",
        mimeType: "image/png",
      })}
    />,
  );
  fireEvent.error(await screen.findByRole("img"));
  expect(screen.getByRole("alert")).toHaveTextContent("Cannot decode");
});
it("does not allocate a URL after unmount while bytes are pending", async () => {
  const create = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  let resolve!: (value: any) => void;
  const view = render(
    <ImagePreview
      document={file}
      readBytes={() =>
        new Promise((done) => {
          resolve = done;
        })
      }
    />,
  );
  view.unmount();
  resolve({ base64: "aA==", mimeType: "image/png" });
  await waitFor(() => expect(create).not.toHaveBeenCalled());
});
