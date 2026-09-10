import type { ManagedMcpServer, McpServiceDefinition, McpRequirement } from "@amiba/dsh-plugin-mcp-manager";
import type {
  ApprovalOutcomeNotice,
  ApprovalPrompt,
  ApprovalReply,
  InboundConversationRef,
  InboundMessageEnvelope,
  MessageChannelCenter,
  MessageChannelDeliveryStatus,
  OutboundMessageEnvelope,
} from "@amiba/dsh-plugin-messaging-core";

export interface ConversationRef extends InboundConversationRef {}

/** Inbound envelope from a platform adapter: text plus conversation identity. */
export interface ConnectorInboundEnvelope
  extends Omit<InboundMessageEnvelope, "conversation"> {
  conversation: ConversationRef;
}

export type ConnectorStatus =
  | { state: "off" }
  | { state: "connecting" }
  | { state: "ready" }
  | { state: "degraded"; detail: string }
  | { state: "error"; detail: string };

export interface ConnectorHandle {
  readonly connectId: string;
  readonly config: unknown;
  onInbound(
    envelope: ConnectorInboundEnvelope,
  ): Promise<ConnectorInboundResult | undefined>;
  setStatus(status: ConnectorStatus): void;
}

/** Server-only account context. Never expose this face through a Remote. */
export interface ConnectorAccountContext {
  connect: ConnectView;
  config: unknown;
  state: unknown;
  signal: AbortSignal;
  updateState(mutate: (current: unknown) => unknown): Promise<void>;
}

export interface ConnectorAccounts {
  list(): Promise<ConnectView[]>;
  run<T>(id: string, operation: (account: ConnectorAccountContext) => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** Cancel outstanding work after an identity/authorization change. */
  invalidate(id: string): void;
}

export interface ConnectorAccessView {
  identity: "application" | "user";
  label?: string;
  state: "unauthorized" | "authorized" | "expired";
  capabilities: Array<{ id: string; available: boolean }>;
}

export type ConnectorInboundResult = Awaited<
  ReturnType<MessageChannelCenter["acceptInbound"]>
>;

export interface ConnectorRuntime {
  stop(): Promise<void>;
  deliver?(
    conversation: ConversationRef,
    envelope: OutboundMessageEnvelope,
  ): Promise<void>;
  /**
   * Present one tool-approval question on this connector's own surface (a
   * Lark interactive card, a DingTalk AI card…) and resolve with the human's
   * answer. Resolve `null` — never throw for it — when this particular
   * connect cannot present the question natively; connector-core then bridges
   * that `null` straight through to messaging-core, which falls back to its
   * text protocol on the same channel. A throw is bridged through the same
   * way, with a warning logged by messaging-core. `request.signal` aborts
   * when the question is settled by any other path (a text reply, a timeout,
   * the desktop answering first), so a native surface can stop waiting and
   * retract its card.
   */
  requestApproval?(
    conversation: ConversationRef,
    request: ApprovalPrompt,
  ): Promise<ApprovalReply | null>;
  /**
   * Called after a natively presented question settles — whoever won — so the
   * card can flip to its result state. Only invoked for a question this same
   * runtime's `requestApproval` presented successfully (returned non-null,
   * didn't throw); a connector without a native surface can omit both
   * methods entirely.
   */
  announceApprovalOutcome?(
    conversation: ConversationRef,
    notice: ApprovalOutcomeNotice,
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
  | { kind: "mcp"; service: McpServiceDefinition; identity: string; tools: McpRequirement["tools"]; spec: ManagedMcpServer }
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
  /** Omit for tool-only connectors. Authentication remains provider-owned. */
  readonly messaging?: { ownerPairing: boolean };
  /** Schema value driving the settings form; validated by the provider. */
  readonly configSchema: unknown;
  validate(config: unknown): Promise<void>;
  start(handle: ConnectorHandle): Promise<ConnectorRuntime>;
  capabilities(config: unknown): CapabilityDecl[];
  /** Explicit public projection; never return credentials from this hook. */
  settings?(config: unknown): Record<string, unknown>;
  /** Merge a settings edit with the private config. The result is validated before saving. */
  configure?(config: unknown, patch: Record<string, unknown>): unknown;
  /** Public authorization projection of private account state. */
  access?(state: unknown): ConnectorAccessView;
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
  messaging?: { ownerPairing: boolean };
}

export interface ConnectDetails {
  connect: ConnectView;
  settings: Record<string, unknown>;
  access?: ConnectorAccessView;
  capabilityUses?: Array<{ name: string; capabilities: string[] }>;
  messaging?: {
    delivery: MessageChannelDeliveryStatus;
    conversations: Array<{
      key: string;
      kind: "p2p" | "group";
      title?: string;
      sessionId: string;
    }>;
  };
}

export interface UpdateConnectInput {
  name?: string;
  agentPreset?: string;
  settings?: Record<string, unknown>;
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
  status: ConnectorStatus;
  createdAt: string;
  updatedAt: string;
}
