// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
/** Builtin HTML metadata and keyed body registration; assembly belongs to the package entry. */
import type { DocumentPreviewDefinition } from '../document/registry.js'

/** HTML implementation identity, shared by metadata and the keyed slot. */
export const HTML_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/html'

/**
 * Describe the builtin HTML renderer's file types and loading mode.
 * @param title - locale-owned implementation name.
 * @returns metadata for complete HTML documents.
 */
export function htmlBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return { id: HTML_BODY_ID, extensions: ['html', 'htm'], priority: 'builtin', title, loading: 'bytes-complete', wrap: false }
}
