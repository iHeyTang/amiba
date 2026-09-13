import { describe, it, expect, vi } from "vitest";
import { API_BASE, configSchema, WeixinApi, weixinUrl } from "./api.js";
const signal = new AbortController().signal;
const config = configSchema.parse({
  botToken: "secret",
  botId: "bot",
  userId: "owner",
});
describe("iLink transport", () => {
  it("uses authenticated POST long polling and preserves uint64 IDs", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          '{"ret":0,"msgs":[{"message_id":18446744073709551615,"text":"12345678901234567"}],"get_updates_buf":"cursor"}',
        ),
    );
    const result = await new WeixinApi(fetcher).updates(config, "old", signal);
    expect(result.msgs?.[0].message_id).toBe("18446744073709551615");
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${API_BASE}/ilink/bot/getupdates`);
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer secret",
      "iLink-App-Id": "bot",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      get_updates_buf: "old",
      base_info: { bot_agent: "Amiba/0.1.0" },
    });
  });
  it.each([
    "http://ilinkai.weixin.qq.com",
    "https://weixin.qq.com.evil.test",
    "https://localhost",
    "https://user:pass@ilinkai.weixin.qq.com",
    "https://ilinkai.weixin.qq.com:123",
  ])("rejects credential/media destination %s", (url) => {
    expect(() => weixinUrl(url)).toThrow("weixin_untrusted_url");
  });
  it("rejects business failures without exposing upstream messages or secrets", async () => {
    const api = new WeixinApi(
      vi.fn(async () => Response.json({ ret: -14, errmsg: "private-token" })),
    );
    await expect(api.updates(config, "", signal)).rejects.toThrow(
      "weixin_api_-14",
    );
  });
  it("requires context and the bound recipient before sending", async () => {
    const fetcher = vi.fn();
    const api = new WeixinApi(fetcher);
    await expect(
      api.send(config, "owner", "", {}, "id", signal),
    ).rejects.toThrow("send_a_message_first");
    await expect(
      api.send(config, "stranger", "ctx", {}, "id", signal),
    ).rejects.toThrow("recipient_not_owner");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
