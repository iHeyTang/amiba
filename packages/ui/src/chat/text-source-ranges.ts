import type { AssistantTimelineItem } from "@amiba/app-runtime/protocol";
export type TextSourceRange = {start:number;end:number;runtimeSeq:number};
export type SourcedText = {text:string;sources:TextSourceRange[]};
/** Translate only a uniquely identified contiguous slice; never match repeated prose by guess. */
export function sliceTextSources(original:SourcedText, displayed:string): TextSourceRange[] {
  if (!displayed) return [];
  const at=original.text.indexOf(displayed);
  if (at<0 || at!==original.text.lastIndexOf(displayed)) return [];
  return original.sources.flatMap(range=>{
    const start=Math.max(range.start,at),end=Math.min(range.end,at+displayed.length);
    return end>start?[{start:start-at,end:end-at,runtimeSeq:range.runtimeSeq}]:[];
  });
}
export function timelineTextSource(item:Extract<AssistantTimelineItem,{kind:"text"}>): SourcedText {
  return {text:item.text,sources:item.runtimeSeq!==undefined
    ? [{start:0,end:item.text.length,runtimeSeq:item.runtimeSeq}]
    : (item.sourceRanges??[]).flatMap(range=>range.runtimeSeq===undefined?[]:[{start:range.start,end:range.end,runtimeSeq:range.runtimeSeq}])};
}
export function joinTextSources(items:readonly SourcedText[], separator:string): SourcedText {
  let text="";const sources:TextSourceRange[]=[];
  items.forEach((item,index)=>{
    if(index)text+=separator;
    for(const range of item.sources)sources.push({...range,start:range.start+text.length,end:range.end+text.length});
    text+=item.text;
  });
  return {text,sources};
}
