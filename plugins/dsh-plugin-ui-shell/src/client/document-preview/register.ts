import { MarkdownBody } from './markdown/MarkdownBody.js'
import { markdownDefinition, MARKDOWN_BODY_ID } from './markdown/index.js'
import { en as markdownEn, zh as markdownZh } from './markdown/locales.js'
import markdownCss from './markdown/MarkdownBody.module.css?inline'
import { ImageBody } from './image/ImageBody.js'
import { imageBodyDefinition, IMAGE_BODY_ID } from './image/index.js'
import { en as imageEn, zh as imageZh } from './image/locales.js'
import imageCss from './image/ImageBody.module.css?inline'
import { HtmlBody, type HtmlBodyProps } from './html/HtmlBody.js'
import { htmlBodyDefinition, HTML_BODY_ID } from './html/index.js'
import { en as htmlEn, zh as htmlZh } from './html/locales.js'
import htmlCss from './html/HtmlBody.module.css?inline'
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
  const disposeMarkdownLocale = ctx.locale.register('documentMarkdown', { zh: markdownZh, en: markdownEn })
  const markdownT = ctx.locale.bind('documentMarkdown')
  const disposeMarkdown = previews.register(markdownDefinition(() => markdownT('viewer.label')))
  const disposeImageLocale = ctx.locale.register('sidebarImage', { zh: imageZh, en: imageEn })
  const imageT = ctx.locale.bind('sidebarImage')
  const disposeImage = previews.register(imageBodyDefinition(() => imageT('title')))
  const disposeHtmlLocale = ctx.locale.register('documentHtml', { zh: htmlZh, en: htmlEn })
  const htmlT = ctx.locale.bind('documentHtml')
  const disposeHtml = previews.register(htmlBodyDefinition(() => htmlT('title')))
  const disposePlain = previews.register(textBodyDefinition(() => t('viewer.text')))
  const store = createTextStore()
  const { readPage, readAll, readRelated } = nativeDocumentReads(files)
  const face = textFace(readPage, readAll)
  const style = document.createElement('style')
  style.dataset.pluginCss = '@amiba/dsh-plugin-ui-shell/document-preview'
  style.textContent = previewCss + '\n' + loadingCss + '\n' + markdownCss + '\n' + imageCss + '\n' + htmlCss
  document.head.append(style)
  const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: TEXTPREVIEW_ID, locale: 'sidebarDocumentPreview', store,
    children: { 'sidebar.right.tab.document': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: documentTabInfoFactory } } } },
    inject: (sessionId, actions): TextPreviewInjected => ({ ...face(sessionId, actions), hooks: { documentPreviews: previews } }),
  }, TextPreview))
  const disposeTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TEXTPREVIEW_ID }, TextTitle))
  const disposeText = ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({ name: 'sidebar.right.tab.document', key: PLAIN_BODY_ID }, TextBody))
  const disposeMarkdownBody = ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({ name: 'sidebar.right.tab.document', key: MARKDOWN_BODY_ID, locale: 'documentMarkdown' }, MarkdownBody))
  const disposeImageBody = ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({ name: 'sidebar.right.tab.document', key: IMAGE_BODY_ID, locale: 'sidebarImage' }, ImageBody))
  const disposeHtmlBody = ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({ name: 'sidebar.right.tab.document', key: HTML_BODY_ID, locale: 'documentHtml', inject: (): Pick<HtmlBodyProps, 'readRelated'> => ({ readRelated }) }, HtmlBody))
  return () => {
    disposeHtmlBody(); disposeHtml(); disposeHtmlLocale();
    disposeImageBody(); disposeImage(); disposeImageLocale();
    disposeMarkdownBody(); disposeMarkdown(); disposeMarkdownLocale();
    disposeText(); disposeTitle(); disposeBody(); disposePlain(); disposeType()
    void disposeService(); disposeLocale(); style.remove()
  }
}
