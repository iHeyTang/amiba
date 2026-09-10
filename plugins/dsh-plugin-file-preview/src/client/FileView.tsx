import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@amiba/i18n";
import {
  Copy,
  FileCode2,
  FolderOpen,
  ExternalLink,
  RotateCw,
} from "lucide-react";
import type {
  WorkspaceFileDocument,
  WorkspaceFilesAdapter,
} from "@amiba/app-runtime/platform";
import {
  PreviewHeader,
  WorkbenchViewBoundary,
} from "@amiba/dsh-plugin-ui-shell/client";
import { selectFileRenderer, type FilePreviewRenderer } from "./renderers.js";
function formatBytes(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
}
export function WorkspaceFileView({
  resource,
  sessionId,
  files,
  showHeader = true,
  renderers,
}: {
  renderers: readonly FilePreviewRenderer[];
  resource: { path: string; line?: number };
  sessionId: string;
  files: WorkspaceFilesAdapter;
  showHeader?: boolean;
}) {
  const { t } = useT();
  const zh = globalThis.document.documentElement.lang.startsWith("zh");
  const [document, setDocument] = useState<WorkspaceFileDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await files.read(sessionId, resource.path);
      if (request !== requestRef.current) return;
      setDocument(next);
    } catch (cause) {
      if (request !== requestRef.current) return;
      setDocument(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [files, resource.path, sessionId]);

  useEffect(() => {
    setDocument(null);
    void load();
    return () => {
      requestRef.current++;
    };
  }, [load]);

  useEffect(() => {
    const path = document?.path ?? resource.path;
    return files.watch(sessionId, [path], (change) => {
      if (change.event === "unlink") {
        requestRef.current++;
        setDocument(null);
        setError(t("workspacePane.fileDeleted"));
        setLoading(false);
        return;
      }
      void load();
    });
  }, [document?.path, files, load, resource.path, sessionId, t]);

  const renderer = document
    ? selectFileRenderer(renderers, document)
    : undefined;
  const Renderer = renderer?.component;
  const targetPath = document?.path ?? resource.path;
  const displayPath = document?.relativePath ?? resource.path;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showHeader && (
        <PreviewHeader
          icon={FileCode2}
          title={
            <span className="font-mono" title={targetPath}>
              {displayPath}
            </span>
          }
          status={
            document ? (
              <span className="font-mono text-[9.5px] leading-none tabular-nums text-muted-foreground/70">
                {formatBytes(document.size)}
              </span>
            ) : null
          }
          primaryAction={{
            icon: Copy,
            label: t("workspacePane.copyPath"),
            onSelect: () => void navigator.clipboard.writeText(targetPath),
          }}
          moreActions={[
            {
              icon: FolderOpen,
              label: t("workspacePane.revealFile"),
              onSelect: () =>
                void files.reveal(sessionId, targetPath).catch(() => {}),
            },
            {
              icon: ExternalLink,
              label: t("workspacePane.openExternal"),
              onSelect: () =>
                void files.openExternal(sessionId, targetPath).catch(() => {}),
            },
          ]}
        />
      )}
      {loading && !document ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">
          {t("workspacePane.loadingFile")}
        </div>
      ) : error || !document ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <FileCode2 className="h-5 w-5 text-muted-foreground/50" />
          <div className="max-w-sm text-xs text-muted-foreground">
            {error || t("workspacePane.fileUnavailable")}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 px-2.5 text-[11px] text-foreground transition-colors hover:bg-muted/50"
          >
            <RotateCw className="h-3 w-3" />
            {t("common.retry")}
          </button>
        </div>
      ) : !Renderer ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <FileCode2 className="h-5 w-5 text-muted-foreground/50" />
          <div className="text-xs font-medium">{document.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {zh ? "没有可用的文件预览器" : "No file previewer is available"} ·{" "}
            {formatBytes(document.size)}
          </div>
        </div>
      ) : (
        <>
          {(document.truncated || loading) && (
            <div className="flex h-7 shrink-0 items-center border-b border-border/25 bg-muted/20 px-3 text-[10px] text-muted-foreground">
              {loading
                ? t("workspacePane.refreshing")
                : t("workspacePane.truncated", {
                    size: formatBytes(document.size),
                  })}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <WorkbenchViewBoundary
              key={`${sessionId}:${document.path}:${document.revision}:${renderer!.id}`}
              fallback={
                <p role="alert" className="p-6 text-xs text-muted-foreground">
                  {zh
                    ? "预览器运行失败，请重新打开文件或使用外部应用。"
                    : "Preview failed. Reopen the file or use an external app."}
                </p>
              }
            >
              <Renderer
                document={document}
                line={resource.line}
                readBytes={() => {
                  if (!files.readBytes)
                    return Promise.reject(
                      new Error(
                        zh
                          ? "当前宿主不支持二进制读取。"
                          : "Binary reading is unavailable on this host.",
                      ),
                    );
                  return files.readBytes(sessionId, document.path);
                }}
              />
            </WorkbenchViewBoundary>
          </div>
        </>
      )}
    </div>
  );
}
