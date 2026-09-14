import { createLauncher, type Launcher } from "./launcher.js";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { ConnectionHandle } from "@deepseek-ai/dsh-api-remotes/client";
import type {
  PropsRenderSlots,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { useSyncExternalStore } from "react";
import { Button, Label, usePluginT } from "@amiba/ui/plugin";
import { Guide, type GuideProps, type StepSource } from "./Guide.js";
import { createProgressStore } from "./progress.js";
import { FirstRun } from "./FirstRun.js";
import { guideI18n } from "./i18n.js";
export type { GuideMood, GuideStepOwner } from "./contracts.js";
export const name = "amiba-onboarding-client";
export const inject = ["slots", "connection", "layout"];
const children = {
  "amiba.onboarding.step": { kind: "list", scope: "root" },
  "amiba.onboarding.companion": { kind: "single", scope: "root" },
} as const;
type Slots = PropsRenderSlots<keyof typeof children>;
function Overlay(
  props: Slots &
    Pick<GuideProps, "store" | "steps" | "openSection"> & {
      launcher: Launcher;
    },
) {
  const request = useSyncExternalStore(
    props.launcher.subscribe,
    props.launcher.getSnapshot,
  );
  return (
    request && (
      <Guide
        {...props}
        revisit={request.revisit}
        close={props.launcher.close}
      />
    )
  );
}
function Revisit({ launcher }: { launcher: Launcher }) {
  const { t } = usePluginT(guideI18n);
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <Label className="text-sm font-normal">{t("guide.settings")}</Label>
      <Button variant="outline" size="sm" onClick={() => launcher.open({ revisit: true, done: () => {} })}>
        {t("guide.reopen")}
      </Button>
    </div>
  );
}
export function apply(ctx: ClientContext) {
  const launcher = createLauncher();
  const api = (ctx.get("connection") as ConnectionHandle).api;
  const store = createProgressStore(api);
  const hasConfiguredProvider = async () => {
    const { result } = await api.llm.providers({});
    if (!result.ok) throw new Error(result.error.message);
    return result.value.providers.some(provider => provider.active || provider.declared === true);
  };
  let version = -1;
  let language = "";
  let rows: ReturnType<StepSource["getSnapshot"]> = [];
  const steps: StepSource = {
    getSnapshot() {
      const next = ctx.slots.getVersion("amiba.onboarding.step");
      if (next !== version || language !== document.documentElement.lang) {
        language = document.documentElement.lang;
        version = next;
        rows = ctx.slots
          .entriesOfSlot("amiba.onboarding.step")
          .slice()
          .sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
          .filter((row) => !!row.options.id)
          .map((row) => ({
            id: row.options.id!,
            label:
              (typeof row.options.label === "function"
                ? row.options.label()
                : row.options.label) ?? row.options.id!,
          }));
      }
      return rows;
    },
    subscribe: (listener) => {
      const off = ctx.slots.subscribe("amiba.onboarding.step", listener);
      const observer = new MutationObserver(listener);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"],
      });
      return () => {
        observer.disconnect();
        off();
      };
    },
  };
  const off = [
    ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register(
        {
          name: "shell.overlay",
          id: "amiba-setup-guide",
          children,
          inject: () => ({
            store,
            steps,
            launcher,
            openSection: (id: string) => {
              launcher.close();
              ctx.layout.openSettings(id);
            },
          }),
        },
        Overlay,
      ),
    ),
    ctx.slots.inject("settings.onboarding", () =>
      ctx.slots.register(
        {
          name: "settings.onboarding",
          id: "amiba-first-run",
          order: -100,
          inject: () => ({ launcher, hasConfiguredProvider }),
        },
        FirstRun,
      ),
    ),
    ctx.slots.inject("settings.general.item", () =>
      ctx.slots.register(
        {
          name: "settings.general.item",
          id: "onboarding",
          order: 40,
          inject: () => ({ launcher }),
        },
        Revisit,
      ),
    ),
  ];
  return () => off.reverse().forEach((dispose) => dispose());
}
