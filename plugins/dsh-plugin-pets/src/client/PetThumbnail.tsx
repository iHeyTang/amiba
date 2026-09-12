import { useEffect, useRef } from "react";
import { createSpatialRenderer, renderSpatial, dimensionOf } from "../mofli-capabilities.generated.js";
import { createSvgRenderer } from "@mofli/core/browser";
import type { PetConfig } from "@mofli/core";
import { registry } from "../model.js";

/** A single frame: wardrobe tiles never start their own animation loop. */
export function PetThumbnail({
  config,
  className = "h-20 w-full",
}: {
  config: PetConfig;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const pet = registry.create(config);
    if (dimensionOf(pet.engine) === "3d") {
      const renderer = createSpatialRenderer(ref.current);
      renderSpatial(renderer, pet, 0, true);
      // Tiles keep an image, not a WebGL context per library entry.
      if (renderer.element) {
        const image = new Image(); image.src = renderer.element.toDataURL();
        image.style.cssText = "width:100%;height:100%;object-fit:contain";
        renderer.destroy(); ref.current.replaceChildren(image);
      }
      return () => { renderer.destroy(); };
    }
    const renderer = createSvgRenderer(ref.current);
    renderer.render(pet.sample(0, true));
    const svg = renderer.svg;
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText =
      "display:block;width:100%;height:100%;pointer-events:none";
    const box = (svg.children[1] as SVGGraphicsElement | undefined)?.getBBox();
    if (box && box.width > 0 && box.height > 0) {
      const pad = Math.max(box.width, box.height) * 0.18;
      svg.setAttribute(
        "viewBox",
        `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`,
      );
    }
    return () => renderer.destroy();
  }, [config]);
  return <div ref={ref} className={`${className} rounded-lg dark:bg-white/10`} aria-hidden="true" />;
}
