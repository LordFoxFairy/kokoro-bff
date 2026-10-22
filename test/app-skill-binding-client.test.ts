import assert from "node:assert/strict"
import test from "node:test"
import { create } from "@bufbuild/protobuf"
import * as p from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { projectAppSkillBinding } from "../src/infrastructure/clients/platform/app-skill-binding-response.js"

function binding(status = p.SkillStatus.ACTIVE) {
  return create(p.AppSkillBindingSchema, {
    bindingId: "binding-1",
    seriesId: { value: "series-1" },
    skillId: { value: "exact-1" },
    revision: 1n,
    stateVersion: 2n,
    sourceStatus: status,
    createdAt: { seconds: 1n },
    updatedAt: { seconds: 3n },
    skill: {
      skillId: { value: "exact-1" },
      seriesId: { value: "series-1" },
      sourceRef: { value: "skill:exact-1" },
      revision: 1n,
      status,
      metadata: { displayName: "Exact App Skill", summary: "Description", examplePrompts: { prompts: [] }, categoryKeys: { keys: [] } },
      createdAt: { seconds: 1n },
      skillUpdatedAt: { seconds: 2n },
      product: { publicationAudience: "catalog", stateVersion: 1n },
      packagePhase: p.SkillPackagePhase.VALIDATED,
    },
  })
}
test("App binding projects exact binding facts and nullable current metadata without fabricating an installation or owner", () => {
  const source = binding()
  const fact = projectAppSkillBinding(source)
  assert.equal(fact.skill_id, "exact-1")
  assert.equal(fact.metadata?.name, "Exact App Skill")
  assert.equal(fact.state_version, "2")
  assert.equal(fact.removed_at, null)
  assert.equal(Object.hasOwn(fact, "installation_id"), false)
  assert.equal(Object.hasOwn(fact, "owner_scope"), false)
  source.skill = undefined
  source.sourceStatus = p.SkillStatus.DELETED
  assert.equal(projectAppSkillBinding(source).metadata, null)
  source.removedAt = { $typeName: "google.protobuf.Timestamp", seconds: 3n, nanos: 0 }
  assert.equal(projectAppSkillBinding(source).removed_at, "1970-01-01T00:00:03.000Z")
})
test("App binding rejects mismatched exact version/series, unavailable metadata, missing timestamps and unknown wire recursively", () => {
  const changes = [
    (value: p.AppSkillBinding) => {
      value.skill!.skillId!.value = "latest-other"
    },
    (value: p.AppSkillBinding) => {
      value.skill!.seriesId!.value = "other"
    },
    (value: p.AppSkillBinding) => {
      value.skill!.revision = 2n
    },
    (value: p.AppSkillBinding) => {
      value.sourceStatus = p.SkillStatus.WITHDRAWN
    },
    (value: p.AppSkillBinding) => {
      value.stateVersion = 0n
    },
    (value: p.AppSkillBinding) => {
      value.removedAt = { $typeName: "google.protobuf.Timestamp", seconds: 3n, nanos: 0 }
    },
    (value: p.AppSkillBinding) => {
      value.updatedAt = undefined
    },
    (value: p.AppSkillBinding) => {
      value.$unknown = [{ no: 100, wireType: 0, data: new Uint8Array([1]) }]
    },
    (value: p.AppSkillBinding) => {
      value.skill!.product!.$unknown = [{ no: 100, wireType: 0, data: new Uint8Array([1]) }]
    },
  ]
  for (const change of changes) {
    const value = binding()
    change(value)
    assert.throws(() => projectAppSkillBinding(value), /skill_response_invalid/)
  }
})

import { readFile } from "node:fs/promises"
import { projectAppSkillBindingCommand } from "../src/infrastructure/clients/platform/app-skill-binding-command.js"
test("App binding command matches all fixed owner RFC8785 vectors and binds exact App/subject/target/CAS but not correlation or key", async () => {
  const profile = JSON.parse(
    await readFile(
      new URL("../contract/vendor/kokoro-platform/451d0fb5a2df76f9050a685eef02782989d94cce/execution-operations/app-skill-binding-v1.json", import.meta.url),
      "utf8",
    ),
  )
  assert.equal(profile.request_digest.canonicalization, "RFC8785")
  for (const vector of profile.vectors) assert.equal(projectAppSkillBindingCommand(vector.input).sha256, vector.sha256)
  assert.throws(() => projectAppSkillBindingCommand({ ...profile.vectors[0].input, expected_binding_version: "00" }))
  assert.throws(() => projectAppSkillBindingCommand({ ...profile.vectors[0].input, requestId: "not-a-digest-member" }))
})

import { createServer } from "node:http"
import { once } from "node:events"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { AppSkillBindingConnectClient } from "../src/infrastructure/clients/platform/app-skill-binding-connect.js"
import { configureBffProtobufTextEncoding } from "../src/infrastructure/protobuf-text-encoding.js"
configureBffProtobufTextEncoding()
test("real Native peer receives trusted App/subject headers, exact version and CAS, isolated catalog/projection credentials and owner digest", async () => {
  const calls: { method: string; input: unknown; headers: Headers }[] = []
  let sourceStatus = p.SkillStatus.ACTIVE,
    ackVersion = 2n,
    replayed = false
  const currentBinding = () => {
    const value = binding(sourceStatus)
    value.stateVersion = ackVersion
    return value
  }
  const server = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(p.SkillCatalogService, {
          putAppSkillBinding(request, context) {
            calls.push({ method: "put", input: request, headers: context.requestHeader })
            context.responseHeader.set("x-kokoro-request-id", request.requestId)
            context.responseHeader.set("cache-control", "no-store")
            return { binding: currentBinding(), eventId: "event", replayed }
          },
          removeAppSkillBinding(request, context) {
            calls.push({ method: "remove", input: request, headers: context.requestHeader })
            context.responseHeader.set("x-kokoro-request-id", request.requestId)
            context.responseHeader.set("cache-control", "no-store")
            const removed = currentBinding()
            removed.skill = undefined
            removed.removedAt = { $typeName: "google.protobuf.Timestamp", seconds: 3n, nanos: 0 }
            return { binding: removed, eventId: "event-remove", replayed: false }
          },
        })
        router.service(p.ProductSkillReadService, {
          listAppSkillBindings(request, context) {
            calls.push({ method: "list", input: request, headers: context.requestHeader })
            context.responseHeader.set("x-kokoro-request-id", request.requestId)
            context.responseHeader.set("cache-control", "no-store")
            return { bindings: [currentBinding()], page: { nextCursor: "next-original-page" } }
          },
        })
      },
    }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const client = new AppSkillBindingConnectClient(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      { get: async () => "catalog-fixture" },
      { get: async () => "projection-fixture" },
      1000,
    )
    const context = { requestId: "native-app", tenant: "tenant", subject: "operator", appId: "registered-app" },
      signal = new AbortController().signal,
      deadline = performance.now() + 1000
    const put = await client.command("put", { ...context, commandId: "original-key" }, { target: "exact-1", expectedBindingVersion: "1" }, signal, deadline)
    assert.equal(put.binding.skill_id, "exact-1")
    const list = await client.list(context, { limit: 2, cursor: "original-page" }, signal, deadline)
    assert.equal(list.nextCursor, "next-original-page")
    await client.command("remove", { ...context, commandId: "remove-key" }, { target: "series-1", expectedBindingVersion: "1" }, signal, deadline)
    for (const call of calls) {
      assert.equal(call.headers.get("x-kokoro-app-id"), "registered-app")
      assert.equal(call.headers.get("x-kokoro-subject"), "operator")
      assert.equal(call.headers.get("authorization"), `Bearer ${call.method === "list" ? "projection" : "catalog"}-fixture`)
      assert.equal(Object.hasOwn(call.input as object, "productContext"), false)
    }
    const wire = calls[0].input as p.PutAppSkillBindingRequest
    assert.equal(wire.skillId?.value, "exact-1")
    assert.equal(wire.expectedBindingVersion, 1n)
    assert.equal(wire.command?.commandId, "original-key")
    assert.equal(
      wire.command?.requestDigest,
      projectAppSkillBindingCommand({
        tenantId: "tenant",
        subjectId: "operator",
        appId: "registered-app",
        operation: "skill.app_binding.put",
        target: "exact-1",
        expected_binding_version: "1",
      }).sha256,
    )
    assert.equal((calls[1].input as p.ListAppSkillBindingsRequest).page?.cursor, "original-page")
    sourceStatus = p.SkillStatus.DISABLED
    const disabledAck = await client.command(
      "put",
      { ...context, commandId: "disabled-key" },
      { target: "exact-1", expectedBindingVersion: "1" },
      signal,
      deadline,
    )
    assert.equal(disabledAck.binding.source_status, "disabled")
    assert.equal(disabledAck.binding.metadata?.name, "Exact App Skill")
    const disabledGet = await client.list(context, { limit: 2 }, signal, deadline)
    assert.equal(disabledGet.items[0]?.source_status, "disabled")
    assert.equal(disabledGet.items[0]?.metadata?.name, "Exact App Skill")
    for (const version of [1n, 3n]) {
      ackVersion = version
      await assert.rejects(
        client.command("put", { ...context, commandId: "bad-ack" }, { target: "exact-1", expectedBindingVersion: "1" }, signal, deadline),
        /skill_response_invalid/,
      )
    }
    ackVersion = 2n
    replayed = true
    assert.equal(
      (await client.command("put", { ...context, commandId: "original-replay" }, { target: "exact-1", expectedBindingVersion: "1" }, signal, deadline))
        .replayed,
      true,
    )
    const largeExpected = 9_007_199_254_740_993n
    ackVersion = largeExpected + 1n
    assert.equal(
      (
        await client.command(
          "put",
          { ...context, commandId: "large-ack" },
          { target: "exact-1", expectedBindingVersion: largeExpected.toString() },
          signal,
          deadline,
        )
      ).binding.state_version,
      ackVersion.toString(),
    )
    ackVersion = largeExpected + 2n
    await assert.rejects(
      client.command(
        "put",
        { ...context, commandId: "large-bad-ack" },
        { target: "exact-1", expectedBindingVersion: largeExpected.toString() },
        signal,
        deadline,
      ),
      /skill_response_invalid/,
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
