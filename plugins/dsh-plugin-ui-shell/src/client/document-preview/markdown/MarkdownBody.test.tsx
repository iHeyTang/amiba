// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { MarkdownBody, type MarkdownBodyProps } from './MarkdownBody.js'
import { markdownDefinition } from './index.js'
import { DocumentPreviewRegistry } from '../document/registry.js'
afterEach(cleanup)
const props = (text: string, eof = true) => ({ content: { kind: 'text', text, pages: [{ offset: 1, text, lines: text.split('\n').length }], eof }, t: (key: string) => ({ 'code.copy': 'Copy source', 'code.copied': 'Copied source' })[key] ?? key }) as MarkdownBodyProps
it('renders Markdown semantics through the installed primitive with localized code controls', async () => {
  const { container } = render(<MarkdownBody {...props('# Document\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst answer = 42;\n```\n\n<script>bad()</script>\n\n[unsafe](javascript:bad())')} />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Document')
  expect(container.querySelector('table')).toBeTruthy()
  await waitFor(() => expect(container.querySelector('code')?.textContent).toContain('const answer = 42;'))
  expect(screen.getByRole('button', { name: 'Copy source' })).toBeTruthy()
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
})
it('settles references across accumulated pages and returns no body for byte contents', () => {
  const view = render(<MarkdownBody {...props('# Notes\n\n[reference][target]\n', false)} />)
  const body = view.container.querySelector('[data-document-markdown]')
  view.rerender(<MarkdownBody {...props('# Notes\n\n[reference][target]\n\n[target]: https://example.com/')} />)
  expect(view.container.querySelector('[data-document-markdown]')).toBe(body)
  expect(screen.getByRole('link', { name: 'reference' }).getAttribute('href')).toBe('https://example.com/')
  view.rerender(<MarkdownBody {...{ ...props(''), content: { kind: 'bytes', data: new Uint8Array() } }} />)
  expect(view.container.querySelector('[data-document-markdown]')).toBeNull()
})
it('matches Markdown suffixes and yields to external implementations', () => {
  const registry = new DocumentPreviewRegistry()
  const builtin = markdownDefinition(() => 'Markdown')
  registry.register(builtin)
  expect(registry.candidates('folder/README.MD')[0]).toBe(builtin)
  expect(registry.candidates('doc.markdown')[0]).toBe(builtin)
  const off = registry.register({ id: 'external', extensions: ['md'], title: () => 'External', loading: 'text-pages' })
  expect(registry.candidates('README.md')[0]?.id).toBe('external')
  off()
  expect(registry.candidates('README.md')[0]).toBe(builtin)
})

it('localizes streamed and settled footnotes and updates labels without source changes', () => {
  const text = 'Note[^one].\n\n[^one]: Footnote body.'
  const localized = { ...props(text, false), t: (key: string) => key === 'footnotes' ? '脚注' : key } as MarkdownBodyProps
  const view = render(<MarkdownBody {...localized} />)
  expect(screen.getByRole('heading', { name: '脚注' })).toBeTruthy()
  view.rerender(<MarkdownBody {...localized} t={((key: string) => key === 'footnotes' ? 'Notes' : key) as MarkdownBodyProps['t']} />)
  expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy()
  view.rerender(<MarkdownBody {...localized} content={props(text).content} />)
  expect(screen.getByRole('heading', { name: '脚注' })).toBeTruthy()
  expect(view.container.querySelector('[data-footnotes] li')?.textContent).toContain('Footnote body.')
})
it('preserves rc.2 default footnotes and legacy code labels while accepting newer labels', async () => {
  const text = 'Note[^one].\n\n[^one]: Footnote body.\n\n```js\nconst n = 1;\n```'
  const view = render(<MarkdownText text={text} codeLabels={{ copyLabel: 'Legacy copy' }} />)
  expect(screen.getByRole('heading', { name: 'Footnotes' })).toBeTruthy()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Legacy copy' })).toBeTruthy())
  view.rerender(<MarkdownText text={text} codeLabels={{ copyLabel: 'Legacy copy' }} labels={{ code: { copyLabel: 'New copy' }, footnotes: 'Notes' }} />)
  expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy()
  await waitFor(() => expect(screen.getByRole('button', { name: 'New copy' })).toBeTruthy())
  expect(screen.queryByRole('button', { name: 'Legacy copy' })).toBeNull()
})
