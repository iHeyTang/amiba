// @vitest-environment jsdom
import React from "react";
import { act, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@amiba/ui/plugin", () => ({
  EmptyStateVisualProvider: ({ render }: any) => render({ scene: "home", defaultVisual: <span>Default logo</span> }),
}));
import { SurfaceProvider } from "./surface-provider.js";
afterEach(cleanup);
it("picks a visual arriving after boot and falls back safely on unload", () => {
  let state: any = { ready: true, choices: {}, rows: { "amiba.emptyState.visual": [] } };
  let notify = () => {};
  const surfaces: any = { getSnapshot: () => state, subscribe: (fn: () => void) => { notify = fn; return () => {}; } };
  render(<SurfaceProvider surfaces={surfaces} renderSlot={(() => <span>Pet</span>) as any}>{null}</SurfaceProvider>);
  expect(screen.getByText("Default logo")).toBeTruthy();
  act(() => { state = { ...state, rows: { "amiba.emptyState.visual": [{ id: "mofli" }] } }; notify(); });
  expect(screen.getByText("Pet")).toBeTruthy();
  act(() => { state = { ...state, choices: { "amiba.emptyState.visual": "uninstalled" } }; notify(); });
  expect(screen.getByText("Default logo")).toBeTruthy();
  act(() => { state = { ...state, choices: {}, rows: { "amiba.emptyState.visual": [] } }; notify(); });
  expect(screen.getByText("Default logo")).toBeTruthy();
});
it("does not flash the default visual while saved surface selection loads", () => {
  let state: any = { ready: false, choices: {}, rows: { "amiba.emptyState.visual": [] } };
  let notify = () => {};
  const surfaces: any = { getSnapshot: () => state, subscribe: (fn: () => void) => { notify = fn; return () => {}; } };
  render(<SurfaceProvider surfaces={surfaces} renderSlot={(() => <span>Pet</span>) as any}>{null}</SurfaceProvider>);
  expect(screen.queryByText("Default logo")).toBeNull();
  act(() => { state = { ready: true, choices: { "amiba.emptyState.visual": "mofli" }, rows: { "amiba.emptyState.visual": [{ id: "mofli" }] } }; notify(); });
  expect(screen.getByText("Pet")).toBeTruthy();
  expect(screen.queryByText("Default logo")).toBeNull();
  act(() => { state = { ...state, choices: {} }; notify(); });
  expect(screen.getByText("Pet")).toBeTruthy();
  act(() => { state = { ...state, choices: { "amiba.emptyState.visual": "" } }; notify(); });
  expect(screen.getByText("Default logo")).toBeTruthy();
});
