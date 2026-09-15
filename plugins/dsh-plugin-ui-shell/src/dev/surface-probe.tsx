import { useEffect, useState, useSyncExternalStore } from "react";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { SurfaceVisualOwner } from "@amiba/extension-sdk";
import { usePresentationCoordinator } from "@amiba/ui/plugin";

const idleInput = {
  pointer: null,
  input: { focused: false, active: false, composing: false },
};
const idleActivity = { phase: "idle", restored: true };
const noopSubscribe = () => () => {};
/** Development-only DSH plugin. Never added to production bundles. */
export const name = "amiba-surface-probe";
function Probe({
  interaction,
  activity,
  presentation,
  place,
  priority,
}: SurfaceVisualOwner & { place: string; priority: number }) {
  const root = usePresentationCoordinator();
  const coordinator = presentation ?? root;
  const input = useSyncExternalStore(
    interaction?.subscribe ?? noopSubscribe,
    interaction?.getSnapshot ?? (() => idleInput),
  );
  const state = useSyncExternalStore(
    activity?.subscribe ?? noopSubscribe,
    activity?.getSnapshot ?? (() => idleActivity),
  );
  const [enabled, setEnabled] = useState(false),
    [clicks, setClicks] = useState(0);
  useEffect(() => {
    if (!coordinator) return;
    const lease = coordinator.claim("surface-probe", priority);
    const update = () => setEnabled(lease.getSnapshot());
    const off = lease.subscribe(update);
    update();
    return () => {
      off();
      lease.release();
    };
  }, [coordinator, priority]);
  return (
    <button
      type="button"
      aria-label={`Probe ${place}`}
      data-probe={place}
      data-enabled={enabled}
      data-phase={state.phase}
      data-restored={state.restored}
      data-typing={input.input.active}
      data-composing={input.input.composing}
      data-x={input.pointer?.x ?? ""}
      data-clicks={clicks}
      onClick={() => setClicks((n) => n + 1)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        border: 0,
        background: "transparent",
        color: "inherit",
        padding: 4,
      }}
    >
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="26" fill={enabled ? "#789174" : "#cbd0c6"} />
        <circle
          cx={24 + (input.pointer?.x ?? 0) * 4}
          cy={29 + (input.pointer?.y ?? 0) * 4}
          r="3"
          fill="white"
        />
        <circle
          cx={40 + (input.pointer?.x ?? 0) * 4}
          cy={29 + (input.pointer?.y ?? 0) * 4}
          r="3"
          fill="white"
        />
      </svg>
      <span>
        {place} · {state.phase}
      </span>
    </button>
  );
}
export function apply(ctx: Pick<ClientContext, "slots">) {
  const disposers = [
    ctx.slots.inject("amiba.emptyState.visual", () =>
      ctx.slots.register(
        {
          name: "amiba.emptyState.visual",
          id: "surface-probe",
          label: "Interaction probe",
        },
        (owner) => <Probe {...owner} place="empty" priority={30} />,
      ),
    ),
    ctx.slots.inject("amiba.emptyState.visual", () =>
      ctx.slots.register(
        {
          name: "amiba.emptyState.visual",
          id: "surface-probe-card",
          label: "Welcome card probe",
        },
        () => <div data-probe-card="">Welcome illustration</div>,
      ),
    ),
    ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register({ name: "shell.overlay", id: "surface-probe" }, () => (
        <div
          style={{ position: "fixed", right: 8, bottom: 8, pointerEvents: "auto" }}
        >
          <Probe place="overlay" priority={0} />
        </div>
      )),
    ),
  ];
  return () => disposers.reverse().forEach((dispose) => dispose());
}
