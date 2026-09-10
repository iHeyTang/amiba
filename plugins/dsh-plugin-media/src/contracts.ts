/** Provider-neutral contract. No provider credentials or executable code cross it. */
export type MediaOperation =
  | "image.generate"
  | "video.generate"
  | "speech.synthesize"
  | "audio.generate";
export type MediaKind = "image" | "video" | "audio" | "file";
export interface MediaModel {
  id: string;
  name: string;
  /** Provider-supplied display description, matching DSH LlmModelInfo. */
  description?: string;
  /** Inventory-only indication of an implemented provider protocol. */
  supported?: boolean;
  parameterContract?: {
    version: string;
    schema: Record<string, unknown>;
    constraints: string[];
  };
  protocols: string[];
  operations: MediaOperation[];
}
export interface MediaProtocol {
  id: string;
  operations: MediaOperation[];
  documentation: string[];
  instructions: string;
}
export interface MediaDescription {
  provider: string;
  name: string;
  models: MediaModel[];
  /** Full provider inventory for display, including routes not executable here. */
  inventory?: MediaModel[];
  protocols: MediaProtocol[];
}
export interface MediaRequest {
  model: string;
  protocol: string;
  operation: MediaOperation;
  /** Native request body, including model-specific nested fields. */
  parameters: Record<string, unknown>;
}
export interface MediaArtifactSource {
  kind: MediaKind;
  mimeType?: string;
  /** Provider output only; the host persists it before presenting success. */
  url?: string;
  bytes?: Uint8Array;
}
export interface MediaTaskReference {
  id: string;
  protocol: string;
  model: string;
}
/** Optional per-request cumulative accounting snapshot. Omit when unsupported; {} means supported but unavailable. Never report estimates as actual cost. */
export interface MediaAccounting {
  usage?: Record<string, unknown>;
  cost?: { amount: string; currency: string };
}
export type MediaExecution = { accounting?: MediaAccounting } & (
  | {
      status: "succeeded";
      artifacts: MediaArtifactSource[];
      warnings?: string[];
    }
  | { status: "queued" | "running"; task: MediaTaskReference }
  | { status: "failed" | "cancelled" | "expired"; message: string }
);
/** Quote for the exact normalized request; not actual accounting. Read-only, never submits generation. */
export interface MediaEstimate {
  minimum?: number;
  maximum: number;
  currency: string;
  source: string;
  validUntil?: number;
}
export interface MediaProvider {
  id: string;
  describe(signal?: AbortSignal): Promise<MediaDescription>;
  /** Validate and normalize native parameters before creating a paid job. Must not submit generation. */
  /** Read-only account-specific choices, such as current voice IDs. */
  choices?(model: string, signal: AbortSignal): Promise<unknown>;
  estimate?(request: MediaRequest, signal: AbortSignal): Promise<MediaEstimate | undefined>;
  prepare(request: MediaRequest, signal: AbortSignal): Promise<MediaRequest>;
  generate(request: MediaRequest, signal: AbortSignal): Promise<MediaExecution>;
  queryTask?(
    task: MediaTaskReference,
    signal: AbortSignal,
  ): Promise<MediaExecution>;
  /** Omission means remote cancellation is unsupported, not locally simulated. */
  cancelTask?(task: MediaTaskReference, signal: AbortSignal): Promise<void>;
}
export type MediaErrorCode =
  | "INVALID_REQUEST"
  | "UNAVAILABLE"
  | "SUBMISSION_UNKNOWN"
  | "PROVIDER_ERROR";
export class MediaError extends Error {
  constructor(
    public readonly code: MediaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MediaError";
  }
}
