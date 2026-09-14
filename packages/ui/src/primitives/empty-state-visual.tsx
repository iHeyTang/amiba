import {
  PresentationBoundary,
  useSurfaceInteraction,
  useSurfaceActivity,
} from "./interaction-region";
import { createContext, useContext, type ReactNode } from "react";
import type {
  EmptyStateVisualOwner,
  MessageDecorationOwner,
} from "@amiba/extension-sdk";

export type EmptyStateVisualRenderer = (
  owner: EmptyStateVisualOwner,
) => ReactNode;
const MessageRenderer = createContext<
  ((owner: MessageDecorationOwner) => ReactNode) | undefined
>(undefined);
const Renderer = createContext<EmptyStateVisualRenderer | undefined>(undefined);

/** The shell supplies the real Slot dispatcher; standalone hosts keep defaults. */
export function EmptyStateVisualProvider({
  render,
  message,
  children,
}: {
  message?: (owner: MessageDecorationOwner) => ReactNode;
  render: EmptyStateVisualRenderer;
  children: ReactNode;
}) {
  return (
    <Renderer.Provider value={render}>
      <MessageRenderer.Provider value={message}>
        {children}
      </MessageRenderer.Provider>
    </Renderer.Provider>
  );
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

export function MessageDecoration(
  props: Pick<MessageDecorationOwner, "sessionId" | "messageId" | "streaming">,
) {
  const render = useContext(MessageRenderer);
  const interaction = useSurfaceInteraction(),
    activity = useSurfaceActivity();
  return render ? (
    <PresentationBoundary
      data-message-decoration={props.messageId}
      className="relative isolate max-h-24 overflow-hidden empty:hidden"
    >
      {(presentation) =>
        render({ ...props, interaction, activity, presentation })
      }
    </PresentationBoundary>
  ) : null;
}
