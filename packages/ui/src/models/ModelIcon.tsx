/// <reference path="../assets.d.ts" />
import ai21Icon from "@lobehub/icons-static-svg/icons/ai21.svg";
import aionlabsIcon from "@lobehub/icons-static-svg/icons/aionlabs.svg";
import antgroupIcon from "@lobehub/icons-static-svg/icons/antgroup.svg";
import bytedanceIcon from "@lobehub/icons-static-svg/icons/bytedance.svg";
import cerebrasIcon from "@lobehub/icons-static-svg/icons/cerebras.svg";
import cloudflareIcon from "@lobehub/icons-static-svg/icons/cloudflare.svg";
import hunyuanIcon from "@lobehub/icons-static-svg/icons/hunyuan.svg";
import ibmIcon from "@lobehub/icons-static-svg/icons/ibm.svg";
import inceptionIcon from "@lobehub/icons-static-svg/icons/inception.svg";
import kwaikatIcon from "@lobehub/icons-static-svg/icons/kwaikat.svg";
import longcatIcon from "@lobehub/icons-static-svg/icons/longcat.svg";
import microsoftIcon from "@lobehub/icons-static-svg/icons/microsoft.svg";
import poolsideIcon from "@lobehub/icons-static-svg/icons/poolside.svg";
import relaceIcon from "@lobehub/icons-static-svg/icons/relace.svg";
import sparkIcon from "@lobehub/icons-static-svg/icons/spark.svg";
import upstageIcon from "@lobehub/icons-static-svg/icons/upstage.svg";
import vercelIcon from "@lobehub/icons-static-svg/icons/vercel.svg";
import workersaiIcon from "@lobehub/icons-static-svg/icons/workersai.svg";
import tokendanceIcon from "./assets/tokendance.svg";
import unifuncsIcon from "./assets/unifuncs.png";
import dotsIcon from "./assets/dots.png";
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
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi.svg";
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
import openRouterIcon from "@lobehub/icons-static-svg/icons/openrouter.svg";
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
  ai21: ai21Icon,
  aionlabs: aionlabsIcon,
  antgroup: antgroupIcon,
  bytedance: bytedanceIcon,
  cerebras: cerebrasIcon,
  cloudflare: cloudflareIcon,
  hunyuan: hunyuanIcon,
  ibm: ibmIcon,
  inception: inceptionIcon,
  kwaikat: kwaikatIcon,
  longcat: longcatIcon,
  microsoft: microsoftIcon,
  poolside: poolsideIcon,
  relace: relaceIcon,
  spark: sparkIcon,
  upstage: upstageIcon,
  vercel: vercelIcon,
  workersai: workersaiIcon,
  tokendance: tokendanceIcon,
  unifuncs: unifuncsIcon,
  dots: dotsIcon,

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
  "unifuncs",
  "dots",
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
  "meta",
  "minimax",
  "mistral",
  "nova",
  "novita",
  "nvidia",
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
  { icon: "bytedance", pattern: /(^|[/_.:-])(seed|doubao)(?=$|[/_.:-]|\d)/ },
  { icon: "hunyuan", pattern: /(^|[/_.:-])(hunyuan|hy[3-9])(?=$|[/_.:-])/ },
  { icon: "antgroup", pattern: /(^|[/_.:-])(ling|ring)(?=$|[/_.:-]|\d)/ },
  { icon: "longcat", pattern: /(^|[/_.:-])longcat(?=$|[/_.:-])/ },
  { icon: "spark", pattern: /(^|\/)spark(?=$|[/_.:-])/ },
  { icon: "unifuncs", pattern: /(^|[/_.:-])unifuncs(?=$|[/_.:-])/ },
  { icon: "dots", pattern: /(^|[/_.:-])dots(?=$|[/_.:-]|\d)/ },
  { icon: "ibm", pattern: /(^|[/_.:-])granite(?=$|[/_.:-])/ },
  { icon: "microsoft", pattern: /(^|[/_.:-])(phi|mai)(?=$|[/_.:-]|\d)/ },
  { icon: "ai21", pattern: /(^|[/_.:-])jamba(?=$|[/_.:-])/ },
  { icon: "inception", pattern: /(^|[/_.:-])mercury(?=$|[/_.:-])/ },
  { icon: "kwaikat", pattern: /(^|[/_.:-])kat-coder(?=$|[/_.:-])/ },
  { icon: "poolside", pattern: /(^|[/_.:-])laguna(?=$|[/_.:-])/ },
  { icon: "cohere", pattern: /(^|[/_.:-])north-mini(?=$|[/_.:-])/ },
  { icon: "upstage", pattern: /(^|[/_.:-])solar(?=$|[/_.:-])/ },
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
      /(^|[/_.:-])(mistral|mixtral|codestral|ministral|magistral|devstral|pixtral|voxtral)(?=$|[/_.:-])/,
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
  ai21: "ai21",
  aionlabs: "aionlabs",
  antgroup: "antgroup",
  bytedance: "bytedance",
  cerebras: "cerebras",
  cloudflare: "cloudflare",
  hunyuan: "hunyuan",
  ibm: "ibm",
  inception: "inception",
  kwaikat: "kwaikat",
  longcat: "longcat",
  microsoft: "microsoft",
  poolside: "poolside",
  relace: "relace",
  spark: "spark",
  upstage: "upstage",
  vercel: "vercel",
  workersai: "workersai",
  tokendance: "tokendance",
  unifuncs: "unifuncs",
  dots: "dots",
  meta: "meta",
  "ant-ling": "antgroup",
  inclusionai: "antgroup",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "workersai",
  "vercel-ai-gateway": "vercel",
  ai21labs: "ai21",
  "aion-labs": "aionlabs",
  "arcee-ai": "arcee",
  "bytedance-seed": "bytedance",
  "ibm-granite": "ibm",
  mistralai: "mistral",
  kwaipilot: "kwaikat",
  meituan: "longcat",
  "dots-studio": "dots",
  tencent: "hunyuan",
  qwen: "qwen",
  qwen3: "qwen",
  "google-deepmind": "gemini",

  alibaba: "qwen",
  anthropic: "anthropic",
  arcee: "arcee",
  "azure-foundry": "azureai",
  bedrock: "bedrock",
  "amazon-bedrock": "bedrock",
  "azure-openai-responses": "azureai",
  cohere: "cohere",
  copilot: "githubcopilot",
  "copilot-acp": "githubcopilot",
  deepseek: "deepseek",
  "deepseek-official": "deepseek",
  fireworks: "fireworks",
  gemini: "gemini",
  "github-copilot": "githubcopilot",
  google: "gemini",
  "google-vertex": "gemini",
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
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
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
  "qwen-token-plan": "qwen",
  "qwen-token-plan-cn": "qwen",
  siliconcloud: "siliconcloud",
  stepfun: "stepfun",
  "tencent-tokenhub": "tencent",
  togetherai: "together",
  together: "together",
  xai: "xai",
  "xai-oauth": "xai",
  xiaomi: "xiaomimimo",
  "xiaomi-token-plan-cn": "xiaomimimo",
  "xiaomi-token-plan-sgp": "xiaomimimo",
  "xiaomi-token-plan-ams": "xiaomimimo",
  zai: "zai",
  "zai-coding-cn": "zai",
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

  // Aggregators preserve owner namespaces (e.g. arcee-ai/trinity-mini).
  // Use only exact known namespace segments; unknown names keep the transport
  // provider fallback instead of being assigned an unrelated brand.
  const segments = normalizedModel.split("/");
  for (const owner of segments.slice(0, -1)) {
    const icon = PROVIDER_ICONS[owner];
    if (icon) return icon;
  }
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
export function ModelIcon({ className, model, provider }: ModelIconProps) {
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
        className={cn(
          "inline-block h-4 w-4 shrink-0 object-contain",
          name !== "unifuncs" && name !== "dots" && "dark:brightness-150",
          className,
        )}
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
        // Vite embeds SVGs as data URLs containing quotes. An unquoted url()
        // is invalid CSS and leaves only this element's solid background.
        maskImage: `url(${JSON.stringify(url)})`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url(${JSON.stringify(url)})`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}
