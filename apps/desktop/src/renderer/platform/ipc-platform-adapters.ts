/**
 * Renderer platform adapters executed over the main-process DSH API proxy.
 *
 * Every adapter method is one `dshApis.call(adapter, method, args)` invoke;
 * the MAIN process runs the real implementations
 * (`createDshPlatformAdapters` bound to the app's single DshApiClient) so
 * windows never open their own DSH connections for conversation data —
 * session history reads, workspace writes and model listings all happen in
 * main, and only JSON results cross the bridge.
 *
 * `agentAttachments` is intentionally absent: the official attachment draft
 * registry is per-renderer (bound by the DSH Web Shell) and stays local.
 */

import type {
  AgentCommandEntry,
  AgentCredentialView,
  AgentModelGroup,
  AgentModelSelection,
  AgentPermissionState,
  AgentPresetsAdapter,
  AgentSessionHistoryEntry,
  AgentSessionSummary,
  AgentSettingsNamespace,
  AgentSkillMention,
  AgentSubagentAddress,
  AgentWorkspaceEntry,
  AgentWorkspacesAdapter,
  AgentSessionsAdapter,
  AgentSettingsAdapter,
  AgentCommandsAdapter,
  AgentCredentialsAdapter,
  AgentModelsAdapter,
  AgentPermissionsAdapter,
  AgentSkillsAdapter,
} from "@amiba/app-runtime/platform";

export type IpcCall = <T = unknown>(
  adapter: string,
  method: string,
  args?: unknown[],
) => Promise<T>;

export interface IpcPlatformAdapters {
  agentSessions: AgentSessionsAdapter;
  agentWorkspaces: AgentWorkspacesAdapter;
  agentModels: AgentModelsAdapter;
  agentPresets: AgentPresetsAdapter;
  agentSettings: AgentSettingsAdapter;
  agentCredentials: AgentCredentialsAdapter;
  agentPermissions: AgentPermissionsAdapter;
  agentSkills: AgentSkillsAdapter;
  agentCommands: AgentCommandsAdapter;
}

export function createIpcPlatformAdapters(call: IpcCall): IpcPlatformAdapters {
  return {
    agentSessions: {
      list: () => call<AgentSessionSummary[]>("agentSessions", "list"),
      search: (query) =>
        call<Array<{ sessionId: string; snippet: string }>>(
          "agentSessions",
          "search",
          [query],
        ),
      create: (input) =>
        call<{ sessionId: string; agentPreset?: string }>(
          "agentSessions",
          "create",
          [input],
        ),
      history: (sessionId, options) =>
        call<{
          events: AgentSessionHistoryEntry[];
          hasMore: boolean;
          projections?: Record<string, unknown>;
        }>("agentSessions", "history", [sessionId, options ?? {}]),
      rename: (sessionId, title) =>
        call<{ title: string; seq: number }>("agentSessions", "rename", [
          sessionId,
          title,
        ]),
      fork: (sessionId, atSeq) =>
        call<{ sessionId: string }>("agentSessions", "fork", [
          sessionId,
          ...(atSeq === undefined ? [] : [atSeq]),
        ]),
    },
    agentWorkspaces: {
      list: () =>
        call<{
          items: AgentWorkspaceEntry[];
          archivedSessionIds: string[];
        }>("agentWorkspaces", "list"),
      create: (path) =>
        call<{ workspace: AgentWorkspaceEntry; created: boolean }>(
          "agentWorkspaces",
          "create",
          [path],
        ),
      rename: (workspaceId, title) =>
        call<{ workspace: AgentWorkspaceEntry }>(
          "agentWorkspaces",
          "rename",
          [workspaceId, title],
        ),
      remove: (workspaceId) =>
        call<void>("agentWorkspaces", "remove", [workspaceId]),
      reorder: (workspaceId, beforeWorkspaceId) =>
        call<{ workspaceIds: string[] }>("agentWorkspaces", "reorder", [
          workspaceId,
          beforeWorkspaceId,
        ]),
      reorderSession: (workspaceId, sessionId, beforeSessionId) =>
        call<{ workspace: AgentWorkspaceEntry }>(
          "agentWorkspaces",
          "reorderSession",
          [workspaceId, sessionId, beforeSessionId],
        ),
      archiveSession: (sessionId) =>
        call<{ archivedSessionIds: string[] }>(
          "agentWorkspaces",
          "archiveSession",
          [sessionId],
        ),
    },
    agentModels: {
      directory: (sessionId) =>
        call<{
          current: AgentModelSelection;
          routable: boolean;
          groups: AgentModelGroup[];
          failures: Array<{ id: string; name: string; message: string }>;
        } | null>("agentModels", "directory", [sessionId]),
      select: (sessionId, selection) =>
        call<{ selected: AgentModelSelection }>("agentModels", "select", [
          sessionId,
          selection,
        ]),
    },
    agentPresets: {
      list: () =>
        call<{
          presets: import("@amiba/app-runtime/platform").AgentPresetEntry[];
          authorable: boolean;
          hasDocument: boolean;
        }>("agentPresets", "list"),
      select: (sessionId, agentPreset) =>
        call<{ agentPreset: string }>("agentPresets", "select", [
          sessionId,
          agentPreset,
        ]),
      read: (agentPreset) =>
        call<{
          agentPreset: string;
          trust: "system" | "user";
          content: string;
          name?: string;
          description?: string;
        }>("agentPresets", "read", [agentPreset]),
      copy: (input) =>
        call<{ agentPreset: string }>("agentPresets", "copy", [input]),
      openDocument: (agentPreset) =>
        call<{ opened: true } | { opened: false; path: string }>(
          "agentPresets",
          "openDocument",
          [agentPreset],
        ),
      remove: (agentPreset) =>
        call<void>("agentPresets", "remove", [agentPreset]),
    },
    agentSettings: {
      describe: () =>
        call<{
          writable: boolean;
          hasDocument: boolean;
          namespaces: AgentSettingsNamespace[];
        }>("agentSettings", "describe"),
      update: (ns, patch, expectedRevision) =>
        call<AgentSettingsNamespace>("agentSettings", "update", [
          ns,
          patch,
          ...(expectedRevision === undefined ? [] : [expectedRevision]),
        ]),
      replace: (ns, section, expectedRevision) =>
        call<AgentSettingsNamespace>("agentSettings", "replace", [
          ns,
          section,
          ...(expectedRevision === undefined ? [] : [expectedRevision]),
        ]),
      mutate: (ns, ops, expectedRevision) =>
        call<AgentSettingsNamespace>("agentSettings", "mutate", [
          ns,
          ops,
          ...(expectedRevision === undefined ? [] : [expectedRevision]),
        ]),
      openDocument: () =>
        call<{ opened: true }>("agentSettings", "openDocument"),
    },
    agentCredentials: {
      describe: (refs) =>
        call<Record<string, AgentCredentialView>>(
          "agentCredentials",
          "describe",
          [refs],
        ),
      set: (ref, value) =>
        call<void>("agentCredentials", "set", [ref, value]),
      unset: (ref) => call<void>("agentCredentials", "unset", [ref]),
    },
    agentPermissions: {
      getDefault: () => call<AgentPermissionState>("agentPermissions", "getDefault"),
      setDefault: (preset, expectedRevision) =>
        call<AgentPermissionState>("agentPermissions", "setDefault", [
          preset,
          ...(expectedRevision === undefined ? [] : [expectedRevision]),
        ]),
      getSession: (sessionId) =>
        call<AgentPermissionState | null>("agentPermissions", "getSession", [
          sessionId,
        ]),
      setSession: (sessionId, preset) =>
        call<AgentPermissionState>("agentPermissions", "setSession", [
          sessionId,
          preset,
        ]),
    },
    agentSkills: {
      list: (sessionId) =>
        call<{ skills: AgentSkillMention[] }>("agentSkills", "list", [
          sessionId,
        ]),
    },
    agentCommands: {
      list: (sessionId) =>
        call<AgentCommandEntry[]>("agentCommands", "list", [sessionId]),
    },
  };
}