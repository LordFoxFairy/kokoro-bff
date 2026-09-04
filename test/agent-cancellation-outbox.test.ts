import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { AgentCancellationOutboxDispatcher } from "../dist/application/agent-cancellation-outbox-dispatcher.js"
import type { AgentCancellationDeliveryPort } from "../dist/application/ports/agent-cancellation-delivery.js"
import type {
  AgentCancellationOutboxClaimInput,
  AgentCancellationOutboxRepository,
} from "../dist/application/ports/agent-cancellation-outbox-repository.js"
import type {
  AgentCancellationCommand,
  AgentCancellationLease,
} from "../dist/domain/chat/agent-cancellation.js"
import {
  agentControlRequestDigest,
  classifyAgentCancellationAttempt,
} from "../dist/infrastructure/clients/agent/cancellation-delivery.js"

function cancellation(suffix = "first", leaseRemainingMs = 3000): AgentCancellationCommand {
  return {
    cancellationId: `cancel_${suffix}`,
    tenantId: "tenant_fixture",
    conversationId: "conversation_fixture",
    conversationDispatchSeq: suffix === "second" ? "3" : "1",
    runId: `run_${suffix}`,
    subjectId: "subject_fixture",
    actorId: "actor_fixture",
    requestId: "delete_request",
    commandId: `cancel_${suffix}`,
    identityAssertionRef: "bff:fixture",
    payload: { kind: "run.cancel", session_id: "conversation_fixture" },
    status: "leased",
    attemptCount: 1,
    leaseOwner: "worker_fixture",
    leaseToken: `lease_${suffix}`,
    leaseUntil: new Date("2099-01-01T00:00:00.000Z"),
    leaseRemainingMs,
    fence: 1,
  }
}

class RecordingCancellationRepository implements AgentCancellationOutboxRepository {
  public readonly claimInputs: AgentCancellationOutboxClaimInput[] = []
  public readonly events: string[] = []
  public readonly succeeded: AgentCancellationLease[] = []
  public readonly retryable: Array<{ lease: AgentCancellationLease; delayMs: number; errorCode: string }> = []
  public readonly failed: Array<{ lease: AgentCancellationLease; errorCode: string }> = []
  public claims: AgentCancellationCommand[] = []

  public async claimAgentCancellationOutbox(input: AgentCancellationOutboxClaimInput): Promise<AgentCancellationCommand[]> {
    this.claimInputs.push(input)
    const claimed = this.claims.splice(0, input.limit)
    this.events.push(`claim:${claimed.map((item) => item.cancellationId).join(",")}`)
    return claimed
  }

  public async markAgentCancellationSucceeded(lease: AgentCancellationLease): Promise<boolean> {
    this.succeeded.push(lease)
    return true
  }

  public async markAgentCancellationRetryable(lease: AgentCancellationLease, delayMs: number, errorCode: string): Promise<boolean> {
    this.retryable.push({ lease, delayMs, errorCode })
    return true
  }

  public async markAgentCancellationFailed(lease: AgentCancellationLease, errorCode: string): Promise<boolean> {
    this.failed.push({ lease, errorCode })
    return true
  }
}

describe("Agent cancellation outbox worker", () => {
  it("claims and delivers one cancellation before leasing the next", async () => {
    const repository = new RecordingCancellationRepository()
    repository.claims = [cancellation(), cancellation("second")]
    const delivery: AgentCancellationDeliveryPort = {
      deliver: async (command, timeoutBudgetMs) => {
        repository.events.push(`deliver:${command.cancellationId}:${timeoutBudgetMs}`)
        return { outcome: "succeeded" }
      },
    }
    const dispatcher = new AgentCancellationOutboxDispatcher(repository, delivery, {
      workerId: "worker_fixture",
      maxCommandsPerCycle: 2,
      leaseSettlementReserveMs: 500,
      monotonicNow: () => 100,
    })

    assert.equal(await dispatcher.runOnce(), 2)
    assert.deepEqual(repository.events, [
      "claim:cancel_first",
      "deliver:cancel_first:2500",
      "claim:cancel_second",
      "deliver:cancel_second:2500",
    ])
    assert.deepEqual(repository.claimInputs.map((input) => [input.limit, input.maxAttempts]), [[1, 8], [1, 8]])
  })

  it("persists retryable cancellation outcomes with exponential jitter", async () => {
    const repository = new RecordingCancellationRepository()
    repository.claims = [cancellation()]
    const dispatcher = new AgentCancellationOutboxDispatcher(repository, {
      deliver: async () => ({ outcome: "retryable", errorCode: "agent_http_404" }),
    }, { workerId: "worker_fixture", random: () => 0.5 })

    await dispatcher.runOnce()
    assert.equal(repository.retryable[0]?.delayMs, 500)
    assert.equal(repository.retryable[0]?.errorCode, "agent_http_404")
  })
})

describe("Agent cancellation control receipt", () => {
  it("matches canonical command identity and request digest without requiring run_id", () => {
    const command = cancellation()
    const digest = agentControlRequestDigest(command.runId, command.payload)
    assert.equal(digest, "sha256:c6dfeba9ab642e29ded09f21aa2f67b82243dc398ae9eeb27384e2d1c3bbe100")
    assert.deepEqual(classifyAgentCancellationAttempt({
      kind: "response",
      status: 202,
      body: { data: { command_id: command.commandId, request_digest: digest, status: "pending", replayed: false } },
    }, command), { outcome: "succeeded" })
  })

  it("retries uncertain 404/transient failures and terminates malformed or permanent responses", () => {
    const command = cancellation()
    assert.equal(classifyAgentCancellationAttempt({ kind: "response", status: 404, body: {} }, command).outcome, "retryable")
    assert.equal(classifyAgentCancellationAttempt({ kind: "response", status: 429, body: {} }, command).outcome, "retryable")
    assert.equal(classifyAgentCancellationAttempt({ kind: "response", status: 400, body: {} }, command).outcome, "failed")
    assert.deepEqual(classifyAgentCancellationAttempt({ kind: "response", status: 202, body: {} }, command), {
      outcome: "failed",
      errorCode: "agent_control_receipt_invalid",
    })
    assert.equal(classifyAgentCancellationAttempt({
      kind: "transport",
      errorCode: "upstream_response_too_large",
    }, command).outcome, "failed")
  })
})
