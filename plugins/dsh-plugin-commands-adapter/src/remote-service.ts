import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CommandRuntime } from "@deepseek-ai/dsh-commands";
import type { Context } from "@deepseek-ai/cordis";
import {
  Remote,
  TypertRemoteService,
} from "@deepseek-ai/dsh-typert-protocol";

function liveAgent(ctx: Context, sessionId: string): Agent {
  const normalized = sessionId.trim();
  const agent = normalized ? ctx.agents.get(normalized as never) : undefined;
  if (!agent) throw new Error(`DSH session is not live: ${sessionId}`);
  return agent;
}

class AmibaCommandsRemoteService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, "amibaCommands");
  }

  @Remote
  async list(sessionId: string) {
    const commands = await Promise.resolve(
      (this.ctx as Context & { commands: CommandRuntime }).commands.list(
        liveAgent(this.ctx, sessionId),
      ),
    );
    return commands.map((command) => ({
      name: command.name,
      description: command.description,
      ...(command.input?.hint ? { inputHint: command.input.hint } : {}),
    }));
  }
}

/** Install the DSH Remote used by every Client surface's slash composer. */
export function applyCommandsRemote(ctx: Context): void {
  new AmibaCommandsRemoteService(ctx);
}
