import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChatMarkdown } from "@amiba/markdown";

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
