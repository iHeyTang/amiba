import { spawn, type ChildProcess } from "node:child_process"

export interface SpawnHandle {
  proc: ChildProcess
  exit: Promise<number>
  kill: () => void
}

export function spawnAsync(cmd: string, args: string[], opts: { cwd: string }): SpawnHandle {
  const proc = spawn(cmd, args, { cwd: opts.cwd, stdio: "inherit" })
  const exit = new Promise<number>((resolve, reject) => {
    proc.on("exit", (code) => {
      if (code === 0 || code === null) resolve(code ?? 0)
      else reject(new Error(`${cmd} exited with ${code}`))
    })
    proc.on("error", reject)
  })
  return {
    proc,
    exit,
    kill: () => {
      try {
        proc.kill("SIGTERM")
      } catch {
        // ignore errors during cleanup
      }
    },
  }
}
