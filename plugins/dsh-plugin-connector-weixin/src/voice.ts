/** Normalize the common Weixin SILK payload to mono PCM WAV for agent audio tools. */
export async function voiceToWav(data: Buffer): Promise<Buffer | undefined> {
  if (
    data.length > 2 * 1024 * 1024 ||
    !data.subarray(0, 16).toString().includes("#!SILK_V3")
  )
    return;
  try {
    const { decode, getDuration } = await import("silk-wasm");
    if (getDuration(data) > 180_000) return;
    const decoded = await decode(data, 24000);
    if (!decoded.data.length || decoded.data.length > 50 * 1024 * 1024 - 44)
      return;
    const result = Buffer.alloc(44 + decoded.data.length);
    result.write("RIFF", 0);
    result.writeUInt32LE(result.length - 8, 4);
    result.write("WAVEfmt ", 8);
    result.writeUInt32LE(16, 16);
    result.writeUInt16LE(1, 20);
    result.writeUInt16LE(1, 22);
    result.writeUInt32LE(24000, 24);
    result.writeUInt32LE(48000, 28);
    result.writeUInt16LE(2, 32);
    result.writeUInt16LE(16, 34);
    result.write("data", 36);
    result.writeUInt32LE(decoded.data.length, 40);
    result.set(decoded.data, 44);
    return result;
  } catch {
    return;
  }
}
