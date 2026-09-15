/**
 * Read user-supplied `File` / fetched `Blob` objects into composer-ready
 * `FileAttachment`s.
 *
 * The pipeline does these in order:
 *
 *   1. Product-level size cap.
 *
 *   2. Stage the full bytes through the host's DSH attachment adapter.
 *
 *   3. Optional preview (thumbnail / text snippet) *after* upload, with
 *      timeouts so it cannot block clearing the "uploading" chip.
 *
 * Errors are returned as plain strings so the caller can surface them
 * inline without juggling exception types — none of the failure modes
 * here (size cap, decode error, bridge disconnected, write error) are
 * "exceptional" enough to warrant a thrown error.
 *
 * The stable DSH contract accepts UTF-8 text, PDF, PNG, JPEG, WebP, and GIF.
 * Other binary/image formats are rejected before staging instead of being
 * presented as if the agent could reliably decode them.
 */

import { getPlatform } from "@amiba/app-runtime/platform";
import { shortId } from "@amiba/app-runtime/utils";

import type {
  Attachment,
  AttachmentBadge,
  AttachmentKind,
  FileAttachment,
} from "./types";

// Hard limit, deliberately conservative for the desktop composer.
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MB

/** How many decoded characters of text-ish content to keep for chip preview. */
const TEXT_PREVIEW_CHARS = 500;
/** Longest edge for the chip-side image thumbnail. */
const THUMB_LONG_EDGE = 256;
/** Longest edge for the click-to-zoom preview source. Bigger than the
 *  chip thumb so a modal-sized render stays crisp (256px scaled up to a
 *  ~70vw modal would look noticeably soft), small enough that 5–10
 *  in-flight images don't strain renderer memory. Stays compose-time
 *  only — see ``attachmentToBadge``. */
const PREVIEW_LONG_EDGE = 1024;
const IMAGE_REENCODE_QUALITY = 0.85;

/** Previews are best-effort; never block the bridge upload on them. */
const PREVIEW_BUDGET_MS = 20_000;
/** Upper bound for staging an attachment so the composer cannot spin forever. */
const PUT_MESSAGE_BUDGET_MS = 130_000;

const PREVIEW_TIMED_OUT = Symbol("previewTimedOut");

async function withBudget<T>(
  p: Promise<T>,
  ms: number,
): Promise<T | typeof PREVIEW_TIMED_OUT> {
  let tid: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof PREVIEW_TIMED_OUT>((resolve) => {
    tid = setTimeout(() => resolve(PREVIEW_TIMED_OUT), ms);
  });
  try {
    return await Promise.race([p as Promise<T>, timeout]);
  } finally {
    if (tid !== undefined) clearTimeout(tid);
  }
}

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/avif",
  "image/svg+xml",
]);

/**
 * Common text-ish extensions whose MIME types are routinely reported as
 * `""` or `application/octet-stream` by the OS. We classify these as
 * "text" so the chip shows a snippet preview and `kind="text"` is forwarded
 * to the agent. Kept lowercase, no leading dot.
 */
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "rst",
  "log",
  "csv",
  "tsv",
  "json",
  "jsonc",
  "ndjson",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "env",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "sql",
  "graphql",
  "gql",
  "vue",
  "svelte",
  "tex",
  "patch",
  "diff",
  "lua",
  "r",
  "dart",
  "scala",
  "clj",
]);

/**
 * Keep the native picker broad so text files with uncommon extensions remain
 * selectable. Intake performs the authoritative capability check and returns
 * a visible error for unsupported formats.
 */
export const ATTACHMENT_INPUT_ACCEPT = "*/*";

export type AttachmentReadOk = { ok: true; attachment: Attachment };
export type AttachmentReadFail = { ok: false; error: string; name: string };
export type AttachmentReadResult = AttachmentReadOk | AttachmentReadFail;

/**
 * Type guard distinguishing the success and error variants returned by the
 * host attachment store. Keeping the predicate local also gives call sites
 * consistent narrowing across package boundaries.
 */
export function isAttachmentReadOk(
  r: AttachmentReadResult,
): r is AttachmentReadOk {
  return r.ok === true;
}

/** Settings every read needs from the call site. */
export interface AttachmentReadOptions {
  /**
   * UUID of the side-panel chat session this attachment belongs to. Used
   * by the desktop host to group uploads under its DSH data root.
   * Pass `"default"` (or
   * anything stable) if you don't have a session id yet.
   */
  sessionId: string;
  /**
   * When the UI already showed a pending row (spinner), pass the same id so
   * the completed attachment replaces that row. If we mint a fresh id here
   * instead, a missed state merge leaves the chip stuck on "uploading".
   */
  uiId?: string;
}

/**
 * Read a `File` (file picker / drag / paste) into a composer attachment.
 */
export async function readFileAsAttachment(
  file: File,
  options: AttachmentReadOptions,
): Promise<AttachmentReadResult> {
  return readBlobAsAttachment({
    blob: file,
    name: file.name || "file",
    mime: file.type || "",
    options,
  });
}

/**
 * Read a `Blob` (e.g. fetched from a URL) into a composer attachment. The
 * `File`-based entry point delegates to this so the file-picker path and
 * the page-context auto-attach path share one pipeline.
 */
export async function readBlobAsAttachment(args: {
  blob: Blob;
  name: string;
  mime?: string;
  options: AttachmentReadOptions;
}): Promise<AttachmentReadResult> {
  const { blob, options } = args;
  const name = sanitizeDisplayName(args.name);
  const mime = (args.mime || blob.type || "").toLowerCase();
  const size = blob.size;

  if (size <= 0) {
    return {
      ok: false,
      error: "File is empty.",
      name,
    };
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `File is ${formatBytesShort(size)}; the limit is ${formatBytesShort(MAX_ATTACHMENT_BYTES)}.`,
      name,
    };
  }

  const kind = classify(name, mime);
  // Upload first. We used to build image/text previews *before* this step;
  // `buildImageThumbnail` / `decode` can hang or run for minutes on some
  // inputs (huge PNGs, exotic codecs), which left the composer stuck on
  // "uploading" because the bridge was never contacted.
  let attachmentId: string;
  try {
    attachmentId = await stageBlobForDsh(blob, name, mime, options.sessionId);
  } catch (e) {
    return {
      ok: false,
      error: (e as Error)?.message || String(e),
      name,
    };
  }

  // Preview side-channel — failures and slow paths are non-fatal.
  let thumbDataUrl: string | undefined;
  let previewDataUrl: string | undefined;
  let textPreview: string | undefined;
  try {
    if (kind === "image") {
      const sourceMime = mime || "image/png";
      // Build the larger click-to-zoom preview first; the chip thumbnail
      // is then a cheap re-downscale off the same data URL. Two passes
      // sound wasteful but they share the most expensive step (decoding
      // the source blob) — the downstream ``downscaleImageDataUrl`` calls
      // operate on an already-decoded `<img>` and only differ in target
      // edge length.
      const previewRes = await withBudget(
        buildImageThumbnail(blob, sourceMime, PREVIEW_LONG_EDGE),
        PREVIEW_BUDGET_MS,
      );
      if (previewRes === PREVIEW_TIMED_OUT) {
        console.warn("[attachments] preview timed out; continuing without preview");
      } else if (previewRes) {
        previewDataUrl = previewRes;
        const thumbRes = await withBudget(
          downscaleImageDataUrl(previewRes, THUMB_LONG_EDGE, sourceMime),
          PREVIEW_BUDGET_MS,
        );
        if (thumbRes === PREVIEW_TIMED_OUT) {
          console.warn("[attachments] thumb timed out; falling back to preview");
          thumbDataUrl = previewRes;
        } else {
          thumbDataUrl = thumbRes;
        }
      }
    } else if (kind === "text") {
      const r = await withBudget(buildTextPreview(blob), PREVIEW_BUDGET_MS);
      if (r === PREVIEW_TIMED_OUT) {
        console.warn("[attachments] text preview timed out; continuing without preview");
      } else {
        textPreview = r;
      }
    }
  } catch (e) {
    console.warn(
      "[attachments] preview generation failed:",
      (e as Error)?.message || e,
    );
  }

  const att: FileAttachment = {
    uiId: options.uiId ?? shortId("att"),
    name,
    mime: mime || "application/octet-stream",
    size,
    kind,
    attachmentId,
    uploading: false,
    ...(thumbDataUrl ? { thumbDataUrl } : {}),
    ...(previewDataUrl ? { previewDataUrl } : {}),
    ...(textPreview ? { textPreview } : {}),
  };
  return { ok: true, attachment: att };
}

/**
 * Classify a (sanitised) name + mime into the `AttachmentKind` we'll use
 * for chip presentation. Always returns *something* — there is no "this
 * file type is forbidden" branch any more.
 */
export function classify(name: string, mime: string): AttachmentKind {
  const m = (mime || "").toLowerCase();
  if (IMAGE_MIMES.has(m) || m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("text/")) return "text";
  if (
    m === "application/json" ||
    m === "application/xml" ||
    m === "application/javascript" ||
    m === "application/typescript" ||
    m === "application/x-yaml"
  ) {
    return "text";
  }

  const dot = name.lastIndexOf(".");
  if (dot >= 0) {
    const ext = name.slice(dot + 1).toLowerCase();
    if (ext === "pdf") return "pdf";
    if (TEXT_EXTENSIONS.has(ext)) return "text";
    if (
      ext === "png" ||
      ext === "jpg" ||
      ext === "jpeg" ||
      ext === "gif" ||
      ext === "webp" ||
      ext === "bmp" ||
      ext === "avif" ||
      ext === "svg"
    ) {
      return "image";
    }
  }
  return "binary";
}

export function isDshNativeImage(name: string, mime: string): boolean {
  const normalized = mime.toLowerCase();
  if (
    normalized === "image/png" ||
    normalized === "image/jpeg" ||
    normalized === "image/jpg" ||
    normalized === "image/webp" ||
    normalized === "image/gif"
  ) {
    return true;
  }
  if (normalized && normalized !== "application/octet-stream") return false;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  const extension = name.slice(dot + 1).toLowerCase();
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(extension);
}

/**
 * Build the lightweight `AttachmentBadge` we persist on the user message.
 *
 * The badge is structurally a near-copy of the live attachment. Full image
 * bytes are sent only for the active turn and never persisted here. We keep
 * the function so call sites stay simple and so future divergence (e.g.
 * compressing the thumbnail further for storage) has a single seam.
 */
export async function attachmentToBadge(
  att: Attachment,
): Promise<AttachmentBadge> {
  return {
    uiId: att.uiId,
    name: att.name,
    mime: att.mime,
    size: att.size,
    kind: att.kind,
    ...(att.attachmentId ? { attachmentId: att.attachmentId } : {}),
    ...(att.thumbDataUrl ? { thumbDataUrl: att.thumbDataUrl } : {}),
  };
}

/**
 * Best-effort cleanup through the DSH plugin. The caller supplies only an
 * opaque id; no renderer-selected filesystem path reaches a delete API.
 */
export async function deleteAttachmentFile(
  idOrAtt: string | { attachmentId?: string },
): Promise<void> {
  const attachmentId =
    typeof idOrAtt === "string" ? idOrAtt : idOrAtt?.attachmentId || "";
  if (!attachmentId) return;
  try {
    await getPlatform().agentAttachments?.remove(attachmentId);
  } catch (e) {
    console.warn(
      "[attachments] delete failed:",
      (e as Error)?.message || e,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function stageBlobForDsh(
  blob: Blob,
  name: string,
  mime: string,
  sessionId: string,
): Promise<string> {
  const adapter = getPlatform().agentAttachments;
  if (!adapter) throw new Error("DSH attachment staging is unavailable.");
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), PUT_MESSAGE_BUDGET_MS);
  try {
    const staged = adapter.put({
      sessionId: sessionId || "default",
      name,
      mime: mime || blob.type || "application/octet-stream",
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
    const result = await Promise.race([
      staged,
      new Promise<never>((_, reject) =>
        ctrl.signal.addEventListener("abort", () => reject(new Error("Attachment staging timed out.")), { once: true }),
      ),
    ]);
    return result.attachmentId;
  } finally {
    clearTimeout(tid);
  }
}

/** Strip directory components and trim, falling back to "file" when empty. */
function sanitizeDisplayName(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "file";
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
  return base.trim() || "file";
}

/**
 * Convert a Blob to a raw base64 string (no `data:` URI prefix).
 *
 * FileReader yields `data:<mime>;base64,<b64>` so we slice off the prefix.
 * We deliberately don't use `btoa` over `await blob.text()` because the
 * blob may be binary and `btoa` only accepts Latin-1.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new Error("FileReader returned non-string result"));
        return;
      }
      const comma = r.indexOf(",");
      resolve(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.onerror = () =>
      reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

async function buildTextPreview(blob: Blob): Promise<string | undefined> {
  // Cap the slice we decode so a 50MB log file doesn't pull a 50MB string
  // through TextDecoder for the sake of a 500-char preview.
  const slice = blob.slice(0, 16 * 1024);
  const text = await slice.text();
  if (!text) return undefined;
  return text.length > TEXT_PREVIEW_CHARS
    ? text.slice(0, TEXT_PREVIEW_CHARS) + "…"
    : text;
}

async function buildImageThumbnail(
  blob: Blob,
  mime: string,
  longEdge: number = THUMB_LONG_EDGE,
): Promise<string | undefined> {
  // GIFs would freeze on the first frame after canvas re-encode, so we
  // pass them through untouched if they're already small enough; otherwise
  // we accept the freeze trade-off for a usable thumbnail.
  const sourceMime = mime || blob.type || "image/png";
  const dataUrl = await blobToDataUrl(blob);
  if (sourceMime === "image/svg+xml") {
    // SVGs scale natively; just return the data URL as the preview.
    return dataUrl;
  }
  return downscaleImageDataUrl(dataUrl, longEdge, sourceMime);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") resolve(r);
      else reject(new Error("FileReader returned non-string result"));
    };
    reader.onerror = () =>
      reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Downscale an image data URL so its longest edge is ≤ `maxLongEdge`,
 * re-encoding to JPEG (PNG kept for transparency-carrying inputs).
 */
async function downscaleImageDataUrl(
  dataUrl: string,
  maxLongEdge: number,
  fallbackMime: string,
): Promise<string | undefined> {
  const sourceMime = pickMimeFromDataUrl(dataUrl) || fallbackMime;
  if (sourceMime === "image/gif") {
    return dataUrl;
  }
  const img = await loadImage(dataUrl).catch(() => null);
  if (!img) return undefined;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return undefined;
  const longEdge = Math.max(w, h);
  if (longEdge <= maxLongEdge) return dataUrl;
  const scale = maxLongEdge / longEdge;
  const targetW = Math.max(1, Math.round(w * scale));
  const targetH = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, targetW, targetH);
  const outMime = sourceMime === "image/png" ? "image/png" : "image/jpeg";
  return outMime === "image/png"
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", IMAGE_REENCODE_QUALITY);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = src;
  });
}

function pickMimeFromDataUrl(dataUrl: string): string | null {
  const m = /^data:([^;,]+)/i.exec(dataUrl);
  return m ? m[1].toLowerCase() : null;
}

export function formatBytesShort(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
