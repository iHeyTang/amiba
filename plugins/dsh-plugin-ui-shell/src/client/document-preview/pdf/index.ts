// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
/** Builtin PDF registration through document metadata and the keyed body slot. */
import type { DocumentPreviewDefinition } from '../document/registry.js'

/** PDF metadata and keyed body share this package-local implementation identity. */
export const PDF_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf'

/**
 * Describe the builtin PDF renderer independently from its keyed body slot.
 * @param title - locale-owned implementation name.
 * @returns the complete-file PDF registration.
 */
export function pdfBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return { id: PDF_BODY_ID, extensions: ['pdf'], priority: 'builtin', title, loading: 'bytes-complete', wrap: false }
}
