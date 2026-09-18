import { createPresentationCoordinator } from "./presentation-coordinator";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import type {
  SurfaceInteraction,
  SurfaceInteractionSnapshot,
  SurfaceActivity,
  PresentationCoordinator,
} from "@amiba/extension-sdk";

export function createSurfaceInteraction() {
  let snapshot: SurfaceInteractionSnapshot = {
    pointer: null,
    input: { focused: false, active: false, composing: false },
  };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = (next: SurfaceInteractionSnapshot) => {
    snapshot = next;
    listeners.forEach((fn) => fn());
  };
  const input = (patch: Partial<SurfaceInteractionSnapshot["input"]>) =>
    update({ ...snapshot, input: { ...snapshot.input, ...patch } });
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    pointer: (x: number, y: number) =>
      update({ ...snapshot, pointer: { x, y } }),
    leave: () => update({ ...snapshot, pointer: null }),
    focus: () => input({ focused: true }),
    blur: () => {
      clear();
      input({ focused: false, active: false, composing: false });
    },
    activity: () => {
      clear();
      input({ active: true });
      if (!snapshot.input.composing)
        timer = setTimeout(() => input({ active: false }), 650);
    },
    composition: (composing: boolean) => {
      clear();
      input({ composing, active: true });
      if (!composing) timer = setTimeout(() => input({ active: false }), 650);
    },
    dispose: () => {
      clear();
      listeners.clear();
    },
  };
}
const RootContext = createContext<
  ReturnType<typeof createPresentationCoordinator> | undefined
>(undefined);
export function PresentationRoot({ children }: { children: ReactNode }) {
  const [root] = useState(createPresentationCoordinator);
  useEffect(() => {
    const update = () => root.setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      document.removeEventListener("visibilitychange", update);
      root.setVisible(false);
    };
  }, [root]);
  return <RootContext.Provider value={root}>{children}</RootContext.Provider>;
}
const ActivityContext = createContext<SurfaceActivity | undefined>(undefined);
const PresentationContext = createContext<PresentationCoordinator | undefined>(
  undefined,
);
export const useSurfaceActivity = () => useContext(ActivityContext);
export const usePresentationCoordinator = () => {
  const local = useContext(PresentationContext);
  const root = useContext(RootContext);
  return local ?? root?.coordinator;
};
const Context = createContext<SurfaceInteraction | undefined>(undefined);
export const useSurfaceInteraction = () => useContext(Context);

/** Uses the existing region box; no global listeners or captured input text. */
export function InteractionRegion({
  children,
  activity,
  ...props
}: HTMLAttributes<HTMLDivElement> & { activity?: SurfaceActivity }) {
  const [store] = useState(createSurfaceInteraction);
  const root = useContext(RootContext);
  const [election] = useState(() =>
    root ? root.scope() : createPresentationCoordinator(),
  );
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    let intersects = true;
    const update = () =>
      election.setVisible(intersects && document.visibilityState !== "hidden");
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver((entries) => {
            intersects = entries[0]?.isIntersecting ?? false;
            update();
          });
    if (element) observer?.observe(element);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
      election.setVisible(false);
    };
  }, [element, election]);

  useEffect(() => () => store.dispose(), [store]);
  const editor = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest("[data-composer-card]") &&
    !!target.closest('input,textarea,[contenteditable="true"]');
  // Lexical may handle beforeinput itself and prevent the browser's input event.
  useEffect(() => {
    const beforeInput = (event: Event) => {
      if (editor(event.target)) store.activity();
    };
    element?.addEventListener("beforeinput", beforeInput, true);
    return () => element?.removeEventListener("beforeinput", beforeInput, true);
  }, [element, store]);
  return (
    <ActivityContext.Provider value={activity}>
      <PresentationContext.Provider value={election.coordinator}>
        <Context.Provider value={store}>
          <div
            {...props}
            ref={setElement}
            onPointerMoveCapture={(e) => {
              props.onPointerMoveCapture?.(e);
              const r = e.currentTarget.getBoundingClientRect();
              if (r.width && r.height)
                store.pointer(
                  Math.max(
                    -1,
                    Math.min(1, (2 * (e.clientX - r.left)) / r.width - 1),
                  ),
                  Math.max(
                    -1,
                    Math.min(1, (2 * (e.clientY - r.top)) / r.height - 1),
                  ),
                );
            }}
            onPointerLeave={(e) => {
              props.onPointerLeave?.(e);
              store.leave();
            }}
            onFocusCapture={(e) => {
              props.onFocusCapture?.(e);
              if (editor(e.target)) store.focus();
            }}
            onBlurCapture={(e) => {
              props.onBlurCapture?.(e);
              if (
                editor(e.target) &&
                !(
                  e.relatedTarget instanceof Node &&
                  e.currentTarget.contains(e.relatedTarget) &&
                  editor(e.relatedTarget)
                )
              )
                store.blur();
            }}
            onInputCapture={(e) => {
              props.onInputCapture?.(e);
              if (editor(e.target)) store.activity();
            }}
            onCompositionStartCapture={(e) => {
              props.onCompositionStartCapture?.(e);
              if (editor(e.target)) store.composition(true);
            }}
            onCompositionEndCapture={(e) => {
              props.onCompositionEndCapture?.(e);
              if (editor(e.target)) store.composition(false);
            }}
          >
            {children}
          </div>
        </Context.Provider>
      </PresentationContext.Provider>
    </ActivityContext.Provider>
  );
}

/** Visibility boundary for an individual slot, including offscreen messages. */
export function PresentationBoundary({
  children,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: (presentation: PresentationCoordinator) => ReactNode;
}) {
  const root = useContext(RootContext);
  const [scope] = useState(() =>
    root ? root.scope() : createPresentationCoordinator(),
  );
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    let intersects = true;
    const update = () =>
      scope.setVisible(intersects && document.visibilityState !== "hidden");
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver((entries) => {
            intersects = entries[0]?.isIntersecting ?? false;
            update();
          });
    if (element) observer?.observe(element);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
      scope.setVisible(false);
    };
  }, [element, scope]);
  return (
    <div {...props} ref={setElement}>
      {children(scope.coordinator)}
    </div>
  );
}
