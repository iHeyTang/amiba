import { useEffect, useRef } from "react";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { Launcher } from "./launcher.js";

export function FirstRun({
  complete,
  launcher,
  hasConfiguredProvider,
}: Pick<PropsRuntime<"settings.onboarding">, "complete"> & {
  launcher: Launcher;
  hasConfiguredProvider(): Promise<boolean>;
}) {
  const done = useRef(complete);
  done.current = complete;
  useEffect(() => {
    let live = true;
    let close: (() => void) | undefined;
    void hasConfiguredProvider().then(
      configured => {
        if (!live) return;
        if (configured) done.current();
        else close = launcher.open({ revisit: false, done: () => done.current() });
      },
      () => {
        // A failed lookup is not evidence of a new user. Retry on the next mount.
        if (live) done.current();
      },
    );
    return () => {
      live = false;
      close?.();
    };
  }, [launcher, hasConfiguredProvider]);
  return null;
}
