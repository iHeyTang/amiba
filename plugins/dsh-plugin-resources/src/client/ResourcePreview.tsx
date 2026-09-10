import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@amiba/ui/plugin";
import type { ResourceDocument, ResourceRef } from "../protocol.js";
import { resourceLink } from "../protocol.js";
import type { ResourcesRemote } from "../remote.js";
export function ResourcePreview({
  reference,
  remote,
  close,
  send,
}: {
  reference: ResourceRef | null;
  remote: ResourcesRemote;
  close(): void;
  send(ref: ResourceRef): Promise<void>;
}) {
  const [doc, setDoc] = useState<ResourceDocument>();
  const [actionError, setActionError] = useState<"copy" | "agent" | null>(null);
  const [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const zh = document.documentElement.lang.startsWith("zh");
  useEffect(() => {
    let alive = true;
    setDoc(undefined);
    setError(false);
    setCopied(false);
    setActionError(null);
    setBusy(false);
    if (reference)
      void remote.read(reference).then(
        (result) => {
          if (alive) {
            if (result.ok) setDoc(result.value);
            else setError(true);
          }
        },
        () => {
          if (alive) setError(true);
        },
      );
    return () => {
      alive = false;
    };
  }, [reference, remote]);
  return (
    <Dialog
      open={!!reference}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {doc?.title ?? (zh ? "资源预览" : "Resource preview")}
          </DialogTitle>
          <DialogDescription>
            {doc
              ? `${doc.account} · ${doc.ref.source}`
              : zh
                ? "内容按当前账号权限读取"
                : "Content uses this account’s current permissions"}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="py-8 text-sm text-muted-foreground">
            {zh
              ? "无法读取此资源。账号可能已断开、权限不足，或来源插件已卸载。"
              : "Resource unavailable. Check the account, permissions and source plugin."}
          </p>
        ) : !doc ? (
          <p role="status" className="py-8 text-muted-foreground">
            {zh ? "正在读取…" : "Loading…"}
          </p>
        ) : (
          <>
            <div className="max-h-[55vh] overflow-auto py-4 text-sm leading-7 whitespace-pre-wrap break-words">
              {doc.text || (zh ? "暂无可预览内容" : "No preview content")}
            </div>
            {doc.truncated && (
              <p className="text-xs text-muted-foreground">
                {zh
                  ? "内容较长，仅展示前 40,000 字符。"
                  : "Preview limited to 40,000 characters."}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {doc.url && (
                <Button variant="ghost" asChild>
                  <a href={doc.url} target="_blank" rel="noreferrer">
                    {zh ? "打开原文" : "Open source"}
                  </a>
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(resourceLink(doc.ref))
                    .then(
                      () => setCopied(true),
                      () => setActionError("copy"),
                    )
                }
              >
                {copied
                  ? zh
                    ? "已复制"
                    : "Copied"
                  : zh
                    ? "复制引用"
                    : "Copy reference"}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void send(doc.ref)
                    .catch(() => setActionError("agent"))
                    .finally(() => setBusy(false));
                }}
              >
                {zh ? "交给 Agent" : "Ask agent"}
              </Button>
            </div>
            {actionError && (
              <p role="alert" className="text-sm text-destructive">
                {actionError === "agent"
                  ? zh
                    ? "请先在连接设置中允许 Agent 读取个人资源。你的预览不受影响。"
                    : "Allow agent access in connection settings first. Your preview remains available."
                  : zh
                    ? "复制失败，请检查剪贴板权限。"
                    : "Could not copy. Check clipboard permissions."}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
