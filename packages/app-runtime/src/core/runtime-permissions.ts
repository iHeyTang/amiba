import {
  getPlatform,
  hasPlatform,
  type AgentPermissionOption,
  type AgentPermissionState,
} from "@amiba/app-runtime/platform";

export type PermissionPresetResult =
  | {
      ok: true;
      preset: string;
      options: AgentPermissionOption[];
      scope: "default" | "session";
      writable: boolean;
      revision?: number;
    }
  | { ok: false; error: string };

function result(state: AgentPermissionState): PermissionPresetResult {
  return {
    ok: true,
    preset: state.currentValue,
    options: state.options,
    scope: state.scope,
    writable: state.writable,
    ...(state.revision === undefined ? {} : { revision: state.revision }),
  };
}

function adapter() {
  if (!hasPlatform()) return undefined;
  return getPlatform().agentPermissions;
}

/** Read a pinned session preset, falling back to the future-session default. */
export async function getPermissionPreset(
  sessionId?: string,
): Promise<PermissionPresetResult> {
  const permissions = adapter();
  if (!permissions) {
    return { ok: false, error: "This surface does not expose DSH permissions" };
  }
  try {
    const session = sessionId
      ? await permissions.getSession(sessionId)
      : null;
    return result(session ?? (await permissions.getDefault()));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Change the pinned preset for an existing session. An unmaterialized task
 * changes DSH's default, which is then atomically pinned by session.create.
 */
export async function setPermissionPreset(
  preset: string,
  sessionId?: string,
  expectedRevision?: number,
): Promise<PermissionPresetResult> {
  const permissions = adapter();
  if (!permissions) {
    return { ok: false, error: "This surface does not expose DSH permissions" };
  }
  try {
    const session = sessionId
      ? await permissions.getSession(sessionId)
      : null;
    return result(
      session
        ? await permissions.setSession(sessionId!, preset)
        : await permissions.setDefault(preset, expectedRevision),
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
