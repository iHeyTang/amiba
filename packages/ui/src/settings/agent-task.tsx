import { createContext, useContext, type ReactNode } from "react"

import type { StartAgentTask } from "./capabilities"
import type { ManagedExtensionsBridge } from "@amiba/managed-extensions/bridge"

/**
 * Carries the host's {@link StartAgentTask} impl down to the settings panes
 * that delegate operator work to the agent (plugin install/uninstall), without
 * prop-drilling it through every intermediate component. Mirrors the
 * `SettingsPaneProvider` / `useT` context pattern already used in this folder.
 *
 * When the host doesn't provide one (no chat surface), the value is `undefined`
 * and consumers hide the affordance.
 */
const AgentTaskContext = createContext<StartAgentTask | undefined>(undefined)
const ManagedExtensionsContext = createContext<ManagedExtensionsBridge | undefined>(undefined)

export function AgentTaskProvider({
  value,
  managedExtensions,
  children,
}: {
  value?: StartAgentTask
  managedExtensions?: ManagedExtensionsBridge
  children: ReactNode
}) {
  return (
    <AgentTaskContext.Provider value={value}>
      <ManagedExtensionsContext.Provider value={managedExtensions}>{children}</ManagedExtensionsContext.Provider>
    </AgentTaskContext.Provider>
  )
}

/**
 * The host's "hand this task to the agent" function, or `undefined` if the host
 * has no chat surface. Consumers should render their delegate-to-agent button
 * only when this is defined.
 */
export function useStartAgentTask(): StartAgentTask | undefined {
  return useContext(AgentTaskContext)
}

export function useManagedExtensions(): ManagedExtensionsBridge | undefined {
  return useContext(ManagedExtensionsContext)
}
