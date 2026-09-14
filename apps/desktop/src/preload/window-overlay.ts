import { ipcRenderer } from "electron";
import { compositeCaptionColor } from "../shared/window-chrome";

/** Native caption buttons sit above Chromium, so mirror the DOM backdrops. */
export function installWindowOverlaySync() {
  if (process.platform !== "win32") return;
  let scheduled = false;
  let previous = "";
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  };
  const update = () => {
    scheduled = false;
    const titlebar = document.querySelector('[data-testid="native-window-titlebar"]');
    if (!titlebar) return;
    const base = getComputedStyle(titlebar);
    let color = base.backgroundColor;
    let symbolColor = base.color;
    let animating = false;
    const captionX = window.innerWidth - 1;
    const captionY = titlebar.getBoundingClientRect().height / 2;
    for (const overlay of Array.from(document.querySelectorAll('[data-ui-overlay="dialog-overlay"]'))) {
      const rect = overlay.getBoundingClientRect();
      const style = getComputedStyle(overlay);
      if (style.visibility === "hidden" || !rect.width || !rect.height ||
          rect.left > captionX || rect.right < captionX || rect.top > captionY || rect.bottom < captionY) continue;
      let opacity = Number(style.opacity);
      // Settings animates the wrapper around its backdrop.
      for (let parent = overlay.parentElement; parent; parent = parent.parentElement) {
        opacity *= Number(getComputedStyle(parent).opacity);
        animating ||= parent.getAnimations().some(a => a.playState === "running");
      }
      color = compositeCaptionColor(color, style.backgroundColor, opacity);
      symbolColor = compositeCaptionColor(symbolColor, style.backgroundColor, opacity);
      animating ||= overlay.getAnimations().some(a => a.playState === "running");
    }
    const key = `${color}/${symbolColor}`;
    if (key !== previous) {
      previous = key;
      ipcRenderer.send("window-chrome:overlay", { color, symbolColor });
    }
    if (animating) schedule();
  };
  new MutationObserver(schedule).observe(document.documentElement, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ["class", "style", "data-state", "hidden"],
  });
  document.addEventListener("animationstart", schedule, true);
  document.addEventListener("animationend", schedule, true);
  window.addEventListener("resize", schedule);
  schedule();
}
