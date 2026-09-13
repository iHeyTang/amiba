import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceFilesAdapter } from '@amiba/app-runtime/platform'
import type { SidebarRightTabRegistry } from '../sidebar-right/tab-registry.js'
import { DocumentPreviewRegistry } from './document/registry.js'
import { documentTabInfoFactory } from './document/contract.js'
import { createTextStore } from './store.js'
import { nativeDocumentReads } from './native-rpc.js'
import { textFace } from './face.js'
import { TextPreview, type TextPreviewInjected } from './TextPreview.js'
import { TextTitle } from './TextTitle.js'
import { TextBody } from './text/TextBody.js'
import { textBodyDefinition, PLAIN_BODY_ID } from './text/index.js'
import { textDefinition, TEXTPREVIEW_ID } from './definition.js'
import { en, zh, type SidebarDocumentPreviewKey } from './locales.js'
import previewCss from './TextPreview.module.css?inline'
import loadingCss from './LoadingIndicator.module.css?inline'

declare module '@deepseek-ai/cordis' { interface Context { documentPreviews: DocumentPreviewRegistry } }
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { sidebarDocumentPreview: SidebarDocumentPreviewKey } }
/** Attach document readers as a separate sidebar type; existing file preview stays available. */
export function registerDocumentPreview(ctx: ClientContext, tabs: SidebarRightTabRegistry, files: WorkspaceFilesAdapter): () => void {
  const previews = new DocumentPreviewRegistry()
  const disposeService = ctx.reflect.provide('documentPreviews', previews)
  const disposeLocale = ctx.locale.register('sidebarDocumentPreview', { zh, en })
  const t = ctx.locale.bind('sidebarDocumentPreview')
  const disposeType = tabs.register(textDefinition())
  const disposePlain = previews.register(textBodyDefinition(() => t('viewer.text')))
  const store = createTextStore()
  const { readPage, readAll } = nativeDocumentReads(files)
  const face = textFace(readPage, readAll)
  const style = document.createElement('style')
  style.dataset.pluginCss = '@amiba/dsh-plugin-ui-shell/document-preview'
  style.textContent = previewCss + '\n' + loadingCss
  document.head.append(style)
  const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: TEXTPREVIEW_ID, locale: 'sidebarDocumentPreview', store,
    children: { 'sidebar.right.tab.document': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: documentTabInfoFactory } } } },
    inject: (sessionId, actions): TextPreviewInjected => ({ ...face(sessionId, actions), hooks: { documentPreviews: previews } }),
  }, TextPreview))
  const disposeTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TEXTPREVIEW_ID }, TextTitle))
  const disposeText = ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({ name: 'sidebar.right.tab.document', key: PLAIN_BODY_ID }, TextBody))
  return () => {
    disposeText(); disposeTitle(); disposeBody(); disposePlain(); disposeType()
    void disposeService(); disposeLocale(); style.remove()
  }
}
