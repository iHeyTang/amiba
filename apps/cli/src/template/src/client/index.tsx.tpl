import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client"
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots"
import type {} from "@amiba/extension-sdk"
import type { ReactNode } from "react"

import "./styles.css"

export const name = "{{ID}}-client"
export const inject = ["slots"]

function HeaderContribution(
  _props: PropsRuntime<"amiba.chat.header.after">,
): ReactNode {
  return <span className="{{SLUG}}-status">{{NAME}}</span>
}

export function apply(ctx: ClientContext): void {
  ctx.effect(
    () =>
      ctx.slots.inject("amiba.chat.header.after", () =>
        ctx.slots.register(
          {
            name: "amiba.chat.header.after",
            id: "{{ID}}.header",
            order: 200,
          },
          HeaderContribution,
        ),
      ),
    "{{ID}}.header-slot",
  )
}
