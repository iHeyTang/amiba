import { audioResponse } from "./audio-results.js";
import { legacyVideoModels } from "./legacy-video-contracts.js";
import {
  contractFor,
  minimaxModels,
  normalizeParameters,
} from "./model-contracts.js";
import {
  MediaError,
  type MediaProvider,
  type MediaRequest,
  type MediaExecution,
  type MediaTaskReference,
} from "@amiba/dsh-plugin-media/contracts";
export interface Connection {
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
}
const routes = [
  {
    id: "minimax:video_generation",
    operation: "video.generate" as const,
    path: "/v1/video_generation",
    doc: "video-generation-t2v",
  },
  {
    id: "minimax:music_generation",
    operation: "audio.generate" as const,
    path: "/v1/music_generation",
    doc: "music-generation",
  },
  {
    id: "minimax:video_generation_v2",
    operation: "video.generate" as const,
    path: "/v2/video_generation",
    doc: "video-generation-v2-create",
  },
  {
    id: "minimax:t2a_v2",
    operation: "speech.synthesize" as const,
    path: "/v1/t2a_v2",
    doc: "speech-t2a-http",
  },
  {
    id: "minimax:image_generation",
    operation: "image.generate" as const,
    path: "/v1/image_generation",
    doc: "image-generation-t2i",
  },
];
const modelRoute = (model: string) =>
  routes.find(
    (r) =>
      r.id ===
      (legacyVideoModels.includes(model)
        ? "minimax:video_generation"
        : model.startsWith("music-")
          ? "minimax:music_generation"
          : model.startsWith("MiniMax-H3")
            ? "minimax:video_generation_v2"
            : model.startsWith("image-")
              ? "minimax:image_generation"
              : "minimax:t2a_v2"),
  )!;
export class MiniMaxMediaProvider implements MediaProvider {
  readonly id = "minimax-cn";
  constructor(
    private connection: () => Promise<Connection>,
    private http: typeof fetch = fetch,
  ) {}
  async describe() {
    await this.connection();
    return {
      provider: this.id,
      name: "MiniMax 中国",
      models: minimaxModels.map((id) => {
        const route = modelRoute(id);
        return {
          id,
          name: id,
          description:
            route.operation === "video.generate"
              ? "MiniMax 视频生成；输入模式与规格由该模型参数规则说明。"
              : route.operation === "image.generate"
                ? "MiniMax 图片生成。"
                : route.operation === "audio.generate"
                  ? "MiniMax 音乐生成，仅限官方允许的历史付费账号。"
                  : "MiniMax 文本转语音，支持音色、语速和发音设置。",
          protocols: [route.id],
          operations: [route.operation],
          parameterContract: contractFor(id),
        };
      }),
      protocols: routes.map((r) => ({
        id: r.id,
        operations: [r.operation],
        documentation: [
          `https://platform.minimax.cn/docs/api-reference/${r.doc}.md`,
        ],
        instructions:
          "Use model.parameterContract. Parameters are validated locally before a paid request. Complete inline data is preferred; video jobs are resumed by task ID.",
      })),
    };
  }
  async prepare(
    request: MediaRequest,
    signal: AbortSignal = AbortSignal.timeout(30000),
  ): Promise<MediaRequest> {
    if (
      !minimaxModels.includes(request.model) ||
      request.protocol !== modelRoute(request.model).id ||
      request.operation !== modelRoute(request.model).operation
    )
      throw new MediaError(
        "INVALID_REQUEST",
        "Unsupported MiniMax model route",
      );
    let parameters: Record<string, unknown>;
    try {
      parameters = normalizeParameters(request.model, request.parameters);
    } catch (e) {
      throw new MediaError(
        "INVALID_REQUEST",
        e instanceof Error ? e.message : "Invalid parameters",
      );
    }
    if (request.operation === "speech.synthesize") {
      const voices = await this.voices(signal);
      const ids = Array.isArray(parameters.timbre_weights)
        ? parameters.timbre_weights.map((v: any) => v.voice_id)
        : [(parameters.voice_setting as { voice_id: string }).voice_id];
      if (ids.some((id) => !voices.some((v) => v.voice_id === id)))
        throw new MediaError(
          "INVALID_REQUEST",
          "Voice is not available to this account. Use media_describe(provider, model) choices.voiceIds; no synthesis was submitted.",
        );
    }
    return { ...request, parameters };
  }
  async choices(model: string, signal: AbortSignal) {
    return model.startsWith("speech-")
      ? { voiceIds: await this.voices(signal) }
      : undefined;
  }
  private async voices(
    signal: AbortSignal,
  ): Promise<Array<{ voice_id: string; name?: string }>> {
    const data = await this.request(
      "/v1/get_voice",
      signal,
      { voice_type: "all" },
      false,
    );
    return ["system_voice", "voice_cloning", "voice_generation"].flatMap(
      (key) =>
        Array.isArray(data[key])
          ? data[key].flatMap((v: any) =>
              typeof v.voice_id === "string"
                ? [
                    {
                      voice_id: v.voice_id,
                      ...(typeof v.voice_name === "string"
                        ? { name: v.voice_name }
                        : {}),
                    },
                  ]
                : [],
            )
          : [],
    );
  }
  private async request(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    paid = !!body,
    raw = false,
  ) {
    const connection = await this.connection();
    let response: Response;
    try {
      response = await this.http(connection.baseURL + path, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(body ? 300000 : 30000),
        ]),
        headers: {
          ...connection.headers,
          Authorization: `Bearer ${connection.apiKey}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new MediaError(
        paid ? "SUBMISSION_UNKNOWN" : "UNAVAILABLE",
        body
          ? "Submission may have been accepted. Resume; do not generate again."
          : "Task query failed; retry the same task",
      );
    }
    if (!response.ok)
      throw new MediaError(
        paid && response.status >= 500
          ? "SUBMISSION_UNKNOWN"
          : [400, 422].includes(response.status)
            ? "INVALID_REQUEST"
            : "PROVIDER_ERROR",
        `MiniMax HTTP ${response.status}`,
      );
    if (raw) return response;
    let data: any;
    try {
      data = JSON.parse(
        (await response.text()).replace(
          /("(?:file_id|task_id)"\s*:\s*)(\d{16,})(?=\s*[,}])/g,
          '$1"$2"',
        ),
      );
    } catch {
      throw new MediaError(
        paid ? "SUBMISSION_UNKNOWN" : "PROVIDER_ERROR",
        "Invalid MiniMax response; do not repeat generation",
      );
    }
    if (data.base_resp?.status_code)
      throw new MediaError(
        data.base_resp.status_code === 2013
          ? "INVALID_REQUEST"
          : paid
            ? "SUBMISSION_UNKNOWN"
            : "PROVIDER_ERROR",
        `MiniMax error ${data.base_resp.status_code}`,
      );
    return data;
  }
  async generate(
    request: MediaRequest,
    signal: AbortSignal,
  ): Promise<MediaExecution> {
    request = await this.prepare(request, signal);
    if (["speech.synthesize", "audio.generate"].includes(request.operation)) {
      const response = await this.request(
        modelRoute(request.model).path,
        signal,
        { ...request.parameters, model: request.model },
        true,
        true,
      );
      try {
        return await audioResponse(response, request.parameters);
      } catch (e) {
        if (e instanceof MediaError) throw e;
        throw new MediaError(
          "SUBMISSION_UNKNOWN",
          "Audio accepted but response incomplete; do not resubmit",
        );
      }
    }
    const data = await this.request(modelRoute(request.model).path, signal, {
      ...request.parameters,
      model: request.model,
    });
    if (request.operation === "video.generate") {
      if (typeof data.task_id !== "string" || !data.task_id)
        throw new MediaError(
          "SUBMISSION_UNKNOWN",
          "Missing task ID; do not repeat generation",
        );
      return {
        status: "queued",
        task: {
          id: data.task_id,
          model: request.model,
          protocol: request.protocol,
        },
      };
    }
    const values =
      request.operation === "image.generate"
        ? request.parameters.response_format === "url"
          ? data.data?.image_urls
          : data.data?.image_base64
        : [data.data?.audio];
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.some((v) => typeof v !== "string" || !v.length)
    )
      throw new MediaError(
        "SUBMISSION_UNKNOWN",
        "Missing media data; do not repeat generation",
      );
    if (
      request.operation === "speech.synthesize" &&
      (!/^[a-f0-9]+$/i.test(values[0]) || values[0].length % 2)
    )
      throw new MediaError(
        "SUBMISSION_UNKNOWN",
        "Invalid hex audio; do not repeat generation",
      );
    return {
      status: "succeeded",
      artifacts: values.map((v: string) =>
        request.parameters.response_format === "url"
          ? { kind: "image" as const, url: v }
          : {
              kind:
                request.operation === "image.generate"
                  ? ("image" as const)
                  : ("audio" as const),
              bytes: Buffer.from(
                v,
                request.operation === "image.generate" ? "base64" : "hex",
              ),
            },
      ),
    };
  }
  async queryTask(
    task: MediaTaskReference,
    signal: AbortSignal,
  ): Promise<MediaExecution> {
    if (task.protocol === "minimax:video_generation") {
      const data = await this.request(
        "/v1/query/video_generation?task_id=" + encodeURIComponent(task.id),
        signal,
      );
      if (["Preparing", "Queueing", "Processing"].includes(data.status))
        return { status: "running", task };
      if (data.status === "Fail")
        return { status: "failed", message: "Remote video failed" };
      if (data.status !== "Success" || !data.file_id)
        throw new MediaError(
          "PROVIDER_ERROR",
          "Unknown legacy task state; retain task ID",
        );
      const file = await this.request(
        "/v1/files/retrieve?file_id=" +
          encodeURIComponent(String(data.file_id)),
        signal,
      );
      if (typeof file.file?.download_url !== "string")
        throw new MediaError(
          "PROVIDER_ERROR",
          "Missing video file URL; retain task ID",
        );
      return {
        status: "succeeded",
        artifacts: [{ kind: "video", url: file.file.download_url }],
      };
    }
    if (task.protocol !== "minimax:video_generation_v2")
      throw new MediaError("INVALID_REQUEST", "Unsupported task protocol");
    const data = await this.request(
      "/v2/query/video_generation/" + encodeURIComponent(task.id),
      signal,
    );
    const result = data.task;
    if (["queued", "running"].includes(result?.status))
      return { status: result.status, task };
    if (["failed", "cancelled", "expired"].includes(result?.status))
      return {
        status: result.status,
        message: `Remote video ${result.status}`,
      };
    if (
      result?.status === "succeeded" &&
      typeof result.content?.url === "string"
    )
      return {
        status: "succeeded",
        artifacts: [{ kind: "video", url: result.content.url }],
      };
    throw new MediaError(
      "PROVIDER_ERROR",
      "Unrecognized MiniMax task result; retain task ID",
    );
  }
}
