import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import type { MarkdownCapabilities } from "@amiba/markdown";
import { z } from "zod";
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaMarkdown: {
      report(
        sessionId: string,
        capabilities: MarkdownCapabilities[],
      ): Promise<RemoteResult<void>>;
    };
  }
  interface TypertRemoteMap {
    "amibaMarkdown/report": (
      sessionId: string,
      capabilities: MarkdownCapabilities[],
    ) => Promise<RemoteResult<void>>;
  }
}
export const MARKDOWN_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-ui-shell",
  descriptors: [
    {
      id: "@amiba/dsh-plugin-ui-shell#amibaMarkdown/report",
      service: "amibaMarkdown",
      namespace: "amibaMarkdown",
      method: "report",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "sessionId",
          wire: "sessionId",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/markdown#session",
            schema: z.string(),
          },
        },
        {
          name: "capabilities",
          wire: "capabilities",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/markdown#capabilities",
            schema: z.array(
              z.object({
                id: z.string(),
                version: z.string(),
                languages: z.array(z.string()),
              }),
            ),
          },
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/markdown#void",
        schema: z.void(),
      },
    },
  ],
};
