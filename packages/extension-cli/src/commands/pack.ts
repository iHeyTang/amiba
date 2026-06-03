import { resolve } from "node:path"
import kleur from "kleur"
import { create as tarCreate } from "tar"
import { readExtensionManifest } from "../lib/manifest.js"

interface PackOptions {
  output: string
}

export async function packCommand(opts: PackOptions) {
  const cwd = process.cwd()
  const manifest = readExtensionManifest(cwd)
  const outPath = resolve(cwd, opts.output)
  await tarCreate({ gzip: true, cwd, file: outPath }, ["manifest.json", "dist"])
  console.log(
    kleur.green("✓"),
    `Packed ${kleur.cyan(manifest.id + "@" + manifest.version)} → ${kleur.dim(outPath)}`,
  )
}
