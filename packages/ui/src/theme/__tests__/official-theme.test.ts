import { afterEach, expect, it } from "vitest";
import { applyThemeClass } from "../index";

afterEach(() => {
  document.documentElement.classList.remove("dark", "light", "accent-cyan");
  document.body.removeAttribute("data-ds-dark-theme");
});

it("keeps official portal selectors in sync across Amiba theme switches", () => {
  document.documentElement.classList.add("accent-cyan");
  applyThemeClass("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.body.hasAttribute("data-ds-dark-theme")).toBe(true);
  applyThemeClass("light");
  expect(document.body.hasAttribute("data-ds-dark-theme")).toBe(false);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(document.documentElement.classList.contains("accent-cyan")).toBe(true);
});
