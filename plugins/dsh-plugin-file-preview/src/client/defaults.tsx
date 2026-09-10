import { useEffect, useState } from "react";
import { CodeEditor } from "@amiba/dsh-plugin-ui-shell/client";
import type { FilePreviewProps, FilePreviewRenderer } from "./renderers.js";
function TextPreview({ document, line }: FilePreviewProps) {
  return (
    <CodeEditor
      content={document.content}
      sourcePath={document.path}
      line={line}
    />
  );
}
export function ImagePreview({ document: file, readBytes }: FilePreviewProps) {
  const zh = document.documentElement.lang.startsWith("zh");
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState<string>();
  const [dimensions, setDimensions] = useState<string>();
  const [actualSize, setActualSize] = useState(false);
  useEffect(() => {
    let alive = true;
    let url: string | undefined;
    setSrc(undefined);
    setError(undefined);
    setDimensions(undefined);
    void readBytes()
      .then((bytes) => {
        if (!alive) return;
        const mime = bytes.mimeType || file.mimeType;
        if (!mime?.startsWith("image/"))
          throw new Error(
            zh ? "无法识别图片格式。" : "Unrecognized image format.",
          );
        const data = Uint8Array.from(atob(bytes.base64), (ch) =>
          ch.charCodeAt(0),
        );
        url = URL.createObjectURL(new Blob([data], { type: mime }));
        setSrc(url);
      })
      .catch((cause) => {
        if (alive)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
    // readBytes is supplied by the file view; revision/session are the lifetime key.
  }, [file.path, file.revision]);
  if (error)
    return (
      <p role="alert" className="p-6 text-center text-xs text-muted-foreground">
        {error}
      </p>
    );
  if (!src)
    return (
      <p
        role="status"
        className="p-6 text-center text-xs text-muted-foreground"
      >
        {zh ? "正在读取图片…" : "Loading image…"}
      </p>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/25 px-3 text-[11px] text-muted-foreground">
        <span>{dimensions}</span>
        <button
          type="button"
          aria-pressed={actualSize}
          onClick={() => setActualSize((value) => !value)}
        >
          {actualSize
            ? zh
              ? "适应窗口"
              : "Fit to window"
            : zh
              ? "原始大小"
              : "Actual size"}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto p-4">
        <img
          src={src}
          alt={file.name}
          className={
            actualSize
              ? "m-auto shrink-0 max-w-none"
              : "m-auto block max-h-full max-w-full object-contain"
          }
          onLoad={(event) =>
            setDimensions(
              `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`,
            )
          }
          onError={() =>
            setError(
              zh
                ? "无法解码此图片，请尝试使用外部应用打开。"
                : "Cannot decode this image. Try an external app.",
            )
          }
        />
      </div>
    </div>
  );
}
export const defaultFileRenderers: readonly FilePreviewRenderer[] = [
  {
    id: "amiba.image",
    order: 100,
    mimeTypes: ["image/*"],
    extensions: [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "bmp",
      "svg",
      "ico",
      "avif",
    ],
    component: ImagePreview,
  },
  { id: "amiba.text", order: 1000, text: true, component: TextPreview },
];
