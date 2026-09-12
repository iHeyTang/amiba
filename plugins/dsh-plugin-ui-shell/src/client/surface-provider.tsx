import { useSyncExternalStore, type ReactNode } from "react";
import { EmptyStateVisualProvider } from "@amiba/ui/plugin";
import type { AmibaShellRenderSlot } from "./product-shell.js";
import type { SurfaceSelections } from "./surface-selections.js";
export function SurfaceProvider({
  surfaces,
  renderSlot,
  children,
}: {
  surfaces: SurfaceSelections;
  renderSlot: AmibaShellRenderSlot;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(
    surfaces.subscribe,
    surfaces.getSnapshot,
    surfaces.getSnapshot,
  );
  const selected = (slot: keyof typeof state.rows) => {
    const id = state.choices[slot];
    // Use the installed visual by default; an explicit empty choice disables it.
    if (id === undefined && slot !== "amiba.message.decoration")
      return state.rows[slot][0]?.id;
    return id && state.rows[slot].some((row) => row.id === id) ? id : undefined;
  };
  return (
    <EmptyStateVisualProvider
      render={(owner) => {
        if (!state.ready) return <div className="h-40 w-40" aria-hidden="true" />;
        const id = selected("amiba.emptyState.visual");
        return id
          ? renderSlot("amiba.emptyState.visual", owner, {
              only: id,
              fallback: owner.defaultVisual,
            })
          : owner.defaultVisual;
      }}
      accessory={(owner) => {
        if (!state.ready) return null;
        const id = selected("amiba.composer.accessory");
        return id
          ? renderSlot("amiba.composer.accessory", owner, { only: id })
          : null;
      }}
      message={(owner) => {
        if (!state.ready) return null;
        const id = selected("amiba.message.decoration");
        return id
          ? renderSlot("amiba.message.decoration", owner, { only: id })
          : null;
      }}
    >
      {children}
    </EmptyStateVisualProvider>
  );
}
