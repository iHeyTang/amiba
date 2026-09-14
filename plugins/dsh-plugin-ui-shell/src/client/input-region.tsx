import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import type { ConversationInputState, ConversationInputZoneOwner, ObservableSnapshot } from "@amiba/extension-sdk";

/** InputZone entries receive real snapshots as owner props, not invented defaults. */
export function InputRegion({ source, input, render }: {
  source?: ObservableSnapshot<ConversationInputZoneOwner["session"]>;
  input?: ObservableSnapshot<ConversationInputState | undefined>;
  render(owner: ConversationInputZoneOwner): ReactNode;
}) {
  const subscribeSession = useCallback((fn: () => void) => source?.subscribe(fn) ?? (() => {}), [source]);
  const readSession = useCallback(() => source?.getSnapshot(), [source]);
  const subscribeInput = useCallback((fn: () => void) => input?.subscribe(fn) ?? (() => {}), [input]);
  const readInput = useCallback(() => input?.getSnapshot(), [input]);
  const session = useSyncExternalStore(subscribeSession, readSession, readSession);
  const state = useSyncExternalStore(subscribeInput, readInput, readInput);
  if (!session || !state) return null;
  return render({ session, input: state });
}
