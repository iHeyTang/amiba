import { describe, expect, it } from "vitest";
import { imageMediaTypeOf } from "./tools.js";

const bytes = (...values: number[]) => Uint8Array.from(values);
const padded = (head: number[], length = 16) =>
  Uint8Array.from([...head, ...new Array(Math.max(0, length - head.length)).fill(0)]);

describe("imageMediaTypeOf", () => {
  it("detects PNG from its signature", () => {
    expect(imageMediaTypeOf(padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
  });

  it("detects JPEG from its marker", () => {
    expect(imageMediaTypeOf(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  });

  it("detects WebP only when both RIFF and WEBP are present", () => {
    const webp = padded([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(imageMediaTypeOf(webp)).toBe("image/webp");
    const notWebp = padded([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49]);
    expect(imageMediaTypeOf(notWebp)).toBeUndefined();
  });

  it("detects GIF from its header", () => {
    expect(imageMediaTypeOf(padded([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
  });

  it("refuses a file whose name lies about its content", () => {
    expect(imageMediaTypeOf(new TextEncoder().encode("<!doctype html>"))).toBeUndefined();
  });

  it("refuses a truncated header", () => {
    expect(imageMediaTypeOf(bytes(0x89, 0x50))).toBeUndefined();
  });
});
