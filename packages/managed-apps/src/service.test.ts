import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createManagedAppService, type ManagedAppService } from "./service"

const services: ManagedAppService[] = []

afterEach(async () => {
  await Promise.allSettled(services.splice(0).map((service) => service.close()))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "amiba-managed-apps-"))
  const activations: string[] = []
  const service = createManagedAppService({
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
  service: ManagedAppService,
  appId: string,
  draftId: string,
  workspacePath: string,
  summary: string,
) {
  await mkdir(join(workspacePath, ".amiba"), { recursive: true })
  await writeFile(
    join(workspacePath, ".amiba", "result.json"),
    `${JSON.stringify({ status: "ready", summary })}\n`,
  )
  return service.buildDraft(appId, draftId)
}

describe("ManagedAppService", () => {
  it("builds an immutable revision and automatically applies a safe change", async () => {
    const { service, created, activations } = await fixture()
    const app = await complete(
      service,
      created.app.id,
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
    ).toMatchObject({ title: "Amiba managed Applet manifest" })
    expect(
      JSON.parse(await readFile(join(created.draft.workspacePath, "..", "..", "state.json"), "utf8")),
    ).toMatchObject({ activeRevisionId: app.activeRevision?.id })
  })

  it("keeps the healthy revision active when an update fails", async () => {
    const { service, created } = await fixture()
    const healthy = await complete(
      service,
      created.app.id,
      created.draft.id,
      created.draft.workspacePath,
      "First healthy version",
    )
    const change = await service.requestChange(created.app.id, "Break the manifest")
    await writeFile(join(change.draft.workspacePath, "manifest.json"), "{}\n")
    const failed = await complete(
      service,
      created.app.id,
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
      created.app.id,
      created.draft.id,
      created.draft.workspacePath,
      "First",
    )
    const change = await service.requestChange(created.app.id, "Add microphone capture")
    const manifestPath = join(change.draft.workspacePath, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.permissions = ["microphone"]
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const pending = await complete(
      service,
      created.app.id,
      change.draft.id,
      change.draft.workspacePath,
      "Adds microphone capture",
    )

    expect(pending.userStatus).toBe("needs-confirmation")
    expect(pending.activeRevisionId).toBe(first.activeRevisionId)
    const confirmed = await service.confirm(created.app.id, pending.candidateRevision!.id)
    expect(confirmed.activeRevision?.permissions).toEqual(["microphone"])
    const rolledBack = await service.rollback(created.app.id)
    expect(rolledBack.activeRevisionId).toBe(first.activeRevisionId)
  })

  it("archives recoverably, restores the active revision, and exports source", async () => {
    const { root, service, created, activations } = await fixture()
    const healthy = await complete(
      service,
      created.app.id,
      created.draft.id,
      created.draft.workspacePath,
      "Ready to export",
    )
    await service.updateMetadata(created.app.id, { pinned: true, tags: ["finance", "personal"] })
    const archived = await service.archive(created.app.id)
    expect(archived.archived).toBe(true)
    expect(await service.list()).toHaveLength(0)
    expect(await service.list({ includeArchived: true })).toHaveLength(1)

    const restored = await service.restore(created.app.id)
    expect(restored.archived).toBe(false)
    expect(restored.activeRevisionId).toBe(healthy.activeRevisionId)
    expect(activations.at(-1)).toBe(healthy.activeRevisionId)

    const exportRoot = join(root, "exports")
    await mkdir(exportRoot)
    const destination = await service.exportProject(created.app.id, exportRoot)
    expect(JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"))).toMatchObject({
      id: created.app.id,
    })
    expect(JSON.parse(await readFile(join(destination, "amiba-export.json"), "utf8"))).toMatchObject({
      activeRevisionId: healthy.activeRevisionId,
    })
  })

  it("keeps Tool presets and Resource outputs under their Applet", async () => {
    const { service, created } = await fixture()
    const healthy = await complete(
      service,
      created.app.id,
      created.draft.id,
      created.draft.workspacePath,
      "Ready",
    )
    const revisionId = healthy.activeRevisionId!
    await service.recordOutputs(created.app.id, [{
      revisionId,
      uri: "report://latest",
      name: "Latest report",
      toolName: "main/create-report",
    }])
    await service.recordOutputs(created.app.id, [{
      revisionId,
      uri: "report://latest",
      name: "Latest report",
      toolName: "main/create-report",
    }])
    expect(await service.listOutputs(created.app.id)).toHaveLength(1)
    const [output] = await service.listOutputs(created.app.id)
    expect(output).toMatchObject({ extensionId: created.app.id, uri: "report://latest" })
    await expect(service.updateOutput(created.app.id, output!.id, { pinned: true }))
      .resolves.toMatchObject({ pinned: true })

    const preset = await service.savePreset(created.app.id, {
      revisionId,
      providerAlias: "main",
      toolName: "create-report",
      name: "Weekly",
      arguments: { range: "7d" },
    })
    await expect(service.listPresets(created.app.id)).resolves.toMatchObject([
      { id: preset.id, name: "Weekly", arguments: { range: "7d" } },
    ])
    await service.deletePreset(created.app.id, preset.id)
    await expect(service.listPresets(created.app.id)).resolves.toEqual([])
  })
})
