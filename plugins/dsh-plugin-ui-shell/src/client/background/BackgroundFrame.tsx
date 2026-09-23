import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useT } from "@amiba/i18n";
import { isVideo } from "../../background/model.js";
import type { BackgroundController } from "./controller.js";
// DSH loads the plugin's JavaScript only, not Vite's extracted CSS asset.
import backgroundCss from "./background.css?inline";

export function BackgroundFrame({
  controller,
  children,
}: {
  controller: BackgroundController;
  children: ReactNode;
}) {
  const {
    snapshot: { config },
  } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [media, setMedia] = useState<{ id: string; url: string } | null>(null);
  const [poster, setPoster] = useState<{ id: string; url: string } | null>(
    null,
  );
  const [readyId, setReadyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [hidden, setHidden] = useState(document.hidden);
  const video = useRef<HTMLVideoElement>(null);
  const { language } = useT();
  const zh = language.startsWith("zh");
  const excluded =
    new URLSearchParams(location.search).get("desktopPet") === "1";
  const enabled = config.enabled && !excluded;
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(query.matches),
      visibility = () => setHidden(document.hidden);
    query.addEventListener("change", changed);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      query.removeEventListener("change", changed);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    setReadyId(null);
    setError("");
    setMedia(null);
    if (!enabled || !config.assetId) return;
    const abort = new AbortController();
    let url: string | undefined;
    const id = config.assetId;
    void controller
      .loadAsset(id, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setMedia({ id, url });
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(String(error));
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [controller, enabled, config.assetId]);
  useEffect(() => {
    setPoster(null);
    if (!enabled || !config.posterId) return;
    const abort = new AbortController();
    let url: string | undefined;
    const id = config.posterId;
    void controller
      .loadAsset(id, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPoster({ id, url });
      })
      .catch(() => {});
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [controller, enabled, config.posterId]);
  const active =
    enabled &&
    !!media &&
    media.id === config.assetId &&
    readyId === config.assetId &&
    !error;
  const paused = config.motion === "pause" || reduced || hidden;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let cancelled = false;
    if (paused || !active) element.pause();
    else
      void element.play().catch(() => {
        if (cancelled) return;
        setError(
          zh
            ? "视频无法播放，请更换格式或暂停动态背景。"
            : "Video playback failed. Try another format or pause the background.",
        );
      });
    return () => {
      cancelled = true;
      element.pause();
    };
  }, [active, paused, media, zh]);
  // The standalone pet window relies on a fully transparent document.
  if (excluded) return <>{children}</>;

  const failed = () =>
    setError(
      zh
        ? "背景无法解码，已恢复默认表面。请在外观中更换素材。"
        : "Background could not be decoded. Default surfaces restored; choose another asset in Appearance.",
    );
  return (
    <div
      className="amiba-background-frame"
      data-background-active={active ? "true" : undefined}
      style={
        {
          "--amiba-background-dim": config.dim,
          "--amiba-background-blur": `${config.blur}px`,
        } as CSSProperties
      }
    >
      <style data-amiba-background-styles>{backgroundCss}</style>
      {enabled && media && media.id === config.assetId && (
        <div
          className="amiba-background-media"
          aria-hidden="true"
          style={{ visibility: active ? "visible" : "hidden" }}
        >
          {isVideo(media.id) ? (
            <video
              key={media.id}
              ref={video}
              src={media.url}
              muted
              loop
              playsInline
              preload="auto"
              style={{ objectFit: "cover" }}
              onLoadedData={() => setReadyId(media.id)}
              onError={failed}
            />
          ) : (
            <img
              key={media.id}
              src={media.url}
              alt=""
              style={{ objectFit: "cover" }}
              onLoad={() => setReadyId(media.id)}
              onError={failed}
            />
          )}
          {paused && isVideo(media.id) && poster?.id === config.posterId && (
            <img src={poster.url} alt="" style={{ objectFit: "cover" }} />
          )}
          <div className="amiba-background-dim" />
        </div>
      )}
      {children}
      {error && enabled && (
        <div role="status" className="amiba-background-error">
          {error}
          <button
            type="button"
            onClick={() => {
              void controller
                .configure(
                  { ...config, enabled: false },
                  controller.getSnapshot().snapshot.revision,
                )
                .catch((e) => setError(String(e)));
            }}
          >
            {zh ? "关闭背景" : "Disable background"}
          </button>
        </div>
      )}
    </div>
  );
}
