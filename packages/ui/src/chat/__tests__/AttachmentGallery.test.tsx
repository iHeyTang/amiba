import { fireEvent, render, waitFor } from "@testing-library/react";
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
  it("renders file names and sizes", () => {
    const items: AttachmentGalleryItem[] = [
      {
        kind: "file",
        id: "f1",
        name: "合同.pdf",
        fileKind: "pdf",
        size: 123456,
      },
    ];
    const { container } = render(<AttachmentGallery items={items} />);
    const row = container.querySelector("[data-attachment-gallery]")!;
    expect(row.textContent).toContain("合同.pdf");
    expect(row.textContent).toContain("121 KB");
  });

  it("keeps the same image when a file is added to the row", () => {
    const items: AttachmentGalleryItem[] = [
      { kind: "image", id: "i1", name: "shot.png", size: 1024, thumbUrl: "blob:thumb" },
    ];
    const { container, rerender } = render(<AttachmentGallery items={items} />);
    const img = container.querySelector("img");
    expect(container.textContent).toContain("shot.png");
    expect(container.textContent).toContain("PNG · 1.0 KB");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("blob:thumb");
    expect(img!.getAttribute("alt")).toBe("shot.png");
    rerender(
      <AttachmentGallery
        items={[...items, { kind: "file", id: "f1", name: "brief.pdf" }]}
      />,
    );
    expect(container.querySelector("img")).toBe(img);
    expect(img!.getAttribute("src")).toBe("blob:thumb");
  });

  it("renders multiple images with their filenames", () => {
    const items: AttachmentGalleryItem[] = [
      { kind: "image", id: "i1", name: "a.png", thumbUrl: "blob:a" },
      { kind: "image", id: "i2", name: "b.png", thumbUrl: "blob:b" },
    ];
    const { container } = render(<AttachmentGallery items={items} />);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(
      [...container.querySelectorAll("img")].map((img) => img.alt),
    ).toEqual(["a.png", "b.png"]);
  });

  it("resolves image URLs through an async loader", async () => {
    const loadImage = vi.fn().mockResolvedValue("blob:loaded");
    const items: AttachmentGalleryItem[] = [
      { kind: "image", id: "i1", name: "durable.png", loadImage },
    ];
    const { container } = render(<AttachmentGallery items={items} />);
    await waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        "blob:loaded",
      );
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
    expect(img!.parentElement).toBe(
      container.querySelector("[data-attachment-gallery]"),
    );
  });

  it("respects end alignment", () => {
    const items: AttachmentGalleryItem[] = [
      { kind: "file", id: "f1", name: "a.txt", fileKind: "text" },
    ];
    const { container } = render(
      <AttachmentGallery items={items} align="end" />,
    );
    expect(
      container
        .querySelector("[data-attachment-gallery]")
        ?.getAttribute("data-align"),
    ).toBe("end");
    expect(
      container.querySelector("[data-attachment-gallery]")?.className,
    ).toContain("justify-end");
  });

  it("removes an image without opening its preview or nesting buttons", () => {
    const onRemove = vi.fn();
    const { container, getByRole, queryByRole } = render(
      <AttachmentGallery
        items={[
          {
            kind: "image",
            id: "i1",
            name: "shot.png",
            thumbUrl: "blob:thumb",
            onRemove,
          },
        ]}
      />,
    );
    expect(container.querySelector("button button")).toBeNull();
    fireEvent.click(
      getByRole("button", { name: "sidepanel.attachment.removeAria" }),
    );
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(queryByRole("dialog")).toBeNull();
    fireEvent.click(getByRole("button", { name: "shot.png" }));
    expect(getByRole("dialog")).toBeInTheDocument();
  });

  it("updates a draft thumbnail without keeping the previous URL", () => {
    const item: AttachmentGalleryItem = {
      kind: "image",
      id: "i1",
      thumbUrl: "blob:before",
    };
    const { container, rerender } = render(
      <AttachmentGallery items={[item]} />,
    );
    rerender(
      <AttachmentGallery items={[{ ...item, thumbUrl: "blob:after" }]} />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:after",
    );
  });

  it("returns null for an empty item list", () => {
    const { container } = render(<AttachmentGallery items={[]} />);
    expect(container.querySelector("[data-attachment-gallery]")).toBeNull();
  });
});

describe("MessageImagesGallery (default conversation.message.images occupant)", () => {
  const ref = (id: string) => ({
    attachment: {
      attachmentId:
        id as import("@amiba/extension-sdk").ImageAttachmentRef["attachmentId"],
      mediaType: "image/png" as const,
      bytes: 1024,
      name: `${id}.png`,
      width: 1,
      height: 1,
    },
  });

  it("resolves a lone durable image through the seat", async () => {
    const owner: MessageImagesOwner = {
      images: [ref("one")],
      loadImage: vi.fn().mockResolvedValue("blob:one"),
    };
    const { container } = render(<MessageImagesGallery owner={owner} />);
    const img = await waitFor(() => {
      const el = container.querySelector("img");
      expect(el?.getAttribute("src")).toBe("blob:one");
      return el!;
    });
    expect(img.getAttribute("src")).toBe("blob:one");
    expect(container.textContent).toContain("one.png");
    expect(container.textContent).toContain("PNG · 1.0 KB");
  });

  it("resolves multiple image references without confusing fallback icons for thumbnails", async () => {
    const loadImage = vi.fn().mockResolvedValue("blob:loaded");
    const owner: MessageImagesOwner = {
      images: [ref("a"), ref("b")],
      loadImage,
    };
    const { container } = render(<MessageImagesGallery owner={owner} />);
    const imgs = await waitFor(() => {
      const els = container.querySelectorAll('img[src="blob:loaded"]');
      expect(els).toHaveLength(2);
      return els;
    });
    expect(imgs[0]!.getAttribute("src")).toBe("blob:loaded");
    expect(loadImage).toHaveBeenCalledTimes(2);
  });
});
