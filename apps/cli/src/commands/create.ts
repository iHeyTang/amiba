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

export async function createCommand(name: string | undefined, opts: CreateOptions) {
  const promptList: prompts.PromptObject[] = []
  if (!name) {
    promptList.push({ type: "text", name: "name", message: "Extension folder name", initial: "my-extension" })
  }
  if (!opts.id) {
    promptList.push({
      type: "text",
      name: "id",
      message: "Extension id (reverse-DNS)",
      initial: "com.example.my-extension",
    })
  }
  promptList.push({ type: "text", name: "author", message: "Author", initial: "" })

  const replies = (await prompts(promptList)) as Record<string, string>

  const finalName = name ?? replies["name"]
  const finalId = opts.id ?? replies["id"]
  const author = replies["author"] || finalId

  if (!finalName) throw new Error("Extension name is required")
  if (!finalId) throw new Error("Extension id is required")

  if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(finalId)) {
    throw new Error(
      `invalid id "${finalId}" — must be reverse-DNS like com.example.my-extension`,
    )
  }

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
          .replaceAll("{{NAME}}", finalName)
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

  console.log(kleur.green("✓"), `Scaffolded ${kleur.cyan(finalName)} (${kleur.dim(finalId)})`)

  if (opts.install !== false) {
    console.log("\n", kleur.bold("Installing dependencies…"))
    await spawnAsync("pnpm", ["install"], { cwd: target }).exit
  }

  console.log(kleur.bold("\nNext steps:"))
  console.log("  ", kleur.cyan(`cd ${finalName}`))
  console.log("  ", kleur.cyan("pnpm hermes-x dev"))
  console.log(
    "    └─ Make sure Hermes desktop is running; you'll see your extension load instantly.",
  )
}
