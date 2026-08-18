import type { AgentCommandsAdapter } from "@amiba/app-runtime/platform";

import { dshRuntime } from "./dsh-runtime";

interface PluginEnvelope<T> {
  ok: boolean;
  error?: string;
  value?: T;
}

export interface DshCommandExecution {
  commandId: string;
  result:
    | { kind: "success"; text?: string; sourceEventSeq?: number }
    | { kind: "error"; text: string };
}

type DshCommandsBridge = AgentCommandsAdapter & {
  execute(
    sessionId: string,
    line: string,
    signal?: AbortSignal,
  ): Promise<DshCommandExecution | null>;
};

async function ensureLive(sessionId: string): Promise<void> {
  const normalized = sessionId.trim();
  if (!normalized)
    throw new Error("A DSH session is required for command discovery.");
  const { client } = await dshRuntime.ensureStarted();
  const item = (await client.listSessions()).items.find(
    (session) => session.sessionId === normalized,
  );
  if (!item)
    throw new Error(`DSH session ${JSON.stringify(normalized)} was not found.`);
  await client.createSession({
    sessionId: normalized,
    ...(item.cwd ? { cwd: item.cwd } : {}),
    ...(item.agentPreset ? { agentPreset: item.agentPreset } : {}),
  });
}

export const dshCommands: DshCommandsBridge = {
  async list(sessionId) {
    await ensureLive(sessionId);
    const { baseUrl, pluginToken } = await dshRuntime.ensureStarted();
    const url = new URL("/api/amiba/commands", baseUrl);
    url.searchParams.set("sessionId", sessionId.trim());
    const response = await fetch(url, {
      headers: { "x-amiba-plugin-token": pluginToken },
      signal: AbortSignal.timeout(35_000),
    });
    const payload = (await response.json()) as PluginEnvelope<
      Awaited<ReturnType<AgentCommandsAdapter["list"]>>
    >;
    if (!response.ok || !payload.ok || !payload.value) {
      throw new Error(
        payload.error ??
          `DSH command catalog request failed (${response.status}).`,
      );
    }
    return payload.value;
  },
  async execute(sessionId, line, signal) {
    await ensureLive(sessionId);
    const { baseUrl, pluginToken } = await dshRuntime.ensureStarted();
    const response = await fetch(new URL("/api/amiba/commands", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-amiba-plugin-token": pluginToken,
      },
      body: JSON.stringify({ sessionId: sessionId.trim(), line }),
      signal: signal ?? AbortSignal.timeout(5 * 60_000),
    });
    const payload =
      (await response.json()) as PluginEnvelope<DshCommandExecution | null>;
    if (!response.ok || !payload.ok || payload.value === undefined) {
      throw new Error(
        payload.error ?? `DSH command execution failed (${response.status}).`,
      );
    }
    return payload.value;
  },
};
