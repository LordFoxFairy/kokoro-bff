import { performance } from "node:perf_hooks"
import type { QueryResultRow } from "pg"

import type { MessageReadLifetime } from "../../application/chat/types.js"
import { agentControlRequestDigest } from "../clients/agent/control-receipt.js"
import { Sha256StableIdGenerator } from "../identifiers/scheduled-task-outbox-id.js"
import { acquireChatClient, lockChatScope, startWithinChatDeadline } from "./chat-turn-commit.js"
import type { PostgresBffDatabase } from "./client.js"

const stableId = new Sha256StableIdGenerator()
const admissionBudgetMs = 4500

export type CommitRunSteer = Readonly<{
  tenantId: string
  subjectId: string
  actorId: string
  conversationId: string
  projectRef?: string
  scope?: "all" | "direct"
  requestId: string
  runId: string
  idempotencyKey: string
  clientMessageId: string
  content: string
  lifetime?: MessageReadLifetime
}>

type RunSteerReceipt = Readonly<{
  run_id: string
  message_id: string
  command_id: string
  request_digest: string
  status: "pending" | "succeeded" | "failed"
  error_code?: string
}>

export type RunSteerCommitResult =
  | { kind: "accepted" | "replay"; receipt: RunSteerReceipt }
  | { kind: "not_found" | "run_not_current" | "idempotency_conflict" }

type StoredSteer = {
  run_id: string
  message_id: string
  intent_digest: string
  actor_id: string
  message_status: string | null
  error_code: string | null
}

/** Text hashed at admission must survive UTF-8 transport and PostgreSQL unchanged. */
export function isRunSteerText(value: string): boolean {
  return value.trim() !== "" && !/[\u0000\uD800-\uDFFF]/u.test(value)
}

/** Bind an exact original Run and one Message; this owner transaction never calls Agent. */
export async function commitRunSteer(database: PostgresBffDatabase, command: CommitRunSteer): Promise<RunSteerCommitResult> {
  for (const value of [command.tenantId, command.subjectId, command.actorId, command.conversationId, command.requestId,
    command.runId, command.idempotencyKey, command.clientMessageId, command.content]) {
    if (!isRunSteerText(value)) throw new Error("RUN_STEER_INPUT_INVALID")
  }
  const keyHash = stableId.generate(command.idempotencyKey)
  const suffix = stableId.generate(JSON.stringify(["chat.run.steer:v1", command.tenantId, command.subjectId, command.conversationId, command.runId, command.idempotencyKey]))
  const messageId = `msg_bff_steer_${suffix}`
  const agentCommandId = `steer_bff_${suffix}`
  // The public intent checks the original client identifier. Dispatch later
  // derives the separate Agent digest with the owner-generated Message ID.
  const intentDigest = agentControlRequestDigest(command.runId, {
    kind: "run.steer", session_id: command.conversationId, message_id: command.clientMessageId, content: command.content,
  })
  const receipt = (runId: string, id: string, status: RunSteerReceipt["status"], errorCode?: string): RunSteerReceipt => ({
    run_id: runId, message_id: id, command_id: command.idempotencyKey, request_digest: intentDigest, status,
    ...(errorCode === undefined ? {} : { error_code: errorCode }),
  })

  const signal = command.lifetime?.signal
  const deadline = Math.min(performance.now() + admissionBudgetMs, command.lifetime?.deadlineAt ?? Infinity)
  const client = await acquireChatClient(database, deadline, signal)
  let discardClient = false
  let open = false
  let committing = false
  const discard = (): void => { discardClient = true }
  client.on("error", discard)
  const query = <Row extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) =>
    startWithinChatDeadline(deadline, "RUN_STEER_ADMISSION_TIMEOUT", () => {
      if (discardClient) throw new Error("RUN_STEER_CONNECTION_LOST")
      return client.query<Row>(sql, values)
    }, discard, undefined, signal)

  const rollback = async (): Promise<void> => {
    await startWithinChatDeadline(deadline, "RUN_STEER_ROLLBACK_TIMEOUT", () => client.query("ROLLBACK"), discard)
    open = false
  }

  const findOrInsert = async (): Promise<RunSteerCommitResult | "retry_scope"> => {
    const scope = await lockChatScope(query, command, true)
    if (scope.kind === "retry") return "retry_scope"
    if (scope.kind !== "locked" || (command.scope === "direct" && (scope.canonicalProjectId !== null || command.projectRef !== undefined)) ||
      (command.projectRef !== undefined && (scope.callerProjectId === null || scope.canonicalProjectId !== scope.callerProjectId))) {
      return { kind: "not_found" }
    }

    // The Conversation lock serializes concurrent launches, moves and steer
    // IDs. Read the accepted identity before considering the current Run head.
    const existing = await query<StoredSteer>(
      `SELECT steer.run_id,steer.message_id,steer.intent_digest,steer.actor_id,steer.error_code,message.status AS message_status
         FROM bff_run_steer AS steer
         LEFT JOIN bff_message AS message ON message.message_id=steer.message_id AND message.tenant_id=steer.tenant_id
           AND message.conversation_id=steer.conversation_id AND message.run_id=steer.run_id AND message.role='user'
        WHERE steer.tenant_id=$1 AND steer.subject_id=$2 AND steer.conversation_id=$3 AND steer.idempotency_key_hash=$4`,
      [command.tenantId, command.subjectId, command.conversationId, keyHash],
    )
    const row = existing.rows[0]
    if (row !== undefined) {
      if (row.actor_id !== command.actorId) return { kind: "not_found" }
      if (row.run_id !== command.runId || row.intent_digest !== intentDigest) return { kind: "idempotency_conflict" }
      if (row.message_id !== messageId || (row.message_status !== "pending" && row.message_status !== "completed" && row.message_status !== "failed")) {
        throw new Error("RUN_STEER_MESSAGE_BINDING_INVALID")
      }
      return { kind: "replay", receipt: receipt(row.run_id, row.message_id, row.message_status === "completed" ? "succeeded" : row.message_status,
        row.message_status === "failed" ? row.error_code ?? undefined : undefined) }
    }

    // This is also the Run terminal/expected-head fence used by the projector
    // and launch owner. Do not accept a later queued Run or a pre-start head.
    await query("SELECT 1 FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE", [command.tenantId, command.conversationId])
    const head = await query<{ identity_assertion_ref: string }>(
      `WITH head AS (
         SELECT run_id,subject_id,actor_id,identity_assertion_ref,status,execution_context_retired_at
           FROM bff_agent_dispatch_outbox
          WHERE tenant_id=$1 AND conversation_id=$2 AND status IN ('pending','leased','retryable','admitted')
          ORDER BY conversation_dispatch_seq,outbox_id LIMIT 1
       )
       SELECT head.identity_assertion_ref FROM head
         JOIN bff_agui_stream AS stream ON stream.tenant_id=$1 AND stream.session_id=$2
        WHERE head.subject_id=$3 AND stream.consumer_subject_id=$3 AND head.run_id=$4 AND head.actor_id=$5
          AND head.status IN ('leased','retryable','admitted') AND head.execution_context_retired_at IS NULL
          AND stream.expected_run_id=$4 AND stream.latest_run_id=$4 AND stream.latest_run_start_sequence IS NOT NULL
          AND stream.terminal_run_id IS DISTINCT FROM $4`,
      [command.tenantId, command.conversationId, command.subjectId, command.runId, command.actorId],
    )
    const active = head.rows[0]
    if (active === undefined) return { kind: "run_not_current" }

    const message = await query(
      `INSERT INTO bff_message (message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq)
       SELECT $1,$2,$3,$4,'user',$5,'pending',COALESCE(MAX(message_seq),0)+1
         FROM bff_message WHERE tenant_id=$2 AND conversation_id=$3`,
      [messageId, command.tenantId, command.conversationId, command.runId, command.content],
    )
    const steer = await query(
      `INSERT INTO bff_run_steer (tenant_id,subject_id,conversation_id,idempotency_key_hash,intent_digest,run_id,message_id,
           agent_command_id,actor_id,request_id,identity_assertion_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [command.tenantId, command.subjectId, command.conversationId, keyHash, intentDigest, command.runId, messageId,
        agentCommandId, command.actorId, command.requestId, active.identity_assertion_ref],
    )
    if (message.rowCount !== 1 || steer.rowCount !== 1) throw new Error("RUN_STEER_INSERT_FAILED")
    return { kind: "accepted", receipt: receipt(command.runId, messageId, "pending") }
  }

  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      open = true
      await query("BEGIN")
      const budget = Math.max(1, Math.floor(deadline - performance.now()))
      await query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)", [`${Math.min(1000, budget)}ms`, `${budget}ms`])
      const result = await findOrInsert()
      if (result !== "retry_scope" && result.kind === "accepted") {
        await startWithinChatDeadline(deadline, "RUN_STEER_ADMISSION_TIMEOUT", () => {
          if (discardClient) throw new Error("RUN_STEER_CONNECTION_LOST")
          committing = true
          return client.query("COMMIT")
        }, discard, undefined, signal)
        return result
      }
      await rollback()
      if (result !== "retry_scope") return result
    }
    throw new Error("RUN_STEER_SCOPE_CHANGED")
  } catch (error) {
    if (committing) {
      discard()
      throw new Error("RUN_STEER_COMMIT_UNKNOWN", { cause: error })
    }
    if (open && !discardClient) await rollback().catch(discard)
    throw error
  } finally {
    client.release(discardClient)
    client.removeListener("error", discard)
  }
}
