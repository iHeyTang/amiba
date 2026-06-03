// packages/extension-host/src/renderer/i18n-merge.ts
export type FlatI18nTable = Record<string, string>

export function prefixTable(extensionId: string, table: FlatI18nTable): FlatI18nTable {
  const out: FlatI18nTable = {}
  const prefix = `ext.${extensionId}.`
  for (const [k, v] of Object.entries(table)) out[prefix + k] = v
  return out
}

export function mergeExtensionTables(opts: {
  core: FlatI18nTable
  perExtension: Record<string, FlatI18nTable>
}): FlatI18nTable {
  const merged: FlatI18nTable = { ...opts.core }
  for (const [id, table] of Object.entries(opts.perExtension)) {
    const prefixed = prefixTable(id, table)
    for (const [k, v] of Object.entries(prefixed)) merged[k] = v
  }
  return merged
}
