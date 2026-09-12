import { expect,it } from "vitest";
import {joinTextSources,sliceTextSources,timelineTextSource} from "../text-source-ranges";
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
it("keeps unknown streaming spans unlinked and declines ambiguous source transformations",()=>{
  const source=timelineTextSource({kind:"text",id:"merged",text:"same same",sourceRanges:[{start:0,end:4,runtimeStep:1},{start:5,end:9,runtimeStep:2,runtimeSeq:40}]});
  expect(source.sources).toEqual([{start:5,end:9,runtimeSeq:40}]);
  expect(sliceTextSources(source,"same")).toEqual([]);
  expect(sliceTextSources(source,"same same")).toEqual(source.sources);
});
