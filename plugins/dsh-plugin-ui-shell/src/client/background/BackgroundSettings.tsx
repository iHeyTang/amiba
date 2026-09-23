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
  const fileInput = useRef<HTMLInputElement>(null),
    posterInput = useRef<HTMLInputElement>(null);
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
    poster: boolean,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const asset = await background.upload(file, setProgress);
      if (poster && isVideo(asset.id))
        throw new Error(zh ? "封面需要图片" : "Poster must be an image");
      change(
        poster
          ? { posterId: asset.id }
          : { assetId: asset.id, posterId: null, enabled: true },
      );
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      await background.configure(draft, revision);
      setDirty(false);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="space-y-3 border-t border-border/50 pt-4"
      aria-label={zh ? "主界面背景" : "Application background"}
    >
      <div className="flex items-center justify-between gap-4">
        <Label>{zh ? "主界面背景" : "Application background"}</Label>
        <Select
          value={draft.enabled ? "on" : "off"}
          disabled={!state.ready || busy}
          onValueChange={(value) => change({ enabled: value === "on" })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{zh ? "默认背景" : "Default"}</SelectItem>
            <SelectItem value="on">{zh ? "自定义背景" : "Custom"}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        {zh
          ? "图片或循环视频，搭配分区毛玻璃；代码、终端和弹窗保留清晰底色。"
          : "Images or looping videos with layered glass; code, terminals and dialogs keep clear surfaces."}
      </p>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{zh ? "背景素材" : "Background asset"}</span>
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
          onChange={(event) => void upload(event, false)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {busy
          ? `${progress}%`
          : draft.assetId
            ? `${isVideo(draft.assetId) ? (zh ? "循环视频" : "Looping video") : zh ? "图片" : "Image"} · ${zh ? "已选择" : "Selected"}`
            : zh
              ? "尚未选择素材 · 最大 64 MiB"
              : "No asset selected · up to 64 MiB"}
      </p>
      {draft.assetId && (
        <>
          {isVideo(draft.assetId) && (
            <>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {zh ? "暂停时的封面（可选）" : "Paused poster (optional)"}
                </span>
                <div className="flex gap-2">
                  {draft.posterId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => change({ posterId: null })}
                    >
                      {zh ? "移除" : "Remove"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => posterInput.current?.click()}
                  >
                    {zh ? "选择封面" : "Choose poster"}
                  </Button>
                </div>
                <input
                  ref={posterInput}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => void upload(event, true)}
                />
              </div>
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
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={
            busy || !state.ready || !dirty || (draft.enabled && !draft.assetId)
          }
          onClick={() => void apply()}
        >
          {zh ? "应用背景" : "Apply"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setDraft({ ...DEFAULT_BACKGROUND });
            setDirty(true);
          }}
        >
          {zh ? "恢复默认" : "Restore defaults"}
        </Button>
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDirty(false);
              setError("");
              void background.refresh();
            }}
          >
            {zh ? "取消修改" : "Discard"}
          </Button>
        )}
      </div>
      {(error || state.error) && (
        <p role="alert" className="text-xs text-destructive">
          {error || state.error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {zh
          ? "也可以对 Agent 说：“把这张图生成一段缓慢运动的视频，并应用为我的背景。”"
          : "You can ask your Agent: “Animate this image into a slow video and apply it as my background.”"}
      </p>
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
