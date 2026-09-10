import { expect, it } from "vitest";
import { relation, JOBS_REMOTE } from "./remote.js";
it("rejects old sparse relation payloads instead of filling them in", () => {
  expect(relation.safeParse({id:"bash-1",title:"old",callId:"call"}).success).toBe(false);
  expect(relation.safeParse({id:"bash-1",recordId:"record",title:"current",kind:"bash",status:"completed",startedAt:1,finishedAt:2,updatedAt:2,resultCallIds:[]}).success).toBe(true);
});
it("requires current output availability flags", () => {
  const codec = JOBS_REMOTE.descriptors.find(row => row.method === "inspect")!.result;
  if (!("schema" in codec)) throw new Error("Expected strict result schema");
  const schema = codec.schema;
  expect(() => schema.parse({sessionId:"s",id:"j",title:"old",output:"text"})).toThrow();
});
