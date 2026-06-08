import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

describe("ui test infra", () => {
  it("renders", () => {
    render(<div>hello</div>)
    expect(screen.getByText("hello")).toBeInTheDocument()
  })
})
