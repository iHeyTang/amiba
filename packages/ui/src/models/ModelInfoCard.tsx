import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  CalendarDays,
  Coins,
  Database,
  Info,
  Layers3,
  SlidersHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@amiba/i18n";

import { cn } from "../primitives";
import { normalizeModelMetadata, type ModelMetadata } from "./model-metadata";
import {
  ModelMetadataPills,
  ModelSummaryView,
  useModelSummaryItems,
  type ModelMetadataItem,
} from "./ModelSummary";

export interface ModelInfoCardProps {
  action?: ReactNode;
  className?: string;
  current?: boolean;
  description?: string;
  metadata?: ModelMetadata;
  model: string;
  provider: string;
  showIdentity?: boolean;
  visible?: boolean;
}

interface ModelMetadataGroup {
  items: ModelMetadataItem[];
  key: string;
  label: string;
}

function formatPrice(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(2)}`;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPriceValue(value: unknown, freeLabel: string): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value === 0 ? freeLabel : `${formatPrice(value)}/M`;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text === "?") return null;
  if (text.toLowerCase() === "free") return freeLabel;
  if (/^\$\d+(?:\.\d+)?$/.test(text)) return `${text}/M`;
  const parsed = Number(text);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed === 0 ? freeLabel : `${formatPrice(parsed)}/M`;
  }
  return null;
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value.toLocaleString(undefined, { maximumFractionDigits: 6 })
      : "";
  }
  if (Array.isArray(value)) {
    return value.map(formatMetadataValue).filter(Boolean).join(" · ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value).trim();
}

function humanizeMetadataKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function ModelInfoCard({
  action,
  className,
  current = false,
  description,
  metadata = {},
  model,
  provider,
  showIdentity = true,
  visible = true,
}: ModelInfoCardProps) {
  const { t } = useT();
  const normalized = normalizeModelMetadata(metadata);
  const { capabilities, limits } = useModelSummaryItems(metadata);
  const pricing: ModelMetadataItem[] = [];
  const inputPrice = formatPriceValue(
    normalized.pricing.input,
    t("options.models.card.free"),
  );
  const outputPrice = formatPriceValue(
    normalized.pricing.output,
    t("options.models.card.free"),
  );
  const cacheReadPrice = formatPriceValue(
    normalized.pricing.cacheRead,
    t("options.models.card.free"),
  );
  const cacheWritePrice = formatPriceValue(
    normalized.pricing.cacheWrite,
    t("options.models.card.free"),
  );

  if (inputPrice) {
    pricing.push({
      icon: Coins,
      key: "input-price",
      label: t("options.models.card.inputPrice"),
      tone: "emerald",
      value: inputPrice,
    });
  }
  if (outputPrice) {
    pricing.push({
      icon: Coins,
      key: "output-price",
      label: t("options.models.card.outputPrice"),
      tone: "emerald",
      value: outputPrice,
    });
  }
  if (cacheReadPrice) {
    pricing.push({
      icon: Database,
      key: "cache-read",
      label: t("options.models.card.cacheRead"),
      tone: "emerald",
      value: cacheReadPrice,
    });
  }
  if (cacheWritePrice) {
    pricing.push({
      icon: Database,
      key: "cache-write",
      label: t("options.models.card.cacheWrite"),
      tone: "emerald",
      value: cacheWritePrice,
    });
  }

  const referenceDetails: ModelMetadataItem[] = [];
  const addReferenceDetail = (
    value: string,
    key: string,
    label: string,
    icon: LucideIcon,
  ) => {
    if (value) referenceDetails.push({ icon, key, label, value });
  };
  addReferenceDetail(
    normalized.reference.family,
    "family",
    t("options.models.card.family"),
    Layers3,
  );
  addReferenceDetail(
    normalized.reference.knowledgeCutoff,
    "cutoff",
    t("options.models.card.knowledgeCutoff"),
    BookOpen,
  );
  addReferenceDetail(
    normalized.reference.releaseDate,
    "released",
    t("options.models.card.releaseDate"),
    CalendarDays,
  );
  addReferenceDetail(
    normalized.reference.status,
    "status",
    t("options.models.card.status"),
    Info,
  );

  for (const [key, value] of normalized.reference.extras) {
    const formatted = formatMetadataValue(value);
    if (!formatted) continue;
    referenceDetails.push({
      icon: SlidersHorizontal,
      key: `metadata:${key}`,
      label: humanizeMetadataKey(key),
      value: formatted,
    });
  }

  const groups: ModelMetadataGroup[] = [
    {
      items: capabilities,
      key: "capabilities",
      label: t("options.models.card.group.capabilities"),
    },
    {
      items: limits,
      key: "limits",
      label: t("options.models.card.group.limits"),
    },
    {
      items: pricing,
      key: "pricing",
      label: t("options.models.card.group.pricing"),
    },
    {
      items: referenceDetails,
      key: "reference",
      label: t("options.models.card.group.reference"),
    },
  ].filter((group) => group.items.length > 0);
  return (
    <article
      className={cn(
        "rounded-lg border border-border/60 bg-background px-3 py-3 transition-colors",
        visible ? "text-foreground" : "text-muted-foreground opacity-65",
        className,
      )}
      data-model-info-card={model}
    >
      {showIdentity ? (
        <ModelSummaryView
          action={action}
          capabilities={capabilities}
          current={current}
          displayName={description}
          limits={limits}
          model={model}
          provider={provider}
        />
      ) : groups.length > 0 ? (
        <ModelMetadataGroups groups={groups} />
      ) : null}
    </article>
  );
}

function ModelMetadataGroups({ groups }: { groups: ModelMetadataGroup[] }) {
  return (
    <div className="divide-y divide-border/40" data-model-metadata-groups>
      {groups.map((group) => (
        <section
          className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-3"
          data-model-metadata-group={group.key}
          key={group.key}
        >
          <h3 className="pt-1 text-[10px] font-medium text-muted-foreground">
            {group.label}
          </h3>
          <ModelMetadataPills items={group.items} />
        </section>
      ))}
    </div>
  );
}
