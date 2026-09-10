import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { JobResult, filePreview } from "./job-result.js";
afterEach(cleanup);
it("unwraps read's file protocol before passing Markdown to the shared renderer", () => {
  const renderer=vi.fn(text=><article>{text}</article>);
  render(<JobResult detail={{liveOutput:false,outputAvailable:true,sessionId:"s",id:"j",title:"Read",toolName:"read",output:"<path>/project/README.md</path>\n<type>file</type>\n<content>\n1: # Project\n2: Hello\n</content>"}} renderMarkdown={renderer}/>);
  expect(renderer).toHaveBeenCalledWith("# Project\nHello");
  expect(screen.getByText("README.md")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("<content>");
});
it("preserves terminal output literally, including Markdown and line numbers", () => {
  const renderer=vi.fn();
  render(<JobResult detail={{liveOutput:false,outputAvailable:true,sessionId:"s",id:"j",title:"Build",toolName:"bash",output:"1: # compiler output"}} renderMarkdown={renderer}/>);
  expect(screen.getByText("1: # compiler output").tagName).toBe("PRE");
  expect(renderer).not.toHaveBeenCalled();
});
it("does not strip arbitrary text that resembles an incomplete read envelope", () => {
  expect(filePreview("<path>example</path>\nnot a read result")).toBeUndefined();
});
