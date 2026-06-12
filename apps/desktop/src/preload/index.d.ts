import type { AmibaBridge } from "./index"

declare global {
  interface Window {
    amiba: AmibaBridge
  }
}

export {}
