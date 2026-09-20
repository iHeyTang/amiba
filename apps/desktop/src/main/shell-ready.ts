/**
 * "The product shell is on screen" latch.
 *
 * The main process used to guess when the renderer had settled — creating the
 * desktop pet window one `did-finish-load` + 350 ms after the main window, and
 * paying for a second renderer boot while the first one was still painting.
 * The renderer knows exactly when its shell is up (`waitForAmibaRoot`), so it
 * says so over IPC and this latch turns that one-shot signal into something the
 * window installers can await, whichever arrives first.
 *
 * The latch never resets: the shell is published once per window lifetime, and
 * consumers that arrive late must not wait again.
 */

/** How long a consumer waits before giving up on the renderer's signal. */
export const SHELL_READY_TIMEOUT_MS = 20_000;

let ready = false;
const waiters = new Set<() => void>();

/** Record the renderer's signal; wakes every current waiter. */
export function markShellReady(): void {
  if (ready) return;
  ready = true;
  for (const waiter of [...waiters]) waiter();
  waiters.clear();
}

export function isShellReady(): boolean {
  return ready;
}

/**
 * Resolves `true` once the shell is up, or `false` if the renderer never
 * reported within `timeoutMs`. Callers treat the timeout as "proceed anyway":
 * a late window is better than a window that never appears.
 */
export function whenShellReady(
  timeoutMs = SHELL_READY_TIMEOUT_MS,
): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    function settle(value: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      waiters.delete(onReady);
      resolve(value);
    }
    function onReady(): void {
      settle(true);
    }
    // Not unref'd on purpose: the timeout is the only thing that resolves this
    // promise when the renderer never reports, and a detached timer would let
    // the event loop drain first.
    const timer = setTimeout(() => settle(false), timeoutMs);
    waiters.add(onReady);
    // A signal that landed between the `ready` check above and the
    // registration below must not be lost.
    if (ready) settle(true);
  });
}
