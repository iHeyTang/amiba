import { expect, it } from "vitest";
import { commandEnvelope } from "../command-contract";
import { CommandClaimStore } from "../triggers/claim";

it("retains both public capability projections for newer command status", () => {
  const claims = new CommandClaimStore();
  const claim = { name: "new-image", token: "/new-image ", attachments: true, submit: async () => ({ kind: "success" as const }) };
  claims.begin(claim);
  expect(claims.get()).toBe(claim);
  expect(claims.getInputStatus().claim).toEqual({ name: "new-image", token: "/new-image ", images: true, attachments: true });
  claims.setAttemptPhase("submitting");
  expect(claims.getInputStatus().claim).toMatchObject({ name: "new-image", attachments: true, images: true });
  claims.release();
  claims.setAttemptPhase(null);
  expect(claims.getInputStatus()).toEqual({ phase: "plain" });
});

it("reports total attachments separately from the legacy image count", () => {
  expect(commandEnvelope(1, 3)).toEqual({ images: 1, attachments: 3 });
});
