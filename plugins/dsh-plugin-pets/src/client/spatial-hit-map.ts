/** Read the just-rendered alpha buffer, so transparent corners remain click-through. */
export function createSpatialHitMap(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl");
  let pixels = new Uint8Array(0),
    width = 0,
    height = 0;
  let extent: { x: number; y: number; width: number; height: number } | null =
    null;
  return {
    update() {
      if (!gl || gl.isContextLost()) return;
      width = canvas.width;
      height = canvas.height;
      if (pixels.length !== width * height * 4)
        pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let left = width,
        right = -1,
        top = height,
        bottom = -1;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          if (pixels[((height - y - 1) * width + x) * 4 + 3] < 24) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      extent =
        right < left
          ? null
          : {
              x: left / width,
              y: top / height,
              width: (right - left + 1) / width,
              height: (bottom - top + 1) / height,
            };
    },
    bounds() {
      if (!extent) return null;
      const r = canvas.getBoundingClientRect();
      return {
        x: r.x + extent.x * r.width,
        y: r.y + extent.y * r.height,
        width: extent.width * r.width,
        height: extent.height * r.height,
      };
    },
    hitTest(clientX: number, clientY: number) {
      const r = canvas.getBoundingClientRect(),
        x = (clientX - r.x) / r.width,
        y = (clientY - r.y) / r.height;
      const column = Math.floor(x * width),
        row = Math.floor(y * height);
      const inside =
        column >= 0 &&
        column < width &&
        row >= 0 &&
        row < height &&
        pixels[((height - row - 1) * width + column) * 4 + 3] >= 24;
      return {
        region: inside ? "body" : "outside",
        point: { x: x * 2 - 1, y: y * 2 - 1 },
      };
    },
  };
}
