import { useLayoutEffect, useRef } from "react";

export function useMessageGlass(complete: boolean, align: "left" | "right") {
  const chromeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const chrome = chromeRef.current;
    const body = chrome?.querySelector<HTMLElement>("[data-message-glass-body]");
    const tab = chrome?.querySelector<HTMLElement>('[data-background-surface="message-actions"]');
    if (!chrome || !body) return;
    let generation = 0;
    let lastGeometry = "";
    const measure = () => {
      const w = chrome.clientWidth, h = body.offsetHeight;
      if (!w || !h) {
        generation++;
        lastGeometry = "";
        chrome.removeAttribute("data-unified-glass");
        return;
      }
      const th = tab?.offsetHeight ?? 0;
      const tw = Math.min(tab?.offsetWidth ?? 0, w - 20);
      const geometry = `${w}:${h}:${th}:${tw}`;
      if (geometry === lastGeometry) return;
      lastGeometry = geometry;
      const currentGeneration = ++generation;
      // Alpha-mask the final filtered pixels, not just the layer geometry.
      const path = `M12 0 H${w-12} Q${w} 0 ${w} 12 V${h-12} Q${w} ${h} ${w-12} ${h} H${tw+8} Q${tw} ${h} ${tw} ${h+8} V${h+th-12} Q${tw} ${h+th} ${tw-12} ${h+th} H12 Q0 ${h+th} 0 ${h+th-12} V12 Q0 0 12 0 Z`;
      const closedPath = `M12 0 H${w-12} Q${w} 0 ${w} 12 V${h-12} Q${w} ${h} ${w-12} ${h} H${tw+8} Q${tw} ${h} ${tw} ${h} V${h} Q${tw} ${h} ${tw} ${h} H12 Q0 ${h} 0 ${h-12} V12 Q0 0 12 0 Z`;
      const mirror = align === "right" ? `translate(${w} 0) scale(-1 1)` : "";
      const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h+th}" viewBox="0 0 ${w} ${h+th}">${th ? `<path d="${path}" transform="${mirror}" fill="white"/>` : `<rect width="${w}" height="${h}" rx="12" fill="white"/>`}</svg>`;
      const closedMask = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h+th}" viewBox="0 0 ${w} ${h+th}"><rect width="${w}" height="${h}" rx="12" fill="white"/></svg>`;
      const openUrl = `data:image/svg+xml,${encodeURIComponent(mask)}`;
      const closedUrl = `data:image/svg+xml,${encodeURIComponent(closedMask)}`;
      // A CSS mask paints transparent until its image is decoded. Keep the
      // native body (or previous mask) until BOTH hover states are ready.
      void Promise.all([openUrl, closedUrl].map(async src => {
        const image = new Image();
        image.src = src;
        await image.decode();
      })).then(() => {
        if (generation !== currentGeneration) return;
        chrome.style.setProperty("--assistant-glass-mask", `url("${openUrl}")`);
        chrome.style.setProperty("--assistant-glass-mask-closed", `url("${closedUrl}")`);
        chrome.style.setProperty("--assistant-glass-closed", th ? `path('${closedPath}')` : "inset(0 round 12px)");
        chrome.style.setProperty("--assistant-glass-outline", th ? `path('${path}')` : "inset(0 round 12px)");
        chrome.style.setProperty("--message-glass-height", `${h+th}px`);
        chrome.setAttribute("data-unified-glass", "");
      }).catch(() => {
        if (generation !== currentGeneration) return;
        lastGeometry = "";
        chrome.removeAttribute("data-unified-glass");
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(chrome);
    observer.observe(body);
    if (tab) observer.observe(tab);
    return () => {
      generation++;
      observer.disconnect();
    };
  }, [complete, align]);
  return chromeRef;

}
