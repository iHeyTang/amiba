// @vitest-environment jsdom
import { vi, expect, it, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { TextPreview, type TextPreviewProps } from './TextPreview.js'
import { TextBody } from './text/TextBody.js'
import { textBodyDefinition } from './text/index.js'
import type { DocumentPreviewProps } from './document/contract.js'
import { createTextStore } from './store.js'
import { textFace } from './face.js'
import { createResourceSnapshotStore } from '../resources/snapshot-store.js'
import { bindSnapshotSelector } from '../../dev/renderer-bindings.js'
import { ADDRESS, FILE, SESSION, TAB_ID, page } from './fixtures.js'
afterEach(cleanup)
it('dispatches loaded pages, preserves view on remount, reloads changed files and clears closed tabs', async () => {
  const instance = createTextStore().create()
  const controller = new AbortController()
  const read = vi.fn(async (_session: unknown, _path: unknown, offset: number) => page(offset, [offset === 1 ? 'first' : 'last'], offset > 1))
  const face = textFace(read, vi.fn())(SESSION, instance.actions)
  const metadata = createResourceSnapshotStore({ status: 'live', value: { absolutePath: '/file', version: 'v1' }, failure: undefined })
  const definitions = createResourceSnapshotStore([textBodyDefinition(() => 'Text')])
  const info = { tab: { id: TAB_ID, contentId: ADDRESS, title: 'file', navigation: { revision: 1 }, signal: controller.signal } }
  const useTabInfo = () => info
  let owner: DocumentPreviewProps | undefined
  const props = { ...face, useStore: bindSnapshotSelector(instance), actions: instance.actions, useTabInfo,
    useResource: bindSnapshotSelector(metadata), useDocumentPreviews: bindSnapshotSelector(definitions), t: (key: string) => key,
    renderSlot: (_name: string, next: DocumentPreviewProps) => { owner = next; return <TextBody {...next} useTabInfo={useTabInfo as DocumentPreviewProps['useTabInfo']} /> },
  } as unknown as TextPreviewProps
  // useResource is keyed rather than selector-based; its snapshot still comes from a real observable hook.
  const useMeta = bindSnapshotSelector(metadata)
  props.useResource = (() => useMeta(value => value)) as TextPreviewProps['useResource']
  const mounted = render(<TextPreview {...props} />)
  await waitFor(() => expect(document.querySelector('[data-textpreview-line="1"]')?.textContent).toContain('first'))
  expect(owner?.resourceAddress).toBe(ADDRESS)
  expect(read).toHaveBeenCalledWith(FILE.sessionId, FILE.path, 1, controller.signal)
  fireEvent.click(document.querySelector('[data-textpreview-more]')!)
  await waitFor(() => expect(document.querySelector('[data-textpreview-line="2"]')?.textContent).toContain('last'))
  mounted.unmount()
  render(<TextPreview {...props} />)
  expect(read).toHaveBeenCalledTimes(2)
  act(() => metadata.set({ status: 'live', value: { absolutePath: '/file', version: 'v2' }, failure: undefined }))
  expect(document.querySelector('[data-textpreview-changed]')).toBeTruthy()
  fireEvent.click(document.querySelector('[data-textpreview-reload-now]')!)
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3))
  cleanup()
  controller.abort()
  expect(instance.getSnapshot().byTab[TAB_ID]).toBeUndefined()
})
