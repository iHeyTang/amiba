import type { Context } from "@deepseek-ai/cordis";

/** Keep the published workspace service, locale and hooks, with Amiba's UI.
 * Only this apply receives the facade: third-party registration is untouched.
 * Children must have one declarer even when a different parent entry wins.
 */
export function mountOfficialWorkspaceServices(ctx: Context, apply: (ctx: Context) => void) {
  const slots = new Proxy(ctx.slots, { get(target, key) {
    if (key === "register") return (options: { name: string }) => {
      if (options.name !== "sidebar.workspaces" && options.name !== "conversation.hero.workspace") {
        throw new Error(`Unexpected official workspace presentation: ${options.name}`);
      }
      return () => {};
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const serviceContext = new Proxy(ctx, { get(target, key) {
    if (key === "slots") return slots;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  apply(serviceContext);
}
