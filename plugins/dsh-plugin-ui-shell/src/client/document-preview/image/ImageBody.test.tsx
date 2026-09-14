// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ImageBody, imageMediaType, type ImageBodyProps } from './ImageBody.js'
import { imageBodyDefinition, IMAGE_EXTENSIONS } from './index.js'
import { DocumentPreviewRegistry } from '../document/registry.js'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const props = (data = new Uint8Array([1]), name = 'test.svg') => ({
  content: { kind: 'bytes', data }, resourceAddress: `dsh-resource://file/session/test/${name}`,
  t: (key: string, args?: { name: string }) => key === 'preview' ? `Image: ${args?.name}` : key,
}) as ImageBodyProps
function urls() {
  const create = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  return { create, revoke }
}
it('releases replaced and unmounted bytes and resets decoding for a new image', () => {
  const { create, revoke } = urls()
  const view = render(<ImageBody {...props()} />)
  const first = view.container.querySelector('img')!
  expect(first.hidden).toBe(true)
  fireEvent.load(first)
  expect(first.hidden).toBe(false)
  expect(first.alt).toBe('Image: test.svg')
  view.rerender(<ImageBody {...props(new Uint8Array([2]))} />)
  expect(revoke).toHaveBeenCalledWith('blob:first')
  const next = view.container.querySelector('img')!
  expect(next).not.toBe(first)
  expect(next.hidden).toBe(true)
  fireEvent.error(next)
  expect(screen.getByRole('alert').textContent).toBe('failed')
  expect(next.hidden).toBe(true)
  expect(create.mock.calls[0]?.[0].type).toBe('image/svg+xml')
  view.unmount()
  expect(revoke.mock.calls).toEqual([['blob:first'], ['blob:second']])
})
it('shows allocation and unsupported input failures without leaking URLs', () => {
  const { create, revoke } = urls()
  create.mockReset().mockImplementation(() => { throw new Error('allocation') })
  const view = render(<ImageBody {...props()} />)
  expect(screen.getByRole('alert').textContent).toBe('failed')
  view.rerender(<ImageBody {...props(undefined, 'test.txt')} />)
  expect(screen.getByRole('alert').textContent).toBe('unsupported')
  view.unmount()
  expect(revoke).not.toHaveBeenCalled()
})
it('registers every image suffix as complete bytes and allows third-party priority', () => {
  const registry = new DocumentPreviewRegistry()
  const builtin = imageBodyDefinition(() => 'Image')
  registry.register(builtin)
  for (const suffix of IMAGE_EXTENSIONS) {
    expect(imageMediaType(`C:\\folder\\FILE.${suffix.toUpperCase()}`)).toMatch(/^image\//)
    expect(registry.candidates(`FILE.${suffix.toUpperCase()}`)[0]).toBe(builtin)
  }
  expect(builtin.loading).toBe('bytes-complete')
  const off = registry.register({ id: 'custom', extensions: ['svg'], title: () => 'Custom', loading: 'text-pages' })
  expect(registry.candidates('test.svg')[0]?.id).toBe('custom')
  off()
  expect(registry.candidates('test.svg')[0]).toBe(builtin)
})
