import {
  MediaError,
  type MediaArtifactSource,
  type MediaExecution,
} from "@amiba/dsh-plugin-media/contracts";
import { sseData } from "./sse.js";
/** Assemble the provider stream once; never submit a second synthesis to recover it. */
export async function audioResponse(
  response: Response,
  body: Record<string, any>,
): Promise<MediaExecution> {
  let data: any;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    if (!response.body) throw new Error("Missing audio stream");
    const chunks: string[] = [];
    let complete = false;
    for await (const raw of sseData(response.body)) {
      if (raw === "[DONE]") break;
      const frame = JSON.parse(raw);
      if (frame.base_resp?.status_code)
        throw new MediaError(
          "SUBMISSION_UNKNOWN",
          `Audio stream error ${frame.base_resp.status_code}; do not resubmit`,
        );
      if (frame.data?.status === 2) {
        complete = true;
        data = frame;
        if (body.stream_options?.exclude_aggregated_audio) {
          if (frame.data.audio) chunks.push(frame.data.audio);
          data.data.audio = chunks.join("");
        }
      } else if (frame.data?.audio) chunks.push(frame.data.audio);
    }
    if (!complete)
      throw new MediaError(
        "SUBMISSION_UNKNOWN",
        "Audio stream ended without completion; do not resubmit",
      );
  } else data = await response.json();
  if (data.base_resp?.status_code)
    throw new MediaError(
      "SUBMISSION_UNKNOWN",
      `Audio response error ${data.base_resp.status_code}; do not resubmit`,
    );
  const value = data.data?.audio;
  const artifacts: MediaArtifactSource[] = [];
  if (body.output_format === "url") {
    if (typeof value !== "string" || !/^https?:\/\//.test(value))
      throw new Error("Missing audio URL");
    artifacts.push({ kind: "audio", url: value });
  } else {
    if (
      typeof value !== "string" ||
      !value.length ||
      value.length % 2 ||
      !/^[0-9a-f]+$/i.test(value)
    )
      throw new Error("Invalid hex audio");
    let bytes: Uint8Array = Buffer.from(value, "hex");
    const format = body.audio_setting?.format;
    if (format === "pcm" || format === "pcmu_raw")
      bytes = wave(
        bytes,
        body.audio_setting.sample_rate,
        body.audio_setting.channel ?? 1,
        format === "pcmu_raw",
      );
    artifacts.push({ kind: "audio", bytes });
  }
  if (data.data?.subtitle_file)
    artifacts.push({
      kind: "file",
      url: data.data.subtitle_file,
      mimeType: "application/json",
    });
  return { status: "succeeded", artifacts };
}
export function wave(
  input: Uint8Array,
  rate: number,
  channels: number,
  mulaw = false,
): Uint8Array {
  let pcm = Buffer.from(input);
  if (mulaw) {
    pcm = Buffer.alloc(input.length * 2);
    input.forEach((v, i) => {
      const n = ~v & 255;
      const t = (((n & 15) << 3) + 132) << ((n >> 4) & 7);
      pcm.writeInt16LE(n & 128 ? 132 - t : t - 132, i * 2);
    });
  }
  if (pcm.length % (channels * 2)) throw new Error("Incomplete PCM frame");
  const h = Buffer.alloc(44);
  h.write("RIFF");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
