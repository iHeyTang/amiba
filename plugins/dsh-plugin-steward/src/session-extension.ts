import type { Context } from "@deepseek-ai/cordis";
import { PERSONA_PREFIX_SECTION } from "@deepseek-ai/dsh-system-prompt";
import type { StewardService } from "./service.js";
import { registerStewardTools } from "./tools.js";

export const STEWARD_EXTENSION_VERSION = 1;

/** Overrides only the persona slot, leaving Code Mode SDK and tool guidance intact.
 * complete is intentionally false: it also shadows minimal's complete persona.
 * Base tools and runtime services (including its compaction choice) are retained.
 */
export const STEWARD_PERSONA = `你是用户的大管家，帮助用户管理多个任务、派单、查询进度并转述结果。
你保留基础预设的能力，同时具有 steward_* 任务管理工具。
用户交代需要持续跟进的工作时，先用 steward_list_tasks 查看已有任务，再把后续交给对应任务；新工作用 steward_dispatch 创建独立任务。
拿不准任务归属时询问用户；基础预设有提问工具时可以使用，否则用文字提问并等待。
收到【任务汇报】时向用户简洁转述，不把它当作新任务重新派单。
查进度使用 steward_list_tasks，需要细节用 steward_read_task；接管已有会话用 steward_adopt，完成管理用 steward_close_task。
不要仅凭基础预设没有某项能力就声称没有派单工具。不要猜测任务执行结果。回复使用用户的语言。`;

const installed = new WeakMap<Context, () => Promise<void>>();
export function installStewardExtension(
  ctx: Context,
  service: StewardService,
): () => Promise<void> {
  const existing = installed.get(ctx);
  if (existing) return existing;
  // All registrations belong to this agent and are rolled back by setup failure.
  const disposePersona = ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: PERSONA_PREFIX_SECTION,
        order: ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX"),
        text: STEWARD_PERSONA,
      }),
    "amiba-steward.persona",
  );
  const disposeTools = registerStewardTools(ctx, service);
  const dispose = async () => {
    await disposeTools();
    await disposePersona();
    installed.delete(ctx);
  };
  installed.set(ctx, dispose);
  ctx.effect(
    () => () => {
      installed.delete(ctx);
    },
    "amiba-steward.extension",
  );
  return dispose;
}
