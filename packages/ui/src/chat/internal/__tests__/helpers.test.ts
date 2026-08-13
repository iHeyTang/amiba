import { describe, expect, it } from "vitest"

import { stripManagedResourceContext } from "../helpers"

describe("stripManagedResourceContext", () => {
  it("keeps the user's visible mention and hides agent-only Resource contents", () => {
    const value = [
      "Summarize @Quarterly report",
      '<amiba-resource applet="io.amiba.report" revision="rev-one" trust="untrusted-content">',
      "private context for the model",
      "</amiba-resource>",
    ].join("\n")

    expect(stripManagedResourceContext(value)).toBe("Summarize @Quarterly report")
  })
})

