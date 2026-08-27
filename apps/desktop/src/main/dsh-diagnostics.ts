import type {
  AgentDiagnosticsAdapter,
  AgentRuntimeStatus,
} from "@amiba/app-runtime/platform";

import { dshRuntime, managedDshPaths } from "./dsh-runtime";
import { MANAGED_DSH_RUNTIME } from "@amiba/app-runtime/dsh-runtime";

async function status(start = true): Promise<AgentRuntimeStatus> {
  let sessionCount = 0;
  let liveSessionCount = 0;
  let startupError: string | undefined;
  if (start) {
    try {
      const handle = await dshRuntime.ensureStarted();
      const sessions = (await handle.client.listSessions()).items;
      sessionCount = sessions.length;
      liveSessionCount = sessions.filter((session) => session.running).length;
    } catch (cause) {
      startupError = cause instanceof Error ? cause.message : String(cause);
    }
  }
  const runtime = dshRuntime.diagnostics;
  const paths = managedDshPaths();
  return {
    runtime: "dsh",
    healthy: runtime.state === "running" && !startupError,
    state: startupError ? "failed" : runtime.state,
    version: MANAGED_DSH_RUNTIME.version,
    nodeVersion: MANAGED_DSH_RUNTIME.nodeVersion,
    ...(runtime.pid === undefined ? {} : { pid: runtime.pid }),
    ...(runtime.startedAt === undefined ? {} : { startedAt: runtime.startedAt }),
    sessionCount,
    liveSessionCount,
    paths: {
      home: paths.home,
      agentsHome: paths.agentsHome,
      runtimeDir: paths.runtimeDir,
    },
    ...((startupError ?? runtime.error)
      ? { error: startupError ?? runtime.error }
      : {}),
  };
}

export const dshDiagnostics: AgentDiagnosticsAdapter = {
  status: () => status(true),
  async restart() {
    try {
      await dshRuntime.restart();
    } catch {
      // Return the complete failed diagnostic snapshot rather than losing the
      // pinned runtime identity and captured child output in an IPC exception.
    }
    return status(false);
  },
  async logs(input = {}) {
    const limit = Math.max(1, Math.min(input.limit ?? 200, 5_000));
    const needle = input.search?.trim().toLocaleLowerCase();
    const entries = dshRuntime.readLogs().filter((entry) =>
      (input.level === undefined || input.level === "all" || entry.level === input.level) &&
      (input.stream === undefined || input.stream === "all" || entry.stream === input.stream) &&
      (!needle || entry.message.toLocaleLowerCase().includes(needle))
    );
    return { entries: entries.slice(-limit) };
  },
};
