/** File-only structural contract from the fixed c291e796 attachment service.
 * rc.2 has no exported file types; runtime identifiers retain their exact wire form. */
export interface FileAttachmentRef { attachmentId: string; name: string; bytes: number }
export interface SaveFileAttachment { data: Uint8Array; name?: string }
export interface SaveFileStreamAttachment { data: AsyncIterable<Uint8Array>; name?: string; signal?: AbortSignal }
