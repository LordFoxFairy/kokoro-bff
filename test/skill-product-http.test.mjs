import assert from "node:assert/strict"
import test from "node:test"
import { create } from "@bufbuild/protobuf"
import * as wire from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts"

test("Product mapper preserves unknown legacy facts as absent and bounds CAS", async () => {
  const module = await import("../src/infrastructure/clients/platform/skill-product-response.ts").catch(() => ({}))
  assert.equal(typeof module.projectSkillProductFacts, "function", "Product response mapper missing")
  const facts = create(wire.SkillProductFactsSchema, {
    publicationAudience: "owner",
    stateVersion: 9007199254740993n,
  })
  assert.deepEqual(module.projectSkillProductFacts(facts), {
    publication_audience: "owner",
    state_version: "9007199254740993",
  })
  assert.throws(() =>
    module.projectSkillProductFacts(
      create(wire.SkillProductFactsSchema, {
        publicationAudience: "tenant",
        stateVersion: 0n,
      }),
    ),
  )
  assert.throws(() =>
    module.projectSkillProductFacts(
      create(wire.SkillProductFactsSchema, {
        publicationAudience: "public",
        stateVersion: 1n,
      }),
    ),
  )
  facts.$unknown = [{ no: 100, wireType: 0, data: new Uint8Array([1]) }]
  assert.throws(() => module.projectSkillProductFacts(facts))
})

test("Product record mapper rejects package phases outside the public Skill record vocabulary", async () => {
  const { projectSkillProductRecord } = await import("../src/infrastructure/clients/platform/skill-product-response.ts")
  for (const packagePhase of [wire.SkillPackagePhase.UNSPECIFIED, wire.SkillPackagePhase.INTENT, 999]) {
    const record = create(wire.SkillProductRecordSchema, {
      skillId: { value: "skill-1" },
      sourceRef: { value: "skill:skill-1" },
      seriesId: { value: "series-1" },
      revision: 1n,
      status: wire.SkillStatus.ACTIVE,
      metadata: { displayName: "Skill", summary: "", examplePrompts: { prompts: [] }, categoryKeys: { keys: [] } },
      skillUpdatedAt: { seconds: 1n, nanos: 0 },
      product: { publicationAudience: "owner", stateVersion: 1n },
      packagePhase,
    })
    assert.throws(() => projectSkillProductRecord(record), /skill_response_invalid/u)
  }
})

test("Skill specification facade accepts the canonical public valid package phase", async () => {
  const { PlatformSkillSpecificationFacade } = await import("../src/infrastructure/clients/platform/skill-specification-facade.ts")
  const skill = create(wire.SkillProductRecordSchema, {
    skillId: { value: "skill-1" },
    sourceRef: { value: "skill:skill-1" },
    seriesId: { value: "series-1" },
    revision: 1n,
    status: wire.SkillStatus.ACTIVE,
    metadata: { displayName: "Skill", summary: "", examplePrompts: { prompts: [] }, categoryKeys: { keys: [] } },
    createdAt: { seconds: 1n, nanos: 0 },
    skillUpdatedAt: { seconds: 2n, nanos: 0 },
    ownerScope: { kind: "user", id: "user-1" },
    product: { publicationAudience: "owner", stateVersion: 1n },
    packagePhase: wire.SkillPackagePhase.VALIDATED,
  })
  const facade = new PlatformSkillSpecificationFacade({
    product: {
      current: async () => ({
        publication: {
          seriesId: { value: "series-1" },
          current: true,
          stateVersion: 1n,
          audience: "owner",
          currentVersion: skill,
          publishedAt: { seconds: 3n, nanos: 0 },
        },
      }),
      download: async () => {
        throw new Error("not used")
      },
    },
    installations: {
      list: async () => {
        throw new Error("not used")
      },
    },
    projection: {
      read: async () => {
        throw new Error("not used")
      },
    },
  })
  const current = await facade.current(
    "series-1",
    {
      requestId: "request-1",
      identity: { namespace: "tenant-1", userId: "user-1" },
    },
    new AbortController().signal,
    Date.now() + 1_000,
  )
  assert.equal(current.skill.package_phase, "valid")
})

import { once } from "node:events"
import { createLiveTestBffServer } from "./doubles/server.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
const productConfig = {
  host: "127.0.0.1",
  port: 4300,
  mode: "live",
  domain: "dev.kokoro.localhost",
  tenantId: "tenant",
  iamBaseUrl: null,
  sharedSecret: "secret",
  upstreamSecret: null,
  upstreamTimeoutMs: 100,
  upstreamMaxResponseBytes: 1048576,
  schedulerServiceToken: null,
  schedulerTargetUrl: null,
  agentEnabled: false,
  postgresUrl: null,
  redisUrl: null,
  agUi: DEFAULT_AGUI_CONFIG,
  upstreams: {},
  platformProjection: { baseUrl: null, credentialFile: null, timeoutMs: 100 },
  skillDraft: {
    enabled: false,
    platformBaseUrl: null,
    credentialFile: null,
    timeoutMs: 100,
  },
}
const headers = {
  authorization: "Bearer session",
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
  "content-type": "application/json",
  "idempotency-key": "product-draft-1",
}
test("Public Product draft route admits current human action then forwards exact CAS and explicit empty metadata", async () => {
  const calls = []
  const server = createLiveTestBffServer(productConfig, {
    sessionAdmission: new SessionAdmissionDouble({
      session: { namespace: "tenant", userId: "user" },
    }),
    skillAuthorization: {
      check: async (input) => {
        calls.push(["admit", input])
        return { ok: true }
      },
    },
    skillProductClient: {
      command: async (...args) => {
        calls.push(["command", ...args])
        throw new (await import("@connectrpc/connect")).ConnectError("missing", 5)
      },
    },
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/skills/skill-1/draft`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        expected_state_version: "9007199254740993",
        metadata: {
          display_name: "Name",
          summary: "",
          tags: [],
          example_prompts: [],
          category_keys: [],
        },
        clear_cover: false,
      }),
    })
    assert.equal(response.status, 404)
    assert.equal((await response.json()).error.code, "skill_not_found")
    assert.equal(calls[0][1].action, "update_draft")
    assert.equal(calls[1][1], "updateSkillDraft")
    assert.equal(calls[1][2].tenant, "tenant")
    assert.equal(calls[1][3].expected_state_version, "9007199254740993")
    assert.deepEqual(calls[1][3].metadata.example_prompts, { prompts: [] })
    assert.deepEqual(calls[1][3].metadata.category_keys, { keys: [] })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("Skills route uses the original admission budget and rejects an already expired stage before side effects", async () => {
  const { IncomingMessage, ServerResponse } = await import("node:http")
  const { Socket } = await import("node:net")
  const module = await import("../src/http/routes/skill-drafts.ts")
  assert.equal(typeof module.startSkillRequestBudget, "function")
  const request = new IncomingMessage(new Socket()),
    response = new ServerResponse(request)
  const deadline = module.startSkillRequestBudget(request, 10)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(module.startSkillRequestBudget(request, 10000), deadline, "later stages never renew admission budget")
  let calls = 0
  await module.runSkillRoute(
    request,
    response,
    {
      requestId: "request-1",
      identity: { namespace: "tenant", userId: "user" },
    },
    async () => {
      calls++
    },
  )
  assert.equal(calls, 0)
  assert.equal(response.statusCode, 503)
  request.socket.destroy()
})

test("IAM enrichment batches exact repeated publishers and represents missing without a guessed display name", async () => {
  const { createServer } = await import("node:http"),
    { IamPublisherProfileClient } = await import("../src/infrastructure/clients/iam-publisher-profile.ts")
  let calls = 0,
    mode = "missing"
  const owner = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk
    calls++
    assert.equal(request.headers.authorization, "Bearer session")
    assert.match(request.url, /\/tenant\//u)
    assert.deepEqual(JSON.parse(body), {
      refs: [{ kind: "user", id: "user-1" }],
    })
    const items =
      mode === "missing"
        ? [{ kind: "user", id: "user-1", status: "missing" }]
        : mode === "omit"
          ? []
          : [
              { kind: "user", id: "user-1", status: "missing" },
              { kind: "user", id: "user-1", status: "missing" },
            ]
    response.writeHead(200, {
      "content-type": "application/json",
      "x-request-id": "request-1",
      "cache-control": "no-store",
    })
    response.end(JSON.stringify({ data: { items } }))
  })
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const client = new IamPublisherProfileClient(`http://127.0.0.1:${owner.address().port}`, 1000),
      item = {
        product: {
          publisher: { kind: "iam", iam: { kind: "user", id: "user-1" } },
        },
      }
    const result = await client.enrich("tenant", "session", "request-1", [item, item], AbortSignal.timeout(2000))
    assert.equal(calls, 1)
    assert.deepEqual(result[0].publisher_profile, {
      kind: "user",
      id: "user-1",
      status: "missing",
    })
    assert.equal(result[0].publisher_profile.display_name, undefined)
    mode = "omit"
    await assert.rejects(client.enrich("tenant", "session", "request-1", [item], AbortSignal.timeout(2000)))
    mode = "duplicate"
    await assert.rejects(client.enrich("tenant", "session", "request-1", [item], AbortSignal.timeout(2000)))
  } finally {
    await new Promise((resolve) => owner.close(resolve))
  }
})

test("Installation real HTTP preserves owner response502 and browser input400", async (t) => {
  for (const fault of ["audience", "category", "metadata", "update", "valid", "input"])
    await t.test(fault, async () => {
      const timestamp = { seconds: 1n, nanos: 0 }
      const item = create(wire.ProductSkillInstallationSchema, {
        installationId: { value: "i" },
        sourceRef: { value: "skill:s" },
        seriesId: { value: "series" },
        revision: 1n,
        installed: true,
        enabled: true,
        installedAt: timestamp,
        updatedAt: timestamp,
        skillUpdatedAt: timestamp,
        displayName: "Name",
        summary: "",
        sourceStatus: wire.SkillStatus.ACTIVE,
        tags: fault === "metadata" ? [""] : [],
        examplePrompts: { prompts: [] },
        categoryKeys: { keys: fault === "category" ? ["bogus"] : [] },
        product: {
          publicationAudience: fault === "audience" ? "bogus" : "owner",
          stateVersion: 1n,
        },
        ...(fault === "update"
          ? {
              availableUpdate: {
                sourceRef: { value: "invalid" },
                revision: 2n,
              },
            }
          : {}),
      })
      let calls = 0
      const server = createLiveTestBffServer(productConfig, {
        sessionAdmission: new SessionAdmissionDouble({
          session: { namespace: "tenant", userId: "user" },
        }),
        skillAuthorization: { check: async () => ({ ok: true }) },
        personalInstallationClient: {
          list: async () => {
            calls++
            return { installations: [item], page: {} }
          },
        },
      })
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      try {
        const requestHeaders = { ...headers }
        delete requestHeaders["idempotency-key"]
        delete requestHeaders["content-type"]
        const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/skill-installations${fault === "input" ? "?enabled=bogus" : ""}`, {
          headers: requestHeaders,
        })
        assert.equal(response.status, fault === "valid" ? 200 : fault === "input" ? 400 : 502)
        if (!["valid", "input"].includes(fault)) assert.equal((await response.json()).error.code, "skill_installation_response_invalid")
        assert.equal(calls, fault === "input" ? 0 : 1)
      } finally {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      }
    })
})

test("P4 Public9 two optional query blocks remain exact and invert whole Public8.10", async () => {
  const { readFile } = await import("node:fs/promises"),
    { createHash } = await import("node:crypto"),
    { load } = await import("js-yaml")
  const { inspectSkillProductContract, stripSkillProductSource } = await import("../scripts/verify-skill-product-contract.mjs")
  const source = await readFile(new URL("../contract/tests/public11-historical.openapi.yaml", import.meta.url), "utf8"),
    document = load(source)
  assert.deepEqual(inspectSkillProductContract(source), [])
  assert.equal(createHash("sha256").update(stripSkillProductSource(source)).digest("hex"), "640f47f9c70341aa49934eec319a4dcc5bab76bba83e4407d6a9e0c3ab0ac389")
  for (const path of ["/v1/self/skills", "/v1/skill-installations"]) {
    const query = document.paths[path].get.parameters.filter((parameter) => parameter.name === "query")
    assert.equal(query.length, 1)
    assert.equal(query[0].required, false)
    assert.deepEqual(query[0].schema, { type: "string", minLength: 1, maxLength: 1024 })
    const offset = source.indexOf("  " + path + ":\n"),
      next = source.indexOf("\n  /", offset + 1),
      block = source.slice(offset, next)
    assert.ok(
      inspectSkillProductContract(source.replace(block, block.replace("maxLength: 1024", "maxLength: 1025"))).some((error) =>
        error.includes("exact closed block drifted"),
      ),
    )
  }
})

test("Product binary wrapper forwards transport request-id and keeps exact response integrity", async () => {
  const { createServer } = await import("node:http")
  const { once } = await import("node:events")
  const { randomUUID } = await import("node:crypto")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { SkillProductConnectClient } = await import("../src/infrastructure/clients/platform/skill-product-connect.ts")
  const wire = await import("../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts")
  const context = { requestId: "header-request", tenant: "tenant", subject: "user" }
  let mode = "valid"
  const seen = []
  const owner = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(wire.SkillCatalogService, {
          getSkillPackageUpload: (_request, rpcContext) => {
            const transportId = rpcContext.requestHeader.get("x-kokoro-request-id")
            seen.push(transportId)
            if (mode !== "missing-id") rpcContext.responseHeader.set("x-kokoro-request-id", mode === "wrong-id" ? "wrong-id" : (transportId ?? randomUUID()))
            if (mode !== "missing-cache") rpcContext.responseHeader.set("cache-control", mode === "wrong-cache" ? "public" : "no-store")
            return { stateVersion: 1n, skillId: { value: "skill" }, phase: wire.SkillPackagePhase.NONE, attemptEpoch: 0n }
          },
        })
      },
    }),
  )
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const client = new SkillProductConnectClient(
      `http://127.0.0.1:${owner.address().port}`,
      { get: async () => "catalog-token", retire() {} },
      { get: async () => "projection-token" },
      1000,
    )
    const signal = new AbortController().signal
    const invoke = () => client.getPackageUpload({ ...context, skillId: "skill" }, signal, performance.now() + 1000)
    await invoke()
    assert.equal(seen.at(-1), context.requestId)
    for (mode of ["missing-id", "wrong-id", "missing-cache", "wrong-cache"]) {
      await assert.rejects(invoke(), /skill_response_invalid/u)
      assert.equal(seen.at(-1), context.requestId)
    }
  } finally {
    owner.closeAllConnections()
    await new Promise((resolve) => owner.close(resolve))
  }
})
