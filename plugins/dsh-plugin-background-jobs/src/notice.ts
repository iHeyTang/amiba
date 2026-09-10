import type { PresentationNotice } from "@amiba/app-runtime/protocol";
/** All UI-only notices use the official optional-event envelope. */
export function appendPresentationNotice(
  session: { append(type: "amiba/notice", data: PresentationNotice, options: { ignorable: true }): unknown },
  notice: PresentationNotice,
): void {
  session.append("amiba/notice", notice, { ignorable: true });
}
