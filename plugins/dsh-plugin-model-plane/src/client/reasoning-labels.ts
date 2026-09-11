const standardEfforts = new Set([
  "off", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
]);

export const reasoningLabels = {
  en: {
    "model.reasoning.off": "Off",
    "model.reasoning.none": "None",
    "model.reasoning.minimal": "Minimal",
    "model.reasoning.low": "Low",
    "model.reasoning.medium": "Medium",
    "model.reasoning.high": "High",
    "model.reasoning.xhigh": "Extra high",
    "model.reasoning.max": "Max",
    "model.reasoning.ultra": "Ultra",
  },
  "zh-CN": {
    "model.reasoning.off": "关闭",
    "model.reasoning.none": "无",
    "model.reasoning.minimal": "最低",
    "model.reasoning.low": "低",
    "model.reasoning.medium": "中",
    "model.reasoning.high": "高",
    "model.reasoning.xhigh": "超高",
    "model.reasoning.max": "最高",
    "model.reasoning.ultra": "极高",
  },
};

export function reasoningLabel(
  effort: { id: string; name?: string },
  t: (key: string) => string,
): string {
  return standardEfforts.has(effort.id)
    ? t(`model.reasoning.${effort.id}`)
    : effort.name || effort.id;
}
