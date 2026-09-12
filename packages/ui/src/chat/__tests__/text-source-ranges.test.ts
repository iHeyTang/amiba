import { expect,it } from "vitest";
import {joinTextSources,sliceTextSources,timelineTextSource,thinkingBodySource} from "../text-source-ranges";
it("preserves final attribution after the native result join and outer whitespace trim",()=>{
  const source=joinTextSources([
    timelineTextSource({kind:"text",id:"first",text:"  Earlier",runtimeSeq:10}),
    timelineTextSource({kind:"text",id:"last",text:"Final `file.txt`  ",runtimeSeq:20}),
  ],"\n\n");
  const displayed=source.text.trim();
  expect(displayed).toBe("Earlier\n\nFinal `file.txt`");
  expect(sliceTextSources(source,displayed)).toEqual([
    {start:0,end:7,runtimeSeq:10},{start:9,end:25,runtimeSeq:20},
  ]);
});
it("retains pending step identity for the owner to verify and declines ambiguous transformations",()=>{
  const source=timelineTextSource({kind:"text",id:"merged",text:"same same",sourceRanges:[{start:0,end:4,runtimeStep:1},{start:5,end:9,runtimeStep:2,runtimeSeq:40}]});
  expect(source.sources).toEqual([{start:0,end:4,runtimeStep:1},{start:5,end:9,runtimeStep:2,runtimeSeq:40}]);
  expect(sliceTextSources(source,"same")).toEqual([]);
  expect(sliceTextSources(source,"same same")).toEqual(source.sources);
});

it("follows thinking removal and newline cleanup without attributing removed text",()=>{
  const raw="  Start `one.txt`<think>secret `secret.txt`</think>\n\n\nEnd `two.txt`  ";
  const source=thinkingBodySource(timelineTextSource({kind:"text",id:"final",text:raw,runtimeSeq:40}));
  expect(source.text).toBe("Start `one.txt`\n\nEnd `two.txt`");
  expect(source.sources).toEqual([{start:0,end:source.text.length,runtimeSeq:40}]);
});
it("preserves distinct message boundaries through repeated thinking blocks",()=>{
  const source=thinkingBodySource(joinTextSources([
    timelineTextSource({kind:"text",id:"old",text:"Old `same.txt`<think>hidden</think>",runtimeSeq:10}),
    timelineTextSource({kind:"text",id:"new",text:"Final <reasoning>hidden</reasoning>`same.txt`",runtimeSeq:20}),
  ],""));
  expect(source.text).toBe("Old `same.txt`Final `same.txt`");
  expect(source.sources).toEqual([{start:0,end:14,runtimeSeq:10},{start:14,end:30,runtimeSeq:20}]);
});
