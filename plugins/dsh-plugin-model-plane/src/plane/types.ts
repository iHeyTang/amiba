import type {
  AgentCredentialView,
  AgentModelSelection,
  ModelDefinition,
  ModelGroup,
} from "@amiba/app-runtime/platform";

/**
 * Plane-owned shapes, moved verbatim from the retired platform-contract
 * members (MP-T4). `ModelDefinition`/`ModelGroup`/`AgentModelSelection`
 * remain platform-owned: the engine-native `agentModels` adapter speaks
 * them independently of the plane.
 */
export type ModelProviderProtocol =
  | "deepseek-chat-completions"
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "provider-native";

/** Canonical provider configuration owned by Amiba, independent of a harness. */
export interface ModelProviderProfile {
  id: string;
  displayName: string;
  protocol: ModelProviderProtocol;
  baseURL?: string;
  credentialRef?: string;
  enabled: boolean;
  editable: boolean;
  source: "builtin" | "user" | "imported";
  models: ModelDefinition[];
}

export interface ModelPlaneSnapshot {
  revision: number;
  providers: ModelProviderProfile[];
  groups: ModelGroup[];
  /** Product default used before an execution session is materialized. */
  defaultSelection?: AgentModelSelection;
  credentials: Record<string, AgentCredentialView>;
  failures: Array<{ id: string; name: string; message: string }>;
}

/**
 * Product-level model plane. DSH is one execution projection of this state;
 * other AI-native consumers use the same provider/model definitions directly.
 */
export interface ModelPlaneAdapter {
  snapshot(): Promise<ModelPlaneSnapshot>;
  setDefaultSelection(
    selection: AgentModelSelection,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot>;
  upsert(input: {
    provider: ModelProviderProfile;
    apiKey?: string;
    expectedRevision?: number;
  }): Promise<ModelPlaneSnapshot>;
  remove(
    providerId: string,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot>;
  discover(input: {
    provider: ModelProviderProfile;
    apiKey?: string;
  }): Promise<{ models: ModelDefinition[] }>;
  unsetCredential(
    providerId: string,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot>;
}
