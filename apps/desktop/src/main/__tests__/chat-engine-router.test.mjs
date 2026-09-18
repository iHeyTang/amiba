import assert from "node:assert/strict";
import test from "node:test";

import { ChatEngineRouter } from "../chat-engine/router.ts";

test("first viewer of a session reports fresh-follow; later viewers do not", () => {
  const router = new ChatEngineRouter();
  assert.equal(router.subscribe(1, "s1"), true);
  assert.equal(router.subscribe(2, "s1"), false);
  assert.equal(router.subscribe(3, "s2"), true);
});

test("unsubscribe reports last-viewer release once and clears the draft submitter", () => {
  const router = new ChatEngineRouter();
  router.subscribe(1, "s1");
  router.subscribe(2, "s1");
  router.declareSubmitter("s1", 2);
  assert.equal(router.unsubscribe(1, "s1"), false);
  assert.equal(router.submitter("s1"), 2);
  assert.equal(router.unsubscribe(2, "s1"), true);
  assert.equal(router.hasSubscribers("s1"), false);
  // Last viewer left: the session has no draft owner anymore.
  assert.equal(router.submitter("s1"), undefined);
  // Re-subscribing opens a fresh follow.
  assert.equal(router.subscribe(1, "s1"), true);
});

test("unsubscribe of an unknown window/session is a no-op", () => {
  const router = new ChatEngineRouter();
  assert.equal(router.unsubscribe(1, "missing"), false);
  router.subscribe(1, "s1");
  assert.equal(router.unsubscribe(2, "s1"), false);
  assert.equal(router.hasSubscribers("s1"), true);
});

test("subagent addresses are kept per session and cleared on last unsubscribe", () => {
  const router = new ChatEngineRouter();
  const address = {
    parentSessionId: "parent",
    childSessionId: "child",
    mode: "continuable",
  };
  router.subscribe(1, "child", address);
  assert.deepEqual(router.address("child"), address);
  assert.equal(router.unsubscribe(1, "child"), true);
  assert.equal(router.address("child"), undefined);
});

test("route delivers one message to every viewer, and stops after removal", () => {
  const router = new ChatEngineRouter();
  router.subscribe(1, "s1");
  router.subscribe(2, "s1");
  const message = { type: "event" };
  const delivered = [];
  router.route("s1", message, (id, msg) => {
    delivered.push(id);
    assert.equal(msg, message);
  });
  assert.deepEqual(delivered.sort(), [1, 2]);

  router.unsubscribe(1, "s1");
  delivered.length = 0;
  router.route("s1", message, (id) => delivered.push(id));
  assert.deepEqual(delivered, [2]);

  delivered.length = 0;
  router.route("unknown-session", message, (id) => delivered.push(id));
  assert.deepEqual(delivered, []);
});

test("clear drops every subscription, address and submitter", () => {
  const router = new ChatEngineRouter();
  router.subscribe(1, "s1", {
    parentSessionId: "p",
    childSessionId: "c",
    mode: "continuable",
  });
  router.declareSubmitter("s1", 1);
  router.clear();
  assert.equal(router.hasSubscribers("s1"), false);
  assert.equal(router.address("s1"), undefined);
  assert.equal(router.submitter("s1"), undefined);
});