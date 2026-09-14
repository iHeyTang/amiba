import { AudioPlayer } from "./AudioPlayer.js";
import { MediaOutcome } from "./outcome.js";
import { MediaAccountingSummary } from "./accounting.js";
import { mediaCopy as copy } from "./i18n-media.js";
import { useEffect, useState, useRef } from "react";
import { MediaViewer } from "./MediaViewer.js";
import { Film, Download, Expand } from "lucide-react";
import {
  ToolRowFrame,
  toolCallResultText,
  toolCallDurationMs,
  toolCallFailed,
  toolCallSettled,
  usePluginT,
} from "@amiba/ui/plugin";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { MediaArtifact, MediaRecord } from "../store.js";
import type {} from "../remote.js";
type Api = ClientContext["remote"]["amibaMediaUi"];

export function parseMediaResult(text: string): MediaRecord | null {
  try {
    let value = JSON.parse(text);
    if (typeof value.json === "string") value = JSON.parse(value.json);
    const record = value.record ?? value;
    return typeof record.id === "string" &&
      typeof record.sessionId === "string" &&
      typeof record.status === "string" &&
      Array.isArray(record.artifacts)
      ? record
      : null;
  } catch {
    return null;
  }
}
export function ArtifactPreview({
  api,
  record,
  artifact,
  autoLoad = false,
}: {
  api: Api;
  record: MediaRecord;
  artifact: MediaArtifact;
  autoLoad?: boolean;
}) {
  const { t } = usePluginT(copy);
  const [requested, setRequested] = useState(
    autoLoad || artifact.kind === "image" || artifact.kind === "file",
  );
  const video = useRef<HTMLVideoElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!requested) return;
    let active = true;
    let objectUrl = "";
    setError(false);
    setUrl("");
    void (async () => {
      const chunks: Uint8Array[] = [];
      let offset = 0;
      while (active) {
        const response = await api.artifact(
          record.sessionId,
          record.id,
          artifact.id,
          offset,
        );
        if (!response.ok) throw new Error("Artifact read failed");
        const part = response.value;
        if (part.size !== artifact.size || part.mimeType !== artifact.mimeType)
          throw new Error("Artifact changed");
        const bytes = Uint8Array.from(atob(part.data), (c) => c.charCodeAt(0));
        chunks.push(bytes);
        if (part.nextOffset === null) {
          if (offset + bytes.length !== artifact.size)
            throw new Error("Incomplete artifact");
          objectUrl = URL.createObjectURL(
            new Blob(chunks, { type: artifact.mimeType }),
          );
          if (active) setUrl(objectUrl);
          else URL.revokeObjectURL(objectUrl);
          return;
        }
        if (
          part.nextOffset !== offset + bytes.length ||
          part.nextOffset <= offset
        )
          throw new Error("Invalid artifact cursor");
        offset = part.nextOffset;
      }
    })().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    api,
    record.sessionId,
    record.id,
    artifact.id,
    artifact.size,
    artifact.mimeType,
    requested,
  ]);
  return (
    <div className="amiba-media-artifact">
      {!requested && (
        <button type="button" onClick={() => setRequested(true)}>
          {t("media.preview")} · {(artifact.size / 1024 / 1024).toFixed(1)} MB
        </button>
      )}
      {requested && !url && !error && (
        <span role="status">{t("media.loading")}</span>
      )}
      {error && (
        <button
          type="button"
          onClick={() => {
            setRequested(false);
          }}
        >
          {t("media.error")}
        </button>
      )}
      {url && (
        <>
          {artifact.kind === "image" ? (
            <div className="amiba-media-image-frame">
              <button
                type="button"
                className="amiba-media-image"
                aria-label={t("media.enlarge")}
                onClick={() => setExpanded(true)}
              >
                <img src={url} alt={record.model} />
              </button>
              <a
                className="amiba-media-image-download"
                href={url}
                download={artifact.path.split(/[\\/]/).pop()}
                aria-label={t("media.download")}
                title={t("media.download")}
              >
                <Download size={18} aria-hidden="true" />
              </a>
            </div>
          ) : artifact.kind === "video" ? (
            <video
              ref={video}
              controls
              playsInline
              preload="metadata"
              src={url}
            />
          ) : artifact.kind === "audio" ? (
            <AudioPlayer url={url} filename={artifact.path.split(/[\\/]/).pop() || artifact.id} />
          ) : (
            <span>{t("media.companion")}</span>
          )}
          {artifact.kind !== "image" && artifact.kind !== "audio" && (
            <div className="amiba-media-artifact-actions">
              {artifact.kind === "video" && (
                <button
                  type="button"
                  onClick={() => {
                    video.current?.pause();
                    setExpanded(true);
                  }}
                >
                  <Expand size={15} />
                  {t("media.openViewer")}
                </button>
              )}
              <a href={url} download={artifact.path.split(/[\\/]/).pop()}>
                <Download size={15} />
                {t("media.download")}
              </a>
            </div>
          )}
          {expanded &&
            (artifact.kind === "image" || artifact.kind === "video") && (
              <MediaViewer
                url={url}
                kind={artifact.kind}
                name={record.model}
                filename={artifact.path.split(/[\\/]/).pop() || artifact.id}
                onClose={() => setExpanded(false)}
              />
            )}
        </>
      )}
    </div>
  );
}
export function MediaToolview({
  block,
  presentation,
  api,
}: {
  block: Parameters<typeof toolCallResultText>[0];
  presentation?: "row" | "summary";
  api: Api;
}) {
  const { t } = usePluginT(copy);
  const text = toolCallResultText(block);
  const initial = parseMediaResult(text);
  const [record, setRecord] = useState<MediaRecord | null>(initial);
  const [readError, setReadError] = useState(false);
  useEffect(() => {
    setRecord(parseMediaResult(text));
    setReadError(false);
    const seed = parseMediaResult(text);
    if (!seed) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      let pending = true;
      try {
        const response = await api.inspect(seed.sessionId, seed.id);
        if (!response.ok) throw new Error("Read failed");
        if (active) {
          setRecord(response.value);
          setReadError(false);
        }
        pending = ["submitting", "queued", "running"].includes(
          response.value.status,
        ) || response.value.storageStatus === "saving";
      } catch {
        if (active) setReadError(true);
      }
      if (active && pending) timer = setTimeout(refresh, 3000);
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, text]);
  return (
    <ToolRowFrame
      icon={Film}
      presentation={presentation}
      action={record?.generationStatus === "succeeded" ? t(record.storageStatus === "saving" ? "media.generatedSaving" : record.storageStatus === "failed" ? "media.generatedSaveFailed" : "media.generatedSaved") : record && ["submitting", "queued", "running"].includes(record.status) ? t(record.operation === "image.generate" ? "media.waitImage" : record.operation === "video.generate" ? "media.waitVideo" : "media.waitAudio") : t("media.title")}
      target={record?.model}
      durationMs={toolCallDurationMs(block)}
      running={
        record
          ? ["submitting", "queued", "running"].includes(record.status)
          : toolCallSettled(block) === null
      }
      failed={record?.generationStatus === "succeeded" ? false : toolCallFailed(block) || record?.status === "failed"}
      detail={
        record ? (
          <div className="amiba-media-result">
            {record.generationStatus === "succeeded" ? <MediaOutcome record={record}/> : <p role="status">{t(`media.${record.status}`)}</p>}
            {readError && <p role="alert">{t("media.error")}</p>}
            {record.error && record.generationStatus !== "succeeded" && <p role="alert">{record.error}</p>}
            {record.warnings?.map((warning, i) => (
              <p key={i} role="status">
                {warning}
              </p>
            ))}
            {["interrupted", "submission_unknown"].includes(record.status) &&
              !record.retryAuthorizedAt && (
                <button
                  type="button"
                  onClick={async () => {
                    const result = await api.authorizeNewGeneration(
                      record.sessionId,
                      record.id,
                    );
                    if (result.ok) setRecord(result.value);
                    else setReadError(true);
                  }}
                >
                  {t("media.authorize")}
                </button>
              )}
            <MediaAccountingSummary accounting={record.accounting}/>
            {record.artifacts.map((artifact) => (
              <ArtifactPreview
                key={artifact.id}
                api={api}
                record={record}
                artifact={artifact}
              />
            ))}
          </div>
        ) : text ? (
          <p>{text}</p>
        ) : undefined
      }
    />
  );
}
