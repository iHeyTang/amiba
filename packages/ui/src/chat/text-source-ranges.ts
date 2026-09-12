import { splitThinkingFromBody } from "./internal/helpers";
import type { AssistantTimelineItem } from "@amiba/app-runtime/protocol";
export type TextSourceRange = {start:number;end:number;runtimeSeq?:number;runtimeStep?:number};
export type SourcedText = {text:string;sources:TextSourceRange[]};
/** Translate only a uniquely identified contiguous slice; never match repeated prose by guess. */
export function sliceTextSources(original:SourcedText, displayed:string): TextSourceRange[] {
  if (!displayed) return [];
  const at=original.text.indexOf(displayed);
  if (at<0 || at!==original.text.lastIndexOf(displayed)) return [];
  return original.sources.flatMap(range=>{
    const start=Math.max(range.start,at),end=Math.min(range.end,at+displayed.length);
    return end>start?[{...range,start:start-at,end:end-at}]:[];
  });
}
export function timelineTextSource(item:Extract<AssistantTimelineItem,{kind:"text"}>): SourcedText {
  return {text:item.text,sources:item.runtimeSeq!==undefined
    ? [{start:0,end:item.text.length,runtimeSeq:item.runtimeSeq}]
    : (item.sourceRanges??[]).map(range=>({...range}))};
}
export function joinTextSources(items:readonly SourcedText[], separator:string): SourcedText {
  let text="";const sources:TextSourceRange[]=[];
  items.forEach((item,index)=>{
    if(index)text+=separator;
    for(const range of item.sources){
      const next={...range,start:range.start+text.length,end:range.end+text.length};
      const previous=sources.at(-1);
      if(previous && previous.runtimeSeq===next.runtimeSeq && previous.runtimeStep===next.runtimeStep && previous.end===next.start) sources[sources.length-1]={...previous,end:next.end};
      else sources.push(next);
    }
    text+=item.text;
  });
  return {text,sources};
}

function sliceAt(source:SourcedText,start:number,end:number):SourcedText {
  return {text:source.text.slice(start,end),sources:source.sources.flatMap(range=>{
    const from=Math.max(start,range.start),to=Math.min(end,range.end);
    return to>from?[{...range,start:from-start,end:to-start}]:[];
  })};
}
/** Follow the existing thinking extractor's exact retained slices and whitespace rules. */
export function thinkingBodySource(source:SourcedText):SourcedText {
  if(!source.text.includes("<"))return source;
  const slices:SourcedText[]=[];
  const {body}=splitThinkingFromBody(source.text,(start,end)=>slices.push(sliceAt(source,start,end)));
  let joined=joinTextSources(slices,"");
  const normalized:SourcedText[]=[];let at=0;
  for(const match of joined.text.matchAll(/\n{3,}/g)){
    normalized.push(sliceAt(joined,at,match.index!+2));
    at=match.index!+match[0].length;
  }
  normalized.push(sliceAt(joined,at,joined.text.length));
  joined=joinTextSources(normalized,"");
  const start=joined.text.length-joined.text.trimStart().length;
  const end=joined.text.trimEnd().length;
  const result=sliceAt(joined,start,Math.max(start,end));
  return result.text===body?result:{text:body,sources:[]};
}

/** Include historical draft provenance only for mapping, never as a display row. */
export function messageTextTimeline(message:{assistantTimeline?:readonly AssistantTimelineItem[];assistantDraftSource?:Extract<AssistantTimelineItem,{kind:"text"}>}):readonly AssistantTimelineItem[] {
  return message.assistantDraftSource ? [...(message.assistantTimeline??[]),message.assistantDraftSource] : message.assistantTimeline??[];
}
