import { open } from "node:fs/promises";
import { basename, extname } from "node:path";

export const MAX_FILE_VIEW_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_BINARY_BYTES = 32 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
};
/** Caller resolves the session path through workspaceManager before either read. */
export async function readPreviewFile(
  resolved: { path: string; relativePath: string },
  raw = false,
) {
  const handle = await open(resolved.path, "r");
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile())
      throw new Error("The selected workspace resource is not a file.");
    if (raw && fileStat.size > MAX_FILE_BINARY_BYTES)
      throw new Error("File exceeds the 32 MB preview limit.");
    const limit = raw ? MAX_FILE_BINARY_BYTES : MAX_FILE_VIEW_BYTES;
    const length = Math.min(fileStat.size, limit);
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const content = buffer.subarray(0, offset);
    const mimeType = MIME[extname(resolved.path).toLowerCase()];
    const binary =
      content.subarray(0, 8192).includes(0) ||
      Boolean(mimeType && mimeType !== "image/svg+xml");
    const metadata = {
      path: resolved.path,
      relativePath: resolved.relativePath,
      name: basename(resolved.path),
      size: fileStat.size,
      modifiedAt: fileStat.mtimeMs,
      revision: `${fileStat.mtimeMs}:${fileStat.size}`,
      mimeType,
    };
    if (raw) {
      if (offset !== fileStat.size)
        throw new Error("File changed while reading. Please retry.");
      return { ...metadata, base64: content.toString("base64") };
    }
    return {
      ...metadata,
      content: binary ? "" : content.toString("utf8"),
      binary,
      truncated: fileStat.size > MAX_FILE_VIEW_BYTES,
    };
  } finally {
    await handle.close();
  }
}
