import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import {
  AttachmentGallery,
  MessageImagesGallery,
  type AttachmentGalleryItem,
  type MessageImagesOwner,
} from "../attachment-gallery";

describe("AttachmentGallery", () => {
  it("renders file items as compact chips", () => {
    const items: AttachmentGalleryItem[] = [
      { kind: "file", id: "f1", name: "合同.pdf", fileKind: "pdf", size: 123456 },
    ];
    const { container } = render(<AttachmentGallery items={items} />);
    const row = container.querySelector("[data-attachment-gallery]")!;
    expect(row.textContent).toContain("合同.pdf");
    expect(row.textContent).toContain("121 KB");
  });

  it("renders a lone image as a bounded preview tile", () => {
    const items: AttachmentGalleryItem[] = [
      { kind: "image", id: "i1", name: "shot.png", thumbUrl: "blob:thumb" },
    ];
    const { container } = render(<AttachmentGallery items={items} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("blob:thumb");
    expect(img!.getAttribute("alt")).toBe("shot.png");
    // One image: the large (bounded) variant, not the small tile.
    expect(container.querySelector("[data-attachment-gallery] span")?.className).toContain("h-32");
  });

  it("renders multiple images as uniform compact tiles", () => {
    const items: AttachmentGalleryItem[] = [
      { kind: "image", id: "i1", name: "a.png", thumbUrl: "blob:a" },
      { kind: "image", id: "i2", name: "b.png", thumbUrl: "blob:b" },
    ];
    const { container } = render(<AttachmentGallery items={items} />);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector("[data-attachment-gallery] span")?.className).toContain("h-16");
  });

  it("resolves image URLs through an async loader", async () => {
    const loadImage = vi.fn().mockResolvedValue("blob:loaded");
    const items: AttachmentGalleryItem[] = [
      { kind: "image", id: "i1", name: "durable.png", loadImage },
    ];
    const { container } = render(<AttachmentGallery items={items} />);
    await waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:loaded");
    });
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it("places an already-rendered image node verbatim (seat output)", () => {
    const items: AttachmentGalleryItem[] = [
      { kind: "image", id: "i1", node: <img src="blob:seat" alt="seat" /> },
      { kind: "file", id: "f1", name: "a.txt", fileKind: "text" },
    ];
    const { container } = render(<AttachmentGallery items={items} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("blob:seat");
    // The pre-rendered node is not re-wrapped in a tile frame.
    expect(container.querySelector("[data-attachment-gallery] span[class*=h-32]")).toBeNull();
    expect(container.querySelector("[data-attachment-gallery] span[class*=h-16]")).toBeNull();
  });

  it("respects end alignment", () => {
    const items: AttachmentGalleryItem[] = [
      { kind: "file", id: "f1", name: "a.txt", fileKind: "text" },
    ];
    const { container } = render(<AttachmentGallery items={items} align="end" />);
    expect(container.querySelector("[data-attachment-gallery]")?.getAttribute("data-align")).toBe("end");
    expect(container.querySelector("[data-attachment-gallery]")?.className).toContain("justify-end");
  });

  it("returns null for an empty item list", () => {
    const { container } = render(<AttachmentGallery items={[]} />);
    expect(container.querySelector("[data-attachment-gallery]")).toBeNull();
  });
});

describe("MessageImagesGallery (default conversation.message.images occupant)", () => {
  const ref = (id: string) => ({
    attachment: {
      attachmentId: id as import("@amiba/extension-sdk").ImageAttachmentRef["attachmentId"],
      mediaType: "image/png" as const,
      bytes: 1,
      width: 1,
      height: 1,
    },
  });

  it("renders a lone image as the larger bounded tile", async () => {
    const owner: MessageImagesOwner = {
      images: [ref("one")],
      loadImage: vi.fn().mockResolvedValue("blob:one"),
    };
    const { container } = render(<MessageImagesGallery owner={owner} />);
    const img = await waitFor(() => {
      const el = container.querySelector("img");
      expect(el).not.toBeNull();
      return el!;
    });
    // The tile frame spans the image: lone → larger bounded preview.
    expect(img.closest("span")?.className).toContain("h-32");
  });

  it("renders several images as compact tiles", async () => {
    const loadImage = vi.fn().mockResolvedValue("blob:loaded");
    const owner: MessageImagesOwner = {
      images: [ref("a"), ref("b")],
      loadImage,
    };
    const { container } = render(<MessageImagesGallery owner={owner} />);
    const imgs = await waitFor(() => {
      const els = container.querySelectorAll("img");
      expect(els).toHaveLength(2);
      return els;
    });
    expect(imgs[0]!.closest("span")?.className).toContain("h-16");
    expect(loadImage).toHaveBeenCalledTimes(2);
  });
});