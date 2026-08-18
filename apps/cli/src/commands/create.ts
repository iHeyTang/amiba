import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import kleur from "kleur"
import prompts from "prompts"
import { spawnAsync } from "../lib/child-process.js"

interface CreateOptions {
  id?: string
  install?: boolean
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// dist/commands/create.js -> ../../src/template
const TEMPLATE_ROOT = join(__dirname, "..", "..", "src", "template")

export async function createCommand(
  name: string | undefined,
  opts: CreateOptions,
) {
  const promptList: prompts.PromptObject[] = []
  if (!name) {
    promptList.push({
      type: "text",
      name: "name",
      message: "DSH plugin name",
      initial: "my-plugin",
    })
  }
  if (!opts.id) {
    promptList.push({
      type: "text",
      name: "id",
      message: "Cordis plugin id",
      initial: "my-plugin",
    })
  }
  promptList.push({
    type: "text",
    name: "author",
    message: "npm scope (without @)",
    initial: "example",
  })

  const replies = (await prompts(promptList)) as Record<string, string>

  const requestedName = name ?? replies["name"]
  const slug = requestedName?.replace(/^dsh-plugin-/u, "")
  const finalName = slug ? `dsh-plugin-${slug}` : undefined
  const finalId = opts.id ?? replies["id"] ?? slug ?? ""
  const author = replies["author"] || "example"

  if (!finalName || !slug) throw new Error("Plugin name is required")
  if (!finalId) throw new Error("Plugin id is required")

  if (!/^[a-z0-9][a-z0-9-]*$/u.test(slug) || !/^[a-z0-9][a-z0-9-]*$/u.test(finalId)) {
    throw new Error("plugin name and id may contain only lowercase letters, digits, and hyphens")
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(author)) {
    throw new Error("npm scope may contain only lowercase letters, digits, and hyphens")
  }
  const pluginName = finalName
  const pluginSlug = slug

  const target = join(process.cwd(), finalName)
  if (existsSync(target)) {
    throw new Error(`${target} already exists`)
  }

  // Walk template dir recursively
  function walk(dir: string, dest: string) {
    mkdirSync(dest, { recursive: true })
    for (const entry of readdirSync(dir)) {
      const src = join(dir, entry)
      const isTpl = entry.endsWith(".tpl")
      const outName = isTpl ? entry.slice(0, -4) : entry
      const out = join(dest, outName)
      const st = statSync(src)
      if (st.isDirectory()) {
        walk(src, out)
      } else if (isTpl) {
        const content = readFileSync(src, "utf8")
          .replaceAll("{{NAME}}", pluginName)
          .replaceAll("{{SLUG}}", pluginSlug)
          .replaceAll("{{ID}}", finalId)
          .replaceAll("{{AUTHOR}}", author)
        writeFileSync(out, content)
      } else {
        // copy as-is (non-template files)
        writeFileSync(out, readFileSync(src))
      }
    }
  }

  walk(TEMPLATE_ROOT, target)

  console.log(
    kleur.green("✓"),
    `Scaffolded ${kleur.cyan(finalName)} (${kleur.dim(`@${author}/${finalName}`)})`,
  )

  if (opts.install !== false) {
    console.log("\n", kleur.bold("Installing dependencies…"))
    await spawnAsync("pnpm", ["install"], { cwd: target }).exit
  }

  console.log(kleur.bold("\nNext steps:"))
  console.log("  ", kleur.cyan(`cd ${finalName}`))
  console.log("  ", kleur.cyan("pnpm dev"))
  console.log(
    "    └─ Add the package to a DSH bundle/Loader graph; Electron does not load plugins.",
  )
}
