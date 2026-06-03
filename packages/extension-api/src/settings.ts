export type SettingsFieldType =
  | "string"
  | "number"
  | "boolean"
  | "url"
  | "secret"

export interface SettingsField {
  key: string
  type: SettingsFieldType
  labelKey: string
  descriptionKey?: string
  defaultValue?: unknown
  /** When `tabId` is set the field is rendered under that contributed settings tab. */
  tabId?: string
}

export interface SettingsSchema {
  fields: SettingsField[]
}
