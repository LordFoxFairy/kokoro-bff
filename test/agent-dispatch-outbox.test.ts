import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { describe, it } from "node:test"

import { AgentDispatchOutboxDispatcher } from "../dist/application/agent-dispatch-outbox-dispatcher.js"
import { ChatTurnApplicationService } from "../dist/application/chat-turn-service.js"
import { classifyAgentDispatchAttempt } from "../dist/infrastructure/clients/agent/outbox-delivery.js"
import type { AgentDispatchDeliveryPort } from "../dist/application/ports/agent-dispatch-delivery.js"
import type {
  AgentDispatchOutboxClaimInput,
  AgentDispatchOutboxRepository,
  CommitChatTurn,
} from "../dist/application/ports/agent-dispatch-outbox-repository.js"
import type { StableIdGenerator } from "../dist/application/ports/stable-id-generator.js"
import type { AgentDispatchCommand, AgentDispatchLease, AgentDispatchReceipt } from "../dist/domain/chat/agent-dispatch.js"

class Sha256TestIdGenerator implements StableIdGenerator {
  public generate(material: string): string {
    return createHash("sha256").update(material).digest("hex")
  }
}

class RecordingRepository implements AgentDispatchOutboxRepository {
  public readonly commits: CommitChatTurn[] = []
  public readonly claimInputs: AgentDispatchOutboxClaimInput[] = []
  public readonly events: string[] = []
  public claims: AgentDispatchCommand[] = []
  public admitted: AgentDispatchLease[] = []
  public unknown: Array<{ lease: AgentDispatchLease; delayMs: number; errorCode: string }> = []
  public notAdmitted: Array<{ lease: AgentDispatchLease; errorCode: string }> = []

  public async prepareChatTurnSelection(_input): Promise<import("../dist/application/ports/agent-dispatch-outbox-repository.js").ChatTurnSelection> {
    return { kind: "new", projectId: null, installationIds: [] }
  }

  public async commitChatTurn(command: CommitChatTurn): Promise<AgentDispatchReceipt> {
    this.commits.push(command)
    return {
      run_id: command.runId,
      user_message_id: command.userMessageId,
      assistant_message_id: command.assistantMessageId,
    }
  }

  public async claimAgentDispatchOutbox(input: AgentDispatchOutboxClaimInput): Promise<AgentDispatchCommand[]> {
    this.claimInputs.push(input)
    const claimed = this.claims.splice(0, input.limit)
    this.events.push(`claim:${claimed.map((item) => item.outboxId).join(",")}`)
    return claimed
  }

  public async markAgentDispatchAdmitted(lease: AgentDispatchLease): Promise<boolean> {
    this.admitted.push(lease)
    return true
  }

  public async markAgentDispatchUnknown(lease: AgentDispatchLease, delayMs: number, errorCode: string): Promise<boolean> {
    this.unknown.push({ lease, delayMs, errorCode })
    return true
  }

  public async markAgentDispatchNotAdmitted(lease: AgentDispatchLease, _delayMs: number, errorCode: string): Promise<boolean> {
    this.notAdmitted.push({ lease, errorCode })
    return true
  }
}

function command(attemptCount = 1, suffix = "fixture", leaseRemainingMs = 30_000): AgentDispatchCommand {
  return {
    tenantId: "tenant_fixture",
    outboxId: `agent_outbox_${suffix}`,
    conversationId: "conversation_fixture",
    conversationDispatchSeq: suffix === "second" ? "3" : "1",
    subjectId: "subject_fixture",
    actorId: "actor_fixture",
    requestId: "request_fixture",
    idempotencyKey: "chat-fixture",
    requestDigest: "a".repeat(64),
    runId: "run_fixture",
    userMessageId: "message_user_fixture",
    assistantMessageId: "message_assistant_fixture",
    identityAssertionRef: "bff:fixture",
    executionProjectRef: null,
    payload: {
      schema_version: 3,
      launch: {
        request_id: "request_fixture",
        run_id: "run_fixture",
        session_id: "conversation_fixture",
        feature_key: "chat",
        message_id: "message_user_fixture",
        content: "hello",
        project_ref: null,
        selected_skill_source_refs: [],
        trace: { source: "kokoro-bff" },
      },
    },
    status: "leased",
    attemptCount,
    admissionUnknownSeen: false,
    leaseOwner: "worker_fixture",
    leaseToken: "lease_fixture",
    leaseUntil: new Date("2099-01-01T00:00:00.000Z"),
    leaseRemainingMs,
    fence: 7,
  }
}

describe("durable Chat turn admission", () => {
  it("derives stable execution identities separately from the request digest", async () => {
    const repository = new RecordingRepository()
    const service = new ChatTurnApplicationService(repository, new Sha256TestIdGenerator())
    const input = {
      tenantId: "tenant_fixture",
      conversationId: "conversation_fixture",
      projectRef: "project_fixture",
      subjectId: "subject_fixture",
      actorId: "actor_fixture",
      requestId: "request_fixture",
      idempotencyKey: "chat-fixture",
      content: "hello",
      model: "default",
    }

    const first = await service.submit(input)
    const changed = await service.submit({ ...input, requestId: "request_retry", content: "changed" })

    assert.ok(first?.run_id.startsWith("run_bff_"))
    assert.equal(changed?.run_id, first?.run_id)
    assert.equal(repository.commits[0]?.runId, repository.commits[1]?.runId)
    assert.notEqual(repository.commits[0]?.requestDigest, repository.commits[1]?.requestDigest)
    assert.equal(repository.commits[0]?.payload.launch.message_id, first?.user_message_id)
    assert.equal(repository.commits[0]?.payload.launch.session_id, input.conversationId)
  })
})

it("inherits exact project defaults only for omitted selection and freezes the original request intent", async () => {
  const repository = new RecordingRepository()
  const preparations = []
  repository.prepareChatTurnSelection = async (input) => {
    preparations.push(input)
    return { kind: "new", projectId: "project_fixture", installationIds: ["installation_a"] }
  }
  const service = new ChatTurnApplicationService(repository, new Sha256TestIdGenerator())
  const input = {
    tenantId: "tenant_fixture",
    conversationId: "conversation_fixture",
    subjectId: "subject_fixture",
    actorId: "actor_fixture",
    requestId: "r",
    idempotencyKey: "k",
    content: "hello",
  }
  let resolved = 0
  const resolver = async (project, ids) => {
    resolved++
    assert.equal(project, "project_fixture")
    assert.deepEqual(ids, ["installation_a"])
    return ["skill:version_a"]
  }
  await service.submit(input, resolver)
  await service.submit({ ...input, selectedSkillSourceRefs: [] }, resolver)
  assert.equal(resolved, 1)
  assert.equal(preparations.length, 1)
  assert.deepEqual(repository.commits[0].payload.launch.selected_skill_source_refs, ["skill:version_a"])
  assert.deepEqual(repository.commits[0].skillSelection, { projectId: "project_fixture", installationIds: ["installation_a"] })
  assert.deepEqual(repository.commits[1].payload.launch.selected_skill_source_refs, [])
  assert.notEqual(repository.commits[0].requestDigest, repository.commits[1].requestDigest)
  repository.prepareChatTurnSelection = async () => ({
    kind: "replay",
    receipt: { run_id: "original", user_message_id: "original-user", assistant_message_id: "original-assistant" },
  })
  assert.equal(
    (
      await service.submit(input, async () => {
        throw Error("must not resolve replay")
      })
    ).run_id,
    "original",
  )
})

describe("Agent dispatch outbox worker", () => {
  it("settles a successful delivery with the full tenant and fence identity", async () => {
    const repository = new RecordingRepository()
    repository.claims = [command()]
    const delivery: AgentDispatchDeliveryPort = { deliver: async () => ({ outcome: "admitted" }) }
    const dispatcher = new AgentDispatchOutboxDispatcher(repository, delivery, { workerId: "worker_fixture" })

    assert.equal(await dispatcher.runOnce(), 1)
    assert.deepEqual(repository.admitted, [
      {
        tenantId: "tenant_fixture",
        outboxId: "agent_outbox_fixture",
        leaseOwner: "worker_fixture",
        leaseToken: "lease_fixture",
        fence: 7,
      },
    ])
    assert.equal(repository.unknown.length, 0)
    assert.equal(repository.notAdmitted.length, 0)
    assert.deepEqual(
      repository.claimInputs.map(({ limit, maxAttempts }) => ({ limit, maxAttempts })),
      [
        { limit: 1, maxAttempts: 8 },
        { limit: 1, maxAttempts: 8 },
      ],
    )
  })

  it("persists retry classification and bounded jitter", async () => {
    const repository = new RecordingRepository()
    repository.claims = [command()]
    const delivery: AgentDispatchDeliveryPort = {
      deliver: async () => ({ outcome: "unknown", errorCode: "agent_http_503" }),
    }
    const dispatcher = new AgentDispatchOutboxDispatcher(repository, delivery, {
      workerId: "worker_fixture",
      random: () => 0.5,
    })

    await dispatcher.runOnce()
    assert.equal(repository.unknown[0]?.delayMs, 500)
    assert.equal(repository.unknown[0]?.errorCode, "agent_http_503")
    assert.equal(repository.admitted.length, 0)
    assert.equal(repository.notAdmitted.length, 0)
  })

  it("paces an exhausted unknown admission at the 30 second cap without releasing the FIFO head", async () => {
    const repository = new RecordingRepository()
    repository.claims = [command(8)]
    const delivery: AgentDispatchDeliveryPort = {
      deliver: async () => ({ outcome: "unknown", errorCode: "agent_http_503" }),
    }
    const dispatcher = new AgentDispatchOutboxDispatcher(repository, delivery, {
      workerId: "worker_fixture",
      maxAttempts: 8,
    })

    await dispatcher.runOnce()
    assert.equal(repository.unknown.length, 1)
    assert.equal(repository.unknown[0]?.delayMs, 30_000)
    assert.equal(repository.unknown[0]?.errorCode, "agent_http_503")
    assert.deepEqual(repository.notAdmitted, [])
    assert.equal(repository.admitted.length, 0)
  })

  it("claims one command at a time and delivers it before claiming the next FIFO item", async () => {
    const repository = new RecordingRepository()
    repository.claims = [command(1), command(1, "second")]
    const delivery: AgentDispatchDeliveryPort = {
      deliver: async (claimed) => {
        repository.events.push(`deliver:${claimed.outboxId}`)
        return { outcome: "admitted" }
      },
    }
    const dispatcher = new AgentDispatchOutboxDispatcher(repository, delivery, {
      workerId: "worker_fixture",
      maxCommandsPerCycle: 2,
    })

    assert.equal(await dispatcher.runOnce(), 2)
    assert.deepEqual(repository.events, [
      "claim:agent_outbox_fixture",
      "deliver:agent_outbox_fixture",
      "claim:agent_outbox_second",
      "deliver:agent_outbox_second",
    ])
  })

  it("reserves settlement time from the database-clock lease budget", async () => {
    const repository = new RecordingRepository()
    repository.claims = [command(1, "fixture", 2500)]
    let timeoutBudgetMs = 0
    const delivery: AgentDispatchDeliveryPort = {
      deliver: async (_claimed, budget) => {
        timeoutBudgetMs = budget
        return { outcome: "admitted" }
      },
    }
    const dispatcher = new AgentDispatchOutboxDispatcher(repository, delivery, {
      workerId: "worker_fixture",
      leaseSettlementReserveMs: 500,
      monotonicNow: () => 100,
    })

    await dispatcher.runOnce()
    assert.equal(timeoutBudgetMs, 2000)
  })
})

describe("Agent dispatch HTTP classification", () => {
  it("accepts only a matching run/session receipt and keeps malformed 2xx admission unknown", () => {
    const leased = command()
    assert.deepEqual(
      classifyAgentDispatchAttempt(
        {
          kind: "response",
          status: 202,
          body: { data: { run_id: leased.runId, session_id: leased.conversationId, replayed: false }, meta: { request_id: "request_1" } },
        },
        leased,
      ),
      { outcome: "admitted" },
    )
    assert.deepEqual(
      classifyAgentDispatchAttempt(
        {
          kind: "response",
          status: 202,
          body: { data: { run_id: "other", session_id: leased.conversationId, replayed: false }, meta: { request_id: "request_1" } },
        },
        leased,
      ),
      { outcome: "unknown", errorCode: "agent_receipt_invalid" },
    )
    assert.deepEqual(classifyAgentDispatchAttempt({ kind: "response", status: 204, body: undefined }, leased), {
      outcome: "unknown",
      errorCode: "agent_receipt_invalid",
    })
  })

  it("distinguishes owner-declared non-admission from sticky unknown transport outcomes", () => {
    const leased = command()
    for (const status of [408, 425, 429, 500, 503]) {
      assert.equal(classifyAgentDispatchAttempt({ kind: "response", status, body: {} }, leased).outcome, "unknown")
    }
    for (const status of [400, 401, 403, 404, 409, 422]) {
      assert.equal(classifyAgentDispatchAttempt({ kind: "response", status, body: {} }, leased).outcome, "not_admitted")
    }
    assert.deepEqual(classifyAgentDispatchAttempt({ kind: "response", status: 503, body: { error: { code: "evil\nheader", message: "secret" } } }, leased), {
      outcome: "unknown",
      errorCode: "agent_http_503",
    })
    assert.deepEqual(classifyAgentDispatchAttempt({ kind: "transport", errorCode: "upstream_timeout" }, leased), {
      outcome: "unknown",
      errorCode: "upstream_timeout",
    })
    assert.deepEqual(classifyAgentDispatchAttempt({ kind: "transport", errorCode: "upstream_response_too_large" }, leased), {
      outcome: "unknown",
      errorCode: "upstream_response_too_large",
    })
  })
})

it("freezes ordered Skill selection in v3 payload and digest, rejecting old durable payloads", async () => {
  const { bindAgentDispatchPayloadProjectScope, buildAgentDispatchPayload, parseAgentDispatchPayload, agentDispatchRequestMaterial } =
    await import("../dist/domain/chat/agent-dispatch.js")
  const input = {
    tenantId: "tenant",
    conversationId: "conversation",
    subjectId: "subject",
    actorId: "actor",
    requestId: "request",
    idempotencyKey: "key",
    content: "hello",
  }
  const ids = { runId: "run", userMessageId: "message" }
  const empty = buildAgentDispatchPayload(input, ids)
  assert.equal(empty.schema_version, 3)
  assert.deepEqual(empty.launch.selected_skill_source_refs, [])
  assert.equal(empty.launch.project_ref, null)
  assert.equal(bindAgentDispatchPayloadProjectScope(empty, "project-canonical").launch.project_ref, "project-canonical")
  assert.notEqual(agentDispatchRequestMaterial(input), agentDispatchRequestMaterial({ ...input, selectedSkillSourceRefs: [] }))
  assert.equal(bindAgentDispatchPayloadProjectScope(empty, "project-canonical").launch.trace.project_ref, "project-canonical")
  assert.equal(
    Object.hasOwn(
      bindAgentDispatchPayloadProjectScope({ ...empty, launch: { ...empty.launch, trace: { ...empty.launch.trace, project_ref: "caller-slug" } } }, null).launch
        .trace,
      "project_ref",
    ),
    false,
  )
  const selected = { ...input, selectedSkillSourceRefs: ["skill:b", "skill:a"] }
  const payload = buildAgentDispatchPayload(selected, ids)
  assert.deepEqual(parseAgentDispatchPayload(JSON.parse(JSON.stringify(payload))), payload)
  assert.notEqual(agentDispatchRequestMaterial(selected), agentDispatchRequestMaterial({ ...selected, selectedSkillSourceRefs: ["skill:a", "skill:b"] }))
  for (const oldVersion of [1, 2]) assert.throws(() => parseAgentDispatchPayload({ ...payload, schema_version: oldVersion }), /PAYLOAD_INVALID/)
  for (const bad of [undefined, ["skill:a\n"], ["skill:a", "skill:a"]]) {
    assert.throws(() => parseAgentDispatchPayload({ ...payload, launch: { ...payload.launch, selected_skill_source_refs: bad } }), /PAYLOAD_INVALID/)
  }
  assert.throws(
    () => parseAgentDispatchPayload({ ...payload, launch: { ...payload.launch, trace: { source: "kokoro-bff", pinned_skills: [] } } }),
    /PAYLOAD_INVALID/,
  )
})

it("freezes exact MCP choice in launch rather than trace; empty choice retains the old digest", async () => {
  const { agentDispatchRequestMaterial, buildAgentDispatchPayload, parseAgentDispatchPayload } = await import("../dist/domain/chat/agent-dispatch.js")
  const input = {
    tenantId: "tenant",
    conversationId: "conversation",
    subjectId: "subject",
    actorId: "actor",
    requestId: "request",
    idempotencyKey: "key",
    content: "hello",
  }
  const legacy = JSON.stringify(["tenant", "conversation", null, "subject", "actor", "hello", null, null, null, null, null])
  assert.equal(agentDispatchRequestMaterial(input), legacy)
  assert.equal(agentDispatchRequestMaterial({ ...input, selectedMcpConnectionIds: [] }), legacy)
  const ids = ["connection-b", "connection-a"]
  const selected = { ...input, selectedMcpConnectionIds: ids }
  const material = agentDispatchRequestMaterial(selected)
  assert.notEqual(material, legacy)
  assert.notEqual(
    material,
    JSON.stringify(["tenant", "conversation", null, "subject", "actor", "hello", null, null, null, null, ids]),
    "old trace-only intent must not share new execution digest",
  )
  assert.notEqual(material, agentDispatchRequestMaterial({ ...selected, selectedMcpConnectionIds: [...ids].reverse() }))
  const payload = buildAgentDispatchPayload(selected, { runId: "run", userMessageId: "message" })
  ids.push("later-mutated-menu")
  assert.deepEqual(payload.launch.selected_mcp_connection_ids, ["connection-b", "connection-a"])
  assert.deepEqual(payload.launch.trace, { source: "kokoro-bff" })
  assert.deepEqual(parseAgentDispatchPayload(JSON.parse(JSON.stringify(payload))), payload)
  const historical = buildAgentDispatchPayload(input, { runId: "old-run", userMessageId: "old-message" })
  historical.launch.trace.mcp_servers = ["historical-diagnostic"]
  const parsedOld = parseAgentDispatchPayload(historical)
  assert.deepEqual(parsedOld.launch.trace.mcp_servers, ["historical-diagnostic"])
  assert.equal(parsedOld.launch.selected_mcp_connection_ids, undefined)
  for (const invalid of [["x", "x"], ["x\n"], [true], null]) {
    assert.throws(
      () => parseAgentDispatchPayload({ ...payload, launch: { ...payload.launch, selected_mcp_connection_ids: invalid } }),
      /AGENT_DISPATCH_PAYLOAD_INVALID/,
    )
  }
})

it("retains the original selected MCP IDs across a retry after unknown Agent admission", async () => {
  const repository = new RecordingRepository()
  const service = new ChatTurnApplicationService(repository, new Sha256TestIdGenerator())
  const ids = ["connection-1"]
  const input = {
    tenantId: "tenant",
    conversationId: "conversation",
    subjectId: "subject",
    actorId: "actor",
    requestId: "request",
    idempotencyKey: "key",
    content: "hello",
    selectedMcpConnectionIds: ids,
    selectedCustomApiProfiles: [{ profile_id: "api-one", expected_state_version: 3 }],
  }
  await service.submit(input)
  const saved = command(1)
  saved.payload = repository.commits[0].payload
  saved.executionProjectRef = null
  const requests: string[] = []
  const delivery: AgentDispatchDeliveryPort = {
    async deliver(current) {
      requests.push(JSON.stringify(current.payload.launch))
      return requests.length === 1 ? { outcome: "unknown", errorCode: "transport_unknown" } : { outcome: "admitted" }
    },
  }
  const dispatcher = new AgentDispatchOutboxDispatcher(repository, delivery, { workerId: "worker_fixture", maxClaimsPerTick: 1 })
  repository.claims = [saved]
  await dispatcher.runOnce()
  assert.equal(repository.unknown.length, 1)
  ids[0] = "connection-2"
  input.selectedCustomApiProfiles[0].expected_state_version = 4
  repository.claims = [{ ...saved, attemptCount: 2 }]
  await dispatcher.runOnce()
  assert.equal(repository.admitted.length, 1)
  assert.equal(requests[0], requests[1])
  assert.deepEqual(JSON.parse(requests[1]).selected_mcp_connection_ids, ["connection-1"])
  assert.deepEqual(JSON.parse(requests[1]).selected_custom_api_profiles, [{ profile_id: "api-one", expected_state_version: 3 }])
})

it("snapshots MCP intent before awaiting project Skill defaults so the digest and payload cannot diverge", async () => {
  const repository = new RecordingRepository()
  let entered
  let resume
  const preparing = new Promise<void>((resolve) => {
    entered = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    resume = resolve
  })
  repository.prepareChatTurnSelection = async () => {
    entered()
    await blocked
    return { kind: "new", projectId: null, installationIds: [] }
  }
  const service = new ChatTurnApplicationService(repository, new Sha256TestIdGenerator())
  const input = {
    tenantId: "tenant",
    conversationId: "conversation",
    subjectId: "subject",
    actorId: "actor",
    requestId: "request",
    idempotencyKey: "key",
    content: "hello",
    selectedMcpConnectionIds: ["connection-1"],
  }
  const submitting = service.submit(input)
  await preparing
  input.selectedMcpConnectionIds[0] = "connection-2"
  resume()
  await submitting
  assert.deepEqual(repository.commits[0].payload.launch.selected_mcp_connection_ids, ["connection-1"])
})

it("freezes Custom API profile versions with stable legacy empty digest and rejects malformed durable references", async () => {
  const { agentDispatchRequestMaterial, buildAgentDispatchPayload, parseAgentDispatchPayload } = await import("../dist/domain/chat/agent-dispatch.js")
  const input = {
    tenantId: "tenant",
    conversationId: "conversation",
    subjectId: "subject",
    actorId: "actor",
    requestId: "request",
    idempotencyKey: "key",
    content: "hello",
  }
  const ids = { runId: "run", userMessageId: "message" }
  assert.equal(agentDispatchRequestMaterial({ ...input, selectedCustomApiProfiles: [] }), agentDispatchRequestMaterial(input))
  assert.deepEqual(buildAgentDispatchPayload({ ...input, selectedCustomApiProfiles: [] }, ids), buildAgentDispatchPayload(input, ids))
  const profiles = [{ profile_id: "profile-a", expected_state_version: 3 }]
  const selected = { ...input, selectedCustomApiProfiles: profiles }
  const digest = agentDispatchRequestMaterial(selected)
  const payload = buildAgentDispatchPayload(selected, ids)
  profiles[0].expected_state_version = 4
  assert.notEqual(agentDispatchRequestMaterial(selected), digest)
  assert.deepEqual(payload.launch.selected_custom_api_profiles, [{ profile_id: "profile-a", expected_state_version: 3 }])
  assert.deepEqual(parseAgentDispatchPayload(JSON.parse(JSON.stringify(payload))), payload)
  for (const invalid of [
    null,
    ["profile-a"],
    [{ profile_id: "p", expected_state_version: 0 }],
    [{ profile_id: "p", expected_state_version: 1, secret: "value" }],
  ])
    assert.throws(() => parseAgentDispatchPayload({ ...payload, launch: { ...payload.launch, selected_custom_api_profiles: invalid } }), /PAYLOAD_INVALID/)
})

it("snapshots Custom API objects before awaited defaults so mutation cannot split digest and durable payload", async () => {
  const repository = new RecordingRepository()
  let entered!: () => void, resume!: () => void
  const preparing = new Promise<void>((resolve) => {
    entered = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    resume = resolve
  })
  repository.prepareChatTurnSelection = async () => {
    entered()
    await blocked
    return { kind: "new", projectId: null, installationIds: [] }
  }
  const service = new ChatTurnApplicationService(repository, new Sha256TestIdGenerator())
  const input = {
    tenantId: "tenant",
    conversationId: "conversation",
    subjectId: "subject",
    actorId: "actor",
    requestId: "request",
    idempotencyKey: "key",
    content: "hello",
    selectedCustomApiProfiles: [{ profile_id: "profile-a", expected_state_version: 3 }],
  }
  const submitting = service.submit(input)
  await preparing
  input.selectedCustomApiProfiles[0].expected_state_version = 4
  input.selectedCustomApiProfiles.push({ profile_id: "profile-b", expected_state_version: 1 })
  resume()
  await submitting
  assert.deepEqual(repository.commits[0].payload.launch.selected_custom_api_profiles, [{ profile_id: "profile-a", expected_state_version: 3 }])
})
