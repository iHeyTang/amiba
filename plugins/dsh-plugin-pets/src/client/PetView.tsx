import { useEffect, useRef } from "react";
import { createSvgRenderer } from "@mofli/core/browser";
import type { Activity, PetConfig } from "@mofli/core";
import type { ComposerAccessoryOwner } from "@amiba/extension-sdk";
import { companionScene, companionExpression, type CompanionScene } from "./companion-behavior.js";
import { registry } from "../model.js";
export function PetView({
  config,
  name,
  interaction,
  activity,
  presentation,
  priority = 10,
  debug = false,
  previewActivity,
  className = "h-24 w-24",
}: ComposerAccessoryOwner & {
  config: PetConfig;
  name: string;
  priority?: number;
  debug?: boolean;
  previewActivity?: Activity;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const pet = registry.create(config),
      renderer = createSvgRenderer(ref.current, { debug }),
      svg = renderer.svg;
    svg.setAttribute("role", "button");
    svg.setAttribute("tabindex", "0");
    svg.setAttribute("aria-label", name);
    svg.style.cssText =
      `display:block;width:100%;height:100%;overflow:visible;cursor:pointer;opacity:${presentation ? 0 : 1}`;
    if (presentation) {
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("tabindex", "-1");
      svg.style.pointerEvents = "none";
    }
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let time = 0,
      last = 0,
      raf = 0,
      enabled = false,
      dead = false;
    let scene: CompanionScene = "idle", sceneAt = 0, expression = -100;
    const businessDriven = !!(interaction || activity);
    if (businessDriven && pet.engine.rig.parameters.customFace) {
      pet.engine.setRigConfig({ ...pet.engine.getRigConfig(), customFace: 1, faceYaw: 0, facePitch: 0, faceRoll: 0 }, 0);
    }
    const draw = () => {
      if (businessDriven) {
        const next = companionExpression(scene, media.matches ? 0 : time - sceneAt);
        if (next !== expression) {
          expression = next;
          const rules = pet.engine.rig.poseParameters;
          if (rules?.state && rules?.expression) pet.engine.setPose({ ...pet.engine.getPose(), state: 0, expression: next }, time);
        }
        svg.dataset.companionScene = scene;
        svg.dataset.companionExpression = String(next);
      }
      renderer.render(pet.sample(time, media.matches));
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
      pet.engine.handle(
        { type: "look", value: input?.pointer ?? { x: 0, y: 0 } },
        time,
      );
      const nextScene = companionScene(state, input);
      if (nextScene !== scene) { scene = nextScene; sceneAt = time; }
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
              : input?.pointer
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
    const move = (e: PointerEvent) => {
      if (interaction) return;
      const r = svg.getBoundingClientRect();
      pet.engine.handle(
        {
          type: "look",
          value: {
            x: Math.max(
              -1,
              Math.min(1, (2 * (e.clientX - r.left)) / r.width - 1),
            ),
            y: Math.max(
              -1,
              Math.min(1, (2 * (e.clientY - r.top)) / r.height - 1),
            ),
          },
        },
        time,
      );
    };
    const tap = (e: MouseEvent) => {
      if (!enabled) return;
      pet.engine.handle(
        {
          type: "tap",
          hit: renderer.hitTest(e.clientX, e.clientY),
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
    svg.addEventListener("pointermove", move);
    svg.addEventListener("click", tap);
    svg.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", sync);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      offInput?.();
      offActivity?.();
      offLease?.();
      lease?.release();
      document.removeEventListener("visibilitychange", sync);
      renderer.destroy();
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
  ]);
  return <div ref={ref} className={className} data-mofli-pet="" />;
}
