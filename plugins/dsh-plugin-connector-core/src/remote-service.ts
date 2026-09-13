import type { Context } from "@deepseek-ai/cordis";
import type { MessageConversationSettingsInput } from "@amiba/dsh-plugin-messaging-core";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import type { ConnectorCenter } from "./center.js";
import type { BeginOnboardingInput, CreateConnectInput } from "./remote.js";
import type { UpdateConnectInput } from "./types.js";

// Exported (unlike messaging-core's private equivalent) so remote-service.test.ts
// can construct it directly and drive its @Remote methods as plain instance
// methods, without a real Typert Gateway carrier in the loop.
export class AmibaConnectorsRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly center: ConnectorCenter,
  ) {
    // Distinct Cordis service key from "amibaConnectors" — index.ts's
    // `ctx.provide("amibaConnectors", center)` already occupies that key,
    // and `TypertRemoteService`'s Service-base constructor registers its
    // own serviceKey too; using the same string for both collides with
    // cordis 4.0.1's real duplicate-registration guard
    // (`ReflectService#provide` throws when a name is already in its
    // store), which fails apply() at boot on a real Context.
    // `{ namespace: "amibaConnectors" }` keeps the wire namespace — and
    // therefore every remote.ts descriptor's `namespace` field, the
    // `TypertRemoteNamespaceMap.amibaConnectors` augmentation, and the
    // client — unchanged; only the Cordis-local service key moves. Verified
    // against @deepseek-ai/dsh-typert-protocol's shipped .d.ts:
    // `TypertRemoteService`'s constructor takes
    // `(ctx, serviceKey, options?: TypertGatewayBindingOptions)` where
    // `TypertGatewayBindingOptions.namespace` is exactly "wire namespace;
    // defaults to the Cordis service key" — the divergence this fix needs.
    super(ctx, "amibaConnectorsRemote", { namespace: "amibaConnectors" });
  }

  @Remote
  messageSources() {
    return this.center.messageSources();
  }

  @Remote
  externalSessions(ids: string[]) {
    return this.center.externalSessions(ids);
  }

  @Remote
  conversationSettings(id: string, conversationKey: string, input: MessageConversationSettingsInput) {
    return this.center.conversationSettings(id, conversationKey, input);
  }

  @Remote
  retryFailedReplies(id: string) {
    return this.center.retryFailedReplies(id);
  }

  @Remote
  searchConversationResources(id: string, key: string, query: string) {
    return this.center.searchConversationResources(id, key, query);
  }

  @Remote
  shareConversationResources(id: string, key: string, references: string[]) {
    return this.center.shareConversationResources(id, key, references);
  }

  @Remote
  // async keeps the return type a real Promise, matching every other
  // @Remote method here and the declared
  // TypertRemoteMap["amibaConnectors/listProviders"] signature, even though
  // ConnectorCenter#listProviders() itself is synchronous.
  async listProviders() {
    return { providers: this.center.listProviders() };
  }

  @Remote
  async listConnects() {
    return { connects: await this.center.listConnects() };
  }

  @Remote
  getConnectDetails(id: string) {
    return this.center.getConnectDetails(id);
  }

  @Remote
  updateConnect(id: string, input: UpdateConnectInput) {
    return this.center.updateConnect(id, input);
  }

  @Remote
  createConnect(input: CreateConnectInput) {
    return this.center.createConnect(input);
  }

  @Remote
  setEnabled(id: string, enabled: boolean) {
    return this.center.setEnabled(id, enabled);
  }

  @Remote
  async removeConnect(id: string) {
    return { id, deleted: await this.center.removeConnect(id) };
  }

  @Remote
  setOwners(id: string, owners: string[]) {
    return this.center.setOwners(id, owners);
  }

  @Remote
  // async keeps the return type a real Promise, matching the declared
  // TypertRemoteMap["amibaConnectors/beginOnboarding"] signature, even
  // though ConnectorCenter#beginOnboarding() itself is synchronous.
  async beginOnboarding(input: BeginOnboardingInput) {
    return this.center.beginOnboarding(input);
  }

  @Remote
  async submitOnboardingInput(sessionId: string, inputId: string, value: string) {
    return this.center.submitOnboardingInput(sessionId, inputId, value);
  }

  @Remote
  async pollOnboarding(sessionId: string) {
    return this.center.pollOnboarding(sessionId);
  }

  @Remote
  async cancelOnboarding(sessionId: string) {
    return this.center.cancelOnboarding(sessionId);
  }
}

/** Install the official DSH Host Remote face owned by connector-core. */
export function applyConnectorsRemote(
  ctx: Context,
  center: ConnectorCenter,
): void {
  new AmibaConnectorsRemoteService(ctx, center);
}
