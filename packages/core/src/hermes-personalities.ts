import { backplaneFetch } from "./backplane-client"

export interface HermesPersonality {
  key: string
  builtin: boolean
  preview: string
}

export interface HermesPersonalitiesResponse {
  ok: boolean
  personalities: HermesPersonality[]
  error?: string
}

export async function getHermesPersonalities(): Promise<HermesPersonalitiesResponse> {
  try {
    const res = await backplaneFetch("/hermes/personalities", { method: "GET" })
    if (!res.ok) {
      return { ok: false, personalities: [], error: `HTTP ${res.status}` }
    }
    const body = (await res.json()) as unknown
    const personalities = Array.isArray(body) ? (body as HermesPersonality[]) : []
    return { ok: true, personalities }
  } catch (e) {
    return { ok: false, personalities: [], error: String((e as Error)?.message || e) }
  }
}
