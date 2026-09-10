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
        ? model.startsWith("minimax-h3")
          ? 50
          : 200
        : 30;
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
        model.startsWith("seedream") &&
        (w <= 14 || h <= 14 || w * h > 36000000 || w / h < 1 / 16 || w / h > 16)
      )
        throw new Error(
          "Seedream input image dimensions are outside the model limits",
        );
      if (
        model.startsWith("minimax-h3") &&
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
      if (
        parameters.background === "transparent" &&
        ![4, 6].includes(b[25]!) &&
        !b.includes(Buffer.from("tRNS"))
      )
        throw new Error(
          "Transparent output requires an input image with an alpha channel",
        );
    }
  };
  inspect(parameters);
}
