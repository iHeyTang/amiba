import { useEffect, useRef } from "react";
import { createSpatialRenderer, renderSpatial, dimensionOf } from "../mofli-capabilities.generated.js";
import { createSpatialHitMap } from "./spatial-hit-map.js";
import { createSvgRenderer } from "@mofli/core/browser";
import type { Activity, PetConfig } from "@mofli/core";
import type { SurfaceVisualOwner } from "@amiba/extension-sdk";
import {
  companionScene,
  companionPose,
  type CompanionScene,
} from "./companion-behavior.js";
import { visibleSvgBounds } from "./visible-svg-bounds.js";
import { registry } from "../model.js";
export function PetView({
  desktop,
  config,
  name,
  interaction,
  activity,
  presentation,
  priority = 10,
  debug = false,
  previewActivity,
  previewScene,
  className = "h-24 w-24",
}: SurfaceVisualOwner & {
  desktop?: {
    api: import("@amiba/app-runtime/platform").DesktopPetBridge;
    menu(): void;
  };
  config: PetConfig;
  name: string;
  priority?: number;
  debug?: boolean;
  previewActivity?: Activity;
  previewScene?: CompanionScene;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const pet = registry.create(config);
    const spatial = dimensionOf(pet.engine) === "3d";
    const renderer = spatial ? undefined : createSvgRenderer(ref.current, { debug });
    const spatialRenderer = spatial ? createSpatialRenderer(ref.current) : undefined;
    const svg = renderer?.svg ?? spatialRenderer?.element;
    if (!svg) return () => spatialRenderer?.destroy();
    const hitMap = spatialRenderer?.element ? createSpatialHitMap(spatialRenderer.element) : undefined;
    svg.setAttribute("role", "button");
    svg.setAttribute("tabindex", "0");
    svg.setAttribute("aria-label", name);
    svg.style.cssText = `display:block;width:100%;height:100%;overflow:visible;cursor:pointer;opacity:${presentation ? 0 : 1}`;
    if (presentation) {
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("tabindex", "-1");
      svg.style.pointerEvents = "none";
    }
    // Electron 33's SVG geometry API still requires a native SVGPoint.
    // Convert per element, leaving other plugins' SVG prototypes untouched.
    const adapted = new WeakSet<SVGGeometryElement>();
    const hitTest = (x: number, y: number) => {
      if (hitMap) return hitMap.hitTest(x, y);
      for (const shape of svg.querySelectorAll<SVGGeometryElement>(
        "path,rect,ellipse,circle,polygon,polyline,line",
      )) {
        if (adapted.has(shape)) continue;
        adapted.add(shape);
        const contains = shape.isPointInFill.bind(shape);
        shape.isPointInFill = (point) => {
          if (!point) return contains();
          const nativePoint = renderer!.svg.createSVGPoint();
          nativePoint.x = point.x ?? 0;
          nativePoint.y = point.y ?? 0;
          return contains(nativePoint);
        };
      }
      return renderer!.hitTest(x, y);
    };
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let time = 0,
      last = 0,
      raf = 0,
      enabled = false,
      dead = false;
    let scene: CompanionScene = "idle",
      sceneAt = 0,
      sceneKey = "",
      expression = "";
    const businessDriven = !!(interaction || activity || previewScene);
    if (businessDriven && pet.engine.rig.parameters.customFace) {
      pet.engine.setRigConfig(
        {
          ...pet.engine.getRigConfig(),
          customFace: 1,
          faceYaw: 0,
          facePitch: 0,
          faceRoll: 0,
        },
        0,
      );
    }
    let desktopLook: { x: number; y: number } | null = null;
    let localLook: { x: number; y: number } | null = null;
    let lookingAt: { x: number; y: number } | null = null;
    const syncLook = (allowed = companionPose(scene, time - sceneAt, spatial, media.matches).followsPointer) => {
      allowed = allowed && previewActivity !== "working" && previewActivity !== "success";
      const pointer = interaction?.getSnapshot().pointer ?? desktopLook ?? localLook;
      const next = allowed ? pointer : null;
      svg.dataset.companionFollowingPointer = String(allowed);
      if (next && (next.x !== lookingAt?.x || next.y !== lookingAt?.y)) {
        pet.engine.handle({ type: "look", value: next }, time);
      } else if (!next && lookingAt) {
        // Reset both the target and focus: some rigs also read raw look values.
        pet.engine.handle({ type: "look", value: { x: 0, y: 0 } }, time);
        pet.engine.handle({ type: "hover", value: false }, time);
      }
      lookingAt = next ? { ...next } : null;
    };
    let lastBoundsAt = -1,
      lastHitMapAt = -1,
      lastRenderedAt = -1;
    let lastVisualBounds: { x: number; y: number; width: number; height: number } | null = null;
    const draw = () => {
      let followsPointer = true;
      if (businessDriven) {
        const pose = companionPose(scene, time - sceneAt, spatial, media.matches);
        followsPointer = pose.followsPointer;
        const next = `${pose.state}:${pose.expression}`;
        if (next !== expression) {
          expression = next;
          const rules = pet.engine.rig.poseParameters;
          if (rules?.state && rules?.expression)
            pet.engine.setPose(
              { ...pet.engine.getPose(), state: pose.state, expression: pose.expression },
              time,
            );
        }
        svg.dataset.companionScene = scene;
        svg.dataset.companionExpression = String(pose.expression);
        svg.dataset.companionAction = pose.action;
      }
      syncLook(followsPointer);
      // The pet animates continuously (skin playback), so a dirty check can't
      // skip frames — but a desktop mascot does not need 60 fps of SVG/WebGL
      // repaint in a full-screen transparent window. Cap the visual refresh
      // near 30 fps for the desktop pet; input (look, activity, drag) still
      // lands on the next frame and is perceptually identical at this size.
      const now = performance.now();
      if (desktop && now - lastRenderedAt < 1000 / 30) return;
      lastRenderedAt = now;
      if (spatialRenderer) renderSpatial(spatialRenderer, pet, time, media.matches);
      else renderer!.render(pet.sample(time, media.matches));
      if (hitMap && time - lastHitMapAt > .08) {
        hitMap.update();
        lastHitMapAt = time;
      }
      if (desktop && time - lastBoundsAt > 0.08) {
        lastBoundsAt = time;
        const box = hitMap ? hitMap.bounds() : visibleSvgBounds(renderer!.svg), rect = ref.current!.getBoundingClientRect();
        if (box && rect.width > 0 && rect.height > 0) {
          const next = {
            x: (box.x - rect.x) / rect.width,
            y: (box.y - rect.y) / rect.height,
            width: box.width / rect.width,
            height: box.height / rect.height,
          };
          // The silhouette moves with every animation frame; only tell the
          // main process when the anchor actually shifted.
          if (
            !lastVisualBounds ||
            Math.abs(next.x - lastVisualBounds.x) > 1e-3 ||
            Math.abs(next.y - lastVisualBounds.y) > 1e-3 ||
            Math.abs(next.width - lastVisualBounds.width) > 1e-3 ||
            Math.abs(next.height - lastVisualBounds.height) > 1e-3
          ) {
            lastVisualBounds = next;
            void desktop.api.setVisualBounds(next);
          }
        }
      }
    };
    const tick = (ms: number) => {
      if (dead || !enabled) return;
      time += last ? Math.min((ms - last) / 1000, 0.05) : 0;
      last = ms;
      draw();
      raf = requestAnimationFrame(tick);
    };
    const lease = presentation?.claim("mofli.companion", priority);
    const sync = () => {
      const next = (lease?.getSnapshot() ?? true) && !document.hidden;
      if (next === enabled) return;
      enabled = next;
      svg.dataset.playing = String(enabled);
      // Keep the observed mount's geometry stable while only the elected
      // companion is visible. Removing it from layout would oscillate leases.
      if (lease) {
        svg.style.opacity = enabled ? "1" : "0";
        svg.style.pointerEvents = enabled ? "auto" : "none";
        svg.setAttribute("aria-hidden", String(!enabled));
        svg.setAttribute("tabindex", enabled ? "0" : "-1");
      }
      last = 0;
      if (enabled) {
        raf = requestAnimationFrame(tick);
      } else cancelAnimationFrame(raf);
    };
    const offLease = lease?.subscribe(sync);
    const update = () => {
      const input = interaction?.getSnapshot();
      const state = activity?.getSnapshot();
      const nextScene = previewScene ?? companionScene(state, input);
      const nextKey = ["completed", "failed", "interrupted"].includes(nextScene)
        ? `${nextScene}:${state?.sessionId}:${state?.revision}` : nextScene;
      if (nextKey !== sceneKey) {
        sceneKey = nextKey;
        scene = nextScene;
        sceneAt = time;
      }
      syncLook();
      const phase = state?.phase;
      const value: Activity =
        previewActivity ??
        (phase === "waiting"
          ? "waiting"
          : input?.input.active ||
              ["thinking", "responding", "tooling"].includes(phase ?? "")
            ? "working"
            : phase === "completed" && !state?.restored
              ? "success"
              : "idle");
      pet.engine.handle({ type: "activity", value }, time);
      pet.engine.handle(
        {
          type: "mood",
          value:
            phase === "failed" || phase === "interrupted"
              ? "calm"
              : input?.pointer && companionPose(scene, time - sceneAt, spatial, media.matches).followsPointer
                ? "curious"
                : "calm",
        },
        time,
      );
    };
    const offInput = interaction?.subscribe(update),
      offActivity = activity?.subscribe(update);
    update();
    draw();
    sync();
    let pressing = false,
      dragged = false,
      startX = 0,
      startY = 0,
      ignored = true,
      pointerId = -1;
    const move = (e: PointerEvent) => {
      if (desktop) {
        if (pressing && Math.hypot(e.screenX - startX, e.screenY - startY) > 4)
          dragged = true;
        const next = hitTest(e.clientX, e.clientY).region === "outside";
        if (!pressing && next !== ignored) {
          ignored = next;
          void desktop.api.setIgnoreMouse(next);
        }
      }
      if (interaction || desktop) return;
      const r = svg.getBoundingClientRect();
      localLook = {
        x: Math.max(-1, Math.min(1, (2 * (e.clientX - r.left)) / r.width - 1)),
        y: Math.max(-1, Math.min(1, (2 * (e.clientY - r.top)) / r.height - 1)),
      };
      syncLook();
    };
    const tap = (e: MouseEvent) => {
      if (!enabled || dragged) return;
      pet.engine.handle(
        {
          type: "tap",
          hit: hitTest(e.clientX, e.clientY),
          at: performance.now() / 1000,
          choice: Math.random(),
        },
        time,
      );
    };
    const key = (e: KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && !e.repeat && enabled) {
        e.preventDefault();
        pet.engine.handle(
          { type: "tap", at: performance.now() / 1000, choice: Math.random() },
          time,
        );
      }
    };
    const down = (e: PointerEvent) => {
      if (
        !desktop ||
        e.button !== 0 ||
        hitTest(e.clientX, e.clientY).region === "outside"
      )
        return;
      pressing = true;
      dragged = false;
      pointerId = e.pointerId;
      startX = e.screenX;
      startY = e.screenY;
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* Pointer may already have ended. */
      }
      // While dragging, the whole transparent window is mouse-interactive and
      // the pet lags behind the cursor, so the pointer-up often lands on the
      // window/container instead of the SVG — and when the renderer is
      // overloaded it may not reach the SVG at all. Listen at the window level
      // (capture phase) so the drag ALWAYS terminates and the main process
      // stops chasing the cursor; a missed pointer-up would otherwise leave
      // the pet stuck following the mouse with no way to release it.
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
      void desktop.api.drag(true);
    };
    const up = () => {
      if (pressing) {
        pressing = false;
        if (pointerId !== -1) {
          window.removeEventListener("pointerup", up, true);
          window.removeEventListener("pointercancel", up, true);
          pointerId = -1;
        }
        void desktop?.api.drag(false);
      }
    };
    let pointerTimeout: ReturnType<typeof setTimeout> | undefined;
    const applyDesktopLook = (point: { x: number; y: number } | null) => {
      desktopLook = point;
      syncLook();
    };
    const offPointer = desktop?.api.onPointer((point) => {
      clearTimeout(pointerTimeout);
      applyDesktopLook(point);
      // Reset if the native stream stops, instead of keeping the last pose.
      // The main process keeps a sparse keep-alive while the cursor is still,
      // so this only fires when the stream genuinely goes away.
      pointerTimeout = setTimeout(() => applyDesktopLook(null), 600);
    });
    const leave = () => {
      if (!desktop && !interaction) {
        localLook = null;
        syncLook();
      }
      if (desktop && !pressing) {
        ignored = true;
        void desktop.api.setIgnoreMouse(true);
      }
    };
    const menu = (e: MouseEvent) => {
      if (desktop) {
        e.preventDefault();
        up();
        desktop.menu();
      }
    };
    svg.addEventListener("pointerdown", event => down(event as PointerEvent));
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("contextmenu", event => menu(event as MouseEvent));
    svg.addEventListener("pointermove", event => move(event as PointerEvent));
    svg.addEventListener("click", event => tap(event as MouseEvent));
    svg.addEventListener("keydown", event => key(event as KeyboardEvent));
    document.addEventListener("visibilitychange", sync);
    return () => {
      up();
      dead = true;
      cancelAnimationFrame(raf);
      offPointer?.();
      clearTimeout(pointerTimeout);
      offInput?.();
      offActivity?.();
      offLease?.();
      lease?.release();
      document.removeEventListener("visibilitychange", sync);
      renderer?.destroy();
      spatialRenderer?.destroy();
    };
  }, [
    config,
    name,
    interaction,
    activity,
    presentation,
    priority,
    debug,
    previewActivity,
    previewScene,
    desktop,
  ]);
  return <div ref={ref} className={className} data-mofli-pet="" />;
}
