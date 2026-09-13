import type {
  OnboardHandle,
  OnboardResult,
} from "@amiba/dsh-plugin-connector-core";
import { API_BASE, configSchema, pause, WeixinApi, weixinUrl } from "./api.js";

export async function onboard(
  api: WeixinApi,
  handle: OnboardHandle,
): Promise<OnboardResult> {
  const signal = AbortSignal.any([
    handle.signal,
    AbortSignal.timeout(8 * 60_000),
  ]);
  for (let refresh = 0; refresh < 4; refresh++) {
    const qr = await api.request<{
      qrcode?: string;
      qrcode_img_content?: string;
    }>(API_BASE, "get_bot_qrcode?bot_type=3", { local_token_list: [] }, signal);
    if (!qr.qrcode || !qr.qrcode_img_content)
      throw new Error("weixin_qr_unavailable");
    handle.emit({ kind: "qr", url: qr.qrcode_img_content, expireIn: 120 });
    handle.emit({
      kind: "status",
      note: "请用微信扫描二维码，并在手机上确认连接。",
    });
    let base = API_BASE;
    let verification = "";
    while (!signal.aborted) {
      const result = await api.request<{
        status: string;
        bot_token?: string;
        ilink_bot_id?: string;
        ilink_user_id?: string;
        baseurl?: string;
        redirect_host?: string;
      }>(
        base,
        `get_qrcode_status?qrcode=${encodeURIComponent(qr.qrcode)}${verification ? `&verify_code=${encodeURIComponent(verification)}` : ""}`,
        undefined,
        signal,
        undefined,
        40_000,
      );
      if (result.status === "confirmed")
        return {
          config: configSchema.parse({
            botToken: result.bot_token,
            botId: result.ilink_bot_id,
            userId: result.ilink_user_id,
            baseUrl: result.baseurl || base,
          }),
        };
      if (result.status === "expired") break;
      if (result.status === "scaned_but_redirect" && result.redirect_host) {
        base = weixinUrl(
          result.redirect_host.startsWith("https://")
            ? result.redirect_host
            : `https://${result.redirect_host}`,
        );
      } else if (result.status === "scaned") {
        handle.emit({ kind: "status", note: "已扫码，请在微信中确认。" });
      } else if (result.status === "need_verifycode") {
        if (!handle.requestInput)
          throw new Error("weixin_verification_required");
        verification = await handle.requestInput(
          "请输入微信页面显示的验证码",
          signal,
        );
      } else if (result.status === "verify_code_blocked") {
        throw new Error("weixin_verification_blocked");
      } else if (result.status === "binded_redirect") {
        throw new Error("weixin_already_bound");
      }
      await pause(1000, signal);
    }
    signal.throwIfAborted();
  }
  throw new Error("weixin_qr_expired");
}
