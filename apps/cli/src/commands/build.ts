import kleur from "kleur"
import { readExtensionManifest } from "../lib/manifest.js"
import { spawnAsync } from "../lib/child-process.js"

export async function buildCommand() {
  const cwd = process.cwd()
  readExtensionManifest(cwd) // validates we're in an extension dir
  console.log(kleur.bold("Building main bundle…"))
  await spawnAsync("pnpm", ["vite", "build", "-c", "vite.main.config.ts"], { cwd }).exit
  console.log(kleur.bold("Building UI bundles…"))
  await spawnAsync("pnpm", ["vite", "build", "-c", "vite.ui.config.ts"], { cwd }).exit
  console.log(kleur.green("✓"), "Build complete")
}
