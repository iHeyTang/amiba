import {
  activateConnectionWork,
  inspectConnectionWork,
  connectionWorkAccess,
} from "@amiba/dsh-plugin-connector-core";
import type { Context } from "@deepseek-ai/cordis";
// Import needed only so `@deepseek-ai/cordis`'s `Context.amibaConnectors`
// augmentation (declared inside dsh-plugin-connector-core) is loaded — this
// plugin otherwise only calls `ctx.amibaConnectors.registerProvider(...)`.
import type {} from "@amiba/dsh-plugin-connector-core";

import { createLarkProvider } from "./provider.js";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  LarkPersonalService,
  personalAccess,
  personalState,
} from "./personal.js";
import { createLarkResourceSource } from "./resources.js";
import {
  personalRequestSchema,
  type PersonalRequest,
  type PersonalResult,
} from "./personal-remote.js";
import type {} from "@amiba/dsh-plugin-resources";

export * from "./provider.js";
export * from "./translate.js";

export const name = "amiba-connector-lark";
export const inject = ["amibaConnectors"];

export class LarkPersonalRemoteService extends TypertRemoteService {
  constructor(
    private setupContext: Context,
    private personal: LarkPersonalService,
  ) {
    super(setupContext, "amibaLarkPersonalRemote", {
      namespace: "amibaLarkPersonal",
    });
  }
  @Remote async manage(input: PersonalRequest): Promise<PersonalResult> {
    input = personalRequestSchema.parse(input);
    const id = input.connectionId;
    switch (input.action) {
      case "status":
        return {
          status: {
            ...(await this.personal.status(id)),
            work: await inspectConnectionWork(
              connectionWorkAccess(this.setupContext),
              id,
            ),
          },
        };
      case "begin":
        return { authorization: await this.personal.begin(id) };
      case "poll":
        if (!input.flowId) throw new Error("authorization_not_found");
        return { authorization: await this.personal.poll(id, input.flowId) };
      case "cancel":
        if (!input.flowId) throw new Error("authorization_not_found");
        return this.personal.cancel(id, input.flowId);
      case "disconnect":
        return { status: await this.personal.disconnect(id) };
      case "complete-connection": {
        // Validate this provider's enabled account and personal grant before
        // activating application tools. No grant is inferred from viewing UI.
        const current = await this.personal.status(id);
        if (current.access.state !== "authorized")
          throw new Error("personal_authorization_required");
        await this.personal.accounts.run(id, async (account) => {
          const generation = personalState(account.state).user?.generation;
          if (!generation) throw new Error("personal_authorization_required");
          await activateConnectionWork(
            connectionWorkAccess(this.setupContext),
            id,
            account.signal,
          );
          account.signal.throwIfAborted();
          await account.updateState((value) => {
            const state = personalState(value);
            if (state.user?.generation !== generation)
              throw new Error("authorization_changed");
            return { ...state, modelAccess: true };
          });
        });
        this.personal.accounts.invalidate(id);
        const status = await this.personal.status(id);
        return {
          status: {
            ...status,
            work: await inspectConnectionWork(
              connectionWorkAccess(this.setupContext),
              id,
            ),
          },
        };
      }
      case "model-access":
        if (input.allowed === undefined)
          throw new Error("permission_choice_required");
        return {
          status: {
            ...(await this.personal.setModelAccess(id, input.allowed)),
            work: await inspectConnectionWork(
              connectionWorkAccess(this.setupContext),
              id,
            ),
          },
        };
    }
  }
}

/**
 * Registers the Lark/Feishu `ConnectorProvider` with the connector center.
 * No config of its own — every setting lives per-connect, validated by the
 * provider itself via `larkConfigSchema`.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () =>
      ctx.amibaConnectors.registerProvider({
        ...createLarkProvider(),
        access: personalAccess,
      }),
    "amiba-connector-lark.provider",
  );
  const personal = new LarkPersonalService(
    ctx.amibaConnectors.accounts("lark"),
  );
  ctx.effect(() => () => personal.dispose());
  new LarkPersonalRemoteService(ctx, personal);
  ctx.inject(["amibaResources"], (resources) => {
    resources.effect(() =>
      resources.amibaResources.register(createLarkResourceSource(personal)),
    );
  });
}
