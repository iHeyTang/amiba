import type { ManagedMcpServer } from "@amiba/dsh-plugin-mcp-manager";
import type {
  InboundConversationRef,
  InboundMessageEnvelope,
  OutboundMessageEnvelope,
} from "@amiba/dsh-plugin-messaging-core";

export interface ConversationRef extends InboundConversationRef {}

/** Inbound envelope from a platform adapter: text plus conversation identity. */
export interface ConnectorInboundEnvelope
  extends Omit<InboundMessageEnvelope, "conversation"> {
  conversation: ConversationRef;
}

export type ConnectorStatus =
  | { state: "connecting" }
  | { state: "ready" }
  | { state: "error"; detail: string };

export interface ConnectorHandle {
  readonly connectId: string;
  readonly config: unknown;
  onInbound(envelope: ConnectorInboundEnvelope): Promise<void>;
  setStatus(status: ConnectorStatus): void;
}

export interface ConnectorRuntime {
  stop(): Promise<void>;
  deliver(
    conversation: ConversationRef,
    envelope: OutboundMessageEnvelope,
  ): Promise<void>;
}

export interface CliProvisionSpec {
  id: string;
  package: string;
  minVersion: string;
  pinnedVersion: string;
  env: Record<string, string>;
  skills: string[];
}

export type CapabilityDecl =
  | { kind: "mcp"; spec: ManagedMcpServer }
  | { kind: "cli"; spec: CliProvisionSpec };

export interface ConnectorProvider {
  readonly id: string; // lowercase [a-z][a-z0-9-]*, e.g. "lark"
  readonly name: string;
  readonly description: string;
  readonly icon?: string;
  /** Schema value driving the settings form; validated by the provider. */
  readonly configSchema: unknown;
  validate(config: unknown): Promise<void>;
  start(handle: ConnectorHandle): Promise<ConnectorRuntime>;
  capabilities(config: unknown): CapabilityDecl[];
}

export interface ConnectorProviderView {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

export interface ConnectView {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  pairing: boolean;
  owners: string[];
  agentPreset?: string;
  channelId?: string;
  status: ConnectorStatus;
  createdAt: string;
  updatedAt: string;
}
