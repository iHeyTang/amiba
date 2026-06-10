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

interface CreateMentionSourceOptions {
  description?: string
  author?: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// dist/commands/create-mention-source.js -> ../../src/template-mention-source
const TEMPLATE_ROOT = join(__dirname, "..", "..", "src", "template-mention-source")

// Must match the backplane loader's name rule (also the on-disk dir name).
const NAME_RE = /^[a-z][a-z0-9-]*$/

export async function createMentionSourceCommand(
  name: string | undefined,
  opts: CreateMentionSourceOptions,
) {
  const promptList: prompts.PromptObject[] = []
  if (!name) {
    promptList.push({
      type: "text",
      name: "name",
      message: "Mention source name (lowercase slug, e.g. notion)",
      initial: "my-source",
    })
  }
  if (!opts.description) {
    promptList.push({
      type: "text",
      name: "description",
      message: "One-line description",
      initial: "",
    })
  }
  if (opts.author === undefined) {
    promptList.push({ type: "text", name: "author", message: "Author", initial: "" })
  }

  const replies = promptList.length
    ? ((await prompts(promptList)) as Record<string, string>)
    : {}

  const finalName = name ?? replies["name"]
  const description = opts.description ?? replies["description"] ?? ""
  const author = opts.author ?? replies["author"] ?? ""

  if (!finalName) throw new Error("Mention source name is required")
  if (!NAME_RE.test(finalName) || finalName.length > 32) {
    throw new Error(
      `invalid name "${finalName}" — must match ${NAME_RE} (lowercase slug, max 32 chars)`,
    )
  }

  const target = join(process.cwd(), finalName)
  if (existsSync(target)) {
    throw new Error(`${target} already exists`)
  }

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
          .replaceAll("{{DESCRIPTION}}", description)
          .replaceAll("{{AUTHOR}}", author)
        writeFileSync(out, content)
      } else {
        writeFileSync(out, readFileSync(src))
      }
    }
  }

  walk(TEMPLATE_ROOT, target)

  console.log(kleur.green("✓"), `Scaffolded mention source ${kleur.cyan(finalName)}`)
  console.log(kleur.bold("\nWhat to fill in:"))
  console.log("  ", kleur.cyan("source.py"), kleur.dim("— implement search(rtype, query, limit)"))
  console.log("  ", kleur.cyan("mention-source.yaml"), kleur.dim("— declare @ types + fields + serialize"))
  console.log("  ", kleur.cyan("skills/resolve.md"), kleur.dim("— teach the agent to act on a picked handle"))
  console.log(kleur.bold("\nNext steps:"))
  console.log("  ", kleur.cyan(`cd ${finalName} && git init && git add -A && git commit -m init`))
  console.log("  ", kleur.dim("# install into a running backplane (local dev):"))
  console.log(
    "  ",
    kleur.cyan(
      `curl -XPOST 127.0.0.1:9394/hermes/mention-sources -d '{"from_path":"'$PWD'","name":"${finalName}"}'`,
    ),
  )
  console.log("  ", kleur.dim("# or publish the repo and install by URL:"))
  console.log(
    "  ",
    kleur.cyan(
      `curl -XPOST 127.0.0.1:9394/hermes/mention-sources -d '{"from_git":"<repo-url>"}'`,
    ),
  )
}
