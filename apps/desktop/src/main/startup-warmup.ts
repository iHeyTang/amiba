/**
 * Startup warm-up.
 *
 * The startup screen is the only honest place to spend boot time: while it is up
 * the user expects to wait, and once it goes away they expect everything they
 * can reach to be warm. So the main process warms the extra windows (the desktop
 * pet, Quick-Ask) *before* telling the renderer to reveal the UI, instead of
 * revealing the UI first and booting them behind it.
 *
 * The screen must never be held hostage: every target is bounded by one
 * timeout, a target that throws or never settles is reported and skipped.
 */

export interface StartupWarmupTarget {
  /** Used in diagnostics only. */
  label: string;
  /** Boot the surface; resolve when using it costs no further cold work. */
  boot(): void | Promise<void>;
}

/**
 * Upper bound on how long the startup screen waits for the warm-up. Kept below
 * the renderer's own reveal fallback so the normal path always wins.
 */
export const STARTUP_WARMUP_TIMEOUT_MS = 10_000;

export interface StartupWarmupResult {
  completed: boolean;
  /** Labels still booting when the timeout won. */
  pending: string[];
}

export async function runStartupWarmup(
  targets: readonly StartupWarmupTarget[],
  timeoutMs = STARTUP_WARMUP_TIMEOUT_MS,
): Promise<StartupWarmupResult> {
  const pending = new Set(targets.map((target) => target.label));
  const jobs = targets.map(async (target) => {
    try {
      await target.boot();
    } catch (error) {
      console.warn(`[amiba] startup warm-up "${target.label}" failed:`, error);
    } finally {
      pending.delete(target.label);
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([Promise.all(jobs), timedOut]);
  if (timer !== undefined) clearTimeout(timer);
  return { completed: pending.size === 0, pending: [...pending] };
}
