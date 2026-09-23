import { expect, it } from 'vitest';
import { readTranscriptScrollPosition } from '../transcript-scroll-position';
it('carries a reader position while keeping live-tail and absent viewport distinct', () => {
  const viewport = document.createElement('div');
  Object.defineProperties(viewport, { scrollHeight: { value: 1000 }, clientHeight: { value: 400 } });
  viewport.scrollTop = 200;
  expect(readTranscriptScrollPosition(viewport)).toEqual({ anchorKey: '', anchorTop: 0, scrollTop: 200 });
  expect(readTranscriptScrollPosition(viewport, 'previous', 'next')).toBeUndefined();
  expect(readTranscriptScrollPosition(viewport, 'same', 'same')?.scrollTop).toBe(200);
  viewport.scrollTop = 590;
  expect(readTranscriptScrollPosition(viewport)).toBeNull();
  expect(readTranscriptScrollPosition(null)).toBeUndefined();
});
