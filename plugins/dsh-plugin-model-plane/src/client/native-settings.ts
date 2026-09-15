import type {
  ClientRemote,
  SettingsNamespaceView,
  SettingsPathOpView,
} from "@deepseek-ai/dsh-api-remotes/client";
import type { ProviderSettingsController } from "./ModelProviderConfigTab.js";
import type {
  ModelPlaneSnapshotShape,
  ModelProviderProfileShape,
  ConfigureProviderInput,
  AgentModelSelectionShape,
  ProviderConfiguration,
} from "./view-types.js";
import { at, schemaAt, credentialFields } from "./schema.js";
import { object } from "./schema-object.js";

/** UI-only enhancement. Providers do not know or implement this namespace. */
export const UI_NS = "amiba-model-ui";
export async function responseValue<T>(
  response: Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>,
): Promise<T> {
  const result = await response;
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** React data/actions using the same native API as the official UI.
 * There is no custom provider service, registry, RPC, or protocol translation. */
export class NativeProviderSettings implements ProviderSettingsController {
  constructor(
    private readonly api: ClientRemote,
    readonly subscribe: (listener: () => void) => () => void,
  ) {}
  private namespaces: SettingsNamespaceView[] = [];
  private writable = false;
  private revision = 0;
  private signature = "";
  private queue: Promise<unknown> = Promise.resolve();
  private serialize<T>(action: () => Promise<T>) {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }
  private namespace(ns: string) {
    const value = this.namespaces.find((n) => n.ns === ns);
    if (!value) throw new Error(`Settings unavailable: ${ns}`);
    return value;
  }
  private mutate(
    ns: string,
    ops: SettingsPathOpView[],
    revision = this.namespace(ns).revision,
  ) {
    if (!this.writable) throw new Error("Settings are read-only");
    return responseValue(
      this.api.settings.mutate(ns, ops, revision),
    );
  }
  async snapshot(): Promise<ModelPlaneSnapshotShape> {
    const [directory, catalog, settings, activeProviders] = await Promise.all([
      responseValue(this.api.llm.listConfigurableProviders()),
      responseValue(this.api.session.modelCatalog()),
      responseValue(this.api.settings.describe()),
      responseValue(this.api.llm.listProviders()),
    ]);
    this.namespaces = settings.namespaces;
    this.writable = settings.writable;
    const prefs = object(
      settings.namespaces.find((n) => n.ns === UI_NS)?.value,
    );
    const hiddenProviders = Array.isArray(prefs.hiddenProviders)
      ? prefs.hiddenProviders
      : [];
    const hiddenModels = object(prefs.hiddenModels);
    const providers: ModelProviderProfileShape[] = directory.map(official => ({ ...official, active: activeProviders.some(provider => provider.id === official.provider) })).map(
      (official) => {
        const ns = settings.namespaces.find(
          (n) => n.ns === official.settingsNs,
        );
        const schema = ns
          ? schemaAt(ns.schema, official.settingsPath)
          : undefined;
        const value = object(
          ns ? at(ns.value, official.settingsPath) : undefined,
        );
        const configuration: ProviderConfiguration | undefined = ns
          ? {
              namespace: ns.ns,
              path: official.settingsPath,
              revision: ns.revision,
              schema,
              value,
              credentialFields: credentialFields(schema, value),
              removable:
                official.settingsPath.length > 0 &&
                at(ns.user, official.settingsPath) !== undefined &&
                at(ns.base, official.settingsPath) === undefined,
            }
          : undefined;
        const hidden = Array.isArray(hiddenModels[official.provider])
          ? (hiddenModels[official.provider] as string[])
          : [];
        return {
          official,
          providerCard: {
            provider: official,
            configured: ns !== undefined && (official.settingsPath.length === 0 || at(ns.value, official.settingsPath) !== undefined),
            keyConfigured: false,
          },
          id: official.provider,
          displayName: official.displayName,
          protocol:
            typeof value.api === "string" ? value.api : "provider-native",
          ...(typeof value.baseURL === "string"
            ? { baseURL: value.baseURL }
            : {}),
          credentialRef: configuration?.credentialFields[0]?.ref,
          enabled: !hiddenProviders.includes(official.provider),
          editable: !!ns && settings.writable,
          source:
            official.declared === true
              ? "user"
              : official.declared === false
                ? "builtin"
                : "imported",
          models: (
            catalog.groups.find((g) => g.id === official.provider)?.models ?? []
          ).map((m) => ({ ...m, enabled: !hidden.includes(m.id) })),
          configuration,
        };
      },
    );
    const refs = [
      ...new Set(
        providers.flatMap(
          (p) => [
            ...(p.configuration?.credentialFields.map((f) => f.ref) ?? []),
            modelCardKeyRef(p),
          ],
        ),
      ),
    ];
    const credentials = await responseValue(
      this.api.credentials.describe(refs),
    );
    // Listing models and possessing the required credentials are separate facts.
    // Keep catalog rows for configuration, but never advertise known unusable
    // routes as enabled or offer them in a picker. Keyless/native-auth plugins
    // remain supported: only credential references actually declared by the
    // owning plugin are required here.
    for (const provider of providers) {
      if (provider.providerCard) provider.providerCard.keyConfigured =
        credentials[modelCardKeyRef(provider)]?.configured === true;
      provider.availability = !provider.official?.active
        ? "unconfigured"
        : provider.configuration?.credentialFields.some(
              (field) => !credentials[field.ref]?.configured,
            )
          ? "missing-credential"
          : catalog.failures.some((failure) => failure.id === provider.id)
            ? "catalog-error"
            : provider.models.length === 0
              ? "no-models"
              : "ready";
      provider.enabled = provider.enabled && provider.availability === "ready";
      provider.visibilityEditable =
        settings.writable && settings.namespaces.some((n) => n.ns === UI_NS);
    }
    const defaults = object(
      settings.namespaces.find((n) => n.ns === "agent-default-model")?.value,
    );
    const defaultSelection =
      typeof defaults.provider === "string" &&
      typeof defaults.model === "string"
        ? {
            provider: defaults.provider,
            model: defaults.model,
            ...(typeof defaults.reasoningEffort === "string"
              ? { reasoningEffort: defaults.reasoningEffort }
              : {}),
          }
        : undefined;
    const piSchema = settings.namespaces.find(
      (n) => n.ns === "llm-pi-ai",
    )?.schema;
    const apiSchema = object(schemaAt(piSchema, ["providers", "_", "api"]));
    const protocols = Array.isArray(apiSchema.list)
      ? apiSchema.list.flatMap((v) =>
          typeof object(v).value === "string"
            ? [object(v).value as string]
            : [],
        )
      : [];
    const data = {
      providers,
      credentials,
      defaultSelection:
        defaultSelection &&
        providers.some(
          (p) =>
            p.id === defaultSelection.provider &&
            p.enabled &&
            p.models.some(
              (m) => m.id === defaultSelection.model && m.enabled !== false,
            ),
        )
          ? defaultSelection
          : undefined,
      failures: catalog.failures,
      protocols,
      groups: catalog.groups
        .filter((g) => providers.some((p) => p.id === g.id && p.enabled))
        .map((g) => ({
          ...g,
          models: g.models.filter(
            (m) =>
              !(
                Array.isArray(hiddenModels[g.id]) &&
                (hiddenModels[g.id] as string[]).includes(m.id)
              ),
          ),
        })),
    };
    const signature = JSON.stringify(data);
    if (signature !== this.signature) {
      this.signature = signature;
      this.revision++;
    }
    return { revision: this.revision, ...data };
  }
  private check(snapshot: ModelPlaneSnapshotShape, revision?: number) {
    if (revision !== undefined && snapshot.revision !== revision)
      throw new Error("Model settings changed. Refresh and retry.");
  }
  async configure(providerId: string, input: ConfigureProviderInput) {
    return this.serialize(async () => {
      const snapshot = await this.snapshot();
      const config = snapshot.providers.find(
        (p) => p.id === providerId,
      )?.configuration;
      if (!config) throw new Error("Provider has no configurable settings");
      if (config.revision !== input.expectedRevision)
        throw new Error("Settings changed. Refresh and retry.");
      const latest = input.ops.length
        ? await this.mutate(
            config.namespace,
            input.ops.map((op) => ({
              ...op,
              path: [...config.path, ...op.path],
            })),
            input.expectedRevision,
          )
        : this.namespace(config.namespace);
      const fields = credentialFields(
        config.schema,
        at(latest.value, config.path),
      );
      for (const edit of input.credentials) {
        if (!fields.some((field) => field.ref === edit.ref))
          throw new Error("Credential is not declared by this provider");
        if (edit.value === undefined)
          await responseValue(this.api.credentials.unset(edit.ref));
        else
          await responseValue(
            this.api.credentials.set(edit.ref, edit.value),
          );
      }
      return this.snapshot();
    });
  }
  async setDefaultSelection(
    selection: AgentModelSelectionShape,
    revision?: number,
  ) {
    return this.serialize(async () => {
      const snapshot = await this.snapshot();
      this.check(snapshot, revision);
      const model = snapshot.groups
        .find((g) => g.id === selection.provider)
        ?.models.find((m) => m.id === selection.model);
      if (!model) throw new Error("Model is unavailable");
      if (
        selection.reasoningEffort &&
        !model.reasoning?.efforts.some(
          (e) => e.id === selection.reasoningEffort,
        )
      )
        throw new Error("Unsupported reasoning effort");
      await this.mutate("agent-default-model", [
        { op: "set", path: ["provider"], value: selection.provider },
        { op: "set", path: ["model"], value: selection.model },
        selection.reasoningEffort === undefined
          ? { op: "unset", path: ["reasoningEffort"] }
          : {
              op: "set",
              path: ["reasoningEffort"],
              value: selection.reasoningEffort,
            },
      ]);
      return this.snapshot();
    });
  }
  async upsert(input: {
    provider: ModelProviderProfileShape;
    apiKey?: string;
    expectedRevision?: number;
  }) {
    return this.serialize(async () => {
      const snapshot = await this.snapshot();
      this.check(snapshot, input.expectedRevision);
      const p = input.provider;
      const existing = snapshot.providers.find((row) => row.id === p.id);
      if (existing) {
        if (p.enabled && existing.availability !== "ready")
          throw new Error(
            "Configure the provider and required credentials before enabling models",
          );
        const preferences = object(this.namespace(UI_NS).value);
        const hidden = Array.isArray(preferences.hiddenProviders)
          ? preferences.hiddenProviders
          : [];
        await this.mutate(UI_NS, [
          {
            op: "set",
            path: ["hiddenProviders"],
            value: [
              ...hidden.filter((id) => id !== p.id),
              ...(!p.enabled ? [p.id] : []),
            ],
          },
          {
            op: "set",
            path: ["hiddenModels", p.id],
            value: p.models.filter((m) => m.enabled === false).map((m) => m.id),
          },
        ]);
      } else {
        // This is the official llm-pi-ai's custom-endpoint setting, not a new
        // Amiba provider protocol. All other plugins use their own schema editor.
        const ref =
          p.credentialRef ?? `${p.id.replace(/-/g, "_").toUpperCase()}_API_KEY`;
        await this.mutate("llm-pi-ai", [
          {
            op: "set",
            path: ["providers", p.id],
            value: {
              displayName: p.displayName,
              api: p.protocol,
              ...(p.baseURL ? { baseURL: p.baseURL } : {}),
              apiKeyEnv: ref,
              models: p.models.map((m) => ({ id: m.id, name: m.name })),
            },
          },
        ]);
        if (input.apiKey?.trim())
          await responseValue(
            this.api.credentials.set(ref, input.apiKey.trim()),
          );
      }
      return this.snapshot();
    });
  }
  async remove(id: string, revision?: number) {
    return this.serialize(async () => {
      const snapshot = await this.snapshot();
      this.check(snapshot, revision);
      const config = snapshot.providers.find((p) => p.id === id)?.configuration;
      if (!config?.removable)
        throw new Error(
          "Remove this provider through its plugin configuration",
        );
      await this.mutate(
        config.namespace,
        [{ op: "unset", path: [...config.path] }],
        config.revision,
      );
      return this.snapshot();
    });
  }
  async discover(input: {
    provider: ModelProviderProfileShape;
    apiKey?: string;
  }) {
    const p = input.provider;
    const models = await responseValue(
      this.api.llm.discoverModels(p.official?.settingsNs || "llm-pi-ai", {
        ...(p.official ? { provider: p.official.provider } : {}),
        ...(p.baseURL ? { baseURL: p.baseURL } : {}),
        ...(p.protocol !== "provider-native" ? { api: p.protocol } : {}),
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      }),
    );
    return { models: models.map((m) => ({ ...m, name: m.name ?? m.id })) };
  }
  async unsetCredential(id: string, revision?: number) {
    return this.serialize(async () => {
      const snapshot = await this.snapshot();
      this.check(snapshot, revision);
      for (const field of snapshot.providers.find((p) => p.id === id)
        ?.configuration?.credentialFields ?? [])
        await responseValue(this.api.credentials.unset(field.ref));
      return this.snapshot();
    });
  }
}

/** The official card's apiKeyEnv/derived-key fact is independent of native auth fields. */
function modelCardKeyRef(provider: ModelProviderProfileShape): string {
  const named = provider.configuration?.value.apiKeyEnv;
  return typeof named === "string" && named.length > 0
    ? named
    : `${provider.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}
