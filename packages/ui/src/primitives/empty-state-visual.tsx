import {
  PresentationBoundary,
  useSurfaceInteraction,
  useSurfaceActivity,
} from "./interaction-region";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type {
  EmptyStateVisualOwner,
  ComposerAccessoryOwner,
  MessageDecorationOwner,
} from "@amiba/extension-sdk";

export type EmptyStateVisualRenderer = (
  owner: EmptyStateVisualOwner,
) => ReactNode;
const MessageRenderer = createContext<
  ((owner: MessageDecorationOwner) => ReactNode) | undefined
>(undefined);
const AccessoryRenderer = createContext<
  ((owner: ComposerAccessoryOwner) => ReactNode) | undefined
>(undefined);
const Renderer = createContext<EmptyStateVisualRenderer | undefined>(undefined);

/** The shell supplies the real Slot dispatcher; standalone hosts keep defaults. */
export function EmptyStateVisualProvider({
  render,
  accessory,
  message,
  children,
}: {
  message?: (owner: MessageDecorationOwner) => ReactNode;
  accessory?: (owner: ComposerAccessoryOwner) => ReactNode;
  render: EmptyStateVisualRenderer;
  children: ReactNode;
}) {
  return (
    <Renderer.Provider value={render}>
      <AccessoryRenderer.Provider value={accessory}>
        <MessageRenderer.Provider value={message}>
          {children}
        </MessageRenderer.Provider>
      </AccessoryRenderer.Provider>
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

export function ComposerAccessory() {
  const render = useContext(AccessoryRenderer);
  const interaction = useSurfaceInteraction();
  const activity = useSurfaceActivity();
  const perch = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = perch.current;
    const card = host?.closest("[data-composer-card]");
    if (!host || !card) return;
    const dock = host.closest<HTMLElement>("[data-composer-dock]");
    // Overlays may be portalled outside the composer. Test their actual screen
    // rectangles, including animated menus, instead of raising our z-index.
    const place = () => {
      const width = host.offsetWidth, height = host.offsetHeight;
      // Include the perch plus breathing room in the dock's measured height.
      // ChatSurface already reserves that height at the end of the transcript.
      dock?.style.setProperty("--amiba-companion-clearance", `${height ? Math.max(0, height - 8) + 12 : 0}px`);
      const c = card.getBoundingClientRect();
      const safeTop = dock ? dock.getBoundingClientRect().top + 8 : 8;
      const obstacles = Array.from(document.querySelectorAll<HTMLElement>(
        '[data-ui-overlay], [data-composer-overlay], [role="listbox"], [role="menu"], [role="dialog"], [data-sonner-toast], [data-radix-popper-content-wrapper], [data-composer-context-rail]'
      )).filter(el => !el.contains(host) && !host.contains(el) && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none").map(el => el.getBoundingClientRect());
      const left = c.right - width - 16, top = c.top - height + 8;
      const candidates = [
        { x: left, y: top },
        { x: c.left + 16, y: top },
        ...obstacles.map(r => ({ x: left, y: r.top - height - 8 })),
      ];
      const selected = candidates.find(p => p.x >= 8 && p.y >= safeTop && p.x + width <= innerWidth - 8 && p.y + height <= innerHeight - 8 && !obstacles.some(r => p.x < r.right + 8 && p.x + width > r.left - 8 && p.y < r.bottom + 8 && p.y + height > r.top - 8));
      host.style.opacity = selected ? "1" : "0";
      host.inert = !selected;
      host.setAttribute("aria-hidden", String(!selected));
      host.style.pointerEvents = selected ? "auto" : "none";
      if (selected) host.style.transform = `translate(${selected.x - left}px, ${selected.y - top}px)`;
    };
    place();
    const timer = window.setInterval(place, 100);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { dock?.style.removeProperty("--amiba-companion-clearance"); clearInterval(timer); window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [render]);
  return render ? (
    <div ref={perch} className="absolute right-4 bottom-[calc(100%-8px)] z-0 w-20 motion-safe:transition-transform motion-safe:duration-200" data-composer-perch="">
      <PresentationBoundary
        data-composer-accessory=""
        className="relative isolate max-h-20 overflow-hidden empty:hidden"
      >
        {(presentation) => render({ interaction, activity, presentation })}
      </PresentationBoundary>
    </div>
  ) : null;
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
