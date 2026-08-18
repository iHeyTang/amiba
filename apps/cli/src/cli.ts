#!/usr/bin/env node
import { Command } from "commander"
import { createCommand } from "./commands/create.js"
import { devCommand } from "./commands/dev.js"
import { buildCommand } from "./commands/build.js"
import { packCommand } from "./commands/pack.js"
import { inspectAmibaDsh, runDsh } from "./lib/dsh-runtime.js"

const program = new Command()

program
  .name("amiba")
  .description("Amiba: a product distribution built on DeepSeek Harness")
  .version("0.1.0")
  .option("--dsh-home <path>", "use an explicit DSH home")
  .option("--runtime-dir <path>", "use an explicit Amiba managed DSH runtime")

program
  .command("run")
  .description("Run one task through the Electron-independent Amiba profile")
  .argument("<task...>", "task to run")
  .action(async (task: string[]) => {
    const result = await runDsh({
      surface: "headless",
      args: [task.join(" ")],
      home: program.opts().dshHome as string | undefined,
      runtimeDir: program.opts().runtimeDir as string | undefined,
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })

program
  .command("web")
  .description("Start the Amiba Web client without Electron")
  .option("--host <host>", "bind host", "127.0.0.1")
  .option("--port <port>", "bind port", "3080")
  .action(async (options) => {
    const result = await runDsh({
      surface: "web",
      args: ["--host", options.host, "--port", options.port],
      home: program.opts().dshHome as string | undefined,
      runtimeDir: program.opts().runtimeDir as string | undefined,
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })

program
  .command("doctor")
  .description("Inspect the local Amiba DSH distribution")
  .action(async () => {
    const report = await inspectAmibaDsh({
      home: program.opts().dshHome as string | undefined,
      runtimeDir: program.opts().runtimeDir as string | undefined,
    })
    console.log(JSON.stringify(report, null, 2))
  })

const plugin = program
  .command("plugin")
  .description("Create, develop, build, and package DSH plugins")

plugin
  .command("create")
  .description("Scaffold an independent dsh-plugin-* project")
  .argument("[name]", "Plugin name or dsh-plugin-* folder name")
  .option("--id <id>", "Cordis plugin id (e.g. issue-tracker)")
  .option("--no-install", "skip pnpm install after scaffold")
  .action(createCommand)

plugin
  .command("dev")
  .description("Build the DSH plugin in watch mode")
  .action(devCommand)

plugin.command("build").description("Production build").action(buildCommand)

plugin
  .command("pack")
  .description("Produce dsh-plugin.tgz for distribution")
  .option("-o, --output <path>", "output tarball path", "dsh-plugin.tgz")
  .action(packCommand)

program.parseAsync(process.argv).catch((err) => {
  console.error(err)
  process.exit(1)
})
