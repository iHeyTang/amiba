#!/usr/bin/env node
import { Command } from "commander"
import { createCommand } from "./commands/create.js"
import { devCommand } from "./commands/dev.js"
import { buildCommand } from "./commands/build.js"
import { packCommand } from "./commands/pack.js"

const program = new Command()

program
  .name("hermes-x-ext")
  .description("CLI for hermes-x desktop extensions")
  .version("0.1.0")

program
  .command("create")
  .description("Scaffold a new extension")
  .argument("[name]", "extension folder name")
  .option("--id <id>", "reverse-DNS extension id (e.g. com.example.my-ext)")
  .option("--no-install", "skip pnpm install after scaffold")
  .action(createCommand)

program
  .command("dev")
  .description(
    "Build the extension in watch mode and sideload it into the desktop app",
  )
  .option(
    "--no-symlink",
    "copy files instead of symlinking (for testing copy-based installs)",
  )
  .action(devCommand)

program.command("build").description("Production build").action(buildCommand)

program
  .command("pack")
  .description("Produce extension.tgz for distribution")
  .option("-o, --output <path>", "output tarball path", "extension.tgz")
  .action(packCommand)

program.parseAsync(process.argv).catch((err) => {
  console.error(err)
  process.exit(1)
})
