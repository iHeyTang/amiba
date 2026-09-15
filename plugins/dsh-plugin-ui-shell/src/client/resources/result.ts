/** Resource results cross desktop IPC as plain data, independent of Typert errors. */
export interface ResourceFailure { readonly code: string; readonly message: string; readonly details: Readonly<Record<string, unknown>> }
export type ResourceResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ResourceFailure };
