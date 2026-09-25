import { forwardRef, useSyncExternalStore, type ComponentProps } from "react";
import { Composer, type ComposerHandle } from "./Composer";
import type { ComposerDraftSource } from "./composer-draft-store";

/**
 * Bounded draft subscription for the composer.
 *
 * ChatSurface owns the draft STORE (referentially stable) but must not
 * re-render on every keystroke — before this wrapper it subscribed via
 * useSessionComposerDraft and rebuilt the whole chat surface per key press.
 * This is the ONLY component that subscribes to the store's text, so typing
 * re-renders the composer subtree alone; the message list (memoized) and the
 * rest of ChatSurface stay untouched.
 */
export const DraftBoundComposer = forwardRef<
  ComposerHandle,
  Omit<ComponentProps<typeof Composer>, "value" | "onChange" | "canSubmit" | "draftSource"> & {
    draftSource: ComposerDraftSource;
    canSubmitDraft: (text: string) => boolean;
  }
>(function DraftBoundComposer({ draftSource, canSubmitDraft, ...props }, ref) {
  const value = useSyncExternalStore(
    draftSource.subscribe,
    draftSource.getSnapshot,
    draftSource.getSnapshot,
  );
  return (
    <Composer
      ref={ref}
      {...props}
      value={value}
      onChange={draftSource.set}
      canSubmit={canSubmitDraft(value)}
    />
  );
});