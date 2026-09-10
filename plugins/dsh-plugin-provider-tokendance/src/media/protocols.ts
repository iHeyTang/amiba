import { tokenDanceModels, contractFor } from "./model-contracts.js";
import type { MediaProtocol } from "@amiba/dsh-plugin-media/contracts";
export interface ProtocolRoute extends MediaProtocol {
  path: string;
  queryPath?: string;
  result:
    | "images"
    | "seedance"
    | "minimax-video"
    | "minimax-audio"
    | "ark-audio"
    | "kling-video"
    | "alibaba-video";
}
const docs = (slug: string) => [
  `https://tokendance.space/docs/protocol-${slug}.md`,
];
/** Transport routes; exact supported model parameters are advertised by the model contract. */
export const MEDIA_PROTOCOLS: ProtocolRoute[] = [
  ...["text2video", "image2video", "omni-video"].map((mode) => ({
    id: `kling:${mode}`,
    operations: ["video.generate" as const],
    path: `/kling/v1/${mode}`,
    queryPath: `/kling/v1/${mode}/`,
    result: "kling-video" as const,
    documentation: docs(`kling-${mode}`),
    instructions:
      "Use model parameterContract contents/settings. Save data.id and poll; never repeat an accepted POST.",
  })),
  ...["wan3", "happyhorse"].map((mode) => ({
    id: `${mode}:video-synthesis`,
    operations: ["video.generate" as const],
    path: `/alibaba/${mode}/v1/video-synthesis`,
    queryPath: `/alibaba/${mode}/v1/tasks/`,
    result: "alibaba-video" as const,
    documentation: docs(`${mode}-video-synthesis`),
    instructions:
      "Use native input/parameters and the model contract. Save output.task_id; poll the same task.",
  })),
  {
    id: "openai:image-generations",
    operations: ["image.generate"],
    path: "/v1/images/generations",
    result: "images",
    documentation: docs("openai-image-generations"),
    instructions:
      "Use the model parameterContract. The adapter supplies the model field.",
  },
  {
    id: "ark:image-generations",
    operations: ["image.generate"],
    path: "/ark/v3/images/generations",
    result: "images",
    documentation: docs("ark-image-generations"),
    instructions:
      "Supports reference images and model-specific group/layer outputs. Follow parameterContract for size, streaming and output mode.",
  },
  {
    id: "seedance:generations",
    operations: ["video.generate"],
    path: "/ark/v3/generations/tasks",
    queryPath: "/ark/v3/generations/tasks/",
    result: "seedance",
    documentation: docs("seedance-generations"),
    instructions:
      "Asynchronous generation. Read model-specific duration, reference roles, edit/extend and ratio constraints. Do not resubmit an accepted task.",
  },
  {
    id: "minimax:video_generation_v2",
    operations: ["video.generate"],
    path: "/minimax/v2/video_generation",
    queryPath: "/minimax/v2/query/video_generation/",
    result: "minimax-video",
    documentation: docs("minimax-video-generation-v2"),
    instructions:
      "Asynchronous generation using native content arrays. Read the documentation for reference roles and required ratio.",
  },
  {
    id: "minimax:t2a_v2",
    operations: ["speech.synthesize"],
    path: "/minimax/v1/t2a_v2",
    result: "minimax-audio",
    documentation: docs("minimax-t2a-v2"),
    instructions:
      "Use the model parameterContract for text, mixed voices, voice effects and audio format. The adapter assembles streaming audio and preserves subtitle files.",
  },
  {
    id: "ark:tts",
    operations: ["speech.synthesize"],
    path: "/ark/v3/tts/unidirectional",
    result: "ark-audio",
    documentation: docs("ark-tts"),
    instructions:
      "Use native req_params containing text, speaker and audio_params. The adapter supplies X-Api-Resource-Id and assembles the SSE audio.",
  },
];
export function parseMediaCatalog(body: unknown) {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data))
    throw new Error("Invalid TokenDance media directory");
  const seen = new Set<string>();
  return data.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      !row.id ||
      seen.has(row.id) ||
      !Array.isArray(row.supported_protocols)
    )
      return [];
    const routes = MEDIA_PROTOCOLS.filter((p) =>
      (row.supported_protocols as unknown[]).includes(p.id),
    );
    if (!routes.length || !tokenDanceModels.includes(row.id)) return [];
    seen.add(row.id);
    return [
      {
        id: row.id,
        name: typeof row.name === "string" ? row.name : row.id,
        ...(typeof row.description === "string" && row.description.trim()
          ? { description: row.description }
          : {}),
        parameterContract: contractFor(row.id),
        protocols: routes.map((p) => p.id),
        operations: [...new Set(routes.flatMap((p) => p.operations))],
      },
    ];
  });
}

/** Keep all directory entries visible without expanding executable media routes. */
export function parseProviderInventory(body: unknown) {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data))
    throw new Error("Invalid TokenDance model directory");
  const supported = new Map(
    parseMediaCatalog(body).map((model) => [model.id, model]),
  );
  const seen = new Set<string>();
  return data.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || seen.has(row.id)) return [];
    seen.add(row.id);
    return [
      supported.get(row.id) ?? {
        id: row.id,
        name: typeof row.name === "string" ? row.name : row.id,
        ...(typeof row.description === "string" && row.description.trim()
          ? { description: row.description }
          : {}),
        protocols: Array.isArray(row.supported_protocols)
          ? row.supported_protocols.filter(
              (p): p is string => typeof p === "string",
            )
          : [],
        supported:
          Array.isArray(row.supported_protocols) &&
          row.supported_protocols.some((p) =>
            [
              "openai:chat-completions",
              "openai:responses",
              "anthropic:messages",
            ].includes(String(p)),
          ),
        operations: [],
      },
    ];
  });
}
