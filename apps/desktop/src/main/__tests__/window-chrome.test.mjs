import assert from "node:assert/strict";
import test from "node:test";
import { compositeCaptionColor, getWindowChrome, MAC_TRAFFIC_LIGHT_RESERVE } from "../../shared/window-chrome.ts";

test("caption background and symbols receive the same 80% black backdrop", () => {
  assert.equal(compositeCaptionColor("rgb(255, 255, 255)", "rgba(0, 0, 0, 0.8)", 1), "rgb(51, 51, 51)");
  assert.equal(compositeCaptionColor("rgb(231, 231, 231)", "rgba(0, 0, 0, 0.8)", 1), "rgb(46, 46, 46)");
});

test("caption dimming follows fade opacity and restores at the end of exit", () => {
  const base = "rgb(255, 255, 255)";
  assert.equal(compositeCaptionColor(base, "rgba(0, 0, 0, 0.8)", 0.5), "rgb(153, 153, 153)");
  assert.equal(compositeCaptionColor(base, "rgba(0, 0, 0, 0.8)", 0), base);
  assert.equal(compositeCaptionColor(base, "rgba(0, 0, 0, 0)", 1), base);
});

test("nested backdrops compound instead of restoring while a parent stays open", () => {
  const parent = compositeCaptionColor("rgb(255, 255, 255)", "rgba(0, 0, 0, 0.8)", 1);
  assert.equal(compositeCaptionColor(parent, "rgba(0, 0, 0, 0.8)", 1), "rgb(10, 10, 10)");
  assert.equal(compositeCaptionColor(parent, "rgba(0, 0, 0, 0.8)", 0), parent);
});

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
