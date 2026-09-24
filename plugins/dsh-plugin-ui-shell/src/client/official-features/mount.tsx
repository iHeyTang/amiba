import { createElement, type ComponentType, type CSSProperties } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { FeedbackActions, FeedbackDialog } from "./feedback.js";
import { GoalDock } from "./goal.js";
import { SubagentLineage, SubagentReadOnly } from "./subagent.js";

/** Only these bundled default nodes are already projected by Amiba. External
 * registrations still opt into the full official transcript as before. */
export const OFFICIAL_FEATURE_REGISTRANT = "amiba:rc2-feature-defaults";
type Feature = "plan" | "feedback" | "goal" | "subagent";
const replacements = {
  feedback: {
    "conversation.chat.assistant-actions": FeedbackActions,
    "conversation.input.overlay": FeedbackDialog,
  },
  goal: { "conversation.input.dock": GoalDock, "conversation.chat.node": null },
  subagent: {
    "conversation.session.header.lineage": SubagentLineage,
    "conversation.composer": SubagentReadOnly,
  },
  plan: { "conversation.input.plan": null },
};
const planTheme = {
  "--dsw-alias-state-error-primary": "hsl(var(--destructive))",
  "--dsw-alias-state-warn-label": "hsl(var(--foreground))",
  "--dsw-alias-state-warn-primary": "hsl(var(--warning))",
  "--dsw-alias-state-warn-tertiary": "hsl(var(--warning) / .12)",
} as CSSProperties;

/** Call the pinned published apply with a per-plugin facade. Keep its locale,
 * hooks, CAS verbs, selectors, command decorations and disposal; replace only
 * known presentation entries. No global slot registry or service mutation. */
export function mountOfficialFeature(
  ctx: Context,
  feature: Feature,
  apply: (ctx: Context) => void,
) {
  const mapping = replacements[feature] as Record<
    string,
    ComponentType<never> | null
  >;
  const slots = new Proxy(ctx.slots, {
    get(target, key) {
      if (key === "register")
        return (
          options: Record<string, unknown>,
          component: ComponentType<Record<string, unknown>>,
        ) => {
          const name = String(options.name);
          if (!(name in mapping))
            throw new Error(
              `Unexpected official ${feature} presentation: ${name}`,
            );
          const replacement = mapping[name];
          const Component = replacement ?? component;
          const presentation =
            feature === "plan"
              ? (props: Record<string, unknown>) => (
                  <span style={planTheme}>
                    {createElement(component, props)}
                  </span>
                )
              : Component;
          return target.register(
            {
              ...options,
              registrant: OFFICIAL_FEATURE_REGISTRANT,
              // The command-input node remains available in official transcript mode;
              // Amiba renders the same projection in its own timeline too.
              ...(name === "conversation.chat.node" ? { priority: 1 } : {}),
            } as never,
            presentation as never,
          );
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const facade = new Proxy(ctx, {
    get(target, key) {
      if (key === "slots") return slots;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  apply(facade);
}
