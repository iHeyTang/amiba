import { afterEach, expect, it, vi } from "vitest";
import { WeixinApi } from "./api.js";
import { onboard } from "./onboard.js";
afterEach(() => vi.useRealTimers());
it("handles scan, trusted redirect and confirmation without exposing credentials", async () => {
  vi.useFakeTimers();
  const replies = [
    { qrcode: "qr", qrcode_img_content: "https://weixin.qq.com/scan" },
    { status: "scaned_but_redirect", redirect_host: "other.weixin.qq.com" },
    {
      status: "confirmed",
      bot_token: "private",
      ilink_bot_id: "bot",
      ilink_user_id: "owner",
      baseurl: "https://other.weixin.qq.com",
    },
  ];
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(replies.shift()),
  );
  const emit = vi.fn();
  const result = onboard(new WeixinApi(fetcher), {
    signal: new AbortController().signal,
    emit,
  });
  await vi.advanceTimersByTimeAsync(1100);
  expect((await result).config).toMatchObject({
    botToken: "private",
    userId: "owner",
  });
  expect(fetcher.mock.calls[2][0]).toContain("https://other.weixin.qq.com/");
  expect(JSON.stringify(emit.mock.calls)).not.toContain("private");
  expect(fetcher.mock.calls[1][1]?.headers).not.toHaveProperty("Authorization");
});
it("asks for a transient verification code and submits it to the QR status endpoint", async () => {
  vi.useFakeTimers();
  const replies = [
    { qrcode: "qr", qrcode_img_content: "https://weixin.qq.com/scan" },
    { status: "need_verifycode" },
    {
      status: "confirmed",
      bot_token: "token",
      ilink_bot_id: "bot",
      ilink_user_id: "owner",
    },
  ];
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(replies.shift()),
  );
  const requestInput = vi.fn(async () => "123456");
  const result = onboard(new WeixinApi(fetcher), {
    signal: new AbortController().signal,
    emit: vi.fn(),
    requestInput,
  });
  await vi.advanceTimersByTimeAsync(1100);
  await result;
  expect(requestInput).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[2][0]).toContain("verify_code=123456");
});
it("refreshes an expired QR without reusing its challenge", async () => {
  const replies = [
    { qrcode: "old", qrcode_img_content: "old-link" },
    { status: "expired" },
    { qrcode: "new", qrcode_img_content: "new-link" },
    {
      status: "confirmed",
      bot_token: "token",
      ilink_bot_id: "bot",
      ilink_user_id: "owner",
    },
  ];
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(replies.shift()),
  );
  const emit = vi.fn();
  await onboard(new WeixinApi(fetcher), {
    signal: new AbortController().signal,
    emit,
  });
  expect(emit.mock.calls.filter(([u]) => u.kind === "qr")).toHaveLength(2);
  expect(fetcher.mock.calls[3][0]).toContain("qrcode=new");
});
it("cancels the live QR request immediately", async () => {
  const abort = new AbortController();
  const api = new WeixinApi(
    async (_url, init) =>
      new Promise<Response>((_, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        ),
      ),
  );
  const pending = onboard(api, { signal: abort.signal, emit: vi.fn() });
  abort.abort();
  await expect(pending).rejects.toThrow("aborted");
});
it("rejects redirected hosts outside Weixin before contacting them", async () => {
  const replies = [
    { qrcode: "qr", qrcode_img_content: "link" },
    { status: "scaned_but_redirect", redirect_host: "evil.test" },
  ];
  const fetcher = vi.fn(async () => Response.json(replies.shift()));
  await expect(
    onboard(new WeixinApi(fetcher), {
      signal: new AbortController().signal,
      emit: vi.fn(),
    }),
  ).rejects.toThrow("untrusted_url");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
