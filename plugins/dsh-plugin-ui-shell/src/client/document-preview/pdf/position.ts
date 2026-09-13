/** Reading position belongs to visible pages, independently from render overscan. */
export function observePdfPosition(root: HTMLElement, initialPage: number, onPage: (page: number) => void): () => void {
  let scrollport = root.parentElement
  while (scrollport !== null && !/^(auto|scroll)$/.test(getComputedStyle(scrollport).overflowY)) {
    scrollport = scrollport.parentElement
  }
  if (scrollport === null) return () => {}
  const body = scrollport
  const pages = [...root.querySelectorAll<HTMLElement>('[data-pdf-page]')]
  const target = pages[Math.max(0, Math.min(pages.length - 1, initialPage - 1))]
  // The outer document restores before PDF.js resolves; only now do pages exist.
  if (target !== undefined && body.clientHeight > 0) {
    body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top
  }
  let frame: number | undefined
  let disposed = false
  const record = (): void => {
    frame = undefined
    if (disposed || body.clientHeight === 0 || root.getClientRects().length === 0) return
    const top = body.getBoundingClientRect().top
    const page = pages.find(node => node.getBoundingClientRect().bottom > top + 1)
    if (page !== undefined) onPage(Number(page.dataset.pdfPage))
  }
  const schedule = (): void => {
    if (frame === undefined) frame = requestAnimationFrame(record)
  }
  body.addEventListener('scroll', schedule, { passive: true })
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
  observer?.observe(root)
  schedule()
  return () => {
    disposed = true
    body.removeEventListener('scroll', schedule)
    observer?.disconnect()
    if (frame !== undefined) cancelAnimationFrame(frame)
  }
}
