import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChatMarkdown, MarkdownProvider } from "@amiba/markdown";

afterEach(cleanup);
it("preserves full-source inline-code positions across paragraphs in completed Markdown", () => {
  const source="Earlier `same.txt`\n\nA separate paragraph.\n\nFinal `same.txt`";
  const positions:{start:number;end:number}[]=[];
  const {container}=render(<ChatMarkdown mode="static" components={{inlineCode:({node,children}:any)=>{
    positions.push({start:node.position.start.offset,end:node.position.end.offset});
    return <code>{children}</code>;
  }}}>{source}</ChatMarkdown>);
  expect(container.querySelectorAll("code")).toHaveLength(2);
  const first=source.indexOf("`same.txt`"),last=source.lastIndexOf("`same.txt`");
  expect(positions).toContainEqual({start:first,end:first+"`same.txt`".length});
  expect(positions).toContainEqual({start:last,end:last+"`same.txt`".length});
});

import { WorkspaceMarkdown, WorkspaceInlineCode, WorkspaceTextMentionsContext } from "../workspace-file-links";
import { vi } from "vitest";

it("keeps unchanged source spans linkable through surrounding AST transforms", () => {
  const source="Final `file.txt`";
  const transform=()=> (tree:any)=> { tree.children.unshift({type:"paragraph",children:[{type:"text",value:"Inserted by plugin"}]}); };
  const resolve=vi.fn((_seq:number|undefined,value:string)=>({open:vi.fn(),title:value,label:"Produced file"}));
  const {container}=render(<MarkdownProvider extensions={[{id:"prefix",version:"1",remarkPlugins:[transform]}]}><WorkspaceTextMentionsContext.Provider value={resolve}><WorkspaceMarkdown mode="static" sources={[{start:0,end:source.length,runtimeSeq:12}]} components={{inlineCode:WorkspaceInlineCode}}>{source}</WorkspaceMarkdown></WorkspaceTextMentionsContext.Provider></MarkdownProvider>);
  expect(container.textContent).toContain("Inserted by plugin");
  expect(container.querySelector('[aria-label="Produced file"]')).not.toBeNull();
});
it("retains original message ownership when a plugin rewrites an anchored code value", () => {
  const source="Final `file.txt`";
  const transform=()=> (tree:any)=> { for(const paragraph of tree.children)for(const child of paragraph.children??[])if(child.type==="inlineCode")child.value="other.txt"; };
  const resolve=vi.fn(()=>({open:vi.fn(),title:"other.txt",label:"Rewritten file"}));
  const {container}=render(<MarkdownProvider extensions={[{id:"rewrite",version:"1",remarkPlugins:[transform]}]}><WorkspaceTextMentionsContext.Provider value={resolve}><WorkspaceMarkdown mode="static" sources={[{start:0,end:source.length,runtimeSeq:12}]} components={{inlineCode:WorkspaceInlineCode}}>{source}</WorkspaceMarkdown></WorkspaceTextMentionsContext.Provider></MarkdownProvider>);
  expect(container.textContent).toContain("other.txt");
  expect(container.querySelector('[aria-label="Rewritten file"]')).not.toBeNull();
  expect(resolve).toHaveBeenCalledWith(12,"other.txt",undefined);
});
it("recognizes padded multi-backtick code spans using CommonMark whitespace rules", () => {
  const source="Final `` file.txt ``";
  const resolve=vi.fn((_seq:number|undefined,value:string)=>({open:vi.fn(),title:value,label:"Produced file"}));
  const {container}=render(<WorkspaceTextMentionsContext.Provider value={resolve}><WorkspaceMarkdown mode="static" sources={[{start:0,end:source.length,runtimeSeq:12}]} components={{inlineCode:WorkspaceInlineCode}}>{source}</WorkspaceMarkdown></WorkspaceTextMentionsContext.Provider>);
  expect(container.querySelector('[aria-label="Produced file"]')).not.toBeNull();
  expect(resolve).toHaveBeenCalledWith(12,"file.txt",undefined);
});

it("does not invent source ownership for newly generated code without an original position", () => {
  const source="Final text";
  const transform=()=> (tree:any)=> {tree.children[0].children.push({type:"inlineCode",value:"generated.txt"});};
  const resolve=vi.fn(()=>({open:vi.fn(),title:"generated.txt",label:"Generated file"}));
  const {container}=render(<MarkdownProvider extensions={[{id:"generate",version:"1",remarkPlugins:[transform]}]}><WorkspaceTextMentionsContext.Provider value={resolve}><WorkspaceMarkdown mode="static" sources={[{start:0,end:source.length,runtimeSeq:12}]} components={{inlineCode:WorkspaceInlineCode}}>{source}</WorkspaceMarkdown></WorkspaceTextMentionsContext.Provider></MarkdownProvider>);
  expect(container.textContent).toContain("generated.txt");
  expect(container.querySelector('[aria-label="Generated file"]')).toBeNull();
  expect(resolve).not.toHaveBeenCalled();
});

it("keeps message ownership when a plugin reorders paragraphs with original positions", () => {
  const first="Earlier `old.txt`",last="Final `new.txt`",source=first+"\n\n"+last;
  const transform=()=> (tree:any)=> {tree.children.reverse();};
  const resolve=vi.fn((seq:number|undefined,value:string)=>seq===20?{open:vi.fn(),title:value,label:"Closing file"}:undefined);
  const {container}=render(<MarkdownProvider extensions={[{id:"reorder",version:"1",remarkPlugins:[transform]}]}><WorkspaceTextMentionsContext.Provider value={resolve}><WorkspaceMarkdown mode="static" sources={[{start:0,end:first.length,runtimeSeq:10},{start:first.length+2,end:source.length,runtimeSeq:20}]} components={{inlineCode:WorkspaceInlineCode}}>{source}</WorkspaceMarkdown></WorkspaceTextMentionsContext.Provider></MarkdownProvider>);
  expect(container.textContent?.indexOf("Final")).toBeLessThan(container.textContent!.indexOf("Earlier"));
  expect(container.querySelector('[aria-label="Closing file"]')?.textContent).toBe("new.txt");
  expect(container.querySelectorAll('[aria-label="Closing file"]')).toHaveLength(1);
});

it("replaces and removes same-named transforms during a live provider update", () => {
  const plugin = (label:string) => function sameName() {return (tree:any)=>{tree.children.push({type:"paragraph",children:[{type:"text",value:label}]});};};
  const first=plugin("First implementation"),second=plugin("Second implementation");
  const view=(extensions:any[])=><MarkdownProvider extensions={extensions}><ChatMarkdown mode="static">Original</ChatMarkdown></MarkdownProvider>;
  const {container,rerender}=render(view([{id:"live-transform",version:"1",remarkPlugins:[first]}]));
  expect(container.textContent).toContain("First implementation");
  rerender(view([{id:"live-transform",version:"1",remarkPlugins:[second]}]));
  expect(container.textContent).toContain("Second implementation");
  expect(container.textContent).not.toContain("First implementation");
  rerender(view([]));
  expect(container.textContent).toBe("Original");
});

it("keeps component state mounted during ordinary rerenders of an unchanged pipeline", () => {
  const mounted=vi.fn();
  function Code({children}:any){React.useEffect(()=>{mounted();},[]);return <code>{children}</code>;}
  const view=()=> <MarkdownProvider extensions={[]}><ChatMarkdown mode="static" components={{inlineCode:Code}}>Text `file.txt`</ChatMarkdown></MarkdownProvider>;
  const {rerender}=render(view());
  rerender(view());
  expect(mounted).toHaveBeenCalledTimes(1);
});
