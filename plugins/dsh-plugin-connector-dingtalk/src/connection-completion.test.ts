// @vitest-environment node
import {it,expect,vi} from "vitest";
import {DingtalkPersonalRemoteService} from "./index.js";
vi.mock("@deepseek-ai/dsh-typert-protocol",()=>({Remote:(_target:unknown,_key:unknown,descriptor:unknown)=>descriptor,TypertRemoteService:class{}}));
function fixture(){
 let state:any={modelAccess:false,user:{clientId:"client",userId:"corp:user",name:"User",accessToken:"token",refreshToken:"refresh",expiresAt:Date.now()+600000,refreshExpiresAt:Date.now()+600000,scope:[],generation:"original"}};
 const configuration={ownerId:"connector-core",recordId:"a"};
 let enabled=false;
 const access={list:vi.fn(async()=>[{id:"work",audience:"ordinary-agents",state:enabled?"ready":"approval-required",...(enabled?{configuration,connectionId:"app"}:{}),connections:[{id:"app",approvalToken:"reviewed",configuration}]}]),approve:vi.fn(async()=>{enabled=true}),retry:vi.fn()};
 const personal={status:vi.fn(async()=>({access:{identity:"user",state:"authorized",capabilities:[]},modelAccess:state.modelAccess})),accounts:{invalidate:vi.fn(),run:vi.fn(async(_id:string,op:any)=>op({state,signal:new AbortController().signal,updateState:async(mutate:any)=>{state=mutate(state)}}))}};
 const service={personal,setupContext:{reflect:{get:()=>({access})}}};
 const manage=(action:string)=>DingtalkPersonalRemoteService.prototype.manage.call(service as any,{action,connectionId:"a"} as any);
 return {access,personal,manage,state:()=>state,changeIdentity:()=>{state={...state,user:{...state.user,generation:"changed"}}}};
}
it("one completion enables both connection tools and model document access",async()=>{const h=fixture();const r=await h.manage("complete-connection");expect(h.access.approve).toHaveBeenCalledWith("work","app","reviewed");expect(r.status).toMatchObject({modelAccess:true,work:"ready"});expect(h.personal.accounts.invalidate).toHaveBeenCalledWith("a");});
it("opening status never grants tools or model access",async()=>{const h=fixture();await h.manage("status");expect(h.access.approve).not.toHaveBeenCalled();expect(h.state().modelAccess).toBe(false);});
it("does not mark completion when tool activation fails",async()=>{const h=fixture();h.access.approve.mockRejectedValueOnce(new Error("activation failed"));await expect(h.manage("complete-connection")).rejects.toThrow("activation failed");expect(h.state().modelAccess).toBe(false);});
it("does not transfer consent to a different personal authorization",async()=>{const h=fixture();h.access.approve.mockImplementationOnce(async()=>{h.changeIdentity()});await expect(h.manage("complete-connection")).rejects.toThrow("authorization_changed");expect(h.state().modelAccess).toBe(false);});
