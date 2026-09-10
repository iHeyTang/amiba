import type { ModelDefinition } from "@amiba/app-runtime/platform";

/** Historical disk schema used only by the one-time upgrade. */
export type ModelProviderProtocol = string;

/** Legacy on-disk format, read only by the one-time migration. Never a plugin contract. */
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
