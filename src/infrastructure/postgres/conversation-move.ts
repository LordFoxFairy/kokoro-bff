import { performance } from "node:perf_hooks"

import type { MoveConversationCommand, MoveConversationReceipt, MoveConversationResult } from "../../application/ports/chat-repository.js"
import type { PostgresBffDatabase } from "./client.js"
import { moveReceiptFromRow } from "./chat-repository-mappers.js"
import { acquireMoveLease, MOVE_BUDGET_MS, moveRemaining } from "./conversation-move-lease.js"

async function moveWinnerReceipt(
  database: PostgresBffDatabase,
  tenantId: string,
  subjectId: string,
  conversationId: string,
  targetProjectId: string | null,
  scope: string,
  fingerprint: string,
  deadline: number,
  signal: AbortSignal,
): Promise<MoveConversationResult | null> {
  const lease = await acquireMoveLease(database.pool, deadline, signal)
  try {
    await lease.command("BEGIN")
    const visible = await lease.query<{ project_ref: string | null }>(
      "SELECT project_ref FROM bff_conversation WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND status='active'",
      [tenantId, subjectId, conversationId],
    )
    if (visible.rowCount !== 1) {
      await lease.rollback()
      return { kind: "not_found" }
    }
    const currentRef = visible.rows[0]!.project_ref
    if (currentRef !== null) {
      const source = await lease.query("SELECT project_id FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND (project_id=$3 OR slug=$3) LIMIT 2", [
        tenantId,
        subjectId,
        currentRef,
      ])
      if (source.rows.length === 0) {
        await lease.rollback()
        return { kind: "not_found" }
      }
      if (source.rows.length !== 1) throw new Error("MOVE_PROJECT_REFERENCE_AMBIGUOUS")
    }
    const receipt = await lease.query<{ fingerprint: string; status: number; response_body: unknown }>(
      "SELECT fingerprint,status,response_body FROM bff_idempotency_receipt WHERE scope=$1",
      [scope],
    )
    await lease.command("COMMIT")
    const row = receipt.rows[0]
    return row === undefined ? null : moveReceiptFromRow(row, fingerprint, conversationId, targetProjectId)
  } catch (error) {
    await lease.rollback()
    throw error
  } finally {
    lease.release()
  }
}

export async function moveConversation(database: PostgresBffDatabase, command: MoveConversationCommand): Promise<MoveConversationResult> {
  const { tenantId, subjectId, conversationId, targetProjectId, scope, fingerprint, signal } = command
  const deadline = performance.now() + MOVE_BUDGET_MS
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 10 + Math.floor(Math.random() * 7)))
    moveRemaining(deadline, signal)
    const priorReceipt = await moveWinnerReceipt(database, tenantId, subjectId, conversationId, targetProjectId, scope, fingerprint, deadline, signal)
    if (priorReceipt !== null) return priorReceipt
    const lease = await acquireMoveLease(database.pool, deadline, signal)
    let committing = false
    try {
      await lease.command("BEGIN")
      const prior = await lease.query<{ project_ref: string | null }>(
        "SELECT project_ref FROM bff_conversation WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND status='active'",
        [tenantId, subjectId, conversationId],
      )
      const sourceRef = prior.rows[0]?.project_ref
      if (sourceRef === undefined) {
        await lease.rollback()
        return { kind: "not_found" }
      }
      let sourceProjectId: string | null = null
      if (sourceRef !== null) {
        const source = await lease.query<{ project_id: string }>(
          "SELECT project_id FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND (project_id=$3 OR slug=$3) LIMIT 2",
          [tenantId, subjectId, sourceRef],
        )
        if (source.rows.length === 0) {
          await lease.rollback()
          return { kind: "not_found" }
        }
        if (source.rows.length !== 1) throw new Error("MOVE_PROJECT_REFERENCE_AMBIGUOUS")
        sourceProjectId = source.rows[0]!.project_id
      }
      const projectIds = [...new Set([sourceProjectId, targetProjectId].filter((id): id is string => id !== null))].sort()
      for (const projectId of projectIds) {
        const locked = await lease.query("SELECT project_id FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3 FOR UPDATE", [
          tenantId,
          subjectId,
          projectId,
        ])
        if (locked.rowCount !== 1) {
          await lease.rollback()
          return { kind: "not_found" }
        }
      }
      const conversation = await lease.query<{ project_ref: string | null }>(
        "SELECT project_ref FROM bff_conversation WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND status='active' FOR UPDATE",
        [tenantId, subjectId, conversationId],
      )
      const currentRef = conversation.rows[0]?.project_ref
      if (currentRef === undefined) {
        await lease.rollback()
        return { kind: "not_found" }
      }
      if (currentRef !== sourceRef) {
        await lease.rollback()
        continue
      }
      const existing = await lease.query<{ fingerprint: string; status: number; response_body: unknown }>(
        "SELECT fingerprint,status,response_body FROM bff_idempotency_receipt WHERE scope=$1",
        [scope],
      )
      if (existing.rows[0] !== undefined) {
        await lease.rollback()
        return moveReceiptFromRow(existing.rows[0], fingerprint, conversationId, targetProjectId)
      }
      if (currentRef !== targetProjectId) {
        await lease.query(
          "UPDATE bff_conversation SET project_ref=$4,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND status='active'",
          [tenantId, subjectId, conversationId, targetProjectId],
        )
      }
      const receipt: MoveConversationReceipt = { data: { session_id: conversationId, project_ref: targetProjectId } }
      const inserted = await lease.query(
        `INSERT INTO bff_idempotency_receipt (scope,fingerprint,status,response_body)
           VALUES ($1,$2,200,$3::jsonb) ON CONFLICT (scope) DO NOTHING RETURNING scope`,
        [scope, fingerprint, JSON.stringify(receipt)],
      )
      if (inserted.rowCount !== 1) {
        await lease.rollback()
        lease.release()
        const winner = await moveWinnerReceipt(database, tenantId, subjectId, conversationId, targetProjectId, scope, fingerprint, deadline, signal)
        if (winner !== null) return winner
        continue
      }
      committing = true
      await lease.command("COMMIT")
      return { kind: "moved", receipt }
    } catch (error) {
      if (committing) lease.release(true)
      if (!committing) await lease.rollback()
      if (!committing && typeof error === "object" && error !== null && ["40P01", "40001", "55P03", "57014"].includes(String(Reflect.get(error, "code"))))
        continue
      throw error
    } finally {
      lease.release()
    }
  }
  throw new Error("MOVE_SESSION_UNAVAILABLE")
}
