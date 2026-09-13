import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ConnectorInboundEnvelope } from "@amiba/dsh-plugin-connector-core";
import { configSchema, WeixinApi, type Message } from "./api.js";
import { createWeixinProvider, type WeixinRuntime } from "./provider.js";
const config = configSchema.parse({
  botToken: "secret",
  botId: "bot",
  userId: "owner",
});
const roots: string[] = [];
const live: WeixinRuntime[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((r) => r.stop()));
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
const message = (id = "one"): Message => ({
  message_id: id,
  message_type: 1,
  from_user_id: "owner",
  context_token: "context",
  item_list: [{ type: 1, text_item: { text: "hello" } }],
});
const envelope = {
  id: "out",
  channelId: "channel",
  sessionId: "session",
  inReplyTo: "one",
  text: "reply",
  createdAt: "",
};
async function setup(
  messages: Message[],
  root?: string,
  overrides: {
    failSendAt?: number;
    expired?: boolean;
    rejectInbound?: boolean;
  } = {},
) {
  root ??= await mkdtemp(path.join(tmpdir(), "weixin-provider-"));
  if (!roots.includes(root)) roots.push(root);
  let first = true;
  let sends = 0;
  const bodies: Array<{ endpoint: string; body: any }> = [];
  const api = new WeixinApi(async (url, init) => {
    const endpoint = String(url).split("/").at(-1)!;
    const body = JSON.parse(init!.body as string);
    bodies.push({ endpoint, body });
    if (endpoint === "getupdates") {
      if (first) {
        first = false;
        return Response.json(
          overrides.expired
            ? { ret: -14 }
            : { msgs: messages, get_updates_buf: "next" },
        );
      }
      return new Promise<Response>((_, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        ),
      );
    }
    if (endpoint === "sendmessage" && ++sends === overrides.failSendAt)
      return Response.json({ ret: 99 });
    return Response.json({ ret: 0, message_id: `server-${sends}` });
  });
  const inbound = vi.fn(async (_envelope: ConnectorInboundEnvelope) => {
    if (overrides.rejectInbound) throw new Error("queue unavailable");
    return { accepted: true as const, duplicate: false, sessionId: "session" };
  });
  const status = vi.fn();
  const runtimes = new Map<string, WeixinRuntime>();
  const provider = createWeixinProvider({ root, api, runtimes });
  const runtime = (await provider.start({
    connectId: "connect",
    config,
    setStatus: status,
    onInbound: inbound,
  })) as WeixinRuntime;
  live.push(runtime);
  return { runtime, inbound, status, bodies, root, runtimes, provider };
}
it("routes only the bound personal sender and deduplicates deliveries", async () => {
  const run = await setup([
    message(),
    message(),
    { ...message("foreign"), from_user_id: "other" },
    { ...message("group"), group_id: "group" },
    { ...message("bot"), message_type: 2 },
  ]);
  await vi.waitFor(() =>
    expect(run.status).toHaveBeenCalledWith({ state: "ready" }),
  );
  expect(run.inbound).toHaveBeenCalledTimes(1);
  expect(run.inbound.mock.calls[0][0]).toMatchObject({
    sender: "owner",
    text: "hello",
    conversation: { kind: "p2p", key: "owner" },
  });
  await run.runtime.deliver!({ key: "owner", kind: "p2p" }, envelope);
  await run.runtime.deliver!({ key: "owner", kind: "p2p" }, envelope);
  expect(run.bodies.filter((b) => b.endpoint === "sendmessage")).toHaveLength(
    1,
  );
  expect(
    run.bodies.find((b) => b.endpoint === "sendmessage")?.body.msg
      .context_token,
  ).toBe("context");
  await expect(
    run.runtime.deliver!({ key: "other", kind: "p2p" }, envelope),
  ).rejects.toThrow("recipient_not_owner");
});
it("persists cursor, context and receipts across restarts for delayed replies", async () => {
  const first = await setup([message()]);
  await vi.waitFor(() =>
    expect(first.status).toHaveBeenCalledWith({ state: "ready" }),
  );
  await first.runtime.stop();
  const second = await setup([message()], first.root);
  await vi.waitFor(() =>
    expect(second.status).toHaveBeenCalledWith({ state: "ready" }),
  );
  expect(second.bodies[0].body.get_updates_buf).toBe("next");
  expect(second.inbound).not.toHaveBeenCalled();
  await second.runtime.deliver!({ key: "owner", kind: "p2p" }, envelope);
  expect(
    second.bodies.find((b) => b.endpoint === "sendmessage")?.body.msg
      .context_token,
  ).toBe("context");
});
it("retries only unsent chunks after a partial reply failure", async () => {
  const run = await setup([message()], undefined, { failSendAt: 2 });
  await vi.waitFor(() =>
    expect(run.status).toHaveBeenCalledWith({ state: "ready" }),
  );
  const long = { ...envelope, text: "😊".repeat(4200) };
  await expect(
    run.runtime.deliver!({ key: "owner", kind: "p2p" }, long),
  ).rejects.toThrow("weixin_api_99");
  await run.runtime.deliver!({ key: "owner", kind: "p2p" }, long);
  const messages = run.bodies
    .filter((b) => b.endpoint === "sendmessage")
    .map((b) => b.body.msg);
  expect(messages).toHaveLength(4);
  expect(messages[1].client_id).toBe(messages[2].client_id);
  expect(Array.from(messages[0].item_list[0].text_item.text)).toHaveLength(
    2000,
  );
});
it("does not advance cursor if the inbound queue rejects", async () => {
  const run = await setup([message()], undefined, { rejectInbound: true });
  await vi.waitFor(() =>
    expect(run.status).toHaveBeenCalledWith(
      expect.objectContaining({ state: "degraded" }),
    ),
  );
  await run.runtime.stop();
  const next = await setup([], run.root);
  await vi.waitFor(() =>
    expect(next.status).toHaveBeenCalledWith({ state: "ready" }),
  );
  expect(next.bodies[0].body.get_updates_buf).toBe("");
});
it("clears expired context and reports authorization failure", async () => {
  const first = await setup([message()]);
  await vi.waitFor(() =>
    expect(first.status).toHaveBeenCalledWith({ state: "ready" }),
  );
  await first.runtime.stop();
  const next = await setup([], first.root, { expired: true });
  await vi.waitFor(() =>
    expect(next.status).toHaveBeenCalledWith(
      expect.objectContaining({ state: "error" }),
    ),
  );
  await expect(
    next.runtime.deliver!({ key: "owner", kind: "p2p" }, envelope),
  ).rejects.toThrow("send_a_message_first");
});
it("stops polling and removes the live runtime on unload", async () => {
  const run = await setup([]);
  await vi.waitFor(() =>
    expect(run.status).toHaveBeenCalledWith({ state: "ready" }),
  );
  await run.runtime.stop();
  expect(run.runtimes.size).toBe(0);
  await expect(
    run.runtime.deliver!({ key: "owner", kind: "p2p" }, envelope),
  ).rejects.toThrow();
});
it("restores quoted text and voice transcripts", async () => {
  const run = await setup([
    message(),
    {
      ...message("two"),
      item_list: [
        {
          type: 3,
          voice_item: { text: "summarize that" },
          ref_msg: { svr_id: "one" },
        },
      ],
    },
  ]);
  await vi.waitFor(() =>
    expect(run.status).toHaveBeenCalledWith({ state: "ready" }),
  );
  expect(run.inbound.mock.calls[1][0]).toMatchObject({
    text: "summarize that\n[引用消息：hello]",
  });
});
