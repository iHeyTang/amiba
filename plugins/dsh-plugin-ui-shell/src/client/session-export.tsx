import type {
  ClientContext,
  SessionId,
} from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-session-log-export/client";
import { useSyncExternalStore } from "react";
import { usePluginT } from "@amiba/i18n/plugin";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@amiba/ui/primitives";

type DownloadController = {
  store: Pick<
    ClientContext["sessionLogDownload"]["store"],
    "getSnapshot" | "subscribe"
  >;
  dismiss: ClientContext["sessionLogDownload"]["dismiss"];
};

/** Keep the existing header and export action; the native /export owns ZIP creation. */
export function SessionExportDialog({
  sessionId,
  controller,
}: {
  sessionId: SessionId;
  controller: DownloadController;
}) {
  const { language } = usePluginT();
  const state = useSyncExternalStore(
    controller.store.subscribe,
    controller.store.getSnapshot,
  );
  const entry = state.bySession[String(sessionId)];
  if (!entry?.open) return null;
  const zh = language === "zh-CN";
  const close = () => controller.dismiss(sessionId);
  const title =
    entry.status === "downloading"
      ? zh
        ? "正在准备会话日志"
        : "Preparing session log"
      : entry.status === "success"
        ? zh
          ? "会话日志已开始下载"
          : "Session log download started"
        : zh
          ? "会话日志导出失败"
          : "Session log export failed";
  const description =
    entry.status === "error"
      ? (entry.error ?? title)
      : entry.status === "downloading"
        ? zh
          ? "正在准备会话及其子会话的 ZIP 归档。"
          : "Preparing a ZIP archive of this session and its descendants."
        : zh
          ? "下载内容为官方 DSH 会话日志归档。"
          : "The download contains the official DSH session log archive.";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent size="compact">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={close}>{zh ? "关闭" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function mountSessionExportChrome(ctx: ClientContext) {
  return ctx.inject(["sessionLogDownload"], (scope) =>
    scope.effect(() =>
      scope.slots.register(
        {
          name: "conversation.session.header.utilities",
          id: "session-log-download",
          priority: -1,
          inject: () => ({ controller: scope.sessionLogDownload }),
        },
        SessionExportDialog,
      ),
    ),
  );
}
