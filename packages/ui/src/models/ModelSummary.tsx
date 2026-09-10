import type { LucideIcon } from "lucide-react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  AudioLines,
  Brain,
  Braces,
  Eye,
  FileText,
  Gauge,
  Image as ImageIcon,
  Layers3,
  Thermometer,
  Unlock,
  Video,
  Wrench,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@amiba/i18n";

import { cn } from "../primitives";
import { ModelIcon } from "./ModelIcon";
import { resolveModelDisplayName } from "./model-display";
import { normalizeModelMetadata, type ModelMetadata } from "./model-metadata";

export type ModelMetadataTone =
  | "amber"
  | "blue"
  | "cyan"
  | "emerald"
  | "neutral"
  | "rose"
  | "violet";

export interface ModelMetadataItem {
  icon: LucideIcon;
  key: string;
  label: string;
  tone?: ModelMetadataTone;
  value?: string;
}

export interface ModelSummaryItems {
  capabilities: ModelMetadataItem[];
  limits: ModelMetadataItem[];
}

export interface ModelSummaryProps {
  action?: ReactNode;
  className?: string;
  current?: boolean;
  displayName?: string;
  description?: string;
  icon?: ReactNode;
  metadata?: ModelMetadata;
  model: string;
  provider: string;
  variant?: "standard" | "picker";
  visible?: boolean;
}

export interface ModelSummaryOptionProps {
  action?: ReactNode;
  className?: string;
  description?: string;
  icon: ReactNode;
  label: string;
  variant?: "standard" | "picker";
}

export interface ModelIdentityNameProps {
  className?: string;
  displayName?: string;
  model: string;
  showModelId?: boolean;
  variant?: "standard" | "picker";
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(2)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
  }
  return value.toLocaleString();
}

export function useModelSummaryItems(
  metadata: ModelMetadata = {},
): ModelSummaryItems {
  const { t } = useT();
  const normalized = normalizeModelMetadata(metadata);
  const flags = normalized.capabilities;
  const capabilities: ModelMetadataItem[] = [];
  const limits: ModelMetadataItem[] = [];
  const addCapability = (
    enabled: boolean,
    key: string,
    label: string,
    icon: LucideIcon,
    tone: ModelMetadataTone,
  ) => {
    if (enabled) capabilities.push({ icon, key, label, tone });
  };
  const addCapabilityDetail = (
    value: string,
    key: string,
    label: string,
    icon: LucideIcon,
    tone: ModelMetadataTone,
  ) => {
    if (value) capabilities.push({ icon, key, label, tone, value });
  };

  addCapability(
    flags.reasoning,
    "reasoning",
    t("options.models.card.capability.reasoning"),
    Brain,
    "violet",
  );
  addCapability(
    flags.tools,
    "tools",
    t("options.models.card.capability.tools"),
    Wrench,
    "blue",
  );
  addCapability(
    flags.visionInput,
    "vision",
    t("options.models.card.capability.vision"),
    Eye,
    "cyan",
  );
  addCapability(
    flags.pdfInput,
    "pdf",
    t("options.models.card.capability.pdf"),
    FileText,
    "rose",
  );
  addCapability(
    flags.audioInput,
    "audio-input",
    t("options.models.card.capability.audioInput"),
    AudioLines,
    "cyan",
  );
  addCapability(
    flags.videoInput,
    "video-input",
    t("options.models.card.capability.videoInput"),
    Video,
    "violet",
  );
  addCapability(
    flags.imageOutput,
    "image-output",
    t("options.models.card.capability.imageOutput"),
    ImageIcon,
    "emerald",
  );
  addCapability(
    flags.audioOutput,
    "audio-output",
    t("options.models.card.capability.audioOutput"),
    AudioLines,
    "emerald",
  );
  addCapability(
    flags.videoOutput,
    "video-output",
    t("options.models.card.capability.videoOutput"),
    Video,
    "amber",
  );
  addCapability(
    flags.pdfOutput,
    "pdf-output",
    t("options.models.card.capability.pdfOutput"),
    FileText,
    "blue",
  );
  addCapability(
    flags.structuredOutput,
    "structured-output",
    t("options.models.card.capability.structuredOutput"),
    Braces,
    "amber",
  );
  addCapability(
    flags.temperatureControl,
    "temperature",
    t("options.models.card.capability.temperature"),
    Thermometer,
    "rose",
  );
  addCapability(
    flags.openWeights,
    "open-weights",
    t("options.models.card.capability.openWeights"),
    Unlock,
    "emerald",
  );
  addCapability(
    flags.fastMode,
    "fast-mode",
    t("options.models.card.capability.fastMode"),
    Zap,
    "amber",
  );
  addCapability(
    flags.interleavedReasoning,
    "interleaved",
    t("options.models.card.capability.interleavedReasoning"),
    Layers3,
    "violet",
  );
  addCapabilityDetail(
    normalized.modalities.unclassifiedInput.join(" · "),
    "input-modalities",
    t("options.models.card.inputModalities"),
    ArrowDownToLine,
    "cyan",
  );
  addCapabilityDetail(
    normalized.modalities.unclassifiedOutput.join(" · "),
    "output-modalities",
    t("options.models.card.outputModalities"),
    ArrowUpFromLine,
    "blue",
  );

  if (normalized.limits.contextWindow) {
    limits.push({
      icon: Gauge,
      key: "context",
      label: t("options.models.card.context"),
      value: formatTokenCount(normalized.limits.contextWindow),
    });
  }
  if (normalized.limits.maxInputTokens) {
    limits.push({
      icon: ArrowDownToLine,
      key: "max-input",
      label: t("options.models.card.maxInput"),
      value: formatTokenCount(normalized.limits.maxInputTokens),
    });
  }
  if (normalized.limits.maxOutputTokens) {
    limits.push({
      icon: ArrowUpFromLine,
      key: "max-output",
      label: t("options.models.card.maxOutput"),
      value: formatTokenCount(normalized.limits.maxOutputTokens),
    });
  }

  return { capabilities, limits };
}

export function ModelSummary({ metadata, ...props }: ModelSummaryProps) {
  const items = useModelSummaryItems(metadata);
  return <ModelSummaryView {...props} {...items} />;
}

/**
 * A non-model route rendered with the same identity grid as a model.
 *
 * Used for inherited/default routes in model pickers so their icon, label,
 * and trailing state share the exact alignment contract of model rows.
 */
export function ModelSummaryOption({
  action,
  className,
  description,
  icon,
  label,
  variant = "standard",
}: ModelSummaryOptionProps) {
  const picker = variant === "picker";

  return (
    <ModelSummaryFrame
      action={action}
      className={className}
      icon={icon}
      option={label}
      picker={picker}
    >
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate font-medium leading-snug text-foreground",
            picker ? "text-[10px]" : "text-[11px]",
          )}
        >
          {label}
        </span>
        {description?.trim() ? (
          <span
            className={cn(
              "mt-0.5 block leading-relaxed text-muted-foreground",
              picker ? "line-clamp-1 text-[9px]" : "line-clamp-2 text-[10px]",
            )}
          >
            {description.trim()}
          </span>
        ) : null}
      </span>
    </ModelSummaryFrame>
  );
}

export function ModelIdentityName({
  className,
  displayName,
  model,
  showModelId = true,
  variant = "standard",
}: ModelIdentityNameProps) {
  const primaryName = resolveModelDisplayName(model, displayName);
  const hasReadableName =
    Boolean(primaryName) &&
    primaryName.toLocaleLowerCase() !== model.trim().toLocaleLowerCase();

  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-baseline gap-1.5",
        className,
      )}
      data-model-identity-line
    >
      <span
        className={cn(
          "min-w-0 truncate font-medium leading-snug text-foreground",
          !hasReadableName && "font-mono",
          variant === "picker" ? "text-[10px]" : "text-[11px]",
        )}
        data-model-primary-name
        title={primaryName}
      >
        {primaryName}
      </span>
      {showModelId && hasReadableName ? (
        <span
          className={cn(
            "min-w-0 truncate font-mono font-normal leading-snug text-muted-foreground/70",
            variant === "picker" ? "text-[9px]" : "text-[10px]",
          )}
          data-model-id
          title={model}
        >
          {model}
        </span>
      ) : null}
    </span>
  );
}

export function ModelSummaryView({
  action,
  capabilities,
  className,
  current = false,
  displayName,
  description,
  icon,
  limits,
  model,
  provider,
  variant = "standard",
  visible = true,
}: Omit<ModelSummaryProps, "metadata"> & ModelSummaryItems) {
  const { t } = useT();
  const picker = variant === "picker";

  return (
    <ModelSummaryFrame
      action={action}
      className={className}
      icon={
        icon ?? (
          <ModelIcon
            className={picker ? "h-4 w-4" : "h-[18px] w-[18px]"}
            model={model}
            provider={provider}
          />
        )
      }
      model={model}
      picker={picker}
      visible={visible}
    >
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <ModelIdentityName
            displayName={displayName}
            model={model}
            variant={variant}
          />
          {limits.length > 0 ? <ModelMetricSummary items={limits} /> : null}
          {current ? (
            <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))]"
              />
              {t("options.models.display.currentModel")}
            </span>
          ) : null}
        </span>
        {description?.trim() ? (
          <span className="mt-1 block whitespace-normal break-words text-xs font-normal leading-relaxed text-muted-foreground">
            {description.trim()}
          </span>
        ) : null}
        {capabilities.length > 0 ? (
          <ModelMetadataPills
            className={picker ? "mt-1" : "mt-2"}
            items={capabilities}
          />
        ) : null}
      </span>
    </ModelSummaryFrame>
  );
}

function ModelSummaryFrame({
  action,
  children,
  className,
  icon,
  model,
  option,
  picker,
  visible = true,
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  icon: ReactNode;
  model?: string;
  option?: string;
  picker: boolean;
  visible?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start",
        picker ? "gap-x-2" : "gap-x-3",
        visible ? "text-foreground" : "text-muted-foreground opacity-65",
        className,
      )}
      data-model-summary={model}
      data-model-summary-option={option}
      data-model-summary-variant={picker ? "picker" : "standard"}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg bg-muted/45",
          picker ? "h-7 w-7" : "h-8 w-8",
        )}
        data-model-summary-icon
      >
        {icon}
      </span>
      {children}
      {action ? <span className="shrink-0 self-center">{action}</span> : null}
    </span>
  );
}

function ModelMetricSummary({ items }: { items: ModelMetadataItem[] }) {
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] tabular-nums text-muted-foreground/75"
      data-model-metrics
    >
      {items.map((item) => {
        const Icon = item.icon;
        const accessibleLabel = `${item.label} ${item.value ?? ""}`.trim();
        return (
          <span
            aria-label={accessibleLabel}
            className="inline-flex items-center gap-0.5 whitespace-nowrap"
            data-model-metric={item.key}
            key={item.key}
            title={accessibleLabel}
          >
            <Icon aria-hidden className="h-2.5 w-2.5" />
            <span>{item.value}</span>
          </span>
        );
      })}
    </span>
  );
}

export function ModelMetadataPills({
  className,
  items,
}: {
  className?: string;
  items: ModelMetadataItem[];
}) {
  return (
    <span
      className={cn("flex min-w-0 flex-wrap gap-1", className)}
      data-model-metadata-pills
    >
      {items.map((item) => (
        <ModelMetadataPill
          icon={item.icon}
          key={item.key}
          label={item.label}
          tone={item.tone}
          value={item.value}
        />
      ))}
    </span>
  );
}

const PILL_TONE_CLASSES: Record<ModelMetadataTone, string> = {
  amber:
    "border-amber-500/15 bg-amber-500/[0.045] text-amber-700 dark:text-amber-300",
  blue: "border-blue-500/15 bg-blue-500/[0.045] text-blue-700 dark:text-blue-300",
  cyan: "border-cyan-500/15 bg-cyan-500/[0.045] text-cyan-700 dark:text-cyan-300",
  emerald:
    "border-emerald-500/15 bg-emerald-500/[0.045] text-emerald-700 dark:text-emerald-300",
  neutral: "border-border/40 bg-muted/20 text-muted-foreground",
  rose: "border-rose-500/15 bg-rose-500/[0.045] text-rose-700 dark:text-rose-300",
  violet:
    "border-violet-500/15 bg-violet-500/[0.045] text-violet-700 dark:text-violet-300",
};

function ModelMetadataPill({
  icon: Icon,
  label,
  tone = "neutral",
  value,
}: ModelMetadataItem) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] leading-none",
        PILL_TONE_CLASSES[tone],
      )}
      data-model-metadata-pill
      data-model-metadata-tone={tone}
      title={value ? `${label}: ${value}` : label}
    >
      <Icon aria-hidden className="h-2.5 w-2.5 shrink-0 opacity-75" />
      <span className="shrink-0">{label}</span>
      {value ? (
        <span className="min-w-0 truncate font-mono font-medium text-foreground/80">
          {value}
        </span>
      ) : null}
    </span>
  );
}
