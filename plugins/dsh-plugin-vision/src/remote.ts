import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaVisionUi: {
      catalog(): Promise<RemoteResult<string>>;
      setDefault(
        selectionJson: string,
        revision: number,
      ): Promise<RemoteResult<boolean>>;
    };
  }
  interface TypertRemoteMap {
    "amibaVisionUi/catalog": TypertRemoteNamespaceMap["amibaVisionUi"]["catalog"];
    "amibaVisionUi/setDefault": TypertRemoteNamespaceMap["amibaVisionUi"]["setDefault"];
  }
}

export const VISION_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-vision",
  descriptors: [
    {
      id: "@amiba/dsh-plugin-vision#amibaVisionUi/catalog",
      service: "amibaVisionUi",
      namespace: "amibaVisionUi",
      method: "catalog",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/vision#catalog",
        schema: z.string(),
      },
    },
    {
      id: "@amiba/dsh-plugin-vision#amibaVisionUi/setDefault",
      service: "amibaVisionUi",
      namespace: "amibaVisionUi",
      method: "setDefault",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "selectionJson",
          wire: "selectionJson",
          source: "json",
          codec: { mode: "strict", typeSymbol: "@amiba/vision#selectionJson", schema: z.string() },
        },
        {
          name: "revision",
          wire: "revision",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/vision#revision",
            schema: z.number().int().min(0),
          },
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/vision#setDefault",
        schema: z.boolean(),
      },
    },
  ],
};
