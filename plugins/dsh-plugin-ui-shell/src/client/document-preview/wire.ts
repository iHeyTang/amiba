import type { WorkspaceDocumentContent, WorkspaceDocumentReadRequest } from '@amiba/app-runtime/platform'
export type WorkspaceFileText = Extract<WorkspaceDocumentContent, { text: string }>
export type WorkspaceFileBytes = Extract<WorkspaceDocumentContent, { data: string }>
export type WorkspaceFileRange = Omit<Extract<WorkspaceDocumentReadRequest, { kind: 'text' }>, 'kind'>
