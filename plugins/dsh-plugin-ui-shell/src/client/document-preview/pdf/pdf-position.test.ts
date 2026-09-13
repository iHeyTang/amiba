// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { observePdfPosition } from './position.js'

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals() })

it('restores a loaded page, tracks scrolling in both directions and ignores hidden/closed bodies', () => {
  const frames = new Map<number, FrameRequestCallback>(); let next = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)) }
  const body = document.createElement('div'); body.style.overflowY = 'auto'
  const root = document.createElement('section'); body.append(root); document.body.append(body)
  Object.defineProperty(body, 'clientHeight', { value: 300 })
  body.getBoundingClientRect = () => ({ top: 20, bottom: 320 }) as DOMRect
  let visible = true
  root.getClientRects = () => ({ length: visible ? 1 : 0 }) as DOMRectList
  for (let page = 1; page <= 6; page++) {
    const node = document.createElement('div'); node.dataset.pdfPage = String(page)
    node.getBoundingClientRect = () => ({ top: 20 + (page-1)*400 - body.scrollTop, bottom: 20 + page*400 - body.scrollTop }) as DOMRect
    root.append(node)
  }
  const onPage = vi.fn()
  const dispose = observePdfPosition(root, 4, onPage)
  expect(body.scrollTop).toBe(1200)
  flush(); expect(onPage).toHaveBeenLastCalledWith(4)
  body.scrollTop = 1800; body.dispatchEvent(new Event('scroll')); flush()
  expect(onPage).toHaveBeenLastCalledWith(5)
  body.scrollTop = 450; body.dispatchEvent(new Event('scroll')); flush()
  expect(onPage).toHaveBeenLastCalledWith(2)
  visible = false; body.scrollTop = 0; body.dispatchEvent(new Event('scroll')); flush()
  expect(onPage).toHaveBeenLastCalledWith(2)
  visible = true; body.dispatchEvent(new Event('scroll')); dispose(); flush()
  expect(onPage).toHaveBeenCalledTimes(3)
  body.dispatchEvent(new Event('scroll')); expect(frames.size).toBe(0)
})
