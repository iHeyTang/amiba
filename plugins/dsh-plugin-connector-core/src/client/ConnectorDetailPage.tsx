import { ArrowLeft, Cable, Check, Plus, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Button, cn, usePluginT } from "@amiba/ui/plugin";

import { connectI18n } from "./i18n.js";
import type { ConnectorUIContribution } from "./connector-ui-registry.js";
import type {
  ConnectorProviderView,
  ConnectorStatus,
  ConnectView,
} from "../types.js";

export interface ConnectorDetailPageProps {
  canAdd: boolean;
  connects: ConnectView[];
  entry?: ConnectorUIContribution;
  onAdd(): void;
  onBack(): void;
  onOpenAccount(id: string): void;
  provider: ConnectorProviderView;
}

/**
 * Connector-core owns the navigation, account summary and security context;
 * the provider plugin owns the overview body through `entry.details`.
 */
export function ConnectorDetailPage({
  canAdd,
  connects,
  entry,
  onAdd,
  onBack,
  onOpenAccount,
  provider,
}: ConnectorDetailPageProps) {
  const { t } = usePluginT(connectI18n);
  const Details = entry?.details;
  const addLabel =
    connects.length > 0
      ? t("options.connect.dsh.directory.addAnother", {
          provider: provider.name,
        })
      : t("options.connect.dsh.directory.addAccount", {
          provider: provider.name,
        });

  return (
    <div className="space-y-9" data-connector-detail={provider.id}>
      <button
        className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("options.connect.dsh.detail.back")}
      </button>

      <section className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <ProviderDetailLogo icon={entry?.icon} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold tracking-[-0.025em]">
              {provider.name}
            </h1>
            {connects.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Check className="h-3.5 w-3.5" />
                {t("options.connect.dsh.detail.connected", {
                  count: connects.length,
                })}
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {entry?.tagline ?? provider.description}
          </p>
        </div>
        <Button
          className="self-start sm:self-auto"
          disabled={!canAdd}
          onClick={onAdd}
          type="button"
        >
          <Plus />
          {addLabel}
        </Button>
      </section>

      <div className="max-w-3xl space-y-10">
        {Details ? (
          <Details />
        ) : (
          <p className="text-sm leading-7 text-muted-foreground">
            {provider.description}
          </p>
        )}

        <section
          aria-labelledby="connector-detail-accounts"
          className="space-y-3"
        >
          <h2
            className="flex items-baseline gap-2 text-[15px] font-semibold tracking-[-0.01em]"
            id="connector-detail-accounts"
          >
            {t("options.connect.dsh.accounts.title")}
            <span className="text-[13px] font-normal tabular-nums text-muted-foreground">
              {connects.length}
            </span>
          </h2>
          {connects.length > 0 ? (
            <div className="space-y-1">
              {connects.map((connect) => (
                <button
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  key={connect.id}
                  type="button"
                  onClick={() => onOpenAccount(connect.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {connect.name}
                    </span>
                    {connect.agentPreset ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {t("options.connect.dsh.detail.agentPreset", {
                          preset: connect.agentPreset,
                        })}
                      </span>
                    ) : null}
                  </span>
                  <DetailStatus status={connect.status} />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-lg bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
              {t("options.connect.dsh.detail.noAccounts")}
            </div>
          )}
        </section>

        <div className="flex items-start gap-3 rounded-lg bg-muted/20 px-4 py-3.5 text-[13px] leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t("options.connect.dsh.detail.security")}</p>
        </div>
      </div>
    </div>
  );
}

function ProviderDetailLogo({ icon }: { icon?: ReactNode }) {
  return icon ? (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center [&>img]:h-full [&>img]:w-full [&>svg]:h-full [&>svg]:w-full">
      {icon}
    </span>
  ) : (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground">
      <Cable className="h-6 w-6" />
    </span>
  );
}

export function DetailStatus({ status }: { status: ConnectorStatus }) {
  const { t } = usePluginT(connectI18n);
  let dotClassName: string;
  let label: string;
  if (status.state === "off") {
    dotClassName = "bg-muted-foreground/35";
    label = t("options.connect.dsh.status.off");
  } else if (status.state === "ready") {
    dotClassName = "bg-[hsl(var(--success))]";
    label = t("options.connect.dsh.status.ready");
  } else if (status.state === "connecting") {
    dotClassName = "bg-primary";
    label = t("options.connect.dsh.status.connecting");
  } else if (status.state === "degraded") {
    dotClassName = "bg-[hsl(var(--warning))]";
    label = t("options.connect.dsh.status.degraded", {
      detail: status.detail,
    });
  } else {
    dotClassName = "bg-destructive";
    label = t("options.connect.dsh.status.error", { detail: status.detail });
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClassName)}
      />
      <span className="max-w-48 truncate">{label}</span>
    </span>
  );
}
