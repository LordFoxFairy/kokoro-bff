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
  public succeeded: AgentDispatchLease[] = []
  public retryable: Array<{ lease: AgentDispatchLease; delayMs: number; errorCode: string }> = []
  public failed: Array<{ lease: AgentDispatchLease; errorCode: string }> = []

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

  public async markAgentDispatchSucceeded(lease: AgentDispatchLease): Promise<boolean> {
    this.succeeded.push(lease)
    return true
  }

  public async markAgentDispatchRetryable(lease: AgentDispatchLease, delayMs: number, errorCode: string): Promise<boolean> {
    this.retryable.push({ lease, delayMs, errorCode })
    return true
  }

  public async markAgentDispatchFailed(lease: AgentDispatchLease, errorCode: string): Promise<boolean> {
    this.failed.push({ lease, errorCode })
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
    payload: {
      schema_version: 1,
      launch: {
        request_id: "request_fixture",
        run_id: "run_fixture",
        session_id: "conversation_fixture",
        feature_key: "chat",
        message_id: "message_user_fixture",
        content: "hello",
        trace: { source: "kokoro-bff" },
      },
    },
    status: "leased",
    attemptCount,
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

describe("Agent dispatch outbox worker", () => {
  it("settles a successful delivery with the full tenant and fence identity", async () => {
    const repository = new RecordingRepository()
    repository.claims = [command()]
    const delivery: AgentDispatchDeliveryPort = { deliver: async () => ({ outcome: "succeeded" }) }
    const dispatcher = new AgentDispatchOutboxDispatcher(repository, delivery, { workerId: "worker_fixture" })

    assert.equal(await dispatcher.runOnce(), 1)
    assert.deepEqual(repository.succeeded, [
      {
        tenantId: "tenant_fixture",
        outboxId: "agent_outbox_fixture",
        leaseOwner: "worker_fixture",
        leaseToken: "lease_fixture",
        fence: 7,
      },
    ])
    assert.equal(repository.retryable.length, 0)
    assert.equal(repository.failed.length, 0)
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
      deliver: async () => ({ outcome: "retryable", errorCode: "agent_http_503" }),
    }
    const dispatcher = new AgentDispatchOutboxDispatcher(repository, delivery, {
      workerId: "worker_fixture",
      random: () => 0.5,
    })

    await dispatcher.runOnce()
    assert.equal(repository.retryable[0]?.delayMs, 500)
    assert.equal(repository.retryable[0]?.errorCode, "agent_http_503")
    assert.equal(repository.succeeded.length, 0)
    assert.equal(repository.failed.length, 0)
  })

  it("moves exhausted retryable commands to the terminal failure path", async () => {
    const repository = new RecordingRepository()
    repository.claims = [command(8)]
    const delivery: AgentDispatchDeliveryPort = {
      deliver: async () => ({ outcome: "retryable", errorCode: "agent_http_503" }),
    }
    const dispatcher = new AgentDispatchOutboxDispatcher(repository, delivery, {
      workerId: "worker_fixture",
      maxAttempts: 8,
    })

    await dispatcher.runOnce()
    assert.equal(repository.retryable.length, 0)
    assert.equal(repository.failed[0]?.errorCode, "agent_http_503")
  })

  it("claims one command at a time and delivers it before claiming the next FIFO item", async () => {
    const repository = new RecordingRepository()
    repository.claims = [command(1), command(1, "second")]
    const delivery: AgentDispatchDeliveryPort = {
      deliver: async (claimed) => {
        repository.events.push(`deliver:${claimed.outboxId}`)
        return { outcome: "succeeded" }
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
        return { outcome: "succeeded" }
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
  it("accepts only a matching run/session receipt and makes malformed 2xx permanent", () => {
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
      { outcome: "succeeded" },
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
      { outcome: "failed", errorCode: "agent_receipt_invalid" },
    )
    assert.deepEqual(classifyAgentDispatchAttempt({ kind: "response", status: 204, body: undefined }, leased), {
      outcome: "failed",
      errorCode: "agent_receipt_invalid",
    })
  })

  it("retries only transient statuses and transport failures", () => {
    const leased = command()
    for (const status of [408, 425, 429, 500, 503]) {
      assert.equal(classifyAgentDispatchAttempt({ kind: "response", status, body: {} }, leased).outcome, "retryable")
    }
    for (const status of [400, 401, 403, 404, 409, 422]) {
      assert.equal(classifyAgentDispatchAttempt({ kind: "response", status, body: {} }, leased).outcome, "failed")
    }
    assert.deepEqual(classifyAgentDispatchAttempt({ kind: "response", status: 503, body: { error: { code: "evil\nheader", message: "secret" } } }, leased), {
      outcome: "retryable",
      errorCode: "agent_http_503",
    })
    assert.deepEqual(classifyAgentDispatchAttempt({ kind: "transport", errorCode: "upstream_timeout" }, leased), {
      outcome: "retryable",
      errorCode: "upstream_timeout",
    })
    assert.deepEqual(classifyAgentDispatchAttempt({ kind: "transport", errorCode: "upstream_response_too_large" }, leased), {
      outcome: "failed",
      errorCode: "upstream_response_too_large",
    })
  })
})
