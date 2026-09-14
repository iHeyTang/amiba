import {
  PresentationBoundary,
  useSurfaceInteraction,
  useSurfaceActivity,
} from "./interaction-region";
import { createContext, useContext, type ReactNode } from "react";
import type { EmptyStateVisualOwner } from "@amiba/extension-sdk";

export type EmptyStateVisualRenderer = (
  owner: EmptyStateVisualOwner,
) => ReactNode;
const Renderer = createContext<EmptyStateVisualRenderer | undefined>(undefined);

/** The shell supplies the real Slot dispatcher; standalone hosts keep defaults. */
export function EmptyStateVisualProvider({
  render,
  children,
}: {
  render: EmptyStateVisualRenderer;
  children: ReactNode;
}) {
  return <Renderer.Provider value={render}>{children}</Renderer.Provider>;
}

export function EmptyStateVisual({
  scene,
  children,
}: {
  scene: EmptyStateVisualOwner["scene"];
  children?: ReactNode;
}) {
  const interaction = useSurfaceInteraction();
  const activity = useSurfaceActivity();
  const render = useContext(Renderer);
  return render ? (
    <PresentationBoundary className="relative isolate max-h-48 overflow-hidden empty:hidden">
      {(presentation) =>
        render({
          scene,
          defaultVisual: children,
          interaction,
          activity,
          presentation,
        })
      }
    </PresentationBoundary>
  ) : (
    <>{children}</>
  );
}
