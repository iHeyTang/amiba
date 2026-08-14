import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createManagedExtensionService, type ManagedExtensionService } from "./service"

const services: ManagedExtensionService[] = []

afterEach(async () => {
  await Promise.allSettled(services.splice(0).map((service) => service.close()))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "amiba-managed-extensions-"))
  const activations: string[] = []
  const service = createManagedExtensionService({
    root,
    hooks: {
      discover: async () => ({ tools: [], resources: [], resourceTemplates: [], prompts: [] }),
      validateCandidate: async () => {},
      activate: async ({ revision }) => { activations.push(revision.id) },
    },
  })
  services.push(service)
  const created = await service.create({
    name: "Calculator",
    request: "Build a simple calculator",
  })
  return { root, service, created, activations }
}

async function complete(
  service: ManagedExtensionService,
  extensionId: string,
  draftId: string,
  workspacePath: string,
  summary: string,
) {
  await mkdir(join(workspacePath, ".amiba"), { recursive: true })
  await writeFile(
    join(workspacePath, ".amiba", "result.json"),
    `${JSON.stringify({ status: "ready", summary })}\n`,
  )
  return service.buildDraft(extensionId, draftId)
}

describe("ManagedExtensionService", () => {
  it("returns the same Extension when the same create operation is retried", async () => {
    const { root, service } = await fixture()
    const request = {
      name: "Mortgage calculator",
      request: "Calculate monthly mortgage payments",
      operationId: "session-one:message-one:create-extension",
    }
    const [first, retry] = await Promise.all([
      service.create(request),
      service.create(request),
    ])

    expect(retry.extension.id).toBe(first.extension.id)
    expect(retry.draft.id).toBe(first.draft.id)
    expect(first.agentPrompt).toContain("amiba_preview_extension_draft")
    expect(first.agentPrompt).toContain(`\"extension_id\":\"${first.extension.id}\"`)
    expect(first.agentPrompt).toContain(`\"draft_id\":\"${first.draft.id}\"`)
    expect(first.agentPrompt).toContain(first.draft.workspacePath)
    expect((await service.list()).filter((app) => app.name === request.name)).toHaveLength(1)

    await rm(join(root, first.extension.id, "drafts", `${first.draft.id}.json`))
    const recovered = await service.create(request)
    expect(recovered.extension.id).not.toBe(first.extension.id)
    expect((await service.list()).filter((app) => app.name === request.name)).toHaveLength(1)
  })

  it("removes an unusable initial Extension when its Agent task is aborted", async () => {
    const { service, created } = await fixture()

    await expect(service.abortDraft(created.extension.id, created.draft.id, "Agent did not start"))
      .resolves.toBeNull()
    await expect(service.get(created.extension.id)).resolves.toBeNull()
    await expect(service.list()).resolves.toEqual([])
  })

  it("repairs a missing draft record on the next startup instead of staying creating", async () => {
    const { root, service, created } = await fixture()
    await service.close()
    await rm(join(root, created.extension.id, "drafts", `${created.draft.id}.json`))
    const restarted = createManagedExtensionService({ root })
    services.push(restarted)

    await restarted.init()

    await expect(restarted.get(created.extension.id)).resolves.toMatchObject({
      userStatus: "unavailable",
      lastError: expect.stringContaining("数据不完整"),
    })
    expect((await restarted.get(created.extension.id))?.pendingDraft).toBeUndefined()
  })

  it("marks an in-flight draft interrupted on restart instead of leaving it creating", async () => {
    const { root, service, created } = await fixture()
    await service.close()
    const restarted = createManagedExtensionService({ root })
    services.push(restarted)

    await restarted.init()

    await expect(restarted.get(created.extension.id)).resolves.toMatchObject({
      userStatus: "unavailable",
      pendingDraft: { id: created.draft.id, status: "failed" },
      lastError: expect.stringContaining("退出而中断"),
    })
  })

  it("builds an immutable revision and automatically applies a safe change", async () => {
    const { service, created, activations } = await fixture()
    const app = await complete(
      service,
      created.extension.id,
      created.draft.id,
      created.draft.workspacePath,
      "Calculator is ready",
    )

    expect(app.userStatus).toBe("ready")
    expect(app.activeRevision?.status).toBe("healthy")
    expect(app.latestChangeSummary).toBe("Calculator is ready")
    expect(activations).toEqual([app.activeRevision?.id])
    expect(
      JSON.parse(await readFile(join(created.draft.workspacePath, "..", "..", "project", "manifest.schema.json"), "utf8")),
    ).toMatchObject({ title: "Amiba managed Extension manifest" })
    expect(
      JSON.parse(await readFile(join(created.draft.workspacePath, "..", "..", "state.json"), "utf8")),
    ).toMatchObject({ activeRevisionId: app.activeRevision?.id })
  })

  it("builds and discovers a draft preview without submitting or activating it", async () => {
    const { service, created, activations } = await fixture()

    const preview = await service.prepareDraftPreview(
      created.extension.id,
      created.draft.id,
      { surfaceName: "main", runTests: true },
    )

    expect(preview).toMatchObject({
      extensionId: created.extension.id,
      draftId: created.draft.id,
      workspacePath: created.draft.workspacePath,
      surfaceName: "main",
      entry: "ui/index.html",
      capabilities: { tools: [], resources: [], resourceTemplates: [], prompts: [] },
    })
    expect(activations).toEqual([])
    await expect(service.get(created.extension.id)).resolves.toMatchObject({
      userStatus: "creating",
      pendingDraft: { id: created.draft.id, status: "editing" },
    })
    expect((await service.get(created.extension.id))?.activeRevisionId).toBeUndefined()
    await expect(
      service.prepareDraftPreview(created.extension.id, "draft-not-current"),
    ).rejects.toThrow("已不再是当前操作")
  })

  it("keeps the healthy revision active when an update fails", async () => {
    const { service, created } = await fixture()
    const healthy = await complete(
      service,
      created.extension.id,
      created.draft.id,
      created.draft.workspacePath,
      "First healthy version",
    )
    const change = await service.requestChange(created.extension.id, "Break the manifest")
    await writeFile(join(change.draft.workspacePath, "manifest.json"), "{}\n")
    const failed = await complete(
      service,
      created.extension.id,
      change.draft.id,
      change.draft.workspacePath,
      "Broken",
    )

    expect(failed.userStatus).toBe("update-failed")
    expect(failed.activeRevisionId).toBe(healthy.activeRevisionId)
    expect(failed.lastError).toBeTruthy()
  })

  it("requires confirmation for new permissions and supports rollback", async () => {
    const { service, created } = await fixture()
    const first = await complete(
      service,
      created.extension.id,
      created.draft.id,
      created.draft.workspacePath,
      "First",
    )
    const change = await service.requestChange(created.extension.id, "Add microphone capture")
    const manifestPath = join(change.draft.workspacePath, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.permissions = ["microphone"]
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const pending = await complete(
      service,
      created.extension.id,
      change.draft.id,
      change.draft.workspacePath,
      "Adds microphone capture",
    )

    expect(pending.userStatus).toBe("needs-confirmation")
    expect(pending.activeRevisionId).toBe(first.activeRevisionId)
    const confirmed = await service.confirm(created.extension.id, pending.candidateRevision!.id)
    expect(confirmed.activeRevision?.permissions).toEqual(["microphone"])
    const rolledBack = await service.rollback(created.extension.id)
    expect(rolledBack.activeRevisionId).toBe(first.activeRevisionId)
  })

  it("archives recoverably, restores the active revision, and exports source", async () => {
    const { root, service, created, activations } = await fixture()
    const healthy = await complete(
      service,
      created.extension.id,
      created.draft.id,
      created.draft.workspacePath,
      "Ready to export",
    )
    await service.updateMetadata(created.extension.id, { pinned: true, tags: ["finance", "personal"] })
    const archived = await service.archive(created.extension.id)
    expect(archived.archived).toBe(true)
    expect(await service.list()).toHaveLength(0)
    expect(await service.list({ includeArchived: true })).toHaveLength(1)

    const restored = await service.restore(created.extension.id)
    expect(restored.archived).toBe(false)
    expect(restored.activeRevisionId).toBe(healthy.activeRevisionId)
    expect(activations.at(-1)).toBe(healthy.activeRevisionId)

    const exportRoot = join(root, "exports")
    await mkdir(exportRoot)
    const destination = await service.exportProject(created.extension.id, exportRoot)
    expect(JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"))).toMatchObject({
      id: created.extension.id,
    })
    expect(JSON.parse(await readFile(join(destination, "amiba-export.json"), "utf8"))).toMatchObject({
      activeRevisionId: healthy.activeRevisionId,
    })
  })

  it("keeps Tool presets and Resource outputs under their Extension", async () => {
    const { service, created } = await fixture()
    const healthy = await complete(
      service,
      created.extension.id,
      created.draft.id,
      created.draft.workspacePath,
      "Ready",
    )
    const revisionId = healthy.activeRevisionId!
    await service.recordOutputs(created.extension.id, [{
      revisionId,
      uri: "report://latest",
      name: "Latest report",
      toolName: "main/create-report",
    }])
    await service.recordOutputs(created.extension.id, [{
      revisionId,
      uri: "report://latest",
      name: "Latest report",
      toolName: "main/create-report",
    }])
    expect(await service.listOutputs(created.extension.id)).toHaveLength(1)
    const [output] = await service.listOutputs(created.extension.id)
    expect(output).toMatchObject({ extensionId: created.extension.id, uri: "report://latest" })
    await expect(service.updateOutput(created.extension.id, output!.id, { pinned: true }))
      .resolves.toMatchObject({ pinned: true })

    const preset = await service.savePreset(created.extension.id, {
      revisionId,
      providerAlias: "main",
      toolName: "create-report",
      name: "Weekly",
      arguments: { range: "7d" },
    })
    await expect(service.listPresets(created.extension.id)).resolves.toMatchObject([
      { id: preset.id, name: "Weekly", arguments: { range: "7d" } },
    ])
    await service.deletePreset(created.extension.id, preset.id)
    await expect(service.listPresets(created.extension.id)).resolves.toEqual([])
  })
})
