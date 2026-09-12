import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type {
  OnboardHandle,
  OnboardResult,
} from "@amiba/dsh-plugin-connector-core";
import { dingtalkConfigSchema } from "./translate.js";

// Official DingTalk connector registration protocol, verified at upstream commit
// 5fef12d37377e299e26d18b0145baf646cd17a8b (src/device-auth.ts and config).
// This flow creates/binds the bot in DingTalk's own authorization page.
const BASE_URL = "https://oapi.dingtalk.com/app/registration";
const failure = (kind: string) => new Error(`dingtalk_registration_${kind}`);
const apiSchema = z.object({ errcode: z.number() }).passthrough();
const text = z.string().trim().min(1);
const beginSchema = z.object({
  device_code: text,
  verification_uri_complete: text,
  expires_in: z.number().positive().finite(),
  interval: z.number().positive().finite(),
});
const pollSchema = z.object({
  status: z.enum(["WAITING", "SUCCESS", "FAIL", "EXPIRED"]),
  client_id: text.optional(),
  client_secret: text.optional(),
});

export async function registerDingtalkApp(
  handle: OnboardHandle,
  request: typeof fetch = fetch,
): Promise<OnboardResult> {
  // Match the center's onboarding lifetime; no background registration after
  // the UI is closed, and never expose device codes or credentials in errors.
  const signal = AbortSignal.any([
    handle.signal,
    AbortSignal.timeout(10 * 60_000),
  ]);
  async function post(step: string, body: unknown) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await request(`${BASE_URL}/${step}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        redirect: "error",
      });
    } catch {
      signal.throwIfAborted();
      throw failure("network");
    }
    if (!response.ok)
      throw failure(
        response.status >= 500 || response.status === 429 ? "network" : "api",
      );
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw failure("invalid");
    }
    const parsed = apiSchema.safeParse(raw);
    if (!parsed.success) throw failure("invalid");
    if (parsed.data.errcode !== 0) throw failure("api");
    return parsed.data;
  }
  try {
    const init = await post("init", { source: "DING_DWS_CLAW" });
    const nonce = text.safeParse(init.nonce);
    if (!nonce.success) throw failure("invalid");
    const started = beginSchema.safeParse(
      await post("begin", { nonce: nonce.data }),
    );
    if (!started.success) throw failure("invalid");
    const data = started.data;
    let url: URL;
    try {
      url = new URL(data.verification_uri_complete);
    } catch {
      throw failure("invalid");
    }
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".dingtalk.com") ||
      url.username ||
      url.password
    )
      throw failure("invalid");
    signal.throwIfAborted();
    const expiresIn = Math.min(data.expires_in, 600);
    const expiresAt = Date.now() + expiresIn * 1000;
    const interval = Math.min(30, Math.max(1, data.interval)) * 1000;
    handle.emit({ kind: "qr", url: url.href, expireIn: expiresIn });
    handle.emit({ kind: "status", note: "polling" });
    let retries = 0;
    while (Date.now() < expiresAt) {
      await delay(Math.min(interval, expiresAt - Date.now()), undefined, {
        signal,
      });
      if (Date.now() >= expiresAt) break;
      let raw;
      try {
        raw = await post("poll", { device_code: data.device_code });
        retries = 0;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "dingtalk_registration_network" &&
          ++retries <= 3
        ) {
          handle.emit({ kind: "status", note: "retrying" });
          continue;
        }
        throw error;
      }
      const polled = pollSchema.safeParse(raw);
      if (!polled.success) throw failure("invalid");
      signal.throwIfAborted();
      if (polled.data.status === "WAITING") {
        handle.emit({ kind: "status", note: "polling" });
        continue;
      }
      if (polled.data.status === "EXPIRED") throw failure("expired");
      if (polled.data.status === "FAIL") throw failure("failed");
      const config = dingtalkConfigSchema.safeParse({
        clientId: polled.data.client_id,
        clientSecret: polled.data.client_secret,
      });
      if (!config.success) throw failure("invalid");
      return { config: config.data };
    }
    throw failure("expired");
  } catch (error) {
    handle.signal.throwIfAborted();
    if (signal.aborted) throw failure("expired");
    throw error;
  }
}
