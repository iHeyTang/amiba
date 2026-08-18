import type { Context } from "@deepseek-ai/cordis"

export const name = "{{ID}}"

export function apply(ctx: Context): void {
  ctx.effect(() => {
    ctx.logger(name).info("{{NAME}} started")
    return () => ctx.logger(name).info("{{NAME}} stopped")
  }, "{{ID}}.lifecycle")
}
