import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import { installMessageCatalog } from "@amiba/i18n";
import { en, zhCN } from "@amiba/ui/locales";
import { Composer } from "../../../../packages/ui/src/chat/Composer";
import { PaneHeaderBar } from "../../../../packages/ui/src/navigation/PaneHeaderBar";
import { PresentationRoot } from "../../../../packages/ui/src/primitives/interaction-region";
import { BackgroundFrame } from "../client/background/BackgroundFrame";
import { BackgroundSettings } from "../client/background/BackgroundSettings";
import { createBackgroundController } from "../client/background/controller";
import { DEFAULT_BACKGROUND } from "../background/model";
import "./background.css";
const storage = {
  get: async () => ({}),
  set: async () => {},
  remove: async () => {},
  watch: () => () => {},
};
setPlatform({ storage } as unknown as PlatformAdapter);
installMessageCatalog({ en, "zh-CN": zhCN });
const call = async (method: string, ...args: unknown[]) => {
  const response = await fetch("/__background", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, args }),
  });
  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result.value;
};
const remote = Object.fromEntries(
  ["get", "configure", "beginUpload", "upload", "finishUpload", "asset"].map(
    (method) => [
      method,
      async (...args: unknown[]) => {
        try {
          return { ok: true, value: await call(method, ...args) };
        } catch (error) {
          return { ok: false, error: { message: String(error) } };
        }
      },
    ],
  ),
);
const controller = createBackgroundController({
  inject: (_keys: string[], fn: Function) =>
    fn({ remote: { amibaBackground: remote } }),
} as never);
async function animatedFixture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 800;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(24);
  const recorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp8",
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const complete = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
  });
  let frame = 0;
  const draw = () => {
    const gradient = ctx.createLinearGradient(0, 0, 1280, 800);
    gradient.addColorStop(0, "#031c36");
    gradient.addColorStop(0.5, "#218987");
    gradient.addColorStop(1, "#e0bc82");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1280, 800);
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(240,250,255,${0.12 + i * 0.02})`;
      ctx.ellipse(
        650 + i * 140 + Math.sin(frame / 18) * 55,
        470 + i * 40,
        680,
        100,
        -0.2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    frame++;
  };
  draw();
  recorder.start();
  const timer = setInterval(draw, 42);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  clearInterval(timer);
  recorder.stop();
  const blob = await complete;
  stream.getTracks().forEach((track) => track.stop());
  const file = new File([blob], "generated-motion.webm", {
    type: "video/webm",
  });
  const asset = await controller.upload(file, () => {});
  await controller.configure(
    { ...DEFAULT_BACKGROUND, enabled: true, assetId: asset.id },
    controller.getSnapshot().snapshot.revision,
  );
  return asset;
}
(window as any).backgroundHarness = { controller, animatedFixture, call };
function App() {
  const [text, setText] = useState(""),
    [settings, setSettings] = useState(false),
    [workbenchWidth, setWorkbenchWidth] = useState(256),
    [empty, setEmpty] = useState(false);
  (window as any).backgroundHarness.settings = setSettings;
  (window as any).backgroundHarness.workbench = setWorkbenchWidth;
  (window as any).backgroundHarness.empty = setEmpty;
  return (
    <PresentationRoot>
      <BackgroundFrame controller={controller}>
        <div data-amiba-product-shell>
          <div
            data-background-surface="layout"
            className="flex h-screen bg-background text-foreground"
          >
            <aside
              data-background-surface="navigation"
              className="flex w-60 shrink-0 flex-col border-r border-border/40 p-4"
            >
              <PaneHeaderBar leading={<strong>Amiba</strong>} />
              <button className="mt-5 rounded-md bg-primary/10 px-3 py-2 text-left">
                ＋ 新对话
              </button>
              <p className="mt-8 text-xs text-muted-foreground">最近对话</p>
              <p className="mt-4 text-sm">给工作区一点生机</p>
              <p className="mt-4 text-sm text-muted-foreground">本周研发进展</p>
              <button
                className="mt-auto text-left text-sm"
                onClick={() => setSettings(!settings)}
              >
                外观设置
              </button>
            </aside>
            <main className="flex min-w-0 flex-1 flex-col">
              <PaneHeaderBar
                leading={<span>给工作区一点生机</span>}
                trailing={<span>···</span>}
              />
              <div
                data-background-surface={empty ? "canvas" : "reading"}
                className="flex min-h-0 flex-1 flex-col px-10 py-8"
              >
                <div className="mx-auto w-full max-w-3xl flex-1">
                  <div
                    data-background-surface="sticky-message"
                    className="rounded-xl bg-secondary px-4 py-3 text-sm"
                  >
                    把这张图做成一段缓慢运动的视频，作为我的背景。
                  </div>
                  <div className="py-6 text-sm leading-7">
                    <p>
                      动态背景已应用。聊天正文放在柔化阅读层上，导航和输入区各有独立的毛玻璃材质。
                    </p>
                    <p className="mt-3 text-muted-foreground">
                      窗口隐藏时暂停播放；返回后恢复。系统启用减少动态效果时，会保持静止。
                    </p>
                    <pre className="mt-5 rounded-lg border border-border/50 bg-background p-4 font-mono text-xs">{`background: video\nmotion: play\nglass: balanced`}</pre>
                  </div>
                </div>
                <div className="mx-auto w-full max-w-3xl">
                  <Composer
                    value={text}
                    onChange={setText}
                    onSubmit={() => {}}
                  />
                </div>
              </div>
            </main>
            <aside data-background-surface="workbench" style={{ width: workbenchWidth }} className="shrink-0 border-l border-border p-4">
              <PaneHeaderBar leading="工作区" />
              <p className="mt-4 text-xs text-muted-foreground">
                代码 / 终端保持实色
              </p>
              <pre className="mt-6 font-mono text-xs leading-6">{`$ git status\nOn branch feature\nWorking tree clean`}</pre>
            </aside>
          </div>
        </div>
        {settings && (
          <div
            role="dialog"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          >
            <div className="max-h-[90vh] w-[560px] overflow-auto rounded-xl border border-border bg-background p-6 text-foreground">
              <div className="mb-5 flex justify-between">
                <h2>外观</h2>
                <button onClick={() => setSettings(false)}>关闭</button>
              </div>
              <BackgroundSettings background={controller} />
            </div>
          </div>
        )}
      </BackgroundFrame>
    </PresentationRoot>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
