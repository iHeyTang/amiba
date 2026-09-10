import type { Context } from "@deepseek-ai/cordis";
import type { SkillProvider } from "@deepseek-ai/dsh-skill";
import { withMarkdownCapability } from "@amiba/dsh-plugin-ui-shell";

export const name = "example-progress";
export const inject = ["skills", "markdownCapabilities"];

// Ordinary native Skills provider. A filesystem provider may load SKILL.md
// instead; discovery only exposes descriptions, get loads the actual body.
const provider: SkillProvider = {
  name: "example-progress",
  async list() {
    return [
      {
        name: "progress-display",
        description:
          "Display a known progress measurement as a visual progress bar.",
        whenToUse:
          "The user requests a progress visualization and a real measurement is available.",
        source: "bundled",
        provider: "example-progress",
        rank: 600,
        invocation: { modelInvocable: true, userInvocable: true },
        locator: "progress-display",
      },
    ];
  },
  async get(candidate) {
    return {
      ...candidate,
      content: `Emit an amiba-progress fenced block containing JSON
{"label":"short title","value":0..100}. Do not invent measurements.
Use ordinary prose when a progress visualization does not help.`,
    };
  },
};
export function apply(ctx: Context) {
  return ctx.skills.registerProvider((control) =>
    withMarkdownCapability(
      ctx,
      {
        "progress-display": {
          id: "example.progress",
          version: "1",
          languages: ["amiba-progress"],
        },
      },
      provider,
      control,
    ),
  );
}
