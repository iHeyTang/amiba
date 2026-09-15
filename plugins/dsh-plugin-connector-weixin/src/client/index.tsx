import { WeixinMark } from "./brand-mark.js";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@amiba/dsh-plugin-connector-core/client";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Label, WizardFrame } from "@amiba/ui/plugin";
import { Loader2 } from "lucide-react";
import qrcode from "qrcode-generator";

export const name = "amiba-connector-weixin-ui";
export const inject = ["amibaConnectorUI"];
export function WeixinDetails() {
  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <p>
        在微信 ClawBot
        中给助手发消息、图片、语音或文件，在微信接收回复和处理后的文件。
      </p>
      <p>
        连接后，请在微信中发送第一条消息，建立个人会话。Amiba
        需要保持运行才能收发消息。
      </p>
      <p>
        仅支持个人单聊。微信收藏、其他聊天记录、朋友圈和支付未开放。语音转写取决于微信返回内容及助手可用工具，音频回复以文件发送。
      </p>
    </div>
  );
}
const errors: Record<string, string> = {
  weixin_qr_expired: "二维码已过期，请重新获取。",
  weixin_verification_required:
    "微信要求额外验证码，请重新扫码或在微信中完成验证后重试。",
  weixin_verification_blocked: "验证次数过多，请稍后重新扫码。",
  weixin_already_bound:
    "该微信已经连接，请查看已有连接，或在微信中解除旧连接后重试。",
};
type View = Awaited<ReturnType<ConnectWizardHost["adapter"]["pollOnboarding"]>>;
export function WeixinWizard({ host }: { host: ConnectWizardHost }) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const [connectionName, setName] = useState(host.prefill?.name || "我的微信");
  const [preset, setPreset] = useState(
    host.prefill?.agentPreset ||
      host.presets.find((p) => p.isDefault)?.id ||
      host.presets[0]?.id ||
      "",
  );
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const active = useRef<{ stopped: boolean; session?: string }>({
    stopped: false,
  });
  useEffect(
    () => () => {
      active.current.stopped = true;
      if (active.current.session)
        void hostRef.current.adapter
          .cancelOnboarding(active.current.session)
          .catch(() => {});
    },
    [],
  );
  async function begin() {
    if (busy) return;
    const run = { stopped: false, session: undefined as string | undefined };
    active.current = run;
    setBusy(true);
    setError("");
    setView(null);
    try {
      let next = await hostRef.current.adapter.beginOnboarding({
        provider: "weixin",
        name: connectionName.trim(),
        agentPreset: preset,
      });
      run.session = next.sessionId;
      if (run.stopped) {
        await hostRef.current.adapter.cancelOnboarding(next.sessionId);
        return;
      }
      while (!run.stopped) {
        setView(next);
        if (next.state === "completed") {
          run.session = undefined;
          if (!next.connect) throw new Error("missing_connect");
          hostRef.current.done(next.connect);
          return;
        }
        if (next.state !== "pending")
          throw new Error(next.error || "cancelled");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (run.stopped) return;
        next = await hostRef.current.adapter.pollOnboarding(next.sessionId);
      }
    } catch (cause) {
      if (run.session)
        void hostRef.current.adapter
          .cancelOnboarding(run.session)
          .catch(() => {});
      if (!run.stopped) {
        const message = cause instanceof Error ? cause.message : "";
        setError(errors[message] || "连接暂时未完成，请重试并检查网络。");
        setView(null);
      }
    } finally {
      if (!run.stopped) setBusy(false);
    }
  }
  async function submitVerification() {
    const challenge = view?.input;
    if (
      !view ||
      !challenge ||
      !host.adapter.submitOnboardingInput ||
      submitting
    )
      return;
    setSubmitting(true);
    try {
      await host.adapter.submitOnboardingInput(
        view.sessionId,
        challenge.id,
        verification,
      );
      setVerification("");
      setError("");
    } catch {
      setError("验证码提交未完成，请重试。");
    } finally {
      setSubmitting(false);
    }
  }
  let qrUrl: string | undefined;
  if (view?.qrUrl) {
    const qr = qrcode(0, "M");
    qr.addData(view.qrUrl);
    qr.make();
    qrUrl = `data:image/svg+xml;utf8,${encodeURIComponent(qr.createSvgTag({ cellSize: 4, margin: 4 }))}`;
  }
  const { BasicsFields } = host.kit;
  return (
    <WizardFrame
      title="连接微信"
      subtitle="扫码连接个人助手，在微信里继续任务。"
      icon={<WeixinMark />}
      iconAppearance="bare"
      onClose={host.cancel}
      onBack={host.back}
      closeLabel="关闭"
      backLabel="更换平台"
    >
      <div className="space-y-6">
        <fieldset disabled={busy}>
          <BasicsFields
            name={connectionName}
            onNameChange={setName}
            preset={preset}
            onPresetChange={setPreset}
            presets={host.presets}
          />
        </fieldset>
        <section
          className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-xl bg-muted/20 p-5"
          aria-label="微信扫码连接"
        >
          {qrUrl ? (
            <img
              width={192}
              height={192}
              className="rounded bg-white p-2"
              alt="微信连接二维码"
              src={qrUrl}
            />
          ) : (
            <WeixinMark size={40} />
          )}
          {busy ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {view?.statusNote || "正在获取二维码…"}
            </p>
          ) : (
            <Button
              type="button"
              disabled={!connectionName.trim() || !preset}
              onClick={() => void begin()}
            >
              {error ? "重新获取二维码" : "用微信扫码连接"}
            </Button>
          )}
        </section>
        {view?.input && (
          <div className="space-y-2">
            <Label htmlFor="weixin-verification">{view.input.label}</Label>
            <Input
              id="weixin-verification"
              autoComplete="one-time-code"
              value={verification}
              onChange={(event) => setVerification(event.target.value)}
            />
            <Button
              type="button"
              disabled={!verification.trim() || submitting}
              onClick={() => void submitVerification()}
            >
              提交验证码
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <WeixinDetails />
      </div>
    </WizardFrame>
  );
}
export function apply(ctx: ClientContext) {
  ctx.effect(() =>
    ctx.amibaConnectorUI.register("weixin", {
      component: WeixinWizard,
      details: WeixinDetails,
      icon: <WeixinMark size={22} />,
      tagline: "扫码连接个人微信，收发消息、图片和文件",
    }),
  );
}
