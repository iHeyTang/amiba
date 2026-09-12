import { isPetStatusVisible, type AmibaNotification } from "@amiba/dsh-plugin-notification-hub/model";
/** Same ordering drives the collapsed bubble and the creature's dominant state. */
export function petMessages(notifications: readonly AmibaNotification[]) {
  const visible = notifications.filter(isPetStatusVisible);
  const waiting = new Set(visible.filter(n => !n.activity && n.status === "waiting").map(n => n.sessionId));
  const priority = (n: AmibaNotification) => n.status === "waiting" ? 0 : n.activity ? 1 : 2;
  return visible.filter(n => !n.activity || !waiting.has(n.sessionId))
    .sort((a, b) => priority(a) - priority(b) || b.timestamp - a.timestamp);
}
export function placeDesktopMessage(
  pet: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  height: number,
) {
  const width = Math.min(240, Math.max(0, viewport.width - 24));
  const above = pet.y - height - 12 >= 12;
  return {
    width,
    left: Math.max(
      12,
      Math.min(viewport.width - width - 12, pet.x + pet.width / 2 - width / 2),
    ),
    top: Math.max(
      12,
      Math.min(
        viewport.height - height - 12,
        above ? pet.y - height - 12 : pet.y + pet.height + 12,
      ),
    ),
    above,
  };
}
