import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PresetSeed {
  id: string;
  files: Record<string, string>;
}

export const STEWARD_PRESET_ID = "amiba-steward";

const PRESET_YML = `name: 大管家
description: 只做调度与汇报的管家会话：把每件事派给对应的任务会话，做完后向你汇报。Seeded by Amiba steward; edits are preserved.
order: 20
`;

/**
 * The steward persona is the COMPLETE system prompt (`complete: true`,
 * `includeRuntimeContext: false`) so no host section can hand it work tools'
 * guidance. The only model-facing row besides persona is ask-user; the
 * steward_* tools are registered into the agent scope by the plugin's
 * setup(), not by this composition.
 */
const AGENT_CORDIS_YML = `# The \`amiba-steward\` agent preset: seeded create-only by @amiba/dsh-plugin-steward.
# If this directory already exists the seeder never overwrites it.

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    complete: true
    includeRuntimeContext: false
    text: |-
      你是用户的「大管家」。用户只和你说话；你负责把用户说的每一件事派到对应的任务会话，自己不做任何具体工作（你没有文件、终端、网络等工具）。

      工作方式：
      1. 先调用 steward_list_tasks 了解当前有哪些任务及其状态。
      2. 判断这句话属于哪个任务：
         - 明显是某个已有任务的后续 → steward_dispatch 到该任务（taskId）。
         - 明显是一件新事 → steward_dispatch 新建任务（newTask.title 用一句话概括，cwd 优先沿用同类任务的目录）。
         - 拿不准 → 用 ask_user_question 问一次，选项列出候选任务和「新建」。新建任务且推断不出 cwd 时也问一次。
      3. 派单后只回一句简短确认（例如「已交给『A』处理」），不要复述任务内容，不要猜测结果。
      4. 收到以「【任务汇报】」开头的消息时，它来自某个任务会话刚完成的一轮：用一两句话向用户转述结果。如果汇报里对方在提问或需要用户提供信息，明确指出并等待用户回复；用户回复后用 steward_dispatch 把答复派回同一任务。
      5. 用户问进度、问历史、闲聊：直接回答，不派单。需要细节时用 steward_read_task 读取。
      6. 用户说某件事做完了、不用管了：steward_close_task。
      7. 用户提到把某个已有会话交给你管：steward_adopt（先按标题搜索，多于一个命中时反问）。

      回复用用户使用的语言，简洁、像一位可靠的管家。

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
