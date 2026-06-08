#!/usr/bin/env node
import { Command } from "commander"
import { devCommand } from "./commands/dev.js"
import { buildCommand } from "./commands/build.js"
import { packCommand } from "./commands/pack.js"
import { installCommand } from "./commands/install.js"

const program = new Command()

program
  .name("hermes-x-ext")
  .description("CLI for hermes-x desktop extensions")
  .version("0.1.0")

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

program
  .command("install")
  .description("Install a plugin from a GitHub repo into <userData>/extensions/")
  .argument("<repo>", "GitHub repo as owner/repo[@tag]; tag defaults to latest")
  .option("--sha256 <hex>", "verify downloaded tarball against this hex digest")
  .action(installCommand)

program.parseAsync(process.argv).catch((err) => {
  console.error(err)
  process.exit(1)
})
