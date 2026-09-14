// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
/** Builtin image metadata and keyed document-body registration. */
import type { DocumentPreviewDefinition } from '../document/registry.js'

/** Image implementation identity, shared by metadata and the keyed slot. */
export const IMAGE_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/image'

/** File suffixes rendered by the builtin image body. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'] as const

/**
 * Describe the builtin image renderer independently from its keyed body slot.
 * @param title - locale-owned implementation name.
 * @returns metadata for complete image files.
 */
export function imageBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return {
    id: IMAGE_BODY_ID,
    extensions: IMAGE_EXTENSIONS,
    priority: 'builtin',
    title,
    loading: 'bytes-complete',
    wrap: false,
  }
}
