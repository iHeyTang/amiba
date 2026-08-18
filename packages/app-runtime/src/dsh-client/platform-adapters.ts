import type {
  AgentCommandEntry,
  AgentPermissionOption,
  AgentPermissionState,
  AgentSkillsAdapter,
  ModelPlaneAdapter,
  PlatformAdapter,
} from "../platform/index.js";

import type { DshApiClient, DshSettingsNamespace } from "./index.js";

type DshPlatformKey =
  | "agentSessions"
  | "agentAttachments"
  | "agentModels"
  | "agentWorkspaces"
  | "agentPresets"
  | "agentSettings"
  | "agentCredentials"
  | "agentPermissions"
  | "modelPlane"
  | "agentSkills"
  | "agentCommands";

export type DshPlatformAdapters = Required<
  Pick<PlatformAdapter, DshPlatformKey>
>;

type SerializedSchemaNode = {
  type?: string;
  value?: unknown;
  list?: number[];
  dict?: Record<string, number>;
  meta?: { description?: unknown };
};

type SerializedSchema = {
  uid?: number;
  refs?: Record<string, SerializedSchemaNode>;
};

const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200] as const;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorCode(error: unknown): string | undefined {
  const code = object(error).code;
  return typeof code === "string" ? code : undefined;
}

function permissionOptions(schemaValue: unknown): AgentPermissionOption[] {
  const schema = schemaValue as SerializedSchema;
  const refs = schema?.refs;
  const root = refs?.[String(schema?.uid)];
  const fieldId = root?.dict?.defaultPreset;
  const field = fieldId === undefined ? undefined : refs?.[String(fieldId)];
  const candidates = field?.type === "union" ? (field.list ?? []) : [fieldId];
  return candidates.flatMap((id) => {
    if (id === undefined) return [];
    const node = refs?.[String(id)];
    if (node?.type !== "const" || typeof node.value !== "string") return [];
    return [
      {
        value: node.value,
        name: node.value,
        ...(typeof node.meta?.description === "string"
          ? { description: node.meta.description }
          : {}),
      },
    ];
  });
}

function permissionDefaultState(
  namespace: DshSettingsNamespace,
  writable: boolean,
): AgentPermissionState {
  const currentValue = object(namespace.value).defaultPreset;
  const options = permissionOptions(namespace.schema);
  if (typeof currentValue !== "string" || !currentValue) {
    throw new Error("DSH permission settings has no defaultPreset value");
  }
  if (!options.some((option) => option.value === currentValue)) {
    throw new Error(
      "DSH permission settings does not advertise its current preset",
    );
  }
  return {
    currentValue,
    options,
    writable,
    revision: namespace.revision,
    scope: "default",
  };
}

function permissionSessionState(value: unknown): AgentPermissionState {
  const projection = object(value);
  const currentValue = projection.currentValue;
  const options = Array.isArray(projection.options)
    ? projection.options.flatMap((raw) => {
        const option = object(raw);
        if (
          typeof option.value !== "string" ||
          typeof option.name !== "string"
        ) {
          return [];
        }
        return [
          {
            value: option.value,
            name: option.name,
            ...(typeof option.description === "string"
              ? { description: option.description }
              : {}),
          },
        ];
      })
    : [];
  if (
    typeof currentValue !== "string" ||
    !currentValue ||
    options.length === 0
  ) {
    throw new Error("DSH session has no valid permissions projection");
  }
  return {
    currentValue,
    options,
    writable: currentValue !== "custom",
    scope: "session",
  };
}

async function defaultPermissionDescriptor(client: DshApiClient) {
  const described = await client.describeSettings();
  const namespace = described.namespaces.find(
    (entry) => entry.ns === "permission",
  );
  if (!namespace) throw new Error("DSH permission settings are not exposed");
  return { described, namespace };
}

async function ensureLiveSession(
  client: DshApiClient,
  sessionId: string,
): Promise<void> {
  const normalized = sessionId.trim();
  if (!normalized) throw new Error("A DSH session is required");
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

async function renameWhenReady(
  client: DshApiClient,
  sessionId: string,
  title: string,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.renameSession(sessionId, title);
    } catch (error) {
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (errorCode(error) !== "session-not-found" || delay === undefined)
        throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Adapt the official DSH API and plugin Remotes to Amiba's shared UI contract.
 * No Electron feature IPC is involved: every renderer surface uses the same
 * DSH Client transport installed by its host.
 */
export function createDshPlatformAdapters(
  client: DshApiClient,
): DshPlatformAdapters {
  const attachments = {
    async put(input: {
      sessionId: string;
      name: string;
      mime: string;
      bytes: Uint8Array;
    }) {
      let binary = "";
      const chunkSize = 0x8000;
      for (let offset = 0; offset < input.bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(
          ...input.bytes.subarray(offset, offset + chunkSize),
        );
      }
      return client.call<{ attachmentId: string }>("amibaAttachments/put", {
        args: {
          name: input.name,
          mime: input.mime,
          kind:
            input.mime === "application/pdf"
              ? "pdf"
              : input.mime.startsWith("image/")
                ? "image"
                : "text",
          dataBase64: btoa(binary),
        },
      });
    },
    readForPrompt: (attachmentId: string) =>
      client.call<{
        attachmentId: string;
        name: string;
        mime: string;
        size: number;
        kind: "image" | "text" | "pdf";
        dataBase64: string;
      }>("amibaAttachments/readForPrompt", { args: { attachmentId } }),
    async remove(attachmentId: string) {
      await client.call("amibaAttachments/removeAttachment", {
        args: { attachmentId },
      });
    },
  };

  // Engine-native only: the composer's `/`-skill mention provider is the
  // sole remaining consumer of `platform.agentSkills`. The full
  // authoring/CRUD surface moved to dsh-plugin-skills' own Remote face in
  // T3 — this adapter no longer reaches into that plugin's RPC namespace
  // at all.
  const skills: AgentSkillsAdapter = {
    async list(sessionId) {
      await ensureLiveSession(client, sessionId);
      const { skills: entries } = await client.listSkills(sessionId);
      return {
        skills: entries.map((entry) => ({
          name: entry.name,
          description: entry.description,
          whenToUse: entry.whenToUse,
          modelInvocable: entry.modelInvocable,
          // `skill.list` is documented as the user-invocable catalog for
          // the session — every row already satisfies this, so it is a
          // known constant here, not fabricated data.
          userInvocable: true,
        })),
      };
    },
  };

  const modelPlane: ModelPlaneAdapter = {
    snapshot: () => client.call("amibaModelPlane/snapshot", { args: {} }),
    setDefaultSelection: (selection, expectedRevision) =>
      client.call("amibaModelPlane/setDefaultSelection", {
        args: { selection, expectedRevision },
      }),
    upsert: (input) =>
      client.call("amibaModelPlane/upsert", { args: { input } }),
    remove: (providerId, expectedRevision) =>
      client.call("amibaModelPlane/remove", {
        args: { providerId, expectedRevision },
      }),
    discover: (input) =>
      client.call("amibaModelPlane/discover", { args: { input } }),
    unsetCredential: (providerId, expectedRevision) =>
      client.call("amibaModelPlane/unsetCredential", {
        args: { providerId, expectedRevision },
      }),
  };

  return {
    agentAttachments: attachments,
    modelPlane,
    agentModels: {
      async directory(sessionId) {
        try {
          const value = await client.models(sessionId);
          return value as Awaited<
            ReturnType<NonNullable<PlatformAdapter["agentModels"]>["directory"]>
          >;
        } catch (error) {
          if (errorCode(error) === "session-not-found") return null;
          throw error;
        }
      },
      select: (sessionId, selection) =>
        client.selectModel({ sessionId, ...selection }),
    },
    agentSessions: {
      async list() {
        return (await client.listSessions()).items.map((item) => ({
          ...item,
          title:
            typeof item.projections?.values?.title === "string"
              ? item.projections.values.title
              : undefined,
        }));
      },
      async search(query) {
        return (await client.searchSessions(query)).items;
      },
      create: (input) => client.createSession(input),
      async history(sessionId, options = {}) {
        const result = await client.history(sessionId, options);
        return {
          events: result.events,
          hasMore: result.hasMore,
          projections: result.projections?.values,
        };
      },
      rename: (sessionId, title) => renameWhenReady(client, sessionId, title),
      fork: (sessionId, atSeq) => client.forkSession(sessionId, atSeq),
    },
    agentWorkspaces: {
      list: () => client.listWorkspaces(),
      create: (path) => client.createWorkspace(path),
      rename: (workspaceId, title) =>
        client.renameWorkspace(workspaceId, title),
      remove: (workspaceId) => client.deleteWorkspace(workspaceId),
      reorder: (workspaceId, beforeWorkspaceId) =>
        client.reorderWorkspace(workspaceId, beforeWorkspaceId),
      reorderSession: (workspaceId, sessionId, beforeSessionId) =>
        client.reorderWorkspaceSession(workspaceId, sessionId, beforeSessionId),
      archiveSession: (sessionId) => client.archiveSession(sessionId),
    },
    agentPresets: {
      list: () => client.listAgentPresets(),
      select: (sessionId, agentPreset) =>
        client.selectAgentPreset(sessionId, agentPreset),
      read: (agentPreset) => client.readAgentPreset(agentPreset),
      copy: (input) => client.copyAgentPreset(input),
      openDocument: (agentPreset) => client.openAgentPreset(agentPreset),
      remove: (agentPreset) => client.removeAgentPreset(agentPreset),
    },
    agentSettings: {
      describe: () => client.describeSettings(),
      update: (ns, patch, expectedRevision) =>
        client.updateSettings(ns, patch, expectedRevision),
      replace: (ns, section, expectedRevision) =>
        client.replaceSettings(ns, section, expectedRevision),
      mutate: (ns, ops, expectedRevision) =>
        client.mutateSettings(ns, ops, expectedRevision),
      openDocument: () => client.openSettings(),
    },
    agentCredentials: {
      describe: (refs) => client.describeCredentials(refs),
      set: (ref, value) => client.setCredential(ref, value),
      unset: (ref) => client.unsetCredential(ref),
    },
    agentPermissions: {
      async getDefault() {
        const { described, namespace } =
          await defaultPermissionDescriptor(client);
        return permissionDefaultState(namespace, described.writable);
      },
      async setDefault(preset, expectedRevision) {
        const current = await this.getDefault();
        if (!current.options.some((option) => option.value === preset)) {
          throw new Error(`Unknown DSH permission preset: ${preset}`);
        }
        const namespace = await client.mutateSettings(
          "permission",
          [{ op: "set", path: ["defaultPreset"], value: preset }],
          expectedRevision ?? current.revision,
        );
        return permissionDefaultState(namespace, true);
      },
      async getSession(sessionId) {
        try {
          const history = await client.history(sessionId, { maxMessages: 1 });
          return permissionSessionState(
            history.projections?.values.permissions,
          );
        } catch (error) {
          if (errorCode(error) === "session-not-found") return null;
          throw error;
        }
      },
      async setSession(sessionId, preset) {
        const current = await this.getSession(sessionId);
        if (!current) throw new Error(`DSH session not found: ${sessionId}`);
        if (!current.options.some((option) => option.value === preset)) {
          throw new Error(`Unknown DSH permission preset: ${preset}`);
        }
        const response = await client.prompt(
          sessionId,
          `/permission ${preset}`,
        );
        if (response.command?.kind === "error") {
          throw new Error(
            response.command.text || "DSH rejected the permission preset",
          );
        }
        const updated = await this.getSession(sessionId);
        if (!updated) throw new Error(`DSH session disappeared: ${sessionId}`);
        return updated;
      },
    },
    agentSkills: skills,
    agentCommands: {
      async list(sessionId) {
        await ensureLiveSession(client, sessionId);
        return client.call<AgentCommandEntry[]>("amibaCommands/list", {
          args: { sessionId },
        });
      },
    },
  };
}
