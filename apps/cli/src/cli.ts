#!/usr/bin/env node
import { Command } from "commander"
import { createCommand } from "./commands/create.js"
import { devCommand } from "./commands/dev.js"
import { buildCommand } from "./commands/build.js"
import { packCommand } from "./commands/pack.js"
import { installCommand } from "./commands/install.js"

const program = new Command()

program
  .name("amiba")
  .description("Developer tooling for Amiba Applets")
  .version("0.1.0")

program
  .command("create")
  .description("Scaffold a new Applet")
  .argument("[name]", "Applet folder name")
  .option("--id <id>", "reverse-DNS Applet id (e.g. com.example.my-app)")
  .option("--no-install", "skip pnpm install after scaffold")
  .action(createCommand)

program
  .command("dev")
  .description("Build the Applet in watch mode for local development")
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
  .description("Install an Applet from a GitHub repository")
  .argument("<repo>", "GitHub repo as owner/repo[@tag]; tag defaults to latest")
  .option("--sha256 <hex>", "verify downloaded tarball against this hex digest")
  .action(installCommand)

program.parseAsync(process.argv).catch((err) => {
  console.error(err)
  process.exit(1)
})
