import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
const source = (file: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), file), "utf8");
// Lexical cannot mount in this jsdom suite; lifecycle is exercised in HomeView
// and pending-prompt-handoff tests, and the real occupant in model-plane tests.
it("uses only the official model contract and requires a real session", () => {
  const composer = source('../Composer.tsx');
  expect(composer).toContain('modelPicker && (modelPicker.sessionId ?? permissionSessionId)');
  expect(composer).toContain('owner: { locked: disabled }');
  expect(composer).not.toContain('seat: "hero"');
  expect(composer).not.toContain('draftSelection');
  const home = source('../../home/HomeView.tsx');
  expect(home).toContain('sessionId: preparedId');
  expect(home).not.toContain('permissionSessionId={preparedId}');
});
