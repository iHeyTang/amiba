import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client"
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots"
import type {} from "@amiba/extension-sdk"
import type { ReactNode } from "react"

import "./styles.css"

export const name = "{{ID}}-client"
export const inject = ["slots"]

// Official conversation vocabulary (inherited through @amiba/extension-sdk):
// one utility in the session header's right-aligned strip. Session scope —
// the framework session kit (sessionId, useSession, useProjection) arrives
// as props, and the shell renders the seat only while a session is current.
function HeaderContribution(
  _props: PropsRuntime<"conversation.session.header.utilities">,
): ReactNode {
  return <span className="{{SLUG}}-status">{{NAME}}</span>
}

export function apply(ctx: ClientContext): void {
  ctx.effect(
    () =>
      ctx.slots.inject("conversation.session.header.utilities", () =>
        ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "{{ID}}.header",
            order: 200,
          },
          HeaderContribution,
        ),
      ),
    "{{ID}}.header-slot",
  )
}
