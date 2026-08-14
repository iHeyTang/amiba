import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createManagedExtensionService } from "@amiba/managed-extensions"
import type { ManagedExtensionRevision } from "@amiba/managed-extensions/types"
import { describe, expect, it } from "vitest"

import { createManagedMcpRuntime } from "./runtime"

describe("managed Extension integration", () => {
  it("builds, activates, renders, and recoverably removes a static MCP App", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-managed-integration-"))
    const runtime = createManagedMcpRuntime()
    const service = createManagedExtensionService({
      root,
      hooks: {
        discover: (input) => runtime.discover(input),
        validateCandidate: (input) => runtime.prepare(input).then(() => undefined),
        activate: (input) => runtime.activate(input),
        deactivate: (extensionId) => runtime.deactivate(extensionId),
        discardCandidate: (extensionId, revisionId) => runtime.discardPrepared(extensionId, revisionId),
      },
    })

    try {
      const created = await service.create({
        name: "Static report",
        request: "Create a reusable report",
      })
      await mkdir(join(created.draft.workspacePath, ".amiba"), { recursive: true })
      await writeFile(
        join(created.draft.workspacePath, ".amiba", "result.json"),
        JSON.stringify({ status: "ready", summary: "Report is ready" }),
      )

      const extension = await service.buildDraft(created.extension.id, created.draft.id)
      expect(extension.userStatus).toBe("ready")
      expect(runtime.listActive()).toHaveLength(1)
      await expect(service.surface(created.extension.id)).resolves.toMatchObject({
        extensionId: created.extension.id,
        mimeType: "text/html;profile=mcp-app",
      })

      await service.archive(created.extension.id)
      expect(runtime.listActive()).toHaveLength(0)
      await service.restore(created.extension.id)
      expect(runtime.listActive()).toHaveLength(1)
    } finally {
      await service.close()
      await runtime.close()
    }
  })

  it.skipIf(
    process.platform === "darwin" &&
      !!process.env.CODEX_SANDBOX &&
      process.env.AMIBA_TEST_RUNTIME_SANDBOX !== "1",
  )("discovers and calls a sandboxed bundled stdio MCP Tool", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "amiba-mcp-stdio-"))
    await writeFile(join(projectPath, "server.mjs"), `
      let buffer = "";
      const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf("\\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          const message = JSON.parse(line);
          if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } });
          else if (message.method === "ping") send({ jsonrpc: "2.0", id: message.id, result: {} });
          else if (message.method === "tools/list") send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } } }, annotations: { readOnlyHint: true } }] } });
          else if (message.method === "tools/call") send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: String(message.params.arguments.text) }] } });
        }
      });
    `)
    const runtime = createManagedMcpRuntime({
      resolveDataPath: (extensionId, revisionId, mode) =>
        join(projectPath, "data", extensionId, mode, revisionId),
    })
    const manifest = {
      schemaVersion: 1 as const,
      id: "io.amiba.personal.stdio-fixture",
      name: "Stdio fixture",
      kind: "tool-app" as const,
      runtime: "node" as const,
      mcp: { providers: [{ alias: "main", kind: "bundled" as const, runtime: "node" as const, entry: "server.mjs" }] },
      permissions: [],
    }
    try {
      const capabilities = await runtime.discover({
        extensionId: manifest.id,
        projectPath,
        manifest,
      })
      expect(capabilities.tools.map((tool) => tool.name)).toEqual(["main/echo"])
      const revision: ManagedExtensionRevision = {
        id: "rev-fixture",
        extensionId: manifest.id,
        sourceCommit: "fixture",
        bundleHash: "fixture",
        manifest,
        capabilities,
        permissions: [],
        dataSchemaVersion: 1,
        userRequest: "test",
        changeSummary: "test",
        risk: "safe",
        status: "healthy",
        createdAt: new Date().toISOString(),
      }
      await runtime.activate({ extensionId: manifest.id, revision, bundlePath: projectPath })
      await expect(runtime.callTool(manifest.id, "main", "echo", { text: "hello" }))
        .resolves.toMatchObject({ content: [{ type: "text", text: "hello" }] })
    } finally {
      await runtime.close()
    }
  })
})
