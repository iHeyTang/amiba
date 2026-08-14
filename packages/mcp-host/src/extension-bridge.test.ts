import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createManagedExtensionService } from "@amiba/managed-extensions"
import { describe, expect, it, vi } from "vitest"

import { createAmibaExtensionBridge } from "./extension-bridge"
import { createManagedMcpRuntime } from "./runtime"

describe("Amiba Extensions Hermes plugin bridge", () => {
  it("exposes and routes host-owned tools with native toolset metadata", async () => {
    const runtime = createManagedMcpRuntime()
    const bridge = createAmibaExtensionBridge(runtime, undefined, {
      tools: [
        {
          definition: {
            name: "amiba_browser_test",
            toolset: "browser",
            description: "Test the visible browser bridge.",
            inputSchema: {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
              additionalProperties: false,
            },
          },
          call: (args) => ({
            content: [{ type: "text", text: String(args.value) }],
            structuredContent: { value: args.value },
          }),
        },
      ],
    })

    try {
      expect(bridge.catalog().tools).toContainEqual(
        expect.objectContaining({ name: "amiba_browser_test", toolset: "browser" }),
      )
      await expect(
        bridge.call("amiba_browser_test", { value: "same visible session" }),
      ).resolves.toMatchObject({ structuredContent: { value: "same visible session" } })
    } finally {
      await runtime.close()
    }
  })

  it("lets an ordinary Agent create idempotently, inspect, preview, and cancel an Extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-extension-bridge-management-"))
    const runtime = createManagedMcpRuntime()
    const service = createManagedExtensionService({ root })
    await service.init()
    const previewDraft = vi.fn().mockResolvedValue({
      browser_opened: true,
      preview_url: "http://127.0.0.1:43124/ui/index.html",
    })
    const bridge = createAmibaExtensionBridge(runtime, service, { previewDraft })

    try {
      expect(bridge.catalog().tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "amiba_create_extension",
          "amiba_update_extension",
          "amiba_preview_extension_draft",
          "amiba_get_extension_status",
          "amiba_list_extensions",
          "amiba_cancel_extension_operation",
        ]),
      )
      expect(bridge.catalog().tools.every((tool) => tool.toolset === "extensions"))
        .toBe(true)

      const args = {
        name: "Mortgage calculator",
        request: "Calculate monthly mortgage payments",
        operation_id: "session-one:message-one:create-extension",
      }
      const first = await bridge.call("amiba_create_extension", args) as {
        structuredContent: { result: { extension: { id: string }; draft: { id: string }; agentPrompt: string } }
      }
      const retry = await bridge.call("amiba_create_extension", args) as typeof first
      const firstResult = first.structuredContent.result
      const retryResult = retry.structuredContent.result

      expect(retryResult.extension.id).toBe(firstResult.extension.id)
      expect(retryResult.draft.id).toBe(firstResult.draft.id)
      expect(firstResult.agentPrompt).toContain(firstResult.extension.id)
      expect(firstResult.agentPrompt).toContain("amiba_preview_extension_draft")

      await bridge.call("amiba_preview_extension_draft", {
        extension_id: firstResult.extension.id,
        draft_id: firstResult.draft.id,
        surface: "settings",
        run_tests: false,
      })
      expect(previewDraft).toHaveBeenCalledWith({
        extensionId: firstResult.extension.id,
        draftId: firstResult.draft.id,
        surfaceName: "settings",
        runTests: false,
      })

      const status = await bridge.call("amiba_get_extension_status", {
        extension_id: firstResult.extension.id,
      }) as { structuredContent: { result: { userStatus: string } } }
      expect(status.structuredContent.result.userStatus).toBe("creating")

      await bridge.call("amiba_cancel_extension_operation", {
        extension_id: firstResult.extension.id,
        draft_id: firstResult.draft.id,
      })
      await expect(service.list()).resolves.toEqual([])
    } finally {
      await service.close()
      await runtime.close()
    }
  })
})
