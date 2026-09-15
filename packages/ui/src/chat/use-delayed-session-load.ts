import { useEffect, useState } from "react";
import type { SessionLoadState } from "@amiba/app-runtime/core";

/** Delay only the loading presentation, never the result or core navigation. */
export function useDelayedSessionLoad(load: SessionLoadState | undefined) {
  const [displayed, setDisplayed] = useState<SessionLoadState | undefined>(
    load?.status === "loading" ? undefined : load,
  );
  useEffect(() => {
    if (load?.status !== "loading") {
      setDisplayed(load);
      return;
    }
    const timer = setTimeout(() => setDisplayed(load), 300);
    return () => clearTimeout(timer);
  }, [load]);
  // A retry keeps its error panel until the delay expires. Fast results render
  // immediately, and cleanup prevents an older timer reviving the spinner.
  return load?.status === "loading" ? displayed : load;
}
