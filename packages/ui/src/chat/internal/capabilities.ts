/** Host-owned capabilities consumed by the shared desktop chat surface. */

import type { AgentExecutionContext } from "@amiba/app-runtime/core";
import type {
  AgentModelSelection,
  WorkspaceAdapter,
  WorkspaceDevelopmentAdapter,
  WorkspaceFilesAdapter,
} from "@amiba/app-runtime/platform";

/** Settled attachment carried by a queued client hand-off. */
export interface PendingPromptAttachment {
  uiId: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "text" | "pdf" | "binary";
  attachmentId: string;
  thumbDataUrl?: string;
  textPreview?: string;
}

export interface PendingPromptResult {
  text?: string;
  attachments?: PendingPromptAttachment[];
  sourceApp?: string;
  workspacePath?: string;
  agent?: AgentExecutionContext;
  modelSelection?: AgentModelSelection;
  /**
   * Seed the composer but do NOT auto-send: the payload is a suggested
   * opening the user reviews and fires themselves, so no session exists
   * until they actually submit.
   */
  draftOnly?: boolean;
}

export interface PendingPromptCapability {
  /** Read and atomically clear the next queued desktop hand-off. */
  drain(): Promise<PendingPromptResult | null>;
  /** Wake a mounted chat surface when a new hand-off is queued. */
  subscribe?(onChanged: () => void): () => void;
}

export interface WorkspaceInspectorCapability {
  files: WorkspaceFilesAdapter;
  development?: WorkspaceDevelopmentAdapter;
  workspaces?: WorkspaceAdapter;
}

export interface ChatSurfaceCapabilities {
  pendingPrompt?: PendingPromptCapability;
  workspaceInspector?: WorkspaceInspectorCapability;
}
