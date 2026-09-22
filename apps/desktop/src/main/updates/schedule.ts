const INITIAL_DELAY = 30_000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/** Keep detection quiet, and catch up when the app returns after a long sleep. */
export function scheduleUpdateChecks(check: () => Promise<unknown>) {
  let nextCheck = Date.now() + INITIAL_DELAY;
  let active = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout>;
  const checkIfDue = async () => {
    if (disposed || active || Date.now() < nextCheck) return;
    active = true;
    clearTimeout(timer);
    try { await check(); }
    catch (error) { console.error("[updates] automatic check failed:", error); }
    finally {
      active = false;
      nextCheck = Date.now() + CHECK_INTERVAL;
      if (!disposed) {
        timer = setTimeout(() => { void checkIfDue(); }, CHECK_INTERVAL);
        timer.unref();
      }
    }
  };
  timer = setTimeout(() => { void checkIfDue(); }, INITIAL_DELAY);
  timer.unref();
  return {
    checkIfDue,
    dispose() { disposed = true; clearTimeout(timer); },
  };
}
