/**
 * Mirror of the LifecycleProbe contract in src/main/index.ts. Lives in
 * a renderer-only file because main and the UI bundles ship as separate
 * trees and can't share types via direct import.
 */

export type LifecycleStage =
  | "not-installed"
  | "stopped"
  | "no-provider"
  | "ready"

export interface BrainHealthInfo {
  status: string
  version?: string
  db?: string
  transport?: string
  engine?: string
}

export interface LifecycleProbe {
  stage: LifecycleStage
  binary: string | null
  health: BrainHealthInfo | null
  providerCount: number
  readyProviderCount: number
}
