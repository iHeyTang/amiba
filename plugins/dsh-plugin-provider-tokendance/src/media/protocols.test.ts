import { expect, it } from "vitest";
import { parseMediaCatalog, parseProviderInventory } from "./protocols.js";
it("keeps unknown model updates non-executable even on implemented protocols", () => {
  expect(
    parseMediaCatalog({
      data: [
        { id: "new-version", supported_protocols: ["seedance:generations"] },
        { id: "new-version", supported_protocols: ["seedance:generations"] },
        {
          id: "unknown",
          description: "Generates amazing video",
          supported_protocols: ["unknown:video"],
        },
        { id: "chat", supported_protocols: ["openai:chat-completions"] },
      ],
    }),
  ).toEqual([]);
});

it("preserves provider descriptions and omits invalid metadata", () => {
  const rows = parseMediaCatalog({
    data: [
      {
        id: "seedream-5.0-lite",
        description: "Supports reference images.",
        supported_protocols: ["ark:image-generations"],
      },
      {
        id: "seedream-5.0-pro",
        description: 42,
        supported_protocols: ["ark:image-generations"],
      },
    ],
  });
  expect(rows[0]?.description).toBe("Supports reference images.");
  expect(rows[1]).not.toHaveProperty("description");
});

it("keeps unsupported and chat models in display inventory only", () => {
  const body = {
    data: [
      { id: "chat", supported_protocols: ["openai:responses"] },
      {
        id: "future",
        description: "Future video",
        supported_protocols: ["future:video"],
      },
      {
        id: "seedream-5.0-lite",
        supported_protocols: ["ark:image-generations"],
      },
    ],
  };
  expect(parseProviderInventory(body).map((row) => row.id)).toEqual([
    "chat",
    "future",
    "seedream-5.0-lite",
  ]);
  expect(parseProviderInventory(body)[1]).toMatchObject({
    description: "Future video",
    supported: false,
  });
  expect(parseMediaCatalog(body).map((row) => row.id)).toEqual([
    "seedream-5.0-lite",
  ]);
});
