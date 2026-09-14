// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
/** Builtin Markdown metadata and keyed document-body registration. */
import type { DocumentPreviewDefinition } from '../document/registry.js'

/** Implementation identity shared by metadata and the document slot. */
export const MARKDOWN_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown'

/**
 * Describe the Markdown implementation without taking ownership of loading.
 * @param title - locale-owned implementation name.
 * @returns builtin Markdown registration metadata.
 */
export function markdownDefinition(title: () => string): DocumentPreviewDefinition {
  return { id: MARKDOWN_BODY_ID, extensions: ['md', 'markdown'], priority: 'builtin', title, loading: 'text-pages', wrap: false }
}
