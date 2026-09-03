import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { STEWARD_PRESET_ID } from "./types.js";

export { STEWARD_PRESET_ID } from "./types.js";

export interface PresetSeed {
  id: string;
  files: Record<string, string>;
}

// The picker has no "internal preset" filter yet, so the NAME and DESCRIPTION
// carry the warning: a chat manually started on this preset is hidden from the
// history list (ui-shell hides the preset) and has no steward_* tools, since
// those are registered by the plugin's setup(), not by the composition.
const PRESET_YML = `name: 大管家（内部）
description: 大管家插件内部使用的会话预设，请勿在普通对话中手动选择；手动选中的会话会从历史列表隐藏且没有派单工具。Seeded by Amiba steward; edits are preserved.
order: 20
`;

/**
 * The steward persona is the COMPLETE system prompt (`complete: true`,
 * `includeRuntimeContext: false`) so no host section can hand it work tools'
 * guidance. The only model-facing rows besides persona are ask-user and the
 * compaction group; the steward_* tools are registered into the agent scope by
 * the plugin's setup(), not by this composition.
 *
 * The compaction group is copied verbatim from the stock `standard` preset:
 * the steward conversation is always live and never rotates, so without it the
 * context grows until every dispatch fails.
 */
const AGENT_CORDIS_YML = `# The \`amiba-steward\` agent preset: seeded create-only by @amiba/dsh-plugin-steward.
# If this directory already exists the seeder never overwrites it.

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    complete: true
    includeRuntimeContext: false
    text: |-
      你是用户的「大管家」——用户唯一需要打交道的入口。用户不必再操心「这件事该在哪个会话里继续」「之前那件事做到哪了」「该新开一个还是接着聊」，这些全由你记住并打理。

      你对用户的价值（每一句回复都要体现，而不是解释内部机制）：
      - 用户可以把好几件事穿插着告诉你，甚至一句话里说两件；你把每一件派到它自己的任务会话，做完把结果讲给用户听。
      - 用户问进展，你直接报状态，不让用户自己去翻会话。
      - 用户想看过程细节，你告诉用户去看哪个任务的会话（用任务名称，不要只给 id）。

      工作方式：
      1. 收到任何消息，先调用 steward_list_tasks，知道现在有哪些事、各自什么状态；回复里要用上这些信息。
      2. 判断这句话属于哪件事：
         - 明显是某个已有任务的后续 → steward_dispatch 到该任务（taskId）。
         - 明显是一件新事 → steward_dispatch 新建任务（newTask.title 用一句话概括，cwd 优先沿用同类任务的目录）。
         - 一句话里有好几件事 → 分别派单，各自一条确认。
         - 拿不准 → 用 ask_user_question 问一次，选项列出候选任务和「新建」。新建任务且推断不出 cwd 时也问一次。
      3. 派单后只回一句简短确认，例如「已交给『周报』处理，做完我叫你」。不要复述任务内容，不要猜测结果。
      4. 收到以「【任务汇报】」开头的消息时，它来自某个任务会话刚完成的一轮：用一两句话向用户转述结果。如果汇报里对方在提问或需要用户提供信息，明确指出并等待用户回复；用户回复后用 steward_dispatch 把答复派回同一任务。
      5. 打招呼、问你是谁、问你和普通对话有什么区别：不要说「我没有工具」「我不干活」这类内部实现。用用户视角回答——一句话说清能帮用户省掉什么麻烦，然后立刻给出当前状态（在管的事有几件、各自到哪了；一件都没有就直说「现在还没有在管的事」），再给一两个可以马上开口的例子（例如「帮我把 xxx 项目的 README 翻成英文」「上次那个周报再改一下标题」「同时：修一下登录报错，另外查查这周的用量」）。
      6. 用户问进度、问历史、闲聊：直接回答，不派单。需要细节时用 steward_read_task 读取。
      7. 用户说某件事做完了、不用管了：steward_close_task。
      8. 用户提到把某个已有会话交给你管：steward_adopt（先按标题搜索，多于一个命中时反问）。

      语气：简洁、可靠、记性很好的管家。回复用用户使用的语言。

# \`compaction-basic\` reads \`toolResultPrune\` through \`ctx.get\`, so the pruner must
# share this realm rather than sit outside it.
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'

    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024

- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'
`;

export const STEWARD_PRESET: PresetSeed = {
  id: STEWARD_PRESET_ID,
  files: {
    "preset.yml": PRESET_YML,
    "agent.cordis.yml": AGENT_CORDIS_YML,
  },
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Create-only: a preset directory that already exists is never touched. */
export async function seedAgentPresets(
  root: string,
  seeds: PresetSeed[],
  log: { info?(msg: string): void; warn(msg: string): void },
): Promise<void> {
  for (const seed of seeds) {
    try {
      const dir = join(root, seed.id);
      if (await pathExists(dir)) continue;
      await mkdir(dir, { recursive: true });
      for (const [filename, content] of Object.entries(seed.files)) {
        await writeFile(join(dir, filename), content, "utf8");
      }
      log.info?.(`seeded agent preset "${seed.id}" into ${root}`);
    } catch (error) {
      log.warn(`failed to seed agent preset "${seed.id}" into ${root}: ${String(error)}`);
    }
  }
}
