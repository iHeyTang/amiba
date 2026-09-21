/** Main-process singleton; the state engine is independent of Electron. */
import type { DshApiClient } from "@amiba/app-runtime/dsh-client";
import { dshRuntime } from "./dsh-runtime";
import { SessionIndex } from "./session-index-state";
export { SessionIndex } from "./session-index-state";

export function dshRuntimeClient(): Promise<DshApiClient> {
  return dshRuntime.ensureStarted().then((handle) => handle.client);
}

export const sessionIndex = new SessionIndex(dshRuntimeClient);
