/** PDF binary resources are exact-name, local data with independent transferable buffers. */
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pdfBuildData } from '../../../../scripts/pdf-assets'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPdfBinaryDataFactory, type PdfAssetMap } from './assets.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('PDF binary assets', () => {
  const assets: PdfAssetMap = {
    cMapUrl: { 'sample.bcmap': gzipSync(new Uint8Array([1, 2, 3])).toString('base64') },
    standardFontDataUrl: { 'font.pfb': gzipSync(new Uint8Array([4, 5])).toString('base64') },
    wasmUrl: { 'decoder.wasm': gzipSync(new Uint8Array([6, 7, 8])).toString('base64') },
  }

  it('reads the ambient build payload only when the factory is created', async () => {
    vi.stubGlobal('__DSH_PDFJS_ASSETS__', assets)
    const Factory = createPdfBinaryDataFactory()
    const factory = new Factory()
    expect(Array.from(await factory.fetch({ kind: 'cMapUrl', filename: 'sample.bcmap' }))).toEqual([1, 2, 3])
    expect(Array.from(await factory.fetch({ kind: 'standardFontDataUrl', filename: 'font.pfb' }))).toEqual([4, 5])
    expect(Array.from(await factory.fetch({ kind: 'wasmUrl', filename: 'decoder.wasm' }))).toEqual([6, 7, 8])
  })

  it('never shares a buffer that PDF.js may transfer away', async () => {
    const Factory = createPdfBinaryDataFactory(assets)
    const factory = new Factory()
    const first = await factory.fetch({ kind: 'cMapUrl', filename: 'sample.bcmap' })
    structuredClone(first, { transfer: [first.buffer] })
    expect(first.byteLength).toBe(0)
    expect(Array.from(await factory.fetch({ kind: 'cMapUrl', filename: 'sample.bcmap' }))).toEqual([1, 2, 3])
  })

  it.each(['../font.pfb', 'missing.bcmap', 'toString'])('rejects unbundled filename %s without fetching', async (filename) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const Factory = createPdfBinaryDataFactory(assets)
    await expect(new Factory().fetch({ kind: 'cMapUrl', filename })).rejects.toThrow('not bundled')
    expect(fetch).not.toHaveBeenCalled()
  })
})

it('decodes all packaged PDF.js resources byte-for-byte using the browser decoder', async () => {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('pdfjs-dist/package.json'))
  const directories = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' }
  const payload = JSON.parse(pdfBuildData().assets) as PdfAssetMap
  const factory = new (createPdfBinaryDataFactory(payload))()
  let compressed = 0, original = 0
  for (const kind of Object.keys(directories) as Array<keyof PdfAssetMap>) {
    for (const [filename, packed] of Object.entries(payload[kind])) {
      const bytes = readFileSync(join(root, directories[kind], filename))
      const actual = await factory.fetch({ kind, filename })
      expect(Buffer.from(actual).equals(bytes), `${kind}/${filename}`).toBe(true)
      compressed += packed.length
      original += bytes.toString('base64').length
    }
  }
  expect(compressed).toBeLessThan(original * 0.7)
})
