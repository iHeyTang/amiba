// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDingtalkApp } from "./registration.js";
import { createDingtalkProvider } from "./provider.js";
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(async (_ms, _value, options) => {
    options.signal.throwIfAborted();
  }),
}));
const begin = {
  errcode: 0,
  device_code: "private-device",
  verification_uri_complete:
    "https://open-dev.dingtalk.com/authorize?code=public",
  expires_in: 600,
  interval: 2,
};
function setup(polls: unknown[] = []) {
  const controller = new AbortController();
  const emit = vi.fn();
  const responses = [{ errcode: 0, nonce: "private-nonce" }, begin, ...polls];
  const request = vi.fn(async (_url: unknown, _init: unknown) => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next));
  });
  return {
    handle: { signal: controller.signal, emit },
    request,
    responses,
    controller,
    emit,
  };
}
afterEach(() => vi.restoreAllMocks());
describe("DingTalk registration", () => {
  it("uses the official flow and returns credentials only to the provider", async () => {
    const s = setup([
      { errcode: 0, status: "WAITING" },
      {
        errcode: 0,
        status: "SUCCESS",
        client_id: "cid",
        client_secret: "private-secret",
      },
    ]);
    const result = await registerDingtalkApp(
      s.handle,
      s.request as typeof fetch,
    );
    expect(result.config).toMatchObject({
      clientId: "cid",
      clientSecret: "private-secret",
    });
    expect(
      s.request.mock.calls.map((call) => String(call[0]).split("/").at(-1)),
    ).toEqual(["init", "begin", "poll", "poll"]);
    expect(
      JSON.parse((s.request.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({ source: "DING_DWS_CLAW" });
    expect(s.emit).toHaveBeenCalledWith({
      kind: "qr",
      url: begin.verification_uri_complete,
      expireIn: 600,
    });
    expect(JSON.stringify(s.emit.mock.calls)).not.toMatch(/private-/);
    expect(typeof createDingtalkProvider().onboard).toBe("function");
  });
  it.each([
    ["EXPIRED", "expired"],
    ["FAIL", "failed"],
    ["UNKNOWN", "invalid"],
  ])("handles terminal %s", async (status, error) => {
    const s = setup([{ errcode: 0, status, fail_reason: "private-secret" }]);
    await expect(
      registerDingtalkApp(s.handle, s.request as typeof fetch),
    ).rejects.toThrow(`dingtalk_registration_${error}`);
    expect(s.request).toHaveBeenCalledTimes(3);
  });
  it("rejects missing credentials without exposing upstream content", async () => {
    const s = setup([{ errcode: 0, status: "SUCCESS", client_id: "cid" }]);
    await expect(
      registerDingtalkApp(s.handle, s.request as typeof fetch),
    ).rejects.toThrow("dingtalk_registration_invalid");
  });
  it("retries a transient network failure without creating another app session", async () => {
    const s = setup([
      new Error("private-secret"),
      {
        errcode: 0,
        status: "SUCCESS",
        client_id: "cid",
        client_secret: "secret",
      },
    ]);
    await registerDingtalkApp(s.handle, s.request as typeof fetch);
    expect(s.emit).toHaveBeenCalledWith({ kind: "status", note: "retrying" });
    expect(
      s.request.mock.calls.filter((call) => String(call[0]).endsWith("/init")),
    ).toHaveLength(1);
  });
  it("bounds network retries", async () => {
    const s = setup(
      Array.from({ length: 4 }, () => new Error("private-secret")),
    );
    await expect(
      registerDingtalkApp(s.handle, s.request as typeof fetch),
    ).rejects.toThrow("dingtalk_registration_network");
    expect(s.request).toHaveBeenCalledTimes(6);
  });
  it("does not poll after cancellation", async () => {
    const s = setup();
    s.emit.mockImplementation(() => s.controller.abort());
    await expect(
      registerDingtalkApp(s.handle, s.request as typeof fetch),
    ).rejects.toThrow();
    expect(s.request).toHaveBeenCalledTimes(2);
  });
  it("propagates abort to an in-flight request", async () => {
    const s = setup();
    const request = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(init.signal.reason),
          );
          s.controller.abort();
        }),
    );
    await expect(
      registerDingtalkApp(s.handle, request as typeof fetch),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    expect(s.emit).not.toHaveBeenCalled();
  });
  it("expires locally even when the server keeps waiting", async () => {
    const s = setup([{ errcode: 0, status: "WAITING" }]);
    let time = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      time += 300_000;
      return time;
    });
    await expect(
      registerDingtalkApp(s.handle, s.request as typeof fetch),
    ).rejects.toThrow("dingtalk_registration_expired");
  });
  it.each([
    "https://evil.test/qr",
    "javascript:alert(1)",
    "https://dingtalk.com.evil.test/qr",
  ])("rejects untrusted authorization URL %s", async (url) => {
    const s = setup();
    s.responses[1] = { ...begin, verification_uri_complete: url };
    await expect(
      registerDingtalkApp(s.handle, s.request as typeof fetch),
    ).rejects.toThrow("dingtalk_registration_invalid");
    expect(s.emit).not.toHaveBeenCalled();
  });
  it("does not expose provider errors or credentials", async () => {
    const s = setup();
    s.responses[0] = { errcode: 123, errmsg: "private-secret" };
    await expect(
      registerDingtalkApp(s.handle, s.request as typeof fetch),
    ).rejects.toThrow("dingtalk_registration_api");
  });
});
