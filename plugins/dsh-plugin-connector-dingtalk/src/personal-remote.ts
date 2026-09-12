import { z } from "zod";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import type { PersonalAuthorization, PersonalStatus } from "./personal.js";
export const personalRequestSchema = z
  .object({
    connectionId: z.string().min(1).max(512),
    action: z.enum([
      "status",
      "begin",
      "poll",
      "cancel",
      "disconnect",
      "model-access",
      "complete-connection",
    ]),
    flowId: z.string().max(512).optional(),
    allowed: z.boolean().optional(),
  })
  .strict();
export type PersonalRequest = z.infer<typeof personalRequestSchema>;
export interface PersonalResult {
  status?: PersonalStatus;
  authorization?: PersonalAuthorization;
  cancelled?: boolean;
}
export interface DingtalkPersonalRemote {
  manage(input: PersonalRequest): Promise<RemoteResult<PersonalResult>>;
}
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaDingtalkPersonal: DingtalkPersonalRemote;
  }
  interface TypertRemoteMap {
    "amibaDingtalkPersonal/manage": DingtalkPersonalRemote["manage"];
  }
}
const status = z.object({
  work: z.enum(["ready", "pending", "unavailable"]).optional(),
  modelAccess: z.boolean(),
  access: z.object({
    identity: z.enum(["application", "user"]),
    label: z.string().optional(),
    state: z.enum(["unauthorized", "authorized", "expired"]),
    capabilities: z.array(z.object({ id: z.string(), available: z.boolean() })),
  }),
});
const authorization = z.object({
  id: z.string(),
  connectionId: z.string(),
  verificationUrl: z.string().url(),
  userCode: z.string(),
  expiresAt: z.number(),
  state: z.enum(["pending", "completed", "cancelled", "expired"]),
});
export const AMIBA_DINGTALK_PERSONAL_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-connector-dingtalk",
  descriptors: [
    {
      id: "@amiba/dsh-plugin-connector-dingtalk#amibaDingtalkPersonal/manage",
      service: "amibaDingtalkPersonalRemote",
      namespace: "amibaDingtalkPersonal",
      method: "manage",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/dingtalk#personal-input",
            schema: personalRequestSchema,
          },
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/dingtalk#personal-result",
        schema: z.object({
          status: status.optional(),
          authorization: authorization.optional(),
          cancelled: z.boolean().optional(),
        }),
      },
    },
  ],
};
