import type { ComponentType } from "react";

/** Open domain: resource types belong to their contributing plugins. */
export interface WorkbenchResource {
  type: string;
  id: string;
  title: string;
  data?: unknown;
}
export interface WorkbenchViewProps {
  resource: WorkbenchResource;
  sessionId: string;
  openResource(resource: WorkbenchResource): void;
  openFile(path: string, line?: number): void;
}
export interface WorkbenchViewExtension {
  id: string;
  resourceType: string;
  /** Lower order wins; id breaks ties deterministically. */
  order: number;
  component: ComponentType<WorkbenchViewProps>;
  /** Optional persistent navigation entry, removed with the contribution. */
  launcher?: { label(): string; icon?: ComponentType<{ className?: string }> };
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    /** Register inject: () => ({ extension: WorkbenchViewExtension }). */
    "amiba.workbench.view": { kind: "list"; scope: "root" };
  }
}
