import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";
import { useT } from "@amiba/i18n";
import {
  Button,
  Label,
  Slider,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@amiba/ui/primitives";
import {
  DEFAULT_BACKGROUND,
  isVideo,
  type BackgroundConfig,
} from "../../background/model.js";
import type { BackgroundController } from "./controller.js";
export function BackgroundSettings({
  background,
}: {
  background: BackgroundController;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const state = useSyncExternalStore(
    background.subscribe,
    background.getSnapshot,
  );
  const [draft, setDraft] = useState(state.snapshot.config),
    [revision, setRevision] = useState(state.snapshot.revision);
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  const { language } = useT();
  const zh = language.startsWith("zh");
  useEffect(() => {
    if (!dirty) {
      setDraft(state.snapshot.config);
      setRevision(state.snapshot.revision);
    }
  }, [state.snapshot, dirty]);
  const change = (patch: Partial<BackgroundConfig>) => {
    setDraft((value) => ({ ...value, ...patch }));
    setDirty(true);
  };
  const upload = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const asset = await background.upload(file, setProgress);
      change({ assetId: asset.id, posterId: null, enabled: true });
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const apply = async (config = draft) => {
    setBusy(true);
    setError("");
    try {
      await background.configure(config, revision);
      setDirty(false);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    setPreview(null);
    if (!draft.assetId) return;
    const id = draft.assetId;
    const abort = new AbortController();
    let url: string | undefined;
    void background.loadAsset(id, abort.signal).then(blob => {
      if (abort.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setPreview({ id, url });
    }).catch(() => {
      if (!abort.signal.aborted) setError(zh ? "素材预览加载失败，请重新选择。" : "Could not load preview. Choose the asset again.");
    });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [background, draft.assetId, zh]);
  return (
    <section
      className="space-y-3 border-t border-border/50 pt-4"
      aria-label={zh ? "主界面背景" : "Application background"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label>{zh ? "主界面背景" : "Application background"}</Label>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !state.ready}
          onClick={() => fileInput.current?.click()}
        >
          {zh ? "选择图片或视频" : "Choose image or video"}
        </Button>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
          onChange={(event) => void upload(event)}
        />
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {busy ? (zh ? "正在处理…" : "Working…") + (progress > 0 && progress < 100 ? ` ${progress}%` : "")
          : !draft.assetId ? (zh ? "支持图片与循环视频，最大 64 MiB" : "Images and looping videos, up to 64 MiB")
          : dirty ? (zh ? "预览 · 尚未应用" : "Preview · Not applied") : (zh ? "当前背景" : "Current background")}
      </p>
      {draft.assetId && (
        <div className="relative h-32 overflow-hidden rounded-lg border border-border/60 bg-muted">
          {preview?.id === draft.assetId && (isVideo(draft.assetId)
            ? <video src={preview.url} muted playsInline preload="auto" className="h-full w-full object-cover" style={{ filter: `blur(${draft.blur}px)` }} />
            : <img src={preview.url} alt={zh ? "背景预览" : "Background preview"} className="h-full w-full object-cover" style={{ filter: `blur(${draft.blur}px)` }} />)}
          <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: draft.dim }} />
        </div>
      )}
      {draft.assetId && (
        <>
          {isVideo(draft.assetId) && (
            <>
              <Choice
                label={zh ? "动态播放" : "Motion"}
                value={draft.motion}
                disabled={busy}
                options={[
                  ["play", zh ? "循环播放" : "Loop"],
                  ["pause", zh ? "暂停" : "Pause"],
                ]}
                onChange={(value) =>
                  change({ motion: value as BackgroundConfig["motion"] })
                }
              />
              <p className="text-xs text-muted-foreground">
                {zh
                  ? "窗口隐藏或系统要求减少动态效果时自动暂停。"
                  : "Automatically pauses in hidden windows and when reduced motion is enabled."}
              </p>
            </>
          )}
          <label className="flex items-center justify-between gap-4 text-sm">
            {zh ? "背景压暗" : "Background dimming"}
            <span className="flex w-56 items-center gap-3">
              <Slider
                aria-label={zh ? "背景压暗" : "Background dimming"}
                min={0}
                max={0.65}
                step={0.05}
                value={[draft.dim]}
                disabled={busy}
                onValueChange={([dim]) => change({ dim })}
              />
              <output className="w-10 text-right">
                {Math.round(draft.dim * 100)}%
              </output>
            </span>
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            {zh ? "背景模糊" : "Background blur"}
            <span className="flex w-56 items-center gap-3">
              <Slider
                aria-label={zh ? "背景模糊" : "Background blur"}
                min={0}
                max={20}
                step={1}
                value={[draft.blur]}
                disabled={busy}
                onValueChange={([blur]) => change({ blur })}
              />
              <output className="w-10 text-right">{draft.blur}px</output>
            </span>
          </label>
        </>
      )}
      {(dirty || state.snapshot.config.enabled) && <div className="flex flex-wrap items-center gap-2">
        {dirty && <>
          <Button size="sm" disabled={busy || !state.ready || (draft.enabled && !draft.assetId)} onClick={() => void apply()}>
            {zh ? "应用" : "Apply"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
            setDraft(state.snapshot.config);
            setDirty(false);
            setError("");
          }}>{zh ? "取消" : "Cancel"}</Button>
        </>}
        {state.snapshot.config.enabled && <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" disabled={busy || !state.ready} onClick={() => void apply({ ...DEFAULT_BACKGROUND })}>
          {zh ? "恢复默认" : "Restore defaults"}
        </Button>}
      </div>}
      {(error || state.error) && (
        <p role="alert" className="text-xs text-destructive">
          {error || state.error}
        </p>
      )}
    </section>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: string[][];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="text-sm font-normal">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={label} className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([id, text]) => (
            <SelectItem key={id} value={id!}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
