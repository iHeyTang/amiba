import { expect, it } from "vitest";
import { encode, getWavFileInfo } from "silk-wasm";
import { voiceToWav } from "./voice.js";
it("decodes real SILK into a valid WAV using the packaged WASM codec", async () => {
  const pcm = Buffer.alloc((24000 * 2) / 5);
  for (let index = 0; index < pcm.length / 2; index++)
    pcm.writeInt16LE(
      Math.round(4000 * Math.sin((2 * Math.PI * 440 * index) / 24000)),
      index * 2,
    );
  const silk = await encode(pcm, 24000);
  const wav = await voiceToWav(Buffer.from(silk.data));
  expect(wav).toBeDefined();
  const info = getWavFileInfo(wav!);
  expect(info.fmt).toMatchObject({
    sampleRate: 24000,
    numberOfChannels: 1,
    bitsPerSample: 16,
  });
  expect(wav!.readUInt32LE(40)).toBe(wav!.length - 44);
});
it("leaves unsupported audio for the original-file fallback", async () => {
  expect(await voiceToWav(Buffer.from("not silk"))).toBeUndefined();
});
