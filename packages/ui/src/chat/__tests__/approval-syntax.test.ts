import { describe, expect, it } from "vitest";

import { splitApprovalCommand } from "../bubble/approval-syntax";

function expectPreserved(source: string, expectedLanguages: string[]) {
  const segments = splitApprovalCommand(source);
  expect(segments.map((segment) => segment.text).join("")).toBe(source);
  expect(segments.map((segment) => segment.language)).toEqual(
    expectedLanguages,
  );
}

describe("approval syntax detection", () => {
  it("highlights a quoted Python command without changing its shell wrapper", () => {
    expectPreserved("python3 -c 'import os\nprint(os.getcwd())'", [
      "shell",
      "python",
      "shell",
    ]);
  });

  it("recognizes Hermes execute_code heredocs", () => {
    expectPreserved(
      "execute_code <<'PY'\nimport pathlib\nprint(pathlib.Path.cwd())\nPY",
      ["shell", "python", "shell"],
    );
  });

  it("recognizes JavaScript eval commands", () => {
    expectPreserved('node --eval "const ok = true; console.log(ok)"', [
      "shell",
      "javascript",
      "shell",
    ]);
  });

  it("uses output extensions to identify heredoc content", () => {
    expectPreserved("cat <<'EOF' > config.json\n{\"enabled\":true}\nEOF", [
      "shell",
      "json",
      "shell",
    ]);
  });

  it("recognizes patch payloads and keeps ordinary commands as shell", () => {
    expectPreserved(
      "*** Begin Patch\n*** Update File: app.ts\n@@\n-old\n+new",
      ["diff"],
    );
    expectPreserved("git status --short", ["shell"]);
  });

  it("does not decorate synthetic plugin approval labels as executable code", () => {
    expectPreserved("<write_file> (plugin approval rule)", ["plain"]);
  });
});
