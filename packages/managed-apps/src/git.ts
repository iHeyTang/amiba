import { execFile } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import { dirname } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  })
  return stdout.trim()
}

export async function initializeRepository(projectPath: string): Promise<string> {
  await mkdir(projectPath, { recursive: true })
  await git(projectPath, ["init", "-b", "main"])
  await git(projectPath, ["config", "user.name", "Amiba Managed Apps"])
  await git(projectPath, ["config", "user.email", "managed-apps@amiba.local"])
  await git(projectPath, ["add", "-A"])
  await git(projectPath, ["commit", "--allow-empty", "-m", "Create managed Applet"])
  return git(projectPath, ["rev-parse", "HEAD"])
}

export async function createDraftWorktree(opts: {
  projectPath: string
  workspacePath: string
  draftId: string
  baseCommit: string
}): Promise<{ branch: string }> {
  const branch = `amiba/drafts/${opts.draftId}`
  await mkdir(dirname(opts.workspacePath), { recursive: true })
  await rm(opts.workspacePath, { recursive: true, force: true })
  await git(opts.projectPath, [
    "worktree",
    "add",
    "-b",
    branch,
    opts.workspacePath,
    opts.baseCommit,
  ])
  return { branch }
}

export async function commitDraft(opts: {
  workspacePath: string
  revisionId: string
  summary: string
}): Promise<string> {
  await git(opts.workspacePath, ["add", "-A"])
  await git(opts.workspacePath, [
    "commit",
    "--allow-empty",
    "-m",
    opts.summary || "Improve managed Applet",
  ])
  const commit = await git(opts.workspacePath, ["rev-parse", "HEAD"])
  await git(opts.workspacePath, [
    "update-ref",
    `refs/amiba/revisions/${opts.revisionId}`,
    commit,
  ])
  return commit
}

export async function currentCommit(projectPath: string): Promise<string> {
  return git(projectPath, ["rev-parse", "HEAD"])
}

export async function removeDraftWorktree(opts: {
  projectPath: string
  workspacePath: string
  branch: string
}): Promise<void> {
  try {
    await git(opts.projectPath, ["worktree", "remove", "--force", opts.workspacePath])
  } catch {
    await rm(opts.workspacePath, { recursive: true, force: true })
    try {
      await git(opts.projectPath, ["worktree", "prune"])
    } catch {
      // Best effort cleanup; the source commit remains referenced by Revision.
    }
  }
  try {
    await git(opts.projectPath, ["branch", "-D", opts.branch])
  } catch {
    // The branch can already be gone after an interrupted cleanup.
  }
}

export async function checkoutStableCommit(projectPath: string, commit: string): Promise<void> {
  await git(projectPath, ["reset", "--hard", commit])
}
