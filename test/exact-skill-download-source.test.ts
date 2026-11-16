import "reflect-metadata"
import assert from "node:assert/strict"
import test from "node:test"
import { Test } from "@nestjs/testing"
import { Code, ConnectError } from "@connectrpc/connect"
import { create } from "@bufbuild/protobuf"
import { ProjectsModule } from "../src/modules/projects/projects.module.js"
import { SkillsModule } from "../src/modules/skills/skills.module.js"
import * as tokens from "../src/common/tokens.js"
import * as wire from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { SkillDownloadHandles } from "../src/application/skill-download-handles.js"
import type { ExactSkillDownloadSource } from "../src/application/exact-skill-download.js"
import { projectSkillDownloadFact } from "../src/infrastructure/clients/platform/skill-product-response.js"
import { PlatformProjectionHttpClient } from "../src/infrastructure/clients/platform/projection-http.js"

const context = {
  requestId: "request",
  identity: { namespace: "tenant", userId: "human" },
}
const signal = new AbortController().signal
const config = {
  storageObjectOrigin: "https://objects.test",
  storage: { objectOrigin: "https://other.test" },
  platformProjection: {
    baseUrl: "https://platform.test",
    credentialFile: "/unused-test-credential",
    timeoutMs: 1000,
  },
  iamBaseUrl: "https://iam.test",
}

async function compose(owner: Function, token: symbol, values: Map<symbol, unknown>) {
  const providers = Reflect.getMetadata("providers", owner).filter((provider: { provide?: unknown }) => provider.provide === token)
  assert.equal(providers.length, 1)
  const module = await Test.createTestingModule({
    providers: [providers[0], ...[...values].map(([provide, useValue]) => ({ provide, useValue }))],
  }).compile()
  return { module, source: module.get<ExactSkillDownloadSource | null>(token) }
}

function skillValues(overrides: Array<[symbol, unknown]> = []) {
  return new Map<symbol, unknown>([
    [tokens.BFF_CONFIG, config],
    [tokens.SKILL_PRODUCT_CLIENT, {}],
    [tokens.SKILL_INSTALLATION_CLIENT, {}],
    [tokens.SKILL_SHARE_REPOSITORY, {}],
    [tokens.SKILL_DOWNLOAD_HANDLES, new SkillDownloadHandles()],
    ...overrides,
  ])
}
function projectValues(projects: unknown, installations: unknown, download: unknown = {}) {
  return new Map<symbol, unknown>([
    [tokens.BFF_CONFIG, config],
    [tokens.PROJECT_READ_LOOKUP, projects],
    [tokens.SKILL_INSTALLATION_CLIENT, installations],
    [tokens.SKILL_PACKAGE_INSPECTION_CLIENT, download],
    [tokens.SKILL_DOWNLOAD_HANDLES, new SkillDownloadHandles()],
  ])
}
function installation() {
  return create(wire.ProductSkillInstallationSchema, {
    installationId: { value: "install" },
    sourceRef: { value: "skill:exact" },
    seriesId: { value: "series" },
    revision: 7n,
    acquisitionKind: wire.SkillAcquisitionKind.UNKNOWN,
    installed: true,
    enabled: true,
    displayName: "Exact",
    sourceStatus: wire.SkillStatus.ACTIVE,
    installedAt: { seconds: 1n },
    updatedAt: { seconds: 1n },
    skillUpdatedAt: { seconds: 1n },
    categoryKeys: { keys: [] },
    examplePrompts: { prompts: [] },
    product: { stateVersion: 1n, publicationAudience: "catalog" },
  })
}
function download() {
  return create(wire.GetSkillPackageDownloadResponseSchema, {
    sourceRef: { value: "skill:exact" },
    revision: 7n,
    filename: "skill.zip",
    sizeBytes: 3n,
    contentSha256: "a".repeat(64),
    transferReference: {
      url: "https://objects.test/blob",
      method: "GET",
      requiredHeaders: {},
      expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
    },
  })
}
const notFound = (error: unknown) => error instanceof ConnectError && error.code === Code.NotFound

test("Nest exact download providers retain missing dependency/config null admission", async () => {
  for (const overrides of [
    [[tokens.SKILL_PRODUCT_CLIENT, null]],
    [[tokens.SKILL_INSTALLATION_CLIENT, null]],
    [[tokens.SKILL_SHARE_REPOSITORY, null]],
    [[tokens.BFF_CONFIG, { ...config, iamBaseUrl: undefined }]],
    [[tokens.BFF_CONFIG, { ...config, platformProjection: undefined }]],
  ] as Array<Array<[symbol, unknown]>>) {
    const { module, source } = await compose(SkillsModule, tokens.SKILL_EXACT_DOWNLOAD_SOURCE, skillValues(overrides))
    try {
      assert.equal(source, null)
    } finally {
      await module.close()
    }
  }
  for (const [installations, inspection] of [
    [null, {}],
    [{}, null],
  ]) {
    const { module, source } = await compose(ProjectsModule, tokens.PROJECT_EXACT_DOWNLOAD_SOURCE, projectValues({}, installations, inspection))
    try {
      assert.equal(source, null)
    } finally {
      await module.close()
    }
  }
})

test("Project source rechecks the admitted subject after owner resolution and rejects wrong projectRef", async () => {
  for (const wrongRef of [false, true]) {
    let reads = 0,
      downloads = 0
    const projects = {
      async find(scope: unknown, id: string) {
        assert.deepEqual(scope, { tenantId: "tenant", subjectId: "human" })
        assert.equal(id, "project")
        return ++reads === 1 ? { id: "project" } : null
      },
    }
    const installations = {
      async get(input: unknown, receivedSignal: AbortSignal) {
        assert.deepEqual(input, {
          requestId: "request",
          tenant: "tenant",
          subject: "human",
          projectRef: "project",
          installationId: "install",
        })
        assert.equal(receivedSignal, signal)
        return {
          projectRef: wrongRef ? "other" : "project",
          installation: installation(),
        }
      },
    }
    const inspection = {
      async downloadProject() {
        downloads++
        return download()
      },
    }
    const { module, source } = await compose(ProjectsModule, tokens.PROJECT_EXACT_DOWNLOAD_SOURCE, projectValues(projects, installations, inspection))
    try {
      await assert.rejects(
        source!.prepare(
          {
            kind: "project_installation",
            projectId: "project",
            installationId: "install",
          },
          context,
          signal,
          performance.now() + 10_000,
        ),
        wrongRef ? /skill_response_invalid/u : notFound,
      )
      assert.equal(reads, wrongRef ? 1 : 2)
      assert.equal(downloads, 0)
    } finally {
      await module.close()
    }
  }
})

test("managed source forwards lifetime and preserves owner 404 versus invalid/unavailable failures", async (t) => {
  let status = 404
  const deadline = performance.now() + 10_000
  t.mock.method(PlatformProjectionHttpClient.prototype, "readManagedPersonalSkill", async (...args: unknown[]) => {
    assert.deepEqual(args, ["managedSkill", "tenant", "human", "request", { skillId: "exact" }, signal, deadline])
    return { ok: false, status }
  })
  const { module, source } = await compose(SkillsModule, tokens.SKILL_EXACT_DOWNLOAD_SOURCE, skillValues())
  try {
    for (const [next, expected] of [
      [404, notFound],
      [502, /skill_response_invalid/u],
      [503, /skill_dependency_unavailable/u],
    ] as const) {
      status = next
      await assert.rejects(source!.prepare({ kind: "managed", versionId: "exact" }, context, signal, deadline), expected)
    }
  } finally {
    await module.close()
  }
})

test("active share uses exact inspection/download and configured primary object origin", async () => {
  let active = true,
    inspections = 0,
    downloads = 0
  const deadline = performance.now() + 10_000
  const product = {
    async inspect(input: unknown, receivedSignal: AbortSignal, receivedDeadline: number) {
      inspections++
      assert.deepEqual(input, {
        requestId: "request",
        tenant: "tenant",
        subject: "human",
        sourceRef: "skill:exact",
      })
      assert.equal(receivedSignal, signal)
      assert.equal(receivedDeadline, deadline)
      return create(wire.InspectSkillPackageResponseSchema, {
        sourceRef: { value: "skill:exact" },
        revision: 7n,
      })
    },
    async download(input: unknown, receivedSignal: AbortSignal, receivedDeadline: number) {
      downloads++
      assert.deepEqual(input, {
        requestId: "request",
        tenant: "tenant",
        subject: "human",
        sourceRef: "skill:exact",
      })
      assert.equal(receivedSignal, signal)
      assert.equal(receivedDeadline, deadline)
      return download()
    },
  }
  const shares = {
    async findActive(tenant: string, id: string) {
      assert.equal(tenant, "tenant")
      assert.equal(id, "share")
      return active ? { sourceRef: "skill:exact" } : null
    },
  }
  const { module, source } = await compose(
    SkillsModule,
    tokens.SKILL_EXACT_DOWNLOAD_SOURCE,
    skillValues([
      [tokens.SKILL_PRODUCT_CLIENT, product],
      [tokens.SKILL_SHARE_REPOSITORY, shares],
    ]),
  )
  try {
    const entry = await source!.prepare({ kind: "share", shareId: "share" }, context, signal, deadline)
    assert.equal(entry.binding.sourceRef, "skill:exact")
    assert.equal(entry.binding.revision, "7")
    active = false
    await assert.rejects(source!.confirm(entry.binding, context, signal, deadline), notFound)
    assert.equal(inspections, 1)
    assert.equal(downloads, 1)
  } finally {
    await module.close()
  }
})

test("both exact package wire responses share recursive known-wire and timestamp validation", () => {
  const personal = download()
  const project = create(wire.GetProjectSkillInstallationPackageDownloadResponseSchema, {
    sourceRef: personal.sourceRef,
    revision: personal.revision,
    filename: personal.filename,
    sizeBytes: personal.sizeBytes,
    contentSha256: personal.contentSha256,
    transferReference: {
      ...personal.transferReference!,
      expiresAt: { ...personal.transferReference!.expiresAt! },
    },
  })
  assert.deepEqual(projectSkillDownloadFact(personal), projectSkillDownloadFact(project))
  for (const response of [personal, project]) {
    response.transferReference!.$unknown = [{ no: 100, wireType: 0, data: new Uint8Array([1]) }]
    assert.throws(() => projectSkillDownloadFact(response), /skill_response_invalid/u)
    delete response.transferReference!.$unknown
    response.transferReference!.expiresAt!.nanos = 1_000_000_000
    assert.throws(() => projectSkillDownloadFact(response), /skill_response_invalid/u)
    response.transferReference!.expiresAt = undefined
    assert.throws(() => projectSkillDownloadFact(response), /skill_response_invalid/u)
  }
})
