import { expect, it } from "vitest";
import {
  contractFor,
  normalizeParameters,
  minimaxModels,
} from "./model-contracts.js";
const content = [{ type: "text", text: "A cat" }];
it.each(minimaxModels)(
  "publishes a strict serializable model contract: %s",
  (model) => {
    const c = contractFor(model);
    expect(c.schema.additionalProperties).toBe(false);
    expect(JSON.parse(JSON.stringify(c)).version).toBeTruthy();
  },
);
it("supplies reliable image and speech defaults", () => {
  expect(normalizeParameters("speech-2.8-hd", { text: "hello" })).toMatchObject(
    {
      output_format: "hex",
      stream: false,
      voice_setting: { voice_id: "male-qn-qingse" },
    },
  );
});
it.each([
  ["MiniMax-H3-Max", { content, resolution: "2K" }],
  ["MiniMax-H3-Max", { content, duration: 4 }],
  ["MiniMax-H3", { content, duration: 4.5 }],
  ["speech-2.8-hd", { text: "hello", voice_setting: { speed: 3 } }],
  ["image-01-live", { prompt: "hello", width: 1024, height: 1024 }],
  ["image-01", { prompt: "hello", width: 1024 }],
  [
    "image-01",
    { prompt: "hello", width: 1024, height: 1024, aspect_ratio: "1:1" },
  ],
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
    normalizeParameters("MiniMax-H3", { content: [...content, frame, ref] }),
  ).toThrow("cannot be mixed");
  expect(() =>
    normalizeParameters("MiniMax-H3-Max", { content: [...content, ref] }),
  ).toThrow("does not support");
  expect(() =>
    normalizeParameters("MiniMax-H3", {
      content: [...content, ...Array(10).fill(ref)],
    }),
  ).toThrow("Too many");
  expect(
    normalizeParameters("MiniMax-H3", { content: [...content, frame] }).ratio,
  ).toBe("adaptive");
  expect(() =>
    normalizeParameters("MiniMax-H3", {
      content: [...content, frame],
      ratio: "16:9",
    }),
  ).toThrow("adaptive");
});
it("rejects unknown model updates instead of silently opening them", () =>
  expect(() => contractFor("future-image")).toThrow("no validated"));

it("does not accept another provider’s model IDs", () => {
  expect(() => contractFor("seedream-5.0-lite")).toThrow("no validated");
});
