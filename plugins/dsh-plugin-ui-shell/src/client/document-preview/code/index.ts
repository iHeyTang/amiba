import type { DocumentPreviewDefinition } from '../document/registry.js'
import { CODE_EXTENSIONS } from './languages.js'
export const CODE_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code'
export function codeBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return { id: CODE_BODY_ID, extensions: CODE_EXTENSIONS, priority: 'builtin', title, loading: 'text-pages', wrap: true }
}
