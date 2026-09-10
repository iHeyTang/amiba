import type { JobRelation } from "../remote.js";
function completeRelations(rows: Partial<JobRelation>[]): JobRelation[] {
  return rows.map(row => ({id:"job",recordId:row.id ?? "record",title:"",kind:"bash",status:"completed",startedAt:100,updatedAt:100,resultCallIds:[],...row}));
}
import {expect,it} from "vitest";
import {taskRows} from "./history.js";
it("keeps old and new runtime ids separate and overlays only the exact live instance",()=>{
  const rows=taskRows([{id:"bash-1",kind:"bash",status:"running",startedAt:3000}], completeRelations([
    {id:"bash-1",recordId:"old",status:"completed",startedAt:1000,title:"old"},
    {id:"bash-1",recordId:"new",status:"running",startedAt:3000,title:"new"},
  ]));
  expect(rows.map(row=>[row.id,row.status,row.title])).toEqual([["old","completed","old"],["new","running","new"]]);
});
