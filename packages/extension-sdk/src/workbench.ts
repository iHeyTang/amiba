import type { WorkbenchPanelOwner } from "./slots.js";
import type { ComponentType, ReactNode } from "react";

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
  /** Reuse this component instance across resources in the same session.
   * Views sharing a component and instanceKey can share navigation UI.
   * Omit to remount for each resource. Preview children own their own keys.
   */
  instanceKey?: string;
  /** Mounted alongside the workbench for the elected view, including background sessions.
   * Owns persistent surfaces; removing/replacing the contribution unmounts it.
   */
  host?: ComponentType;
  tabIcon?: ComponentType<{ resource: WorkbenchResource; className?: string }>;
  /** Optional action in the workbench header, follows the same election as the view. */
  toolbar?: ComponentType;
  /** Await cleanup before closing a tab. Rejection keeps it open for retry. */
  onClose?(
    resource: WorkbenchResource,
    sessionId: string,
  ): void | Promise<void>;
  /** Resolve a URL using this plugin's resource semantics; null declines it. */
  resolveUrl?(
    url: string,
    resources: readonly WorkbenchResource[],
  ): WorkbenchResource | null;
  /** New-tab action. The same contribution drives the empty state and + menu. */
  launcher?: {
    label(): string;
    icon?: ComponentType<{ className?: string }>;
    /** Omit for a singleton resource with the resourceType as its id. */
    createResource?(): WorkbenchResource;
  };
}

/** The shell supplies session/platform context; an installed plugin supplies the workbench. */
export interface WorkbenchShellExtension {
  id: string;
  order: number;
  component: ComponentType<{
    visible?: boolean;
    renderPanel?: (owner: WorkbenchPanelOwner) => ReactNode;
    inspectToolCall?: (callId: string) => boolean;
  }>;
  toggle: ComponentType;
}

/**
 * A plugin-owned GROUP in the pinned summary popover (the floating panel that
 * summarizes workspace activity without expanding the workbench). Each
 * contribution is one collapsible group: a localized title plus its rows.
 */
export interface WorkbenchSummaryContribution {
  id: string;
  /** Lower order wins; id breaks ties deterministically. */
  order: number;
  /** Localized group title, e.g. "浏览器" / "Browser". */
  label(): string;
  /** Renders the group's rows for the addressed session. */
  component: ComponentType<{ sessionId: string }>;
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    /** Register inject: () => ({ extension: WorkbenchShellExtension }). */
    "amiba.workbench.shell": { kind: "list"; scope: "root" };
    /** Register inject: () => ({ extension: WorkbenchViewExtension }). */
    "amiba.workbench.view": { kind: "list"; scope: "root" };
    /** Register inject: () => ({ extension: WorkbenchSummaryContribution }). */
    "amiba.workbench.summary": { kind: "list"; scope: "root" };
  }
}
