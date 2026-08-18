import assert from "node:assert/strict";
import test from "node:test";

const { parsePluginNotification, pluginNotificationOperation } = await import(
  "../plugin-notification.ts"
);
const { createDshNativeOperationRouter } = await import(
  "../dsh-native-gateway.ts"
);
const { presentPluginNotifierCard } = await import(
  "../../renderer/notifier/plugin-card.ts"
);

test("plugin notification requires a title and a source", () => {
  assert.throws(
    () => parsePluginNotification({ source: "demo" }),
    /title is required/u,
  );
  assert.throws(
    () => parsePluginNotification({ title: "   ", source: "demo" }),
    /title is required/u,
  );
  assert.throws(
    () => parsePluginNotification({ title: "hello" }),
    /source is required/u,
  );
});

test("plugin notification normalizes optional fields", () => {
  const message = parsePluginNotification({
    title: "  Nightly digest\n ready  ",
    body: "  See the summary.  ",
    kind: "success",
    sessionId: " sess-1 ",
    source: "schedule-adapter",
    timestamp: 1_720_000_000_000,
  });
  assert.deepEqual(message, {
    type: "plugin",
    id: message.id,
    title: "Nightly digest ready",
    body: "See the summary.",
    kind: "success",
    sessionId: "sess-1",
    source: "schedule-adapter",
    timestamp: 1_720_000_000_000,
  });
  assert.match(message.id, /^plugin_/u);
});

test("plugin notification defaults unknown kinds and bad timestamps", () => {
  const before = Date.now();
  const message = parsePluginNotification({
    title: "hello",
    source: "demo",
    kind: "loud",
    timestamp: "yesterday",
  });
  assert.equal(message.kind, "info");
  assert.ok(message.timestamp >= before);
  assert.equal(message.body, undefined);
  assert.equal(message.sessionId, undefined);
});

test("plugin notification compacts over-long text with an ellipsis", () => {
  const message = parsePluginNotification({
    title: "t".repeat(400),
    body: "b".repeat(900),
    source: "s".repeat(200),
  });
  assert.equal(message.title.length, 120);
  assert.ok(message.title.endsWith("…"));
  assert.equal(message.body.length, 300);
  assert.equal(message.source.length, 64);
});

test("amiba_notify routes through the native gateway to the notifier", async () => {
  const delivered = [];
  const router = createDshNativeOperationRouter([
    pluginNotificationOperation((message) => delivered.push(message)),
  ]);

  const result = await router.call("amiba_notify", {
    title: "Backup finished",
    kind: "info",
    sessionId: "sess-9",
    source: "demo",
  });

  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].type, "plugin");
  assert.equal(delivered[0].title, "Backup finished");
  assert.equal(delivered[0].sessionId, "sess-9");
  assert.deepEqual(result, { delivered: true, id: delivered[0].id });

  await assert.rejects(
    router.call("amiba_notify", { source: "demo" }),
    /title is required/u,
  );
  assert.equal(delivered.length, 1);
});

test("plugin notifier card maps calm and attention kinds onto existing tones", () => {
  for (const kind of [undefined, "info", "success"]) {
    assert.equal(
      presentPluginNotifierCard({ id: "n1", title: "t", source: "s", kind })
        .tone,
      "complete",
    );
  }
  for (const kind of ["warning", "error"]) {
    assert.equal(
      presentPluginNotifierCard({ id: "n1", title: "t", source: "s", kind })
        .tone,
      "approval",
    );
  }
});

test("plugin notifier card model prefers body and keeps the session action optional", () => {
  const withSession = presentPluginNotifierCard({
    id: "n1",
    title: " Digest ready ",
    body: "3 items",
    kind: "info",
    sessionId: "sess-1",
    source: "schedule-adapter",
  });
  assert.equal(withSession.title, "Digest ready");
  assert.equal(withSession.status, "3 items");
  assert.equal(withSession.sessionId, "sess-1");

  const withoutSession = presentPluginNotifierCard({
    id: "n2",
    title: "Digest ready",
    source: "schedule-adapter",
  });
  assert.equal(withoutSession.status, "schedule-adapter");
  assert.equal(withoutSession.sessionId, undefined);
  assert.equal("sessionId" in withoutSession, false);
});
