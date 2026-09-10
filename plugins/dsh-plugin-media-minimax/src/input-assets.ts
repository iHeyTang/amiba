/** Local inline-asset checks only. Public URL contents still require upstream validation. */
export function validateInlineAssets(
  model: string,
  parameters: Record<string, unknown>,
): void {
  const serialized = JSON.stringify(parameters);
  if (Buffer.byteLength(serialized) > 64 * 1024 * 1024)
    throw new Error("Request body exceeds 64 MiB; use public asset URLs");
  const inspect = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(inspect);
      return;
    }
    if (v && typeof v === "object") {
      Object.values(v).forEach(inspect);
      return;
    }
    if (typeof v !== "string" || !v.startsWith("data:")) return;
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(v);
    if (!match) throw new Error("Invalid base64 data URL");
    const b = Buffer.from(match[2]!, "base64");
    if (
      !b.length ||
      b.toString("base64").replace(/=+$/, "") !== match[2]!.replace(/=+$/, "")
    )
      throw new Error("Invalid base64 asset");
    const mime = match[1]!;
    const cap = mime.startsWith("audio/")
      ? 15
      : mime.startsWith("video/")
        ? model.startsWith("MiniMax-H3")
          ? 50
          : 200
        : model.startsWith("image-")
          ? 10
          : model.startsWith("MiniMax-H3")
            ? 30
            : 20;
    if (b.length > cap * 1024 * 1024)
      throw new Error(`Inline asset exceeds ${cap} MiB`);
    if (mime === "image/png") {
      if (
        b.length < 33 ||
        !b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error("Invalid PNG header");
      const w = b.readUInt32BE(16),
        h = b.readUInt32BE(20);
      if (
        model.startsWith("MiniMax-H3") &&
        (w < 256 ||
          h < 256 ||
          w > 5760 ||
          h > 5760 ||
          w / h < 0.4 ||
          w / h > 2.5)
      )
        throw new Error(
          "MiniMax H3 input image dimensions are outside the model limits",
        );
    }
  };
  inspect(parameters);
}
