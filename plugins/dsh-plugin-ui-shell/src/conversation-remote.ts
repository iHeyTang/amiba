import type { RemoteResult, TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaConversationEntry: { prepareSubmit(sessionId: string): Promise<RemoteResult<string>> };
  }
  interface TypertRemoteMap {
    "amibaConversationEntry/prepareSubmit": (sessionId: string) => Promise<RemoteResult<string>>;
  }
}
export const CONVERSATION_ENTRY_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-ui-shell",
  descriptors: [{
    id: "@amiba/dsh-plugin-ui-shell#amibaConversationEntry/prepareSubmit",
    service: "amibaConversationEntry", namespace: "amibaConversationEntry", method: "prepareSubmit",
    invocation: { kind: "direct" },
    parameters: [{ name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "typescript#string", schema: z.string() } }],
    result: { mode: "strict", typeSymbol: "typescript#string", schema: z.string() },
  }],
};
