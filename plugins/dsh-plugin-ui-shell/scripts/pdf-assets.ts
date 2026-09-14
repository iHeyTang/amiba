// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
/** Bundle resources and their licenses from the exact installed PDF.js version. */
export function pdfBuildData(): { assets: string; banner: string } {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const groups = [['cMapUrl', 'cmaps'], ['standardFontDataUrl', 'standard_fonts'], ['wasmUrl', 'wasm']] as const
  const licenseFiles = ['LICENSE', ...groups.flatMap(([, folder]) => readdirSync(join(root, folder)).filter(name => name.startsWith('LICENSE')).sort().map(name => `${folder}/${name}`))]
  const notice = licenseFiles.map(name => `${name}\n\n${readFileSync(join(root, name), 'utf8').trimEnd()}`).join('\n\n')
  return {
    assets: JSON.stringify(Object.fromEntries(groups.map(([kind, folder]) => [kind, Object.fromEntries(readdirSync(join(root, folder)).filter(name => !name.startsWith('LICENSE')).sort().map(name => [name, readFileSync(join(root, folder, name)).toString('base64')]))]))),
    banner: `/*! Bundled PDF.js license notices\n${notice.replace(/\*\//g, '* /')}\n*/`,
  }
}
