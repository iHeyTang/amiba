import { object as asObject } from "./schema-object.js";
export const at = (value: unknown, path: readonly string[]): unknown =>
  path.reduce((v, key) => asObject(v)[key], value);
export function expandSchema(schema: unknown): unknown {
  const wire = asObject(schema);
  if (!wire.refs) return schema;
  const refs = asObject(wire.refs);
  function visit(value: unknown, ancestors: Set<string>): unknown {
    if (typeof value === "number") {
      const key = String(value);
      if (ancestors.has(key)) return { type: "unsupported", meta: {} };
      return visit(refs[key], new Set([...ancestors, key]));
    }
    const node = asObject(value);
    return {
      ...node,
      ...(node.dict
        ? {
            dict: Object.fromEntries(
              Object.entries(asObject(node.dict)).map(([k, v]) => [
                k,
                visit(v, ancestors),
              ]),
            ),
          }
        : {}),
      ...(node.inner !== undefined
        ? { inner: visit(node.inner, ancestors) }
        : {}),
      ...(Array.isArray(node.list)
        ? { list: node.list.map((v) => visit(v, ancestors)) }
        : {}),
    };
  }
  return visit(wire.uid, new Set());
}
export function schemaAt(schema: unknown, path: readonly string[]): unknown {
  return path.reduce((value, key) => {
    const node = asObject(value);
    return node.type === "dict" ? node.inner : asObject(node.dict)[key];
  }, expandSchema(schema));
}
export function credentialFields(
  schema: unknown,
  value: unknown,
  path: string[] = [],
): Array<{ path: string[]; ref: string }> {
  const node = asObject(schema);
  if (
    asObject(node.meta).role === "credential-ref" &&
    typeof value === "string" &&
    value
  )
    return [{ path, ref: value }];
  if (node.type === "object")
    return Object.entries(asObject(node.dict)).flatMap(([key, child]) =>
      credentialFields(child, asObject(value)[key], [...path, key]),
    );
  if (node.type === "dict")
    return Object.entries(asObject(value)).flatMap(([key, child]) =>
      credentialFields(node.inner, child, [...path, key]),
    );
  if (node.type === "array" && Array.isArray(value))
    return value.flatMap((child, index) =>
      credentialFields(node.inner, child, [...path, String(index)]),
    );
  return [];
}
