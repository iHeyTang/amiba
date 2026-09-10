import { audioResponse, wave } from "./audio-results.js";
import { normalizeParameters } from "./model-contracts.js";
import {
  MediaError,
  type MediaExecution,
  type MediaProvider,
  type MediaRequest,
  type MediaTaskReference,
} from "@amiba/dsh-plugin-media/contracts";
import {
  MEDIA_PROTOCOLS,
  parseProviderInventory,
  parseMediaCatalog,
  type ProtocolRoute,
} from "./protocols.js";
import { sseData } from "./sse.js";
export interface MediaConnection {
  baseURL: string;
  apiKey: string;
}
const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
function root(base: string): string {
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new MediaError("INVALID_REQUEST", "Invalid media gateway URL");
  return url.href.replace(/\/+$/, "").replace(/\/v1$/, "");
}
function route(id: string): ProtocolRoute {
  const result = MEDIA_PROTOCOLS.find((row) => row.id === id);
  if (!result)
    throw new MediaError(
      "INVALID_REQUEST",
      `Unsupported media protocol: ${id}`,
    );
  return result;
}
function audioMime(format: unknown): string {
  const formats: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    pcm: "audio/pcm",
    ogg_opus: "audio/ogg",
  };
  return formats[String(format ?? "mp3")] ?? "application/octet-stream";
}
export class TokenDanceMediaProvider implements MediaProvider {
  readonly id = "tokendance";
  constructor(
    private readonly connection: () => Promise<MediaConnection>,
    private readonly http: typeof fetch = fetch,
  ) {}
  async describe(signal?: AbortSignal) {
    const connection = await this.connection();
    const response = await this.http(`${root(connection.baseURL)}/v1/models`, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new MediaError(
        "UNAVAILABLE",
        `Media catalog HTTP ${response.status}`,
      );
    const body = await response.json();
    return {
      provider: this.id,
      name: "TokenDance",
      models: parseMediaCatalog(body),
      inventory: parseProviderInventory(body),
      protocols: MEDIA_PROTOCOLS.map(
        ({ id, operations, documentation, instructions }) => ({
          id,
          operations,
          documentation,
          instructions,
        }),
      ),
    };
  }
  private async request(
    path: string,
    signal: AbortSignal,
    body?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    const connection = await this.connection();
    let response: Response;
    try {
      response = await this.http(`${root(connection.baseURL)}${path}`, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(body ? 300000 : 30000),
        ]),
        headers: {
          Authorization: `Bearer ${connection.apiKey}`,
          "Content-Type": "application/json",
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new MediaError(
        body ? "SUBMISSION_UNKNOWN" : "UNAVAILABLE",
        body
          ? "Submission outcome is unknown. Do not automatically resubmit; a paid remote task may already exist."
          : "Could not query the remote media task. Retain its task reference and retry querying.",
      );
    }
    if (!response.ok) {
      const detail = (await response.text())
        .slice(0, 8000)
        .split(connection.apiKey)
        .join("[redacted]");
      throw new MediaError(
        response.status >= 500 && body
          ? "SUBMISSION_UNKNOWN"
          : response.status === 400 || response.status === 422
            ? "INVALID_REQUEST"
            : "PROVIDER_ERROR",
        `Media API HTTP ${response.status}: ${detail}`,
      );
    }
    return response;
  }
  async prepare(request: MediaRequest): Promise<MediaRequest> {
    try {
      const expected = request.model.startsWith("seedream")
        ? [
            "ark:image-generations",
            ...(request.model.endsWith("lite")
              ? ["openai:image-generations"]
              : []),
          ]
        : request.model.startsWith("seedance")
          ? ["seedance:generations"]
          : request.model.startsWith("minimax-h3")
            ? ["minimax:video_generation_v2"]
            : request.model.startsWith("minimax-speech")
              ? ["minimax:t2a_v2"]
              : request.model === "seed-tts-2.0"
                ? ["ark:tts"]
                : request.model.startsWith("kling")
                  ? [
                      request.model.endsWith("omni")
                        ? "kling:omni-video"
                        : request.parameters.contents
                          ? "kling:image2video"
                          : "kling:text2video",
                    ]
                  : request.model.startsWith("wan3")
                    ? ["wan3:video-synthesis"]
                    : ["happyhorse:video-synthesis"];
      if (
        !expected.includes(request.protocol) ||
        !route(request.protocol).operations.includes(request.operation)
      )
        throw new Error("Model, protocol and operation do not match");
      return {
        ...request,
        parameters: normalizeParameters(request.model, request.parameters),
      };
    } catch (error) {
      throw new MediaError(
        "INVALID_REQUEST",
        error instanceof Error ? error.message : "Invalid parameters",
      );
    }
  }
  async generate(
    request: MediaRequest,
    signal: AbortSignal,
  ): Promise<MediaExecution> {
    request = await this.prepare(request);
    const protocol = route(request.protocol);
    if (!protocol.operations.includes(request.operation))
      throw new MediaError(
        "INVALID_REQUEST",
        "Operation does not match protocol",
      );
    const body: Record<string, unknown> = {
      ...request.parameters,
      model: request.model,
    };
    const headers: Record<string, string> = {};
    if (protocol.result === "ark-audio") {
      delete (body as Record<string, unknown>).model;
      headers["X-Api-Resource-Id"] = request.model;
    }
    if (protocol.result === "kling-video") {
      delete body.model;
      body.model_name = request.model;
    }
    if (protocol.result === "alibaba-video")
      headers["X-DashScope-Async"] = "enable";
    const response = await this.request(protocol.path, signal, body, headers);
    try {
      if (protocol.result === "minimax-audio")
        return await audioResponse(response, body);
      if (protocol.result === "images" && body.stream)
        return await streamedImages(response);
      if (protocol.result === "ark-audio") {
        if (!response.body) throw new Error("Missing audio stream");
        const chunks: Buffer[] = [];
        let size = 0,
          complete = false;
        for await (const event of sseData(response.body)) {
          const frame = record(JSON.parse(event));
          if (frame.code === 20000000) {
            complete = true;
            break;
          }
          if (frame.code !== 0)
            throw new Error(`Speech synthesis error ${frame.code}`);
          if (typeof frame.data === "string") {
            const chunk = Buffer.from(frame.data, "base64");
            size += chunk.length;
            if (size > 128 * 1024 * 1024)
              throw new Error("Audio exceeds 128 MiB limit");
            chunks.push(chunk);
          }
        }
        if (!complete || !size)
          throw new Error("Incomplete speech synthesis stream");
        return {
          status: "succeeded",
          artifacts: [
            {
              kind: "audio",
              bytes:
                record(record(body.req_params).audio_params).format === "pcm"
                  ? wave(
                      Buffer.concat(chunks),
                      Number(
                        record(record(body.req_params).audio_params)
                          .sample_rate,
                      ),
                      1,
                    )
                  : Buffer.concat(chunks),
              mimeType: audioMime(
                record(record(body.req_params).audio_params).format,
              ),
            },
          ],
        };
      }
      const data = record(await response.json());
      if (
        record(data.base_resp).status_code &&
        record(data.base_resp).status_code !== 0
      )
        throw new MediaError(
          "PROVIDER_ERROR",
          `Provider error ${record(data.base_resp).status_code}`,
        );
      if (protocol.result === "images") {
        if (!Array.isArray(data.data) || !data.data.length)
          throw new Error("Missing generated images");
        const artifacts: Extract<
          MediaExecution,
          { status: "succeeded" }
        >["artifacts"] = [];
        const metadata: Record<string, unknown>[] = [];
        const warnings: string[] = [];
        for (const value of data.data) {
          const item = record(value);
          if (item.error) {
            warnings.push(
              "Some images failed; successful outputs are retained. Do not automatically resubmit.",
            );
            continue;
          }
          if (typeof item.b64_json === "string" && item.b64_json)
            artifacts.push({
              kind: "image",
              bytes: Buffer.from(item.b64_json, "base64"),
            });
          else if (typeof item.url === "string" && item.url)
            artifacts.push({ kind: "image", url: item.url });
          else {
            warnings.push(
              "An image result could not be decoded; do not automatically resubmit.",
            );
            continue;
          }
          metadata.push({
            artifact_index: artifacts.length - 1,
            ...Object.fromEntries(
              [
                "z_index",
                "name",
                "description",
                "bounding_box",
                "size",
                "output_format",
              ]
                .filter((k) => item[k] !== undefined)
                .map((k) => [k, item[k]]),
            ),
          });
        }
        if (!artifacts.length)
          throw new Error("No valid generated image result");
        if (body.layer_decomposition)
          artifacts.push({
            kind: "file",
            mimeType: "application/json",
            bytes: Buffer.from(
              JSON.stringify(
                { type: "image_layers", images: metadata },
                null,
                2,
              ),
            ),
          });
        return {
          status: "succeeded",
          artifacts,
          accounting: { ...(data.usage && typeof data.usage === "object" && !Array.isArray(data.usage) ? { usage: data.usage } : {}) },
          ...(warnings.length ? { warnings } : {}),
        };
      }
      const id =
        record(data.output).task_id ??
        record(data.data).id ??
        data.id ??
        data.task_id ??
        record(data.task).id ??
        record(data.task).task_id;
      if (typeof id !== "string" || !id)
        throw new Error("Missing remote task ID");
      return {
        status: "queued",
        task: { id, model: request.model, protocol: request.protocol },
      };
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError(
        "SUBMISSION_UNKNOWN",
        "The provider accepted the request but its result could not be decoded. Do not automatically repeat generation.",
      );
    }
  }
  async queryTask(
    task: MediaTaskReference,
    signal: AbortSignal,
  ): Promise<MediaExecution> {
    const protocol = route(task.protocol);
    if (!protocol.queryPath)
      throw new MediaError(
        "INVALID_REQUEST",
        "Protocol does not support task queries",
      );
    const response = await this.request(
      `${protocol.queryPath}${encodeURIComponent(task.id)}`,
      signal,
    );
    const payload = record(await response.json());
    if (protocol.result === "alibaba-video") {
      const output = record(payload.output);
      if (["PENDING", "RUNNING"].includes(output.task_status))
        return {
          status: output.task_status === "PENDING" ? "queued" : "running",
          task,
        };
      if (["FAILED", "CANCELED"].includes(output.task_status))
        return {
          status: "failed",
          message: String(output.message ?? output.task_status),
        };
      if (
        output.task_status === "SUCCEEDED" &&
        typeof output.video_url === "string"
      )
        return {
          status: "succeeded",
          artifacts: [{ kind: "video", url: output.video_url }],
        };
      throw new MediaError(
        "PROVIDER_ERROR",
        "Unknown Alibaba task state; retain task ID",
      );
    }
    if (protocol.result === "kling-video") {
      if (["submitted", "processing"].includes(payload.status))
        return {
          status: payload.status === "submitted" ? "queued" : "running",
          task,
        };
      if (payload.status === "failed")
        return {
          status: "failed",
          message: String(payload.message ?? "Remote video failed"),
        };
      const outputs = Array.isArray(payload.data)
        ? payload.data.flatMap((d: any) =>
            Array.isArray(d.outputs) ? d.outputs : [],
          )
        : [];
      const artifacts = outputs
        .filter((v: any) => v.type === "video" && typeof v.url === "string")
        .map((v: any) => ({ kind: "video" as const, url: v.url }));
      if (payload.status === "succeeded" && artifacts.length)
        return { status: "succeeded", artifacts };
      throw new MediaError(
        "PROVIDER_ERROR",
        "Unknown Kling task state; retain task ID",
      );
    }
    const data =
      protocol.result === "minimax-video" ? record(payload.task) : payload;
    const status = data.status;
    if (status === "queued" || status === "running") return { status, task };
    if (status === "failed" || status === "cancelled" || status === "expired")
      return { status, message: `Remote video task ${status}` };
    if (status === "succeeded") {
      const url =
        protocol.result === "minimax-video"
          ? record(data.content).url
          : record(data.content).video_url;
      if (typeof url !== "string" || !url)
        throw new MediaError(
          "PROVIDER_ERROR",
          "Completed task has no video URL",
        );
      return {
        status,
        artifacts: [
          { kind: "video", url },
          ...(typeof record(data.content).last_frame_url === "string"
            ? [
                {
                  kind: "image" as const,
                  url: record(data.content).last_frame_url,
                },
              ]
            : []),
        ],
      };
    }
    throw new MediaError(
      "PROVIDER_ERROR",
      `Unrecognized remote task status: ${String(status)}`,
    );
  }
}

async function streamedImages(response: Response): Promise<MediaExecution> {
  if (!response.body) throw new Error("Missing image stream");
  const artifacts: Extract<
    MediaExecution,
    { status: "succeeded" }
  >["artifacts"] = [];
  let complete = false;
  let usage: Record<string, unknown> | undefined;
  const warnings: string[] = [];
  try {
    for await (const raw of sseData(response.body)) {
      if (raw === "[DONE]") break;
      const event = JSON.parse(raw);
      if (event.type === "image_generation.completed") {
        complete = true;
        if (event.usage && typeof event.usage === "object" && !Array.isArray(event.usage)) usage = event.usage;
      }
      if (event.type === "image_generation.partial_failed")
        warnings.push(
          "One requested image failed; successful images are retained. Do not automatically resubmit.",
        );
      if (event.type === "image_generation.partial_succeeded") {
        if (event.b64_json)
          artifacts.push({
            kind: "image",
            bytes: Buffer.from(event.b64_json, "base64"),
          });
        else if (event.url) artifacts.push({ kind: "image", url: event.url });
      }
    }
  } catch {
    warnings.push(
      "Image stream interrupted; retained received images. Do not automatically resubmit.",
    );
  }
  if (!artifacts.length)
    throw new MediaError(
      "SUBMISSION_UNKNOWN",
      "Image stream incomplete; do not resubmit",
    );
  if (!complete)
    warnings.push(
      "Image stream has no completion event; output may be partial. Do not automatically resubmit.",
    );
  return {
    status: "succeeded",
    artifacts,
    accounting: { ...(usage ? { usage } : {}) },
    ...(warnings.length ? { warnings } : {}),
  };
}
