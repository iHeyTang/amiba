/** Values supported by the pinned official ReferenceInsert contract. */
export type ReferenceAppearance = "session" | "file" | "folder";
export function referenceAppearance(value: string | undefined): ReferenceAppearance | undefined {
  return value === "session" || value === "file" || value === "folder" ? value : undefined;
}
