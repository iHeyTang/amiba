import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Button, cn } from "../primitives";

export interface SettingsHeaderOverride {
  title: ReactNode;
  onBack?: () => void;
}

interface SettingsPageChromeValue {
  actionsHost: HTMLElement | null;
  setActionsHost: (el: HTMLElement | null) => void;
  override: SettingsHeaderOverride | null;
  setOverride: (o: SettingsHeaderOverride | null) => void;
}

const ChromeContext = createContext<SettingsPageChromeValue | null>(null);

/** Rendered once per page by SettingsPageScaffold — pages never mount this. */
export function SettingsPageChromeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
  const [override, setOverride] = useState<SettingsHeaderOverride | null>(null);
  const setHost = useCallback((el: HTMLElement | null) => {
    setActionsHost(el);
  }, []);
  return (
    <ChromeContext.Provider
      value={{ actionsHost, setActionsHost: setHost, override, setOverride }}
    >
      {children}
    </ChromeContext.Provider>
  );
}

export function useSettingsPageChrome(): SettingsPageChromeValue {
  const value = useContext(ChromeContext);
  if (!value) {
    throw new Error(
      "useSettingsPageChrome must be used inside SettingsPageScaffold",
    );
  }
  return value;
}

/**
 * Drill-in pages override the head (back affordance + item title) while
 * mounted; unmounting or passing null restores the registry defaults.
 */
export function useSettingsPageHeader(
  override: SettingsHeaderOverride | null,
): void {
  const { setOverride } = useSettingsPageChrome();
  const title = override?.title ?? null;
  const onBack = override?.onBack;
  useEffect(() => {
    setOverride(title === null && !onBack ? null : { title, onBack });
    return () => setOverride(null);
  }, [title, onBack, setOverride]);
}

/**
 * Mounts its children into the head's right-side actions cluster.
 * In-tree pages resolve the host from context; DSH plugin sections render
 * in a separate React root (context cannot cross) and pass an explicit
 * `host` getter instead — createPortal works across roots.
 */
export function SettingsPageActions({
  children,
  host,
}: {
  children: ReactNode;
  host?: () => HTMLElement | null;
}): ReactNode {
  const context = useContext(ChromeContext);
  const [externalHost, setExternalHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!host) return;
    setExternalHost(host());
    // The head mounts before section content, but re-resolve on a frame in
    // case this root hydrated first.
    const raf = requestAnimationFrame(() => setExternalHost(host()));
    return () => cancelAnimationFrame(raf);
  }, [host]);
  const target = host ? externalHost : (context?.actionsHost ?? null);
  if (!target) return null;
  return createPortal(children, target);
}

/** Muted intro paragraph — the former pane-header subtitles land here. */
export function SettingsPageDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-[13px] leading-relaxed text-muted-foreground", className)}>
      {children}
    </p>
  );
}

export interface SettingsPageActionButtonProps
  extends Omit<ComponentPropsWithoutRef<typeof Button>, "size"> {
  /** Square icon-only mode (h-7 w-7); default is the compact text button. */
  icon?: boolean;
}

/**
 * The one action-button spec for the settings head. Every control mounted
 * through SettingsPageActions uses this instead of picking its own size, so
 * the head's density matches the chat-surface headers (h-7 rows) everywhere.
 */
export function SettingsPageActionButton({
  icon = false,
  className,
  ...props
}: SettingsPageActionButtonProps) {
  return (
    <Button
      size={icon ? "icon" : "sm"}
      className={cn(
        icon
          ? "h-7 w-7 rounded-lg [&_svg]:size-3.5"
          : "h-7 gap-1.5 rounded-lg px-2.5 text-xs shadow-none [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}
