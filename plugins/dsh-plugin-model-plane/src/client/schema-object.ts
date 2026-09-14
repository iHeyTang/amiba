import { isJsonValue } from "@deepseek-ai/dsh-util-values";
export const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Refuse values JSON cannot preserve before submitting a settings mutation. */
export function jsonValue(value: unknown): import("@deepseek-ai/dsh-util-values").JsonValue {
  if (!isJsonValue(value)) throw new TypeError("Settings value is not lossless JSON");
  return value as import("@deepseek-ai/dsh-util-values").JsonValue;
}
