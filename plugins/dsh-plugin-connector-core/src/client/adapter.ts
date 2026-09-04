import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";

import type {
  ConnectorProviderView,
  ConnectView,
  MessageChannelApproval,
  OnboardingView,
} from "../types.js";

export interface CreateConnectInput {
  provider: string;
  name: string;
  agentPreset: string;
  config: Record<string, unknown>;
  /** Absent uses the bound channel's default (10-minute timeout). */
  approval?: MessageChannelApproval;
}

export interface BeginOnboardingInput {
  provider: string;
  name: string;
  agentPreset: string;
}

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
  listProviders(): Promise<ConnectorProviderView[]>;
  list(): Promise<ConnectView[]>;
  create(input: CreateConnectInput): Promise<ConnectView>;
  setEnabled(id: string, enabled: boolean): Promise<ConnectView>;
  remove(id: string): Promise<{ id: string; deleted: boolean }>;
  setOwners(id: string, owners: string[]): Promise<ConnectView>;
  setApproval(id: string, approval: MessageChannelApproval): Promise<ConnectView>;
  beginOnboarding(input: BeginOnboardingInput): Promise<OnboardingView>;
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
    setApproval: (id, approval) => valueOf(remote.setApproval(id, approval)),
    beginOnboarding: (input) => valueOf(remote.beginOnboarding(input)),
    pollOnboarding: (sessionId) => valueOf(remote.pollOnboarding(sessionId)),
    cancelOnboarding: (sessionId) =>
      valueOf(remote.cancelOnboarding(sessionId)),
  };
}
