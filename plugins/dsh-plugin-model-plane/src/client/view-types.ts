/** Private React presentation state. These are not provider/plugin or RPC contracts.
 * The original official objects are retained; plugins register only with DSH. */
import type {
  ConfigurableProviderView,
  CredentialView,
  ModelProviderGroup,
  ModelSelection,
  SettingsNamespaceView,
  SettingsPathOpView,
} from "@deepseek-ai/dsh-api-remotes/client";
export type AgentModelSelectionShape = ModelSelection;
export type ModelDefinitionShape = ModelProviderGroup["models"][number] & {
  enabled?: boolean;
  inventoryOnly?: boolean;
  pending?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  supported?: boolean;
  outputModalities?: string[];
  contextWindow?: number;
  maxTokens?: number;
  inputModalities?: string[];
};
export interface ProviderConfiguration {
  namespace: string;
  path: string[];
  revision: number;
  schema: unknown;
  value: Record<string, unknown>;
  credentialFields: Array<{ path: string[]; ref: string }>;
  removable: boolean;
}
export interface ModelProviderProfileShape {
  official?: ConfigurableProviderView;
  id: string;
  displayName: string;
  protocol: string;
  baseURL?: string;
  credentialRef?: string;
  enabled: boolean;
  availability?:
    | "ready"
    | "unconfigured"
    | "missing-credential"
    | "no-models"
    | "catalog-error";
  visibilityEditable?: boolean;
  editable: boolean;
  source: "builtin" | "user" | "imported";
  models: ModelDefinitionShape[];
  configuration?: ProviderConfiguration;
}
export interface ModelPlaneSnapshotShape {
  revision: number;
  protocols?: string[];
  providers: ModelProviderProfileShape[];
  groups: ModelProviderGroup[];
  defaultSelection?: ModelSelection;
  credentials: Record<string, CredentialView>;
  failures: Array<{ id: string; name: string; message: string }>;
}
export interface ConfigureProviderInput {
  expectedRevision: SettingsNamespaceView["revision"];
  ops: SettingsPathOpView[];
  credentials: Array<{ ref: string; value?: string }>;
}
