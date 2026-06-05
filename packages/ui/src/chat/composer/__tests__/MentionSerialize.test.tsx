import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RichComposerEditor } from "../RichComposerEditor"

describe("mention value sync", () => {
  it("renders a chip for a token in the external value", async () => {
    render(<RichComposerEditor value="hi @[skill:translate] x" onChange={() => {}} />)
    await waitFor(() => expect(screen.getByText("@translate")).toBeInTheDocument())
  })
})
