import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { describe, it } from "node:test"

import { AgentDispatchOutboxDispatcher } from "../dist/application/agent-dispatch-outbox-dispatcher.js"
import { ChatTurnApplicationService } from "../dist/application/chat-turn-service.js"
import type { AgentDispatchDeliveryPort } from "../dist/application/ports/agent-dispatch-delivery.js"
import type {
  AgentDispatchOutboxClaimInput,
  AgentDispatchOutboxRepository,
  CommitChatTurn,
} from "../dist/application/ports/agent-dispatch-outbox-repository.js"
import type { StableIdGenerator } from "../dist/application/ports/stable-id-generator.js"
import type {
  AgentDispatchCommand,
  AgentDispatchLease,
  AgentDispatchReceipt,
} from "../dist/domain/chat/agent-dispatch.js"

class Sha256TestIdGenerator implements StableIdGenerator {
  public generate(material: string): string {
    return createHash("sha256").update(material).digest("hex")
  }
}

class RecordingRepository implements AgentDispatchOutboxRepository {
  public readonly commits: CommitChatTurn[] = []
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

  public async claimAgentDispatchOutbox(_input: AgentDispatchOutboxClaimInput): Promise<AgentDispatchCommand[]> {
    const claimed = this.claims
    this.claims = []
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

function command(attemptCount = 1): AgentDispatchCommand {
  return {
    tenantId: "tenant_fixture",
    outboxId: "agent_outbox_fixture",
    conversationId: "conversation_fixture",
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
    assert.deepEqual(repository.succeeded, [{
      tenantId: "tenant_fixture",
      outboxId: "agent_outbox_fixture",
      leaseOwner: "worker_fixture",
      leaseToken: "lease_fixture",
      fence: 7,
    }])
    assert.equal(repository.retryable.length, 0)
    assert.equal(repository.failed.length, 0)
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
})
