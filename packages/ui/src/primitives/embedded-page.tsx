import { useEffect, useRef, useState } from "react";

function request(request: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const detail = { request, accepted: false, respond: (error?: string) => error ? reject(new Error(error)) : resolve() };
    window.dispatchEvent(new CustomEvent("amiba:embedded-page", { detail }));
    if (!detail.accepted) reject(new Error("Native page rendering requires the Amiba desktop app."));
  });
}

/** A layout placeholder for a host-owned native Chromium view. No iframe. */
export function EmbeddedPage({ url, title, loadingLabel }: { url: string; title: string; loadingLabel: string }) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const id = crypto.randomUUID();
    let active = true;
    let frame = 0;
    let previous = "";
    setError(null);
    setLoading(true);
    const position = () => {
      if (!active || !element.current) return;
      const node = element.current;
      const rect = node.getBoundingClientRect();
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      let visible = !document.hidden && node.getClientRects().length > 0;
      for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) visible = false;
        if (parent !== node && /(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
          const clip = parent.getBoundingClientRect();
          left = Math.max(left, clip.left); top = Math.max(top, clip.top);
          right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
        }
      }
      // Native views are above DOM layers: hide while a different dialog/menu
      // covers this settings section so they cannot swallow its input.
      for (const overlay of document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) {
        if (!overlay.contains(node) && overlay.getClientRects().length && getComputedStyle(overlay).visibility !== "hidden") visible = false;
      }
      const bounds = visible && right > left && bottom > top
        ? { x: left, y: top, width: right - left, height: bottom - top } : null;
      const current = JSON.stringify(bounds);
      if (current !== previous) {
        previous = current;
        void request({ action: "bounds", id, bounds }).catch((cause) => {
          if (active) setError(String(cause));
        });
      }
      frame = requestAnimationFrame(position);
    };
    void request({ action: "mount", id, url }).then(() => {
      if (active) { setLoading(false); position(); }
    }, (cause) => { if (active) { setLoading(false); setError(String(cause)); } });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      void request({ action: "unmount", id }).catch(() => {});
    };
  }, [url]);
  return <div ref={element} role="region" aria-label={title} className="relative min-h-[240px] flex-1 bg-background">
    {loading || error ? <p role={error ? "alert" : "status"} className="p-5 text-sm text-muted-foreground">{error ?? loadingLabel}</p> : null}
  </div>;
}
