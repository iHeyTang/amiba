import { expect, it, vi } from "vitest";
vi.mock("@amiba/dsh-plugin-catalog", () => ({ registerToolSource: vi.fn() }));
vi.mock("@deepseek-ai/dsh-tools", () => ({
  defineTool: (tool: unknown) => tool,
}));
import { registerMediaTools, parseNativeParameters } from "./tools.js";
it("requires the full generation envelope, exposes calls with protocol, and separates recovery", async () => {
  const tools = new Map<string, any>();
  const generate = vi.fn().mockResolvedValue({ jobId: "one" });
  const resume = vi.fn();
  const media = {
    generate,
    resume,
    get: () => ({}),
    describe: async () => ({
      provider: "p",
      models: [
        {
          id: "m",
          protocols: ["native"],
          operations: ["image.generate"],
          parameterContract: { version: "1", schema: { type: "object" } },
        },
      ],
      protocols: [{ id: "native", operations: ["image.generate"] }],
    }),
  };
  registerMediaTools(
    {
      tools: { register: (tool: any) => tools.set(tool.name, tool) },
      systemPrompt: { context: vi.fn() },
    } as never,
    media as never,
  );
  const create = tools.get("media_generate");
  for (const key of [
    "provider",
    "model",
    "protocol",
    "operation",
    "parametersJson",
  ])
    expect(create.parameters[key].required).toBe(true);
  expect(create.parameters.resumeRecordId).toBeUndefined();
  const exec = {
    agent: { session: { id: "session" } },
    signal: new AbortController().signal,
  };
  const described = JSON.parse(
    (
      await tools
        .get("media_describe")
        .execute({ provider: "p", model: "m" }, exec)
    ).json,
  );
  const args = {
    ...described.generationCalls[0].arguments,
    parametersJson: '{"prompt":"cat"}',
  };
  expect(args.protocol).toBe("native");
  await create.execute(args, exec);
  expect(generate).toHaveBeenCalledWith(
    exec.agent,
    "p",
    {
      model: "m",
      protocol: "native",
      operation: "image.generate",
      parameters: { prompt: "cat" },
    },
    exec.signal,
  );
  await tools.get("media_resume").execute({ recordId: "original" }, exec);
  expect(resume).toHaveBeenCalledWith(exec.agent, "original");
  expect(generate).toHaveBeenCalledTimes(1);
});
it("rejects malformed native bodies before scheduling a job", () => {
  for (const value of ["{", "null", "[]", '"text"', "1"])
    expect(() => parseNativeParameters(value)).toThrow();
});
