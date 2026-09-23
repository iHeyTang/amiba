import { createContext, useContext, type ReactNode } from "react";

/** rc.2 replacement seats. Native presentation remains the default at priority -1. */
export const OFFICIAL_REPLACEMENTS = {
  "conversation.composer.bar": { kind: "single", scope: "session-maybe" },
  "conversation.input.attachments": { kind: "single", scope: "session-maybe" },
  "main.conversation": { kind: "single", scope: "session-maybe" },
  "conversation.session": { kind: "single", scope: "session" },
  "conversation.session.header": { kind: "single", scope: "session" },
  "sidebar": { kind: "single", scope: "root" },
  "sidebar.brand.mark": { kind: "single", scope: "root" },
  "sidebar.brand.name": { kind: "single", scope: "root" },
  "sidebar.workspaces": { kind: "single", scope: "root" },
  "sidebar.settings": { kind: "single", scope: "root" },
  "conversation.hero.brand.mark": { kind: "single", scope: "root" },
} as const;

const NativePresentation = createContext<ReactNode>(null);
/** Default occupant; stronger plugin registrations replace it, including with null. */
export function NativeOfficialPresentation() {
  return <>{useContext(NativePresentation)}</>;
}

export function OfficialReplacement({ fallback, children }: {
  fallback: ReactNode;
  children: ReactNode;
}) {
  return <NativePresentation.Provider value={fallback}>{children}</NativePresentation.Provider>;
}
