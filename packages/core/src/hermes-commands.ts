import { backplaneFetch } from "./backplane-client"

export interface HermesCommand {
  name: string
  description: string
  category: string
  aliases: string[]
  args_hint: string
  subcommands: string[]
}

export interface HermesCommandsResponse {
  ok: boolean
  commands: HermesCommand[]
  error?: string
}

export async function getHermesCommands(): Promise<HermesCommandsResponse> {
  try {
    const res = await backplaneFetch("/hermes/commands", { method: "GET" })
    if (!res.ok) {
      return { ok: false, commands: [], error: `HTTP ${res.status}` }
    }
    const body = (await res.json()) as unknown
    const commands = Array.isArray(body) ? (body as HermesCommand[]) : []
    return { ok: true, commands }
  } catch (e) {
    return { ok: false, commands: [], error: String((e as Error)?.message || e) }
  }
}
