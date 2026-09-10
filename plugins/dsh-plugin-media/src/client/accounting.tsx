import { ChartNoAxesColumnIncreasing } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, usePluginT } from "@amiba/ui/plugin";
import type { MediaAccounting } from "../contracts.js";
import { accountingCopy as copy } from "./i18n-accounting.js";
export function MediaAccountingSummary({
  accounting,
}: {
  accounting?: MediaAccounting;
}) {
  const { t } = usePluginT(copy);
  if (accounting === undefined) return null;
  const cost = accounting.cost;
  const actual =
    cost && /^\d+(\.\d+)?$/.test(cost.amount) && cost.currency?.trim()
      ? `${cost.amount} ${cost.currency}`
      : t("missing");
  const usage = Object.entries(accounting.usage ?? {});
  const label = (key: string) =>
    Object.prototype.hasOwnProperty.call(copy.en, key) ? t(key) : key;
  return (
    <div className="amiba-media-accounting">
      <span>
        {t("cost")}：{actual}
      </span>
      {usage.length ? (
        <Popover>
          <PopoverTrigger asChild><button type="button" className="amiba-media-usage-trigger"><ChartNoAxesColumnIncreasing size={13} strokeWidth={1.6} aria-hidden="true"/>{t("usage")}</button></PopoverTrigger>
          <PopoverContent side="top" align="start" className="amiba-media-usage-popover" aria-label={t("usage")}>
          <h3>{t("usage")}</h3>
          <dl>
            {usage.map(([key, value]) => (
              <div key={key}>
                <dt>{label(key)}</dt>
                <dd>
                  {typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </PopoverContent>
        </Popover>
      ) : (
        <span>
          {t("usage")}：{t("missing")}
        </span>
      )}
    </div>
  );
}
