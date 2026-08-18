import kleur from "kleur"
import { readDshPluginPackage } from "../lib/plugin-package.js"
import { spawnAsync } from "../lib/child-process.js"

export async function buildCommand() {
  const cwd = process.cwd()
  readDshPluginPackage(cwd)
  console.log(kleur.bold("Building DSH host plugin…"))
  await spawnAsync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd }).exit
  console.log(kleur.bold("Building optional DSH Client plugin…"))
  await spawnAsync("pnpm", ["exec", "vite", "build"], { cwd }).exit
  console.log(kleur.green("✓"), "Build complete")
}
