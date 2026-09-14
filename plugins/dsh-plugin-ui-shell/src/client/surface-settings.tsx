import { useSyncExternalStore } from "react";
import { useT } from "@amiba/i18n";
import {
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@amiba/ui/primitives";
import { SURFACE_SLOTS, type SurfaceSelections } from "./surface-selections.js";
export function SurfaceSettings({ surfaces }: { surfaces: SurfaceSelections }) {
  const state = useSyncExternalStore(
    surfaces.subscribe,
    surfaces.getSnapshot,
    surfaces.getSnapshot,
  );
  const { language } = useT();
  const zh = language.startsWith("zh");
  const labels = zh
    ? ["空状态展示", "消息装饰"]
    : ["Empty-state visual", "Message decoration"];
  return (
    <div className="space-y-3">
      {SURFACE_SLOTS.map((slot, i) => {
        const id = state.choices[slot],
          available = state.rows[slot].some((r) => r.id === id);
        return (
          <div className="flex items-center justify-between gap-4" key={slot}>
            <Label>{labels[i]}</Label>
            <Select
              disabled={!state.ready}
              value={id === undefined ? "default" : id === "" ? "none" : `provider:${id}`}
              onValueChange={(value) => {
                void surfaces
                  .set(
                    slot,
                    value === "default" ? undefined : value === "none" ? "" : value.slice("provider:".length),
                  )
                  .catch(() => {});
              }}
            >
              <SelectTrigger
                data-surface-selector={slot}
                aria-label={labels[i]}
                className="w-48"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  {zh ? "默认" : "Default"}
                </SelectItem>
                <SelectItem value="none">
                  {zh ? "不显示" : "None"}
                </SelectItem>
                {id && !available && (
                  <SelectItem value={`provider:${id}`} disabled>
                    {id} ({zh ? "未安装" : "unavailable"})
                  </SelectItem>
                )}
                {state.rows[slot].map((row) => (
                  <SelectItem key={row.id} value={`provider:${row.id}`}>
                    {row.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
    </div>
  );
}
