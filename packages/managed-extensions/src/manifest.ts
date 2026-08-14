import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type { ManagedExtensionManifest } from "./types"

const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9-]+)+$/
const ALIAS_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

function isSafeRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.startsWith("\\")) return false
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false
  return !value.split(/[\\/]+/).some((part) => part === "..")
}

function validateCommands(value: unknown, label: string): void {
  if (value === undefined) return
  if (
    !Array.isArray(value) ||
    value.some(
      (command) =>
        !Array.isArray(command) ||
        command.length === 0 ||
        command.some((part) => typeof part !== "string" || !part),
    )
  ) {
    throw new Error(`${label} must be an array of non-empty argument arrays`)
  }
}

export function validateManagedExtensionManifest(raw: unknown): ManagedExtensionManifest {
  if (!raw || typeof raw !== "object") throw new Error("manifest must be an object")
  const manifest = raw as Partial<ManagedExtensionManifest>
  if (manifest.schemaVersion !== 1) throw new Error("schemaVersion must be 1")
  if (typeof manifest.id !== "string" || !ID_RE.test(manifest.id)) {
    throw new Error("id must be a reverse-DNS identifier")
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    throw new Error("name is required")
  }
  if (
    manifest.kind !== "static-content" &&
    manifest.kind !== "interactive-ui" &&
    manifest.kind !== "tool-app" &&
    manifest.kind !== "registered-mcp"
  ) {
    throw new Error("kind is invalid")
  }
  if (
    manifest.runtime !== "static-mcp-app" &&
    manifest.runtime !== "node" &&
    manifest.runtime !== "python" &&
    manifest.runtime !== "registered"
  ) {
    throw new Error("runtime is invalid")
  }
  if (manifest.runtime !== "static-mcp-app") {
    if (!manifest.mcp?.providers?.length) {
      throw new Error("non-static Extensions must declare at least one MCP provider")
    }
  }
  const aliases = new Set<string>()
  for (const provider of manifest.mcp?.providers ?? []) {
    if (!provider.alias?.trim() || !ALIAS_RE.test(provider.alias)) {
      throw new Error("provider alias is invalid")
    }
    if (aliases.has(provider.alias)) throw new Error(`duplicate provider alias: ${provider.alias}`)
    aliases.add(provider.alias)
    if (provider.kind !== "bundled" && provider.kind !== "registered") {
      throw new Error(`provider ${provider.alias} kind is invalid`)
    }
    if (provider.kind === "bundled" && !provider.entry && !provider.command) {
      throw new Error(`bundled provider ${provider.alias} requires entry or command`)
    }
    if (provider.entry && !isSafeRelativePath(provider.entry)) {
      throw new Error(`provider ${provider.alias} entry must stay inside the Extension`)
    }
    if (provider.args?.some((argument) => typeof argument !== "string")) {
      throw new Error(`provider ${provider.alias} args must be strings`)
    }
    if (provider.transport && provider.transport !== "stdio" && provider.transport !== "streamable-http") {
      throw new Error(`provider ${provider.alias} transport is invalid`)
    }
    if (provider.kind === "registered" && !provider.providerId && !provider.url) {
      throw new Error(`registered provider ${provider.alias} requires providerId or url`)
    }
  }
  if (manifest.runtime === "static-mcp-app" && !Object.keys(manifest.surfaces ?? {}).length) {
    throw new Error("static-mcp-app requires at least one surface")
  }
  for (const [name, surface] of Object.entries(manifest.surfaces ?? {})) {
    if (!surface?.resourceUri?.startsWith("ui://")) {
      throw new Error(`surfaces.${name}.resourceUri must use ui://`)
    }
    if (manifest.runtime === "static-mcp-app" && !surface.entry) {
      throw new Error(`surfaces.${name}.entry is required for static-mcp-app`)
    }
    if (surface.entry && !isSafeRelativePath(surface.entry)) {
      throw new Error(`surfaces.${name}.entry must stay inside the Extension`)
    }
    if (surface.provider && !aliases.has(surface.provider)) {
      throw new Error(`surfaces.${name}.provider is not declared`)
    }
  }
  for (const mention of manifest.mentions ?? []) {
    if (!mention.id?.trim() || !mention.label?.trim()) {
      throw new Error("mention id and label are required")
    }
    if (!aliases.has(mention.provider)) {
      throw new Error(`mention ${mention.id} provider is not declared`)
    }
    if (!!mention.resourceUriTemplate === !!mention.searchTool) {
      throw new Error(`mention ${mention.id} requires exactly one resourceUriTemplate or searchTool`)
    }
  }
  const pluginIds = new Set<string>()
  for (const [index, plugin] of (manifest.hermesPlugins ?? []).entries()) {
    if (!plugin || typeof plugin !== "object") {
      throw new Error(`hermesPlugins[${index}] must be an object`)
    }
    if (typeof plugin.id !== "string" || !plugin.id.trim()) {
      throw new Error(`hermesPlugins[${index}].id is required`)
    }
    if (plugin.id !== plugin.id.trim()) {
      throw new Error(`hermesPlugins[${index}].id must be normalized`)
    }
    if (pluginIds.has(plugin.id)) {
      throw new Error(`duplicate Hermes plugin id: ${plugin.id}`)
    }
    pluginIds.add(plugin.id)
    if (plugin.version !== undefined && (typeof plugin.version !== "string" || !plugin.version.trim())) {
      throw new Error(`hermesPlugins[${index}].version must be a non-empty string`)
    }
    if (plugin.required !== undefined && typeof plugin.required !== "boolean") {
      throw new Error(`hermesPlugins[${index}].required must be a boolean`)
    }
  }
  const permissions = manifest.permissions ?? []
  if (!Array.isArray(permissions) || permissions.some((item) => typeof item !== "string")) {
    throw new Error("permissions must be a string array")
  }
  for (const permission of permissions) {
    if (!permission.trim() || permission !== permission.trim()) {
      throw new Error("permissions must be non-empty normalized tokens")
    }
    if (permission.startsWith("network:")) {
      const value = permission.slice("network:".length)
      let parsed: URL
      try {
        parsed = new URL(value)
      } catch {
        throw new Error(`network permission is invalid: ${permission}`)
      }
      if (parsed.protocol !== "https:" || parsed.origin !== value) {
        throw new Error(`network permission must contain one HTTPS origin: ${permission}`)
      }
    }
  }
  if (!Number.isInteger(manifest.dataSchemaVersion ?? 1) || (manifest.dataSchemaVersion ?? 1) < 1) {
    throw new Error("dataSchemaVersion must be a positive integer")
  }
  validateCommands(manifest.build?.commands, "build.commands")
  validateCommands(manifest.build?.testCommands, "build.testCommands")
  if (manifest.build?.outputDir && !isSafeRelativePath(manifest.build.outputDir)) {
    throw new Error("build.outputDir must stay inside the Extension")
  }
  return {
    ...manifest,
    description: manifest.description?.trim() || undefined,
    permissions: [...new Set(permissions)].sort(),
    dataSchemaVersion: manifest.dataSchemaVersion ?? 1,
  } as ManagedExtensionManifest
}

export async function readManagedExtensionManifest(projectPath: string): Promise<ManagedExtensionManifest> {
  const raw = JSON.parse(await readFile(join(projectPath, "manifest.json"), "utf8"))
  return validateManagedExtensionManifest(raw)
}
