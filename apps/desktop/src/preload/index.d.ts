import type { HermesBridge } from "./index"

declare global {
  interface Window {
    hermes: HermesBridge
  }
}

export {}
