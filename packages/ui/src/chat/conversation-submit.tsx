import { createContext, useContext, type ReactNode } from "react";
export type PrepareConversationSubmit = (sessionId: string) => Promise<string>;
const Preparation = createContext<PrepareConversationSubmit>(async (id) => id);
export function ConversationSubmitProvider({ prepare, children }: { prepare: PrepareConversationSubmit; children: ReactNode }) {
  return <Preparation.Provider value={prepare}>{children}</Preparation.Provider>;
}
export const usePrepareConversationSubmit = () => useContext(Preparation);
