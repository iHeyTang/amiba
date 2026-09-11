import assert from "node:assert/strict";
import test from "node:test";
import { getWindowChrome, MAC_TRAFFIC_LIGHT_RESERVE } from "../../shared/window-chrome.ts";

test("Windows reserves a separate caption strip on the right", () => {
  const chrome = getWindowChrome("win32");
  assert.equal(chrome.standaloneTitleBar, true);
  assert.equal(chrome.leftInsetPx, 0);
  assert.ok(chrome.rightInsetPx >= 3 * 46);
  assert.equal(chrome.topBarHeightPx, 40);
});

test("macOS retains traffic lights without a second title bar", () => {
  const chrome = getWindowChrome("darwin");
  assert.equal(chrome.leftInsetPx, MAC_TRAFFIC_LIGHT_RESERVE);
  assert.equal(chrome.rightInsetPx, 0);
  assert.equal(chrome.standaloneTitleBar, false);
});

test("other platforms do not acquire Windows caption geometry", () => {
  assert.equal(getWindowChrome("linux").standaloneTitleBar, false);
});
