import {expect,it} from "vitest";
import {commandOutput} from "./command-output.js";
it("separates the official footer from command output",()=>{
 expect(commandOutput("DONE\n[status: completed, exit code: 0]\n","completed")).toEqual({text:"DONE",exitCode:0});
 expect(commandOutput("error\n[status: failed, exit code: 2]","failed")).toEqual({text:"error",exitCode:2});
});
it("preserves interior status-like output, indentation, and unrecognized details",()=>{
 const text="  [status: completed, exit code: 0]\n\n  output";
 expect(commandOutput(text,"completed").text).toBe(text);
 expect(commandOutput("[status: running]","completed").text).toBe("[status: running]");
 expect(commandOutput("[status: failed, custom reason]","failed").text).toBe("[status: failed, custom reason]");
});
