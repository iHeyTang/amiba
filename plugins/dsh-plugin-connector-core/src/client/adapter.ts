import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { SharedResourceSearch } from "../conversation-sharing.js";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";

import type {
  ConnectorProviderView,
  ConnectView,
  ConnectDetails,
  UpdateConnectInput,
  OnboardingView,
} from "../types.js";

import type { CreateConnectInput, BeginOnboardingInput } from "../remote.js";
import type { MessageConversationSettingsInput, MessageConversationView } from "../remote.js";
export type { CreateConnectInput, BeginOnboardingInput } from "../remote.js";

/**
 * Client-facing surface consumed by `DshSettingsConnect` (Task 7). Method
 * names are unnamespaced (`remove`, not `removeConnect`) — only the wire
 * methods on the mounted `amibaConnectors` remote carry the `Connect` suffix
 * that disambiguates them among the remote's other namespaces. Same rule for
 * the onboarding trio: the wire methods are `beginOnboarding`/
 * `pollOnboarding`/`cancelOnboarding` (see remote.ts's wire table) and the
 * adapter keeps those exact names since there's no other `amibaConnectors`
 * method they'd collide with.
 */
export interface ConnectAdapter {
  searchConversationResources?(id: string, key: string, query: string): Promise<SharedResourceSearch>;
  shareConversationResources?(id: string, key: string, references: string[]): Promise<MessageConversationView>;
  retryFailedReplies?(id: string): Promise<{ retried: number }>;
  conversationSettings?(id: string, conversationKey: string, input: MessageConversationSettingsInput): Promise<MessageConversationView>;
  details(id: string): Promise<ConnectDetails>;
  update(id: string, input: UpdateConnectInput): Promise<ConnectView>;
  listProviders(): Promise<ConnectorProviderView[]>;
  list(): Promise<ConnectView[]>;
  create(input: CreateConnectInput): Promise<ConnectView>;
  setEnabled(id: string, enabled: boolean): Promise<ConnectView>;
  remove(id: string): Promise<{ id: string; deleted: boolean }>;
  setOwners(id: string, owners: string[]): Promise<ConnectView>;
  beginOnboarding(input: BeginOnboardingInput): Promise<OnboardingView>;
  submitOnboardingInput?(sessionId: string, inputId: string, value: string): Promise<OnboardingView>;
  pollOnboarding(sessionId: string): Promise<OnboardingView>;
  cancelOnboarding(sessionId: string): Promise<OnboardingView>;
}

type ConnectorsRemote = ClientContext["remote"]["amibaConnectors"];

function remoteError(value: unknown): Error {
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  }
  return new Error(String(value));
}

async function valueOf<T>(result: Promise<RemoteResult<T>>): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw remoteError(settled.error);
  return settled.value;
}

/** Build the `ConnectAdapter` over the mounted `amibaConnectors` remote. */
export function buildConnectAdapter(remote: ConnectorsRemote): ConnectAdapter {
  return {
    searchConversationResources: (id, key, query) => valueOf(remote.searchConversationResources(id, key, query)),
    shareConversationResources: (id, key, references) => valueOf(remote.shareConversationResources(id, key, references)),
    retryFailedReplies: id => valueOf(remote.retryFailedReplies(id)),
    conversationSettings: (id, key, input) => valueOf(remote.conversationSettings(id, key, input)),
    details: (id) => valueOf(remote.getConnectDetails(id)),
    update: (id, input) => valueOf(remote.updateConnect(id, input)),
    listProviders: async () => {
      const snapshot = await valueOf(remote.listProviders());
      return snapshot.providers;
    },
    list: async () => {
      const snapshot = await valueOf(remote.listConnects());
      return snapshot.connects;
    },
    create: (input) => valueOf(remote.createConnect(input)),
    setEnabled: (id, enabled) => valueOf(remote.setEnabled(id, enabled)),
    remove: (id) => valueOf(remote.removeConnect(id)),
    setOwners: (id, owners) => valueOf(remote.setOwners(id, owners)),
    beginOnboarding: (input) => valueOf(remote.beginOnboarding(input)),
    submitOnboardingInput: (sessionId, inputId, value) => valueOf(remote.submitOnboardingInput(sessionId, inputId, value)),
    pollOnboarding: (sessionId) => valueOf(remote.pollOnboarding(sessionId)),
    cancelOnboarding: (sessionId) =>
      valueOf(remote.cancelOnboarding(sessionId)),
  };
}
