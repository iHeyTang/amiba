// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
export function pathPartsOf(path: string): { readonly directory: string; readonly name: string } {
  const trimmed = path.replace(/[/\\]+$/, '')
  if (trimmed === '') return { directory: '', name: path }
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1
  return { directory: trimmed.slice(0, cut), name: trimmed.slice(cut) }
}
