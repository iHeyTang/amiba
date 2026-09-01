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
  /** The installed CLI's actual executable name (e.g. `"lark-cli"` for the
   * `@larksuite/cli` package) — distinct from `package`, since a scoped
   * package name can never be looked up on PATH or found under
   * `node_modules/.bin/` directly. */
  binary: string;
  minVersion: string;
  pinnedVersion: string;
  env: Record<string, string>;
  skills: string[];
}

export type CapabilityDecl =
  | { kind: "mcp"; spec: ManagedMcpServer }
  | { kind: "cli"; spec: CliProvisionSpec };

/** Update pushed by a provider's `onboard()` while it runs, e.g. a scannable
 * QR code or a free-text progress note. Surfaced onto the session's
 * `OnboardingView` for the caller to poll. */
export type OnboardUpdate =
  | { kind: "qr"; url: string; expireIn: number }
  | { kind: "status"; note: string };

export interface OnboardHandle {
  /** Aborted when the caller cancels the onboarding session (or the center
   * stops); the provider's `onboard()` should observe this and unwind. */
  readonly signal: AbortSignal;
  emit(update: OnboardUpdate): void;
}

export interface OnboardResult {
  /** Becomes `createConnect`'s `config` verbatim. */
  config: unknown;
}

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
  /** Optional interactive onboarding flow (e.g. scan-a-QR-code login) that
   * produces the config a connect will be created from. Absent for
   * providers whose config is entered directly through the settings form. */
  onboard?(handle: OnboardHandle): Promise<OnboardResult>;
}

export interface ConnectorProviderView {
  id: string;
  name: string;
  description: string;
  icon?: string;
  supportsOnboarding: boolean;
}

export type OnboardingState = "pending" | "completed" | "error" | "cancelled";

export interface OnboardingView {
  sessionId: string;
  state: OnboardingState;
  qrUrl?: string;
  qrExpireIn?: number;
  statusNote?: string;
  /** Set when `state === "completed"`. */
  connect?: ConnectView;
  /** Set when `state === "error"`. */
  error?: string;
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
