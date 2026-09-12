import {describe,it,expect,vi} from "vitest";
import {activateConnectionWork,inspectConnectionWork,type ConnectionWorkAccess} from "./connection-activation.js";
import type {McpAccessView} from "@amiba/dsh-plugin-mcp-manager";
const configuration=(recordId="a")=>({ownerId:"connector-core",recordId});
const row=(id="a"):McpAccessView=>({id,plugin:"provider",name:"tools",serviceId:"service",version:"1",audience:"ordinary-agents",tools:[],state:"approval-required",connections:[{id:"mcp-"+id,name:id,provider:"test",approvalToken:"token-"+id,configuration:configuration(id)}]});
function fixture(rows:McpAccessView[]){const access:ConnectionWorkAccess={list:vi.fn(async()=>rows),approve:vi.fn(async(id)=>{const item=rows.find(r=>r.id===id)!;item.state="ready";item.configuration=item.connections[0]!.configuration;item.connectionId=item.connections[0]!.id}),retry:vi.fn(async(id)=>{rows.find(r=>r.id===id)!.state="ready"})};return access}
const signal=()=>new AbortController().signal;
describe("unified connector activation",()=>{
 it("activates only this account's ordinary AI tools using exact approval tokens",async()=>{const rows=[row(),row("b"),{...row(),id:"other-plugin",audience:"plugin" as const}];const access=fixture(rows);expect(await activateConnectionWork(access,"a",signal())).toBe("ready");expect(access.approve).toHaveBeenCalledTimes(1);expect(access.approve).toHaveBeenCalledWith("a","mcp-a","token-a");});
 it("status reads do not grant access",async()=>{const access=fixture([row()]);expect(await inspectConnectionWork(access,"a")).toBe("unavailable");expect(access.approve).not.toHaveBeenCalled();});
 it("retries failed tools without requesting another approval",async()=>{const access=fixture([{...row(),configuration:configuration(),state:"error"}]);expect(await activateConnectionWork(access,"a",signal())).toBe("ready");expect(access.retry).toHaveBeenCalledWith("a");expect(access.approve).not.toHaveBeenCalled();});
 it("is idempotent after successful completion",async()=>{const access=fixture([row()]);await activateConnectionWork(access,"a",signal());await activateConnectionWork(access,"a",signal());expect(access.approve).toHaveBeenCalledTimes(1);});
 it("does not treat absent tools or another account as success",async()=>{expect(await inspectConnectionWork(undefined,"a")).toBe("unavailable");await expect(activateConnectionWork(fixture([row("b")]),"a",signal())).rejects.toThrow("connection_tools_unavailable");});
 it("reports tools still starting as pending",async()=>{const access=fixture([{...row(),configuration:configuration(),state:"connecting"}]);expect(await activateConnectionWork(access,"a",signal())).toBe("pending");expect(access.approve).not.toHaveBeenCalled();});
 it("does not approve after connection cancellation",async()=>{const controller=new AbortController();controller.abort();const access=fixture([row()]);await expect(activateConnectionWork(access,"a",controller.signal)).rejects.toThrow();expect(access.approve).not.toHaveBeenCalled();});
});
