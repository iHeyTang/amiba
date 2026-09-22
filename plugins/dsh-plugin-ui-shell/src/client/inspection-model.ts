import { recordOf } from "@amiba/ui/plugin";

export const PAGE_SIZE = 20;
export const isScalar = (value: unknown) =>
  value === null || typeof value !== "object";
export const isEmpty = (value: unknown) =>
  value !== null &&
  typeof value === "object" &&
  Object.keys(value).length === 0;

/** Choose comparison columns by shape; never infer a description or translate source data. */
export function collectionColumns(items: unknown[]): string[] | null {
  if (!items.length || !items.every((item) => recordOf(item))) return null;
  const records = items as Record<string, unknown>[];
  const identity = [
    "name",
    "key",
    "id",
    "signature",
    "pluginId",
    "packageId",
  ].find((key) => records.every((row) => typeof row[key] === "string"));
  if (!identity) return null;
  const candidates = [
    identity,
    "description",
    "value",
    "status",
    "state",
    "valueType",
    "signature",
  ];
  return [...new Set(candidates)]
    .filter(
      (key) =>
        records.some((row) => key in row) &&
        records.every((row) => !(key in row) || isScalar(row[key])),
    )
    .slice(0, 3);
}

export interface SearchHit {
  path: string;
  value: unknown;
}
/** Search the entire result, including folded branches and entries not yet paged into the DOM. */
export function searchInspection(value: unknown, query: string): SearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  const walk = (node: unknown, path: string) => {
    if (isScalar(node)) {
      if (String(node).toLocaleLowerCase().includes(needle))
        hits.push({ path, value: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }
    const entries = Object.entries(node as Record<string, unknown>);
    if (
      entries.some(
        ([key, child]) =>
          isScalar(child) &&
          (key.toLocaleLowerCase().includes(needle) ||
            String(child).toLocaleLowerCase().includes(needle)),
      )
    )
      hits.push({ path, value: node });
    for (const [key, child] of entries)
      if (!isScalar(child)) {
        const childPath = `${path}[${JSON.stringify(key)}]`;
        if (key.toLocaleLowerCase().includes(needle))
          hits.push({ path: childPath, value: child });
        else walk(child, childPath);
      }
  };
  walk(value, "$");
  return hits;
}
