import { expect, it } from "vitest";
import { createMarkdownSource } from "./markdown-source";
import type { SlotContributionEntry } from "./session-list-sources";
it("tracks plugin registration and disposal without a global singleton",()=>{
 let entries:SlotContributionEntry[]=[];
 let version=0;
 const source=createMarkdownSource({getVersion:()=>version,entriesOfSlot:()=>entries,subscribe:()=>()=>{}});
 const empty=source.getSnapshot();
 expect(source.getSnapshot()).toBe(empty);
 entries=[{options:{order:5},inject:()=>({extension:{id:"test",version:"1",plugins:{renderers:[{language:"chart",component:()=>null}]}}})}];version++;
 expect(source.getSnapshot()[0].id).toBe("test");
 entries=[];version++;
 expect(source.getSnapshot()).toEqual([]);
});
