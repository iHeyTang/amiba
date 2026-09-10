import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, Maximize, Minus, Plus, X } from "lucide-react";
import { usePluginT } from "@amiba/ui/plugin";
import { mediaCopy } from "./i18n-media.js";

/** Media stage with dialog accessibility, independent of the application's modal frame. */
export function MediaViewer({
  url,
  kind,
  name,
  filename,
  onClose,
}: {
  url: string;
  kind: "image" | "video";
  name: string;
  filename: string;
  onClose: () => void;
}) {
  const { t } = usePluginT(mediaCopy);
  const previousFocus = useRef(
    typeof document === "undefined" ? null : document.activeElement,
  );
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState("");
  const drag = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
  }>();
  const changeZoom = (next: number) => {
    setZoom(Math.max(1, Math.min(5, next)));
    if (next <= 1) setPan({ x: 0, y: 0 });
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="amiba-viewer-backdrop" />
        <Dialog.Content
          className="amiba-viewer"
          data-ui-overlay="dialog"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (
              previousFocus.current instanceof HTMLElement &&
              previousFocus.current.isConnected
            )
              previousFocus.current.focus();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
          onKeyDown={(event) => {
            if (kind !== "image" || event.target instanceof HTMLInputElement)
              return;
            if (event.key === "+" || event.key === "=") {
              event.preventDefault();
              changeZoom(zoom + 0.25);
            }
            if (event.key === "-") {
              event.preventDefault();
              changeZoom(zoom - 0.25);
            }
            if (event.key === "0") {
              event.preventDefault();
              changeZoom(1);
            }
          }}
        >
          <header className="amiba-viewer-bar">
            <div className="amiba-viewer-caption">
              <Dialog.Title>{name}</Dialog.Title>
              <span>{dimensions || filename}</span>
            </div>
            <div className="amiba-viewer-actions">
              <a
                href={url}
                download={filename}
                aria-label={t("media.download")}
                title={t("media.download")}
              >
                <Download size={18} />
              </a>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("media.close")}
                title={t("media.close")}
              >
                <X size={20} />
              </button>
            </div>
          </header>
          <div
            className="amiba-viewer-stage"
            data-zoomed={zoom > 1 || undefined}
            onWheel={
              kind === "image"
                ? (event) =>
                    changeZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25))
                : undefined
            }
            onPointerDown={(event) => {
              if (kind !== "image" || zoom <= 1 || event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                x: event.clientX,
                y: event.clientY,
                originX: pan.x,
                originY: pan.y,
              };
            }}
            onPointerMove={(event) => {
              if (drag.current)
                setPan({
                  x: drag.current.originX + event.clientX - drag.current.x,
                  y: drag.current.originY + event.clientY - drag.current.y,
                });
            }}
            onPointerUp={() => {
              drag.current = undefined;
            }}
            onPointerCancel={() => {
              drag.current = undefined;
            }}
          >
            {kind === "image" ? (
              <img
                src={url}
                alt={name}
                draggable={false}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                }}
                onDoubleClick={() => changeZoom(zoom === 1 ? 2 : 1)}
                onLoad={(event) =>
                  setDimensions(
                    `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`,
                  )
                }
              />
            ) : (
              <video
                controls
                playsInline
                preload="metadata"
                src={url}
                onLoadedMetadata={(event) =>
                  setDimensions(
                    `${event.currentTarget.videoWidth} × ${event.currentTarget.videoHeight}`,
                  )
                }
              />
            )}
          </div>
          <footer className="amiba-viewer-footer">
            {kind === "image" && (
              <div
                className="amiba-viewer-zoom"
                role="group"
                aria-label={t("media.zoom")}
              >
                <button
                  type="button"
                  disabled={zoom <= 1}
                  onClick={() => changeZoom(zoom - 0.25)}
                  aria-label={t("media.zoomOut")}
                >
                  <Minus size={16} />
                </button>
                <output aria-live="polite">{Math.round(zoom * 100)}%</output>
                <button
                  type="button"
                  disabled={zoom >= 5}
                  onClick={() => changeZoom(zoom + 0.25)}
                  aria-label={t("media.zoomIn")}
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => changeZoom(1)}
                  aria-label={t("media.fit")}
                  title={t("media.fit")}
                >
                  <Maximize size={16} />
                </button>
              </div>
            )}
            <span>
              {t(kind === "image" ? "media.viewerHint" : "media.videoHint")}
            </span>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
