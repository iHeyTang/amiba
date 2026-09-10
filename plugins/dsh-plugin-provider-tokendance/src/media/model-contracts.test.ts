import { expect, it } from "vitest";
import {
  contractFor,
  normalizeParameters,
  tokenDanceModels,
} from "./model-contracts.js";
const content = [{ type: "text", text: "A cat" }];
it.each(tokenDanceModels)(
  "publishes a strict serializable model contract: %s",
  (model) => {
    const c = contractFor(model);
    expect(c.schema.additionalProperties).toBe(false);
    expect(JSON.parse(JSON.stringify(c)).version).toBeTruthy();
  },
);
it("supplies reliable image and speech defaults", () => {
  expect(
    normalizeParameters("seedream-5.0-lite", { prompt: "cat" }),
  ).toMatchObject({ size: "2K", response_format: "b64_json" });
  expect(
    normalizeParameters("minimax-speech-2.8-hd", { text: "hello" }),
  ).toMatchObject({
    output_format: "hex",
    stream: false,
    voice_setting: { voice_id: "male-qn-qingse" },
  });
});
it.each([
  ["seedream-5.0-lite", { prompt: "cat", size: "1024x1024" }],
  ["seedream-5.0-lite", { prompt: "cat", unknown: true }],
  ["minimax-h3-max", { content, resolution: "2K" }],
  ["minimax-h3-max", { content, duration: 4 }],
  ["minimax-h3", { content, duration: 4.5 }],
  ["minimax-speech-2.8-hd", { text: "hello", voice_setting: { speed: 3 } }],
  ["seedance-2.0-fast", { content, duration: 30 }],
  ["seedance-2.0-mini", { content, resolution: "1080p" }],
  ["seedance-2.0", { content, omni_reference_task_type: "edit" }],
] as const)(
  "rejects incompatible parameters for %s before transport",
  (model, p) => expect(() => normalizeParameters(model, p)).toThrow(),
);
it("validates roles, counts and mutually exclusive task modes", () => {
  const frame = {
    type: "image_url",
    image_url: { url: "https://example.com/a.png" },
    role: "first_frame",
  };
  const ref = { ...frame, role: "reference_image" };
  expect(() =>
    normalizeParameters("minimax-h3", { content: [...content, frame, ref] }),
  ).toThrow("cannot be mixed");
  expect(() =>
    normalizeParameters("minimax-h3-max", { content: [...content, ref] }),
  ).toThrow("does not support");
  expect(() =>
    normalizeParameters("minimax-h3", {
      content: [...content, ...Array(10).fill(ref)],
    }),
  ).toThrow("Too many");
  expect(
    normalizeParameters("minimax-h3", { content: [...content, frame] }).ratio,
  ).toBe("adaptive");
  expect(() =>
    normalizeParameters("minimax-h3", {
      content: [...content, frame],
      ratio: "16:9",
    }),
  ).toThrow("adaptive");
});
it("rejects unknown model updates instead of silently opening them", () =>
  expect(() => contractFor("future-image")).toThrow("no validated"));

it("does not accept another provider’s model IDs", () => {
  expect(() => contractFor("MiniMax-H3")).toThrow("no validated");
});
