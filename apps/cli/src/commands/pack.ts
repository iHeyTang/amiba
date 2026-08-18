import { resolve } from "node:path"
import kleur from "kleur"
import { create as tarCreate } from "tar"
import { readDshPluginPackage } from "../lib/plugin-package.js"

interface PackOptions {
  output: string
}

export async function packCommand(opts: PackOptions) {
  const cwd = process.cwd()
  const manifest = readDshPluginPackage(cwd)
  const outPath = resolve(cwd, opts.output)
  await tarCreate({ gzip: true, cwd, file: outPath }, ["package.json", "README.md", "lib"])
  console.log(
    kleur.green("✓"),
    `Packed ${kleur.cyan(manifest.name + "@" + manifest.version)} → ${kleur.dim(outPath)}`,
  )
}
