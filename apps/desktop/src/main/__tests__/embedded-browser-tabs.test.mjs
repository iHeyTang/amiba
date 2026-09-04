import assert from "node:assert/strict";
import test from "node:test";

const { BrowserTabIndex, browserTabKey } = await import(
  "../embedded-browser-tabs.ts"
);

function tab(tabId, sessionId, { destroyed = false } = {}) {
  return {
    key: browserTabKey(1, tabId),
    tabId,
    sessionId,
    contents: { isDestroyed: () => destroyed },
  };
}

test("a session's call never lands on another session's tab", () => {
  const index = new BrowserTabIndex();
  const visible = tab("tab-visible", "session-visible");
  index.add(visible, true);

  // The steward's background task has no tab of its own yet: it must NOT
  // adopt the tab of the conversation the user is looking at.
  assert.equal(index.active("session-background"), undefined);
  assert.equal(index.active("session-visible"), visible);

  const background = tab("tab-background", "session-background");
  // A background session mounts its webview hidden, so it registers as
  // inactive — and still has to become its OWN session's active tab.
  index.add(background, false);
  assert.equal(index.active("session-background"), background);
  assert.equal(index.active("session-visible"), visible);

  // The visible session stays the globally active tab: registering a hidden
  // background tab must not steal the session-less (user-driven) route.
  assert.equal(index.active(), visible);
});

test("a session-less call keeps the global last-active behaviour", () => {
  const index = new BrowserTabIndex();
  const first = tab("tab-1");
  const second = tab("tab-2");
  index.add(first, true);
  assert.equal(index.active(), first);
  index.add(second, true);
  assert.equal(index.active(), second);

  index.activate(first);
  assert.equal(index.active(), first);
});

test("registration waiters are bucketed by session", () => {
  const index = new BrowserTabIndex();
  const seenByBackground = [];
  const seenByAnyone = [];
  index.addRegistrationWaiter("session-background", (entry) =>
    seenByBackground.push(entry.tabId),
  );
  index.addRegistrationWaiter(undefined, (entry) =>
    seenByAnyone.push(entry.tabId),
  );

  index.add(tab("tab-visible", "session-visible"), true);
  assert.deepEqual(seenByBackground, []);
  assert.deepEqual(seenByAnyone, ["tab-visible"]);

  index.add(tab("tab-background", "session-background"), false);
  assert.deepEqual(seenByBackground, ["tab-background"]);
  assert.deepEqual(seenByAnyone, ["tab-visible", "tab-background"]);

  const cancel = index.addRegistrationWaiter("session-background", () => {
    throw new Error("a cancelled waiter must not be resolved");
  });
  cancel();
  index.add(tab("tab-background-2", "session-background"), false);
});

test("closing a tab falls back inside its own session", () => {
  const index = new BrowserTabIndex();
  const visible = tab("tab-visible", "session-visible");
  const backgroundOne = tab("tab-background-1", "session-background");
  const backgroundTwo = tab("tab-background-2", "session-background");
  index.add(visible, true);
  index.add(backgroundOne, false);
  index.add(backgroundTwo, false);
  assert.equal(index.active("session-background"), backgroundOne);

  index.delete(backgroundOne.key);
  assert.equal(index.active("session-background"), backgroundTwo);
  assert.equal(index.active("session-visible"), visible);

  index.delete(backgroundTwo.key);
  // No fallback to the visible session's tab — the background session simply
  // has no browser any more.
  assert.equal(index.active("session-background"), undefined);
});

test("a destroyed tab is never handed out", () => {
  const index = new BrowserTabIndex();
  const dead = tab("tab-dead", "session-background", { destroyed: true });
  index.add(dead, true);
  assert.equal(index.active("session-background"), undefined);
  assert.equal(index.active(), undefined);
});
