/**
 * Coalesce engine frames into one message per window per tick.
 *
 * The hosted chat engine pushes one `EngineToClientMessage` per runtime frame —
 * during a streaming turn that is one structured clone plus one renderer wake-up
 * per delta, from the same main process that owns the window event loop. Frames
 * are buffered for a single tick and flushed together, which keeps their order,
 * costs at most one frame of added latency, and lets the renderer apply a whole
 * batch inside one task (so React commits once instead of once per delta).
 */
export interface FrameBatcher<T> {
  push(item: T): void;
  /** Flush immediately (used when a window is going away). */
  flush(): void;
  dispose(): void;
}

export function createFrameBatcher<T>(
  flush: (items: T[]) => void,
  delayMs = 16,
): FrameBatcher<T> {
  let pending: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = (): void => {
    timer = undefined;
    if (pending.length === 0) return;
    const items = pending;
    pending = [];
    flush(items);
  };

  return {
    push(item) {
      pending.push(item);
      if (timer !== undefined) return;
      timer = setTimeout(send, delayMs);
      timer.unref?.();
    },
    flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      send();
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = [];
    },
  };
}
