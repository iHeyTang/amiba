import anthropicIcon from "@lobehub/icons-static-svg/icons/anthropic.svg";
import arceeIcon from "@lobehub/icons-static-svg/icons/arcee-color.svg";
import azureAiIcon from "@lobehub/icons-static-svg/icons/azureai-color.svg";
import bedrockIcon from "@lobehub/icons-static-svg/icons/bedrock-color.svg";
import claudeIcon from "@lobehub/icons-static-svg/icons/claude-color.svg";
import codexIcon from "@lobehub/icons-static-svg/icons/codex-color.svg";
import cohereIcon from "@lobehub/icons-static-svg/icons/cohere-color.svg";
import deepSeekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import fireworksIcon from "@lobehub/icons-static-svg/icons/fireworks-color.svg";
import geminiIcon from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import gemmaIcon from "@lobehub/icons-static-svg/icons/gemma-color.svg";
import githubCopilotIcon from "@lobehub/icons-static-svg/icons/githubcopilot.svg";
import grokIcon from "@lobehub/icons-static-svg/icons/grok.svg";
import groqIcon from "@lobehub/icons-static-svg/icons/groq.svg";
import huggingFaceIcon from "@lobehub/icons-static-svg/icons/huggingface-color.svg";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import kiloCodeIcon from "@lobehub/icons-static-svg/icons/kilocode.svg";
import lmStudioIcon from "@lobehub/icons-static-svg/icons/lmstudio.svg";
import metaIcon from "@lobehub/icons-static-svg/icons/meta-color.svg";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import mistralIcon from "@lobehub/icons-static-svg/icons/mistral-color.svg";
import moonshotIcon from "@lobehub/icons-static-svg/icons/moonshot.svg";
import nousResearchIcon from "@lobehub/icons-static-svg/icons/nousresearch.svg";
import novaIcon from "@lobehub/icons-static-svg/icons/nova-color.svg";
import novitaIcon from "@lobehub/icons-static-svg/icons/novita-color.svg";
import nvidiaIcon from "@lobehub/icons-static-svg/icons/nvidia-color.svg";
import ollamaIcon from "@lobehub/icons-static-svg/icons/ollama.svg";
import openAiIcon from "@lobehub/icons-static-svg/icons/openai.svg";
import openCodeIcon from "@lobehub/icons-static-svg/icons/opencode.svg";
import openRouterIcon from "@lobehub/icons-static-svg/icons/openrouter-color.svg";
import perplexityIcon from "@lobehub/icons-static-svg/icons/perplexity-color.svg";
import qwenIcon from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import siliconCloudIcon from "@lobehub/icons-static-svg/icons/siliconcloud-color.svg";
import stepfunIcon from "@lobehub/icons-static-svg/icons/stepfun-color.svg";
import tencentIcon from "@lobehub/icons-static-svg/icons/tencent-color.svg";
import togetherIcon from "@lobehub/icons-static-svg/icons/together-color.svg";
import xAiIcon from "@lobehub/icons-static-svg/icons/xai.svg";
import xiaomiMimoIcon from "@lobehub/icons-static-svg/icons/xiaomimimo.svg";
import zAiIcon from "@lobehub/icons-static-svg/icons/zai.svg";
import { Cpu } from "lucide-react";

import { cn } from "../primitives";

const MODEL_ICON_URLS = {
  anthropic: anthropicIcon,
  arcee: arceeIcon,
  azureai: azureAiIcon,
  bedrock: bedrockIcon,
  claude: claudeIcon,
  codex: codexIcon,
  cohere: cohereIcon,
  deepseek: deepSeekIcon,
  fireworks: fireworksIcon,
  gemini: geminiIcon,
  gemma: gemmaIcon,
  githubcopilot: githubCopilotIcon,
  grok: grokIcon,
  groq: groqIcon,
  huggingface: huggingFaceIcon,
  kimi: kimiIcon,
  kilocode: kiloCodeIcon,
  lmstudio: lmStudioIcon,
  meta: metaIcon,
  minimax: minimaxIcon,
  mistral: mistralIcon,
  moonshot: moonshotIcon,
  nousresearch: nousResearchIcon,
  nova: novaIcon,
  novita: novitaIcon,
  nvidia: nvidiaIcon,
  ollama: ollamaIcon,
  openai: openAiIcon,
  opencode: openCodeIcon,
  openrouter: openRouterIcon,
  perplexity: perplexityIcon,
  qwen: qwenIcon,
  siliconcloud: siliconCloudIcon,
  stepfun: stepfunIcon,
  tencent: tencentIcon,
  together: togetherIcon,
  xai: xAiIcon,
  xiaomimimo: xiaomiMimoIcon,
  zai: zAiIcon,
} as const;

export type ModelIconName = keyof typeof MODEL_ICON_URLS;

const COLOR_MODEL_ICONS: ReadonlySet<ModelIconName> = new Set([
  "arcee",
  "azureai",
  "bedrock",
  "claude",
  "codex",
  "cohere",
  "deepseek",
  "fireworks",
  "gemini",
  "gemma",
  "huggingface",
  "kimi",
  "meta",
  "minimax",
  "mistral",
  "nova",
  "novita",
  "nvidia",
  "openrouter",
  "perplexity",
  "qwen",
  "siliconcloud",
  "stepfun",
  "tencent",
  "together",
]);

interface ModelFamilyRule {
  icon: ModelIconName;
  pattern: RegExp;
}

/**
 * Model identity wins over transport identity. A Claude model reached through
 * Copilot or OpenRouter should still look like Claude, not like the router.
 */
const MODEL_FAMILY_RULES: ModelFamilyRule[] = [
  { icon: "claude", pattern: /(^|[/_.:-])claude(?=$|[/_.:-])/ },
  { icon: "codex", pattern: /(^|[/_.:-])codex(?=$|[/_.:-])/ },
  {
    icon: "openai",
    pattern: /(^|[/_.:-])(chatgpt|gpt|o1|o3|o4)(?=$|[/_.:-]|\d)/,
  },
  { icon: "deepseek", pattern: /(^|[/_.:-])deepseek(?=$|[/_.:-])/ },
  { icon: "gemini", pattern: /(^|[/_.:-])gemini(?=$|[/_.:-])/ },
  { icon: "gemma", pattern: /(^|[/_.:-])gemma(?=$|[/_.:-])/ },
  { icon: "xiaomimimo", pattern: /(^|[/_.:-])mimo(?=$|[/_.:-])/ },
  {
    icon: "mistral",
    pattern:
      /(^|[/_.:-])(mistral|mixtral|codestral|ministral|magistral)(?=$|[/_.:-])/,
  },
  { icon: "qwen", pattern: /(^|[/_.:-])(qwen|qwq)(?=$|[/_.:-]|\d)/ },
  { icon: "meta", pattern: /(^|[/_.:-])llama(?=$|[/_.:-]|\d)/ },
  { icon: "grok", pattern: /(^|[/_.:-])grok(?=$|[/_.:-])/ },
  { icon: "kimi", pattern: /(^|[/_.:-])kimi(?=$|[/_.:-])/ },
  { icon: "minimax", pattern: /(^|[/_.:-])minimax(?=$|[/_.:-])/ },
  { icon: "zai", pattern: /(^|[/_.:-])glm(?=$|[/_.:-]|\d)/ },
  { icon: "stepfun", pattern: /(^|[/_.:-])step(?=$|[/_.:-]|\d)/ },
  { icon: "nvidia", pattern: /(^|[/_.:-])nemotron(?=$|[/_.:-])/ },
  { icon: "nova", pattern: /(^|[/_.:-])nova(?=$|[/_.:-])/ },
  { icon: "perplexity", pattern: /(^|[/_.:-])sonar(?=$|[/_.:-])/ },
  { icon: "cohere", pattern: /(^|[/_.:-])command-[ar](?=$|[/_.:-])/ },
];

const PROVIDER_ICONS: Record<string, ModelIconName> = {
  alibaba: "qwen",
  anthropic: "anthropic",
  arcee: "arcee",
  "azure-foundry": "azureai",
  bedrock: "bedrock",
  cohere: "cohere",
  copilot: "githubcopilot",
  "copilot-acp": "githubcopilot",
  deepseek: "deepseek",
  fireworks: "fireworks",
  gemini: "gemini",
  "github-copilot": "githubcopilot",
  google: "gemini",
  groq: "groq",
  huggingface: "huggingface",
  "kimi-coding": "kimi",
  "kimi-coding-cn": "kimi",
  kimi: "kimi",
  kilocode: "kilocode",
  lmstudio: "lmstudio",
  minimax: "minimax",
  "minimax-cn": "minimax",
  "minimax-oauth": "minimax",
  mistral: "mistral",
  moonshot: "moonshot",
  nous: "nousresearch",
  novita: "novita",
  nvidia: "nvidia",
  "ollama-cloud": "ollama",
  ollama: "ollama",
  openai: "openai",
  "openai-api": "openai",
  "openai-codex": "openai",
  opencode: "opencode",
  "opencode-go": "opencode",
  "opencode-zen": "opencode",
  openrouter: "openrouter",
  perplexity: "perplexity",
  "qwen-oauth": "qwen",
  siliconcloud: "siliconcloud",
  stepfun: "stepfun",
  "tencent-tokenhub": "tencent",
  togetherai: "together",
  xai: "xai",
  "xai-oauth": "xai",
  xiaomi: "xiaomimimo",
  zai: "zai",
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function resolveModelIconName(
  provider: string,
  model: string,
): ModelIconName | null {
  const normalizedModel = normalize(model);
  const modelRule = MODEL_FAMILY_RULES.find(({ pattern }) =>
    pattern.test(normalizedModel),
  );
  if (modelRule) return modelRule.icon;

  return PROVIDER_ICONS[normalize(provider)] ?? null;
}

export interface ModelIconProps {
  className?: string;
  model: string;
  provider: string;
}

/**
 * A theme-safe AI model mark. Brand-color SVGs render directly; models that
 * only ship a monochrome mark use a CSS mask and inherit the surrounding text
 * color in both light and dark themes.
 */
export function ModelIcon({
  className,
  model,
  provider,
}: ModelIconProps) {
  const name = resolveModelIconName(provider, model);

  if (!name) {
    return (
      <Cpu
        aria-hidden
        className={cn("h-4 w-4 shrink-0", className)}
        data-model-icon="generic"
      />
    );
  }

  const url = MODEL_ICON_URLS[name];
  if (COLOR_MODEL_ICONS.has(name)) {
    return (
      <img
        alt=""
        aria-hidden
        className={cn("inline-block h-4 w-4 shrink-0 object-contain", className)}
        data-model-icon={name}
        src={url}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn("inline-block h-4 w-4 shrink-0", className)}
      data-model-icon={name}
      style={{
        backgroundColor: "currentColor",
        maskImage: `url(${url})`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url(${url})`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}
