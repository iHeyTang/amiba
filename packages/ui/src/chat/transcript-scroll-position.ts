import { createContext } from 'react';

export interface TranscriptScrollPosition { anchorKey: string; anchorTop: number; scrollTop: number }
/** The mounted viewport is the authority when switching transcript renderers. */
export const TranscriptScrollPositionContext = createContext<(() => TranscriptScrollPosition | null | undefined) | undefined>(undefined);
export function readTranscriptScrollPosition(viewport: HTMLElement | null, viewportSession?: string | null, requestedSession?: string | null): TranscriptScrollPosition | null | undefined {
  if (!viewport || viewportSession !== requestedSession) return undefined;
  if (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 24) return null;
  // rc.2 uses scrollTop when a semantic anchor is absent in the new renderer.
  return { anchorKey: '', anchorTop: 0, scrollTop: viewport.scrollTop };
}
