/** Painted bounds of Mofli's flat SVG scene, including its user-space masks. */
export function visibleSvgBounds(svg: SVGSVGElement) {
  type Box = { x: number; y: number; width: number; height: number };
  const union = (a: Box | undefined, b: Box): Box => a ? ({ x: Math.min(a.x,b.x), y: Math.min(a.y,b.y),
    width: Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x),
    height: Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y) }) : b;
  const project = (node: SVGGraphicsElement, matrix: DOMMatrix): Box => {
    const b=node.getBBox();
    const points=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]]
      .map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
    const x=Math.min(...points.map(p=>p.x)), y=Math.min(...points.map(p=>p.y));
    return {x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
  };
  let result: Box | undefined;
  for (const node of Array.from(svg.children[1]?.children ?? []) as SVGGraphicsElement[]) {
    if (Number(node.getAttribute("opacity") ?? 1) <= 0) continue;
    const matrix=node.getScreenCTM(); if (!matrix) continue;
    let box=project(node,matrix);
    const maskId=node.getAttribute("mask")?.match(/url\(#([^)]*)\)/)?.[1];
    if (maskId) {
      const mask=svg.ownerDocument.getElementById(maskId);
      let clip: Box | undefined;
      for (const child of Array.from(mask?.children ?? []) as SVGGraphicsElement[]) {
        const fill=child.getAttribute("fill");
        if (fill === "black" || fill === "#000" || fill === "#000000" || Number(child.getAttribute("opacity") ?? 1) <= 0) continue;
        const transform=child.transform.baseVal.consolidate()?.matrix;
        clip=union(clip,project(child,transform ? matrix.multiply(transform) : matrix));
      }
      if (clip) {
        const x=Math.max(box.x,clip.x),y=Math.max(box.y,clip.y);
        box={x,y,width:Math.max(0,Math.min(box.x+box.width,clip.x+clip.width)-x),
          height:Math.max(0,Math.min(box.y+box.height,clip.y+clip.height)-y)};
      }
    }
    if (box.width>0 && box.height>0) result=union(result,box);
  }
  return result;
}
