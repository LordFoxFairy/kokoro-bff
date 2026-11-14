import { readSharedConversationContext } from "./chat-shared-context.js"
import { projectReadPredicate, projectEditPredicate } from "./project-access.js"
import { readChatTurnPersonalContext } from "./chat-turn-personal-context.js"
import { parseCanonicalResourceReferences } from "../../application/chat/resource-reference-manifest.js"
import { selectedArtifactInTransaction } from "./conversation-artifact-library.js"
import { regenerationSourceInTransaction } from "./message-regeneration.js"
import { selectedFinalAnswerInTransaction } from "./run-final-answer-read.js"
import { parseProjectSkillSelection } from "../../domain/project/skill-selection.js"
import { parseResourceReferenceSelection, type CanonicalFinalAnswerRef, type CanonicalResourceRef } from "../../domain/chat/resource-reference-selection.js"
import { performance } from "node:perf_hooks"

import type { PoolClient, QueryResult, QueryResultRow } from "pg"

import type { CommitChatTurn, ChatTurnSelectionInput, ChatTurnSelection } from "../../application/agent-dispatch/agent-dispatch-outbox-repository.js"
import { isInterruptRunId, type AgentDispatchReceipt, type AgentLaunchBody } from "../../domain/chat/agent-dispatch.js"
import { bindAgentDispatchPayloadProjectScope, parseAgentDispatchPayload } from "../../application/chat/agent-dispatch-payload.js"
import { firstMessageConversationTitle, isClientCreatedConversationId } from "../../domain/chat/conversation.js"
import { agUiConsumerRegistration } from "./agui-consumer-registration.js"
import { AGUI_NOTIFICATION_DEADLINE_MS, type PostgresBffDatabase } from "./client.js"

import { CHAT_TURN_TOTAL_BUDGET_MS } from "../../application/chat-turn-service.js"
const CHAT_TURN_LOCK_BUDGET_MS = 1000
const CHAT_TURN_MAX_SCOPE_ATTEMPTS = 4

type LockedChatScope =
  | Readonly<{
      kind: "locked"
      canonicalProjectId: string | null
      callerProjectId: string | null | undefined
    }>
  | Readonly<{ kind: "retry" }>
  | Readonly<{ kind: "project_not_found" }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "not_found" }>

type ExistingDispatchRow = {
  request_digest: string
  run_id: string
  user_message_id: string
  assistant_message_id: string
}

type QueuedHeadProjector = (client: PoolClient, tenantId: string, conversationId: string) => Promise<string | null>
type DeadlineQuery = <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<Row>>
type ChatScopeInput = Pick<CommitChatTurn, "tenantId" | "subjectId" | "conversationId" | "projectRef" | "content">

function requiredIdentity(value: string): void {
  if (value.trim() === "") throw new Error("CHAT_TURN_INPUT_INVALID")
}

function positiveDecimal(value: string | number): string {
  const normalized = String(value)
  if (!/^[1-9][0-9]*$/u.test(normalized)) throw new Error("CHAT_MESSAGE_SEQUENCE_INVALID")
  return normalized
}

function remainingMilliseconds(deadline: number, code = "CHAT_TURN_BUDGET_EXHAUSTED"): number {
  const remaining = Math.floor(deadline - performance.now())
  if (remaining < 1) throw new Error(code)
  return remaining
}

async function startWithin<T>(
  deadline: number,
  code: string,
  start: () => Promise<T>,
  onTimeout?: () => void,
  maximumMs?: number,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  const milliseconds = Math.min(remainingMilliseconds(deadline, code), maximumMs ?? Number.MAX_SAFE_INTEGER)
  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined
  const interrupted = new Promise<never>((_resolve, reject) => {
    if (signal !== undefined) {
      onAbort = () => {
        onTimeout?.()
        reject(signal.reason)
      }
      signal.addEventListener("abort", onAbort, { once: true })
    }
  })
  try {
    signal?.throwIfAborted()
    return await Promise.race([
      start(),
      interrupted,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.()
          reject(new Error(code))
        }, milliseconds)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort)
  }
}

async function acquireClient(database: PostgresBffDatabase, deadline: number, signal?: AbortSignal): Promise<PoolClient> {
  const acquisition: { promise: Promise<PoolClient> | null } = {
    promise: null,
  }
  try {
    return await startWithin(
      deadline,
      "CHAT_TURN_POOL_TIMEOUT",
      () => {
        acquisition.promise = database.pool.connect()
        return acquisition.promise
      },
      undefined,
      undefined,
      signal,
    )
  } catch (error) {
    // pg-pool does not expose cancellation of an individual queued checkout.
    // Retire this waiter; release any clean late lease without starting SQL.
    if (acquisition.promise !== null) {
      void acquisition.promise.then(
        (lateClient) => lateClient.release(),
        () => undefined,
      )
    }
    throw error
  }
}

export { acquireClient as acquireChatClient, startWithin as startWithinChatDeadline }

/** The pre-resolution read shares Chat's bounded checkout and late-client cleanup. */
export async function prepareChatTurnSelection(database: PostgresBffDatabase, input: ChatTurnSelectionInput): Promise<ChatTurnSelection | null> {
  const deadline = Math.min(performance.now() + CHAT_TURN_TOTAL_BUDGET_MS, input.lifetime?.deadlineAt ?? Infinity)
  input.lifetime?.signal.throwIfAborted()
  const client = await acquireClient(database, deadline, input.lifetime?.signal)
  let destroyClient = false
  let leaseReleased = false
  const onCallerAbort = (): void => {
    destroyClient = true
    if (!leaseReleased) {
      leaseReleased = true
      client.release(true)
    }
  }
  const onError = () => {
    destroyClient = true
  }
  client.on("error", onError)
  input.lifetime?.signal.addEventListener("abort", onCallerAbort, {
    once: true,
  })
  if (input.lifetime?.signal.aborted) onCallerAbort()
  try {
    input.lifetime?.signal.throwIfAborted()
    type SelectionRow = {
      missing_project: boolean
      forbidden: boolean
      project_id: string | null
      installation_ids: string[] | null
      request_digest: string | null
      run_id: string | null
      user_message_id: string | null
      assistant_message_id: string | null
    }
    const config = {
      text: `WITH current_conversation AS (
        SELECT project_ref,owner_id FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$3 AND status='active'
          AND (project_ref IS NOT NULL OR owner_id=$2)
      ), requested_project AS (
        SELECT project_id FROM bff_project WHERE tenant_id=$1 AND deleted_at IS NULL AND project_id=$5
      ), current_scope AS (
        SELECT CASE WHEN EXISTS(SELECT 1 FROM current_conversation) THEN (SELECT project_ref FROM current_conversation) ELSE (SELECT project_id FROM requested_project) END AS project_ref,
          COALESCE((SELECT owner_id FROM current_conversation),$2) AS creator_id,
          (NOT EXISTS(SELECT 1 FROM current_conversation) AND $5::text IS NOT NULL AND NOT EXISTS(SELECT 1 FROM requested_project)) AS missing_project
        WHERE EXISTS(SELECT 1 FROM current_conversation) OR ($6 AND NOT EXISTS(SELECT 1 FROM bff_conversation WHERE conversation_id=$3))
      )
      SELECT s.missing_project,p.project_id,CASE WHEN s.project_ref IS NULL THEN '{}'::text[] ELSE p.selected_skill_installation_ids END AS installation_ids,
        (p.project_id IS NOT NULL AND NOT ${projectEditPredicate.replaceAll("bff_project.", "p.")} AND ${projectReadPredicate.replaceAll("bff_project.", "p.")}) AS forbidden,
        o.request_digest,o.run_id,o.user_message_id,o.assistant_message_id
      FROM current_scope s LEFT JOIN bff_project p ON p.tenant_id=$1 AND p.deleted_at IS NULL
        AND (p.project_id=s.project_ref OR (p.owner_id=s.creator_id AND p.slug=s.project_ref))
      LEFT JOIN bff_agent_dispatch_outbox o ON o.tenant_id=$1 AND o.subject_id=$2 AND o.actor_id=$2 AND o.conversation_id=$3 AND o.idempotency_key=$4
      WHERE s.project_ref IS NULL OR (p.project_id IS NOT NULL AND ${projectReadPredicate.replaceAll("bff_project.", "p.")})`,
      values: [
        input.tenantId,
        input.subjectId,
        input.conversationId,
        input.idempotencyKey,
        input.projectRef ?? null,
        input.interruptRunId === undefined && isClientCreatedConversationId(input.conversationId),
      ],
      query_timeout: remainingMilliseconds(deadline),
    }
    const result = await startWithin(
      deadline,
      "CHAT_TURN_BUDGET_EXHAUSTED",
      () => client.query<SelectionRow>(config),
      () => {
        destroyClient = true
      },
      undefined,
      input.lifetime?.signal,
    )
    input.lifetime?.signal.throwIfAborted()
    remainingMilliseconds(deadline)
    const row = result.rows[0]
    if (result.rows.length > 1) throw Error("CHAT_TURN_PROJECT_NOT_FOUND")
    if (!row) return null
    if (row.forbidden) throw Error("CHAT_TURN_PROJECT_FORBIDDEN")
    if (row.missing_project) throw new Error("CHAT_TURN_PROJECT_NOT_FOUND")
    if (row.request_digest !== null) {
      if (row.request_digest !== input.requestDigest) throw new Error("CHAT_TURN_IDEMPOTENCY_CONFLICT")
      if (!row.run_id || !row.user_message_id || !row.assistant_message_id) throw new Error("AGENT_DISPATCH_LINEAGE_MISMATCH")
      return {
        kind: "replay",
        receipt: {
          run_id: row.run_id,
          user_message_id: row.user_message_id,
          assistant_message_id: row.assistant_message_id,
        },
      }
    }
    const ids = parseProjectSkillSelection(row.installation_ids)
    if (ids === null) throw new Error("CHAT_SKILL_SELECTION_INVALID")
    return { kind: "new", projectId: row.project_id, installationIds: ids }
  } finally {
    try {
      if (!leaseReleased) client.release(destroyClient)
    } finally {
      input.lifetime?.signal.removeEventListener("abort", onCallerAbort)
      client.removeListener("error", onError)
    }
  }
}

async function resolveActiveProject(query: DeadlineQuery, tenantId: string, projectRef: string, legacyCreator?: string): Promise<string | null> {
  const result = await query<{ project_id: string }>(
    `SELECT project_id FROM bff_project WHERE tenant_id=$1 AND deleted_at IS NULL
       AND (project_id=$2 OR ($3::text IS NOT NULL AND owner_id=$3 AND slug=$2)) LIMIT 2`,
    [tenantId, projectRef, legacyCreator ?? null],
  )
  return result.rows.length === 1 ? result.rows[0]!.project_id : null
}

export async function lockChatScope(query: DeadlineQuery, command: ChatScopeInput, existingOnly: boolean): Promise<LockedChatScope> {
  const pre = (
    await query<{ project_ref: string | null; owner_id: string }>(
      "SELECT project_ref,owner_id FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2 AND status='active'",
      [command.tenantId, command.conversationId],
    )
  ).rows[0]
  if (!pre && existingOnly) return { kind: "not_found" }
  if (pre?.project_ref === null && pre.owner_id !== command.subjectId) return { kind: "not_found" }
  const callerProjectId = command.projectRef === undefined ? undefined : await resolveActiveProject(query, command.tenantId, command.projectRef)
  if (command.projectRef !== undefined && callerProjectId === null) return { kind: "project_not_found" }
  const canonicalProjectId = pre
    ? pre.project_ref === null
      ? null
      : await resolveActiveProject(query, command.tenantId, pre.project_ref, pre.owner_id)
    : (callerProjectId ?? null)
  if (pre?.project_ref != null && canonicalProjectId === null) return { kind: "not_found" }
  const ids = [...new Set([canonicalProjectId, callerProjectId].filter((id): id is string => typeof id === "string"))].sort()
  if (ids.length) {
    const locked = await query<{ project_id: string }>(
      "SELECT project_id FROM bff_project WHERE tenant_id=$1 AND project_id=ANY($2::text[]) AND deleted_at IS NULL ORDER BY project_id FOR SHARE",
      [command.tenantId, ids],
    )
    if (locked.rows.length !== ids.length) return { kind: "project_not_found" }
    // Grant mutation locks this same Project row. Read the role after any lock wait, not from the pre-resolution snapshot.
    const access = await query<{ project_id: string; can_read: boolean; can_edit: boolean }>(
      `SELECT project_id,${projectReadPredicate} AS can_read,${projectEditPredicate} AS can_edit FROM bff_project
        WHERE tenant_id=$1 AND project_id=ANY($3::text[]) AND deleted_at IS NULL`,
      [command.tenantId, command.subjectId, ids],
    )
    for (const id of ids) {
      const allowed = access.rows.find((row) => row.project_id === id)
      if (!allowed?.can_edit) return { kind: allowed?.can_read ? "forbidden" : "not_found" }
    }
  }
  if (!pre) {
    if (!isClientCreatedConversationId(command.conversationId)) return { kind: "not_found" }
    const inserted = await query(
      `INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,project_ref,title,status)
      VALUES($1,$2,$3,$4,$5,'active') ON CONFLICT(conversation_id) DO NOTHING`,
      [command.conversationId, command.tenantId, command.subjectId, canonicalProjectId, firstMessageConversationTitle(command.content)],
    )
    if (inserted.rowCount !== 1) {
      const winner = await query("SELECT 1 FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2 AND status='active'", [
        command.tenantId,
        command.conversationId,
      ])
      return { kind: winner.rows.length ? "retry" : "not_found" }
    }
  }
  const current = (
    await query<{ project_ref: string | null; owner_id: string }>(
      "SELECT project_ref,owner_id FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2 AND status='active' FOR UPDATE",
      [command.tenantId, command.conversationId],
    )
  ).rows[0]
  if (!current) return { kind: "not_found" }
  if (pre && (current.project_ref !== pre.project_ref || current.owner_id !== pre.owner_id)) return { kind: "retry" }
  if (current.project_ref === null && current.owner_id !== command.subjectId) return { kind: "not_found" }
  return { kind: "locked", canonicalProjectId, callerProjectId }
}

export async function commitChatTurn(
  database: PostgresBffDatabase,
  command: CommitChatTurn,
  projectQueuedHead: QueuedHeadProjector,
): Promise<AgentDispatchReceipt | null> {
  const deadline = Math.min(performance.now() + CHAT_TURN_TOTAL_BUDGET_MS, command.lifetime?.deadlineAt ?? Infinity)
  command.lifetime?.signal.throwIfAborted()
  for (const value of [
    command.outboxId,
    command.tenantId,
    command.conversationId,
    command.subjectId,
    command.actorId,
    command.requestId,
    command.idempotencyKey,
    command.runId,
    command.userMessageId,
    command.assistantMessageId,
    command.identityAssertionRef,
    command.content,
  ])
    requiredIdentity(value)
  if (command.actorId !== command.subjectId) throw Error("CHAT_TURN_INPUT_INVALID")
  if (!/^[0-9a-f]{64}$/u.test(command.requestDigest)) throw new Error("CHAT_TURN_DIGEST_INVALID")
  if (command.interruptRunId !== undefined && (!isInterruptRunId(command.interruptRunId) || command.regeneration !== undefined)) {
    throw new Error("CHAT_TURN_INPUT_INVALID")
  }
  const callerPayload = parseAgentDispatchPayload(command.payload)
  if (callerPayload.launch.personal_context !== undefined || callerPayload.launch.shared_conversation_context !== undefined)
    throw new Error("CHAT_TURN_INPUT_INVALID")
  if (
    callerPayload.launch.request_id !== command.requestId ||
    callerPayload.launch.run_id !== command.runId ||
    callerPayload.launch.session_id !== command.conversationId ||
    callerPayload.launch.message_id !== command.userMessageId ||
    callerPayload.launch.content !== command.content
  )
    throw new Error("AGENT_DISPATCH_LINEAGE_MISMATCH")

  const client = await acquireClient(database, deadline, command.lifetime?.signal)
  let transactionOpen = false
  let destroyClient = false
  let leaseReleased = false
  const onCallerAbort = () => {
    destroyClient = true
    if (!leaseReleased) {
      leaseReleased = true
      client.release(true)
    }
  }
  const onLeaseClientError = (): void => {
    destroyClient = true
  }
  client.on("error", onLeaseClientError)
  command.lifetime?.signal.addEventListener("abort", onCallerAbort, {
    once: true,
  })
  if (command.lifetime?.signal.aborted) onCallerAbort()
  async function query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>> {
    return startWithin(
      deadline,
      "CHAT_TURN_BUDGET_EXHAUSTED",
      () => {
        command.lifetime?.signal.throwIfAborted()
        if (destroyClient) throw Error("CHAT_TURN_RETIRED")
        return client.query<Row>(text, values)
      },
      () => {
        destroyClient = true
      },
      undefined,
      command.lifetime?.signal,
    )
  }
  async function rollback(): Promise<void> {
    try {
      await startWithin(
        deadline,
        "CHAT_TURN_ROLLBACK_TIMEOUT",
        () => client.query("ROLLBACK").then(() => undefined),
        () => {
          destroyClient = true
        },
      )
      transactionOpen = false
    } catch (error) {
      destroyClient = true
      transactionOpen = false
      throw error
    }
  }
  async function commit(): Promise<void> {
    let commitDispatched = false
    try {
      await startWithin(
        deadline,
        "CHAT_TURN_BUDGET_EXHAUSTED",
        () => {
          command.lifetime?.signal.throwIfAborted()
          commitDispatched = true
          return client.query("COMMIT").then(() => undefined)
        },
        () => {
          destroyClient = true
        },
        undefined,
        command.lifetime?.signal,
      )
      transactionOpen = false
    } catch (error) {
      destroyClient = true
      transactionOpen = false
      if (!commitDispatched) throw error
      throw new Error("CHAT_TURN_COMMIT_UNKNOWN", { cause: error })
    }
  }
  try {
    for (let scopeAttempt = 0; scopeAttempt < CHAT_TURN_MAX_SCOPE_ATTEMPTS; scopeAttempt += 1) {
      const remaining = remainingMilliseconds(deadline)
      await query("BEGIN")
      transactionOpen = true
      await query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)", [
        `${Math.min(CHAT_TURN_LOCK_BUDGET_MS, remaining)}ms`,
        `${remaining}ms`,
      ])
      const existing = await query<ExistingDispatchRow>(
        `SELECT request_digest,run_id,user_message_id,assistant_message_id
           FROM bff_agent_dispatch_outbox
          WHERE tenant_id=$1 AND conversation_id=$2 AND idempotency_key=$3 AND subject_id=$4 AND actor_id=$5 AND identity_assertion_ref=$6
          LIMIT 1`,
        [command.tenantId, command.conversationId, command.idempotencyKey, command.subjectId, command.actorId, command.identityAssertionRef],
      )
      const existingRow = existing.rows[0]
      if (existingRow !== undefined) {
        if (existingRow.request_digest !== command.requestDigest) throw new Error("CHAT_TURN_IDEMPOTENCY_CONFLICT")
        await commit()
        return {
          run_id: existingRow.run_id,
          user_message_id: existingRow.user_message_id,
          assistant_message_id: existingRow.assistant_message_id,
        }
      }
      const scope = await lockChatScope(query, command, command.interruptRunId !== undefined)
      if (scope.kind === "retry") {
        await rollback()
        continue
      }
      if (scope.kind === "not_found") {
        await rollback()
        return null
      }
      if (scope.kind === "forbidden") {
        await rollback()
        throw Error("CHAT_TURN_PROJECT_FORBIDDEN")
      }
      if (scope.kind === "project_not_found") {
        await rollback()
        throw new Error("CHAT_TURN_PROJECT_NOT_FOUND")
      }

      let sourcePersonalContext: AgentLaunchBody["personal_context"]
      if (command.regeneration !== undefined) {
        const original = await regenerationSourceInTransaction(
          { query },
          {
            tenantId: command.tenantId,
            subjectId: command.subjectId,
            conversationId: command.conversationId,
            sourceMessageId: command.regeneration.sourceMessageId,
          },
        )
        if (original === null) {
          await rollback()
          return null
        }
        if (
          original.sourceRunId !== command.regeneration.sourceRunId ||
          original.originalUserMessageId !== command.regeneration.originalUserMessageId ||
          original.sourceFingerprint !== command.regeneration.sourceFingerprint ||
          original.content !== command.content
        )
          throw Error("MESSAGE_REGENERATION_SOURCE_CHANGED")
        if (JSON.stringify(callerPayload.launch.selected_resource_refs ?? []) !== JSON.stringify(original.payload.launch.selected_resource_refs ?? []))
          throw new Error("MESSAGE_REGENERATION_SOURCE_CHANGED")
        sourcePersonalContext = original.payload.launch.personal_context
        if (
          sourcePersonalContext !== undefined &&
          (sourcePersonalContext.owner.tenant_ref !== command.tenantId || sourcePersonalContext.owner.user_ref !== command.actorId)
        )
          throw new Error("MESSAGE_REGENERATION_SOURCE_INVALID")
      }
      if (command.projectRef !== undefined && (scope.callerProjectId === null || scope.callerProjectId !== scope.canonicalProjectId)) {
        await rollback()
        return null
      }
      // Project is already locked in this transaction. Replays above never read a new revision.
      const project =
        scope.canonicalProjectId === null
          ? null
          : (
              await query<{
                instruction: string | null
                selected_skill_installation_ids: string[]
              }>(
                `SELECT instruction, selected_skill_installation_ids
                 FROM bff_project WHERE tenant_id=$1 AND project_id=$3 AND deleted_at IS NULL AND ${projectEditPredicate}`,
                [command.tenantId, command.subjectId, scope.canonicalProjectId],
              )
            ).rows[0]
      if (project === undefined) throw new Error("CHAT_TURN_PROJECT_NOT_FOUND")
      if (command.skillSelection !== undefined) {
        if (command.skillSelection.projectId !== scope.canonicalProjectId) throw new Error("CHAT_SKILL_SELECTION_CHANGED")
        if (JSON.stringify(project?.selected_skill_installation_ids ?? []) !== JSON.stringify(command.skillSelection.installationIds))
          throw new Error("CHAT_SKILL_SELECTION_CHANGED")
      }
      const frozen = callerPayload.launch.selected_resource_refs ?? []
      const requested =
        command.regeneration === undefined
          ? parseResourceReferenceSelection(command.resourceSelection?.refs ?? [])
          : frozen.map(({ kind, resource_id }) => ({ kind, resource_id }))
      if (requested === null || (command.resourceSelection !== undefined && command.resourceSelection.projectId !== scope.canonicalProjectId))
        throw new Error("CHAT_RESOURCE_SELECTION_CHANGED")
      const resources: CanonicalResourceRef[] = []
      let frozenIndex = 0
      for (const intent of requested) {
        if (intent.kind === "final_answer") {
          if (command.scheduledActivation !== undefined) throw new Error("CHAT_RESOURCE_SELECTION_INVALID")
          const answer = await selectedFinalAnswerInTransaction(
            { query },
            {
              tenantId: command.tenantId,
              subjectId: command.subjectId,
              messageId: intent.resource_id,
              projectId: scope.canonicalProjectId,
            },
          )
          if (answer === null) throw new Error(command.regeneration === undefined ? "CHAT_RESOURCE_SELECTION_INVALID" : "CHAT_RESOURCE_SELECTION_CHANGED")
          const final: CanonicalFinalAnswerRef = {
            kind: "final_answer",
            resource_id: answer.messageId,
            source_scope: { kind: "conversation", id: answer.conversationId },
            source_run_id: answer.runId,
            source_final_segment_id: answer.finalSegmentId,
            source_revision: answer.revision,
            content: answer.content,
            content_sha256: answer.contentSha256,
            size_bytes: answer.sizeBytes,
          }
          if (command.regeneration !== undefined && JSON.stringify(frozen[frozenIndex++]) !== JSON.stringify(final))
            throw new Error("CHAT_RESOURCE_SELECTION_CHANGED")
          resources.push(final)
          continue
        }
        const resource = frozen[frozenIndex++]
        if (resource?.kind !== intent.kind || resource.resource_id !== intent.resource_id) throw new Error("CHAT_RESOURCE_SELECTION_CHANGED")
        const source = resource.source_scope
        if (resource.kind === "asset") {
          if ((source.kind === "personal" && source.id !== command.subjectId) || (source.kind === "project" && source.id !== scope.canonicalProjectId))
            throw new Error("CHAT_RESOURCE_SELECTION_CHANGED")
        } else {
          const association = await selectedArtifactInTransaction(
            { query },
            {
              tenantId: command.tenantId,
              subjectId: command.subjectId,
              artifactId: resource.resource_id,
              projectId: scope.canonicalProjectId,
            },
            true,
          )
          if (
            association === null ||
            association.conversationId !== source.id ||
            association.runId !== resource.source_run_id ||
            association.sourceAssetId !== resource.asset_id ||
            association.sourceContentSha256 !== resource.content_sha256
          )
            throw new Error("CHAT_RESOURCE_SELECTION_CHANGED")
        }
        resources.push(resource)
      }
      if (frozenIndex !== frozen.length) throw new Error("CHAT_RESOURCE_SELECTION_CHANGED")
      const canonical = parseCanonicalResourceReferences(resources)
      if (canonical === null) throw new Error("CHAT_RESOURCE_SELECTION_INVALID")
      const boundPayload = bindAgentDispatchPayloadProjectScope(
        canonical.length
          ? {
              ...callerPayload,
              launch: {
                ...callerPayload.launch,
                selected_resource_refs: canonical,
              },
            }
          : callerPayload,
        scope.canonicalProjectId,
        project?.instruction ?? null,
      )
      const personalContext =
        command.regeneration === undefined
          ? await readChatTurnPersonalContext(query, {
              tenantId: command.tenantId,
              actorId: command.actorId,
            })
          : sourcePersonalContext
      const sharedContext =
        scope.canonicalProjectId === null
          ? undefined
          : await readSharedConversationContext(
              query,
              command.tenantId,
              scope.canonicalProjectId,
              command.conversationId,
              command.regeneration?.originalUserMessageId,
            )
      const payload =
        personalContext === undefined && sharedContext === undefined
          ? boundPayload
          : {
              ...boundPayload,
              launch: {
                ...boundPayload.launch,
                ...(personalContext === undefined ? {} : { personal_context: personalContext }),
                ...(sharedContext === undefined ? {} : { shared_conversation_context: sharedContext }),
              },
            }
      // Agent HTTP accepts at most 1 MiB; reject before any outbox/interrupt effects.
      if (Buffer.byteLength(JSON.stringify(payload.launch)) > 1024 * 1024) throw new Error("request_body_too_large")
      const registration = agUiConsumerRegistration(command.tenantId, command.conversationId, command.subjectId, undefined)
      const registered = await query(registration.text, registration.values)
      if (registered.rowCount !== 1) throw new Error("AGENT_DISPATCH_CONSUMER_REGISTRATION_FAILED")
      await query("SELECT 1 FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE", [command.tenantId, command.conversationId])
      if (command.scheduledActivation !== undefined) {
        const activation = command.scheduledActivation
        if (activation.tenantId !== command.tenantId || activation.runId !== command.runId) throw new Error("SCHEDULED_ACTIVATION_LOST")
        // Parent Project / Conversation / stream, then definition, scope and dispatch. Definition edits use the same order.
        await query("SELECT 1 FROM bff_scheduled_task WHERE tenant_id=$1 AND task_id=$2 FOR SHARE", [activation.tenantId, activation.taskId])
        await query("SELECT 1 FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE", [activation.tenantId, activation.taskId])
        const active = await query(
          `SELECT 1 FROM bff_scheduled_agent_dispatch dispatch
            JOIN bff_scheduled_agent_scope scope ON scope.tenant_id=dispatch.tenant_id AND scope.task_id=dispatch.task_id
            LEFT JOIN bff_scheduled_task definition ON definition.tenant_id=dispatch.tenant_id AND definition.task_id=dispatch.task_id
            WHERE dispatch.tenant_id=$1 AND dispatch.task_id=$2 AND dispatch.dispatch_id=$3 AND dispatch.run_id=$4
              AND dispatch.lease_owner=$5 AND dispatch.lease_token=$6 AND dispatch.fence=$7
              AND dispatch.status='leased' AND dispatch.lease_until>clock_timestamp()
              AND dispatch.subject_id=$8 AND dispatch.idempotency_key=$9 AND dispatch.request_digest=$10
              AND dispatch.user_message_id=$11 AND dispatch.assistant_message_id=$12
              AND scope.tenant_id=dispatch.tenant_id AND scope.task_id=dispatch.task_id
              AND scope.session_id=$13
              AND (dispatch.admission_unknown_seen OR (definition.enabled AND definition.status='active'
                AND definition.execution_actor_id=dispatch.subject_id AND definition.revision=dispatch.task_revision))
              AND scope.active_dispatch_id=dispatch.dispatch_id AND scope.active_run_id=dispatch.run_id
            FOR UPDATE OF dispatch`,
          [
            activation.tenantId,
            activation.taskId,
            activation.dispatchId,
            activation.runId,
            activation.leaseOwner,
            activation.leaseToken,
            activation.fence,
            command.subjectId,
            command.idempotencyKey,
            command.requestDigest,
            command.userMessageId,
            command.assistantMessageId,
            command.conversationId,
          ],
        )
        if (active.rowCount !== 1) throw new Error("SCHEDULED_ACTIVATION_LOST")
      }
      if (command.interruptRunId !== undefined) {
        // The stream lock fences owner terminal/head changes; the unique cancellation
        // record also excludes a different command from claiming the same Run.
        const cancellation = await query(
          `WITH head AS (
             SELECT outbox_id,tenant_id,conversation_id,conversation_dispatch_seq,run_id,subject_id,identity_assertion_ref
               FROM bff_agent_dispatch_outbox
              WHERE tenant_id=$1 AND conversation_id=$2 AND status IN ('pending','leased','retryable','admitted')
              ORDER BY conversation_dispatch_seq,outbox_id LIMIT 1
           )
           INSERT INTO bff_agent_cancellation_outbox
             (cancellation_id,tenant_id,conversation_id,conversation_dispatch_seq,run_id,subject_id,actor_id,
              request_id,command_id,identity_assertion_ref,payload,status,attempt_count,available_at,fence)
           SELECT 'cancel_'||head.outbox_id,head.tenant_id,head.conversation_id,head.conversation_dispatch_seq,
                  head.run_id,head.subject_id,$5,$6,'cancel_'||head.outbox_id,head.identity_assertion_ref,
                  jsonb_build_object('kind','run.cancel','session_id',head.conversation_id),'cancel_requested',0,CURRENT_TIMESTAMP(3),0
             FROM head JOIN bff_agui_stream stream ON stream.tenant_id=head.tenant_id AND stream.session_id=head.conversation_id
            WHERE head.subject_id=$3 AND stream.consumer_subject_id=$3 AND head.run_id=$4
              AND stream.expected_run_id=$4 AND stream.latest_run_id=$4 AND stream.terminal_run_id IS DISTINCT FROM $4
           ON CONFLICT (tenant_id,run_id) DO NOTHING`,
          [command.tenantId, command.conversationId, command.subjectId, command.interruptRunId, command.actorId, command.requestId],
        )
        if (cancellation.rowCount !== 1) throw new Error("CHAT_INTERRUPT_TARGET_NOT_CURRENT")
      }

      const sequence = await query<{ next_seq: string | number }>(
        `SELECT COALESCE(MAX(message_seq),0)+1 AS next_seq FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2`,
        [command.tenantId, command.conversationId],
      )
      const nextSequenceRow = sequence.rows[0]
      if (nextSequenceRow === undefined) throw new Error("CHAT_MESSAGE_SEQUENCE_INVALID")
      const nextSequence = positiveDecimal(nextSequenceRow.next_seq)
      const outbox = await query(
        `INSERT INTO bff_agent_dispatch_outbox
          (outbox_id,tenant_id,conversation_id,conversation_dispatch_seq,subject_id,actor_id,request_id,idempotency_key,request_digest,
           run_id,user_message_id,assistant_message_id,identity_assertion_ref,payload,execution_project_ref,status,attempt_count,available_at,fence)
         VALUES ($1,$2,$3,$4::bigint,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,'pending',0,CURRENT_TIMESTAMP(3),0)`,
        [
          command.outboxId,
          command.tenantId,
          command.conversationId,
          nextSequence,
          command.subjectId,
          command.actorId,
          command.requestId,
          command.idempotencyKey,
          command.requestDigest,
          command.runId,
          command.userMessageId,
          command.assistantMessageId,
          command.identityAssertionRef,
          JSON.stringify(payload),
          scope.canonicalProjectId,
        ],
      )
      if (outbox.rowCount !== 1) throw new Error("AGENT_DISPATCH_INSERT_FAILED")
      const inserted = await query(
        `INSERT INTO bff_message (message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq,selected_skill_source_refs,
            ordered_parts,parts_format_version,parts_public_sequence,origin,regenerated_from_message_id,regeneration_user_message_id)
         VALUES ($1,$2,$3,$4,'user',$5,'completed',$6::bigint,$8::jsonb,NULL,NULL,NULL,CASE WHEN $9::boolean THEN 'regeneration_input' ELSE 'normal' END,$10,$11),
                ($7,$2,$3,$4,'assistant','','pending',$6::bigint+1,'[]'::jsonb,'[]'::jsonb,1,0,CASE WHEN $9::boolean THEN 'regeneration_answer' ELSE 'normal' END,$10,$11)`,
        [
          command.userMessageId,
          command.tenantId,
          command.conversationId,
          command.runId,
          command.content,
          nextSequence,
          command.assistantMessageId,
          JSON.stringify(payload.launch.selected_skill_source_refs),
          command.regeneration !== undefined,
          command.regeneration?.sourceMessageId ?? null,
          command.regeneration?.originalUserMessageId ?? null,
        ],
      )
      if (inserted.rowCount !== 2) throw new Error("CHAT_MESSAGE_INSERT_FAILED")
      if (command.scheduledActivation !== undefined) {
        const activation = command.scheduledActivation
        const submitted = await query(
          `UPDATE bff_scheduled_agent_dispatch SET status='submitted',lease_owner=NULL,lease_token=NULL,lease_until=NULL,
              last_error_code=NULL,last_error_at=NULL,updated_at=clock_timestamp()
            WHERE tenant_id=$1 AND task_id=$2 AND dispatch_id=$3 AND run_id=$4
              AND status='leased' AND lease_owner=$5 AND lease_token=$6 AND fence=$7 AND lease_until>clock_timestamp()`,
          [activation.tenantId, activation.taskId, activation.dispatchId, activation.runId, activation.leaseOwner, activation.leaseToken, activation.fence],
        )
        if (submitted.rowCount !== 1) throw new Error("SCHEDULED_ACTIVATION_LOST")
      }
      const queuedCursor = await startWithin(
        deadline,
        "CHAT_TURN_BUDGET_EXHAUSTED",
        () => projectQueuedHead(client, command.tenantId, command.conversationId),
        () => {
          destroyClient = true
        },
        undefined,
        command.lifetime?.signal,
      )
      await query("UPDATE bff_conversation SET updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND conversation_id=$2", [
        command.tenantId,
        command.conversationId,
      ])
      await commit()
      if (queuedCursor !== null && deadline > performance.now()) {
        await startWithin(
          deadline,
          "CHAT_TURN_NOTIFICATION_TIMEOUT",
          () => database.notifyAgUiProjection(command.tenantId, command.conversationId, queuedCursor),
          undefined,
          AGUI_NOTIFICATION_DEADLINE_MS,
        ).catch(() => undefined)
      }
      return {
        run_id: command.runId,
        user_message_id: command.userMessageId,
        assistant_message_id: command.assistantMessageId,
      }
    }
    throw new Error("CHAT_TURN_SCOPE_CHANGED")
  } catch (error) {
    if (transactionOpen && !destroyClient) {
      try {
        await rollback()
      } catch {
        // Preserve the original failure; rollback() already fenced the client.
      }
    }
    throw error
  } finally {
    try {
      if (!leaseReleased) client.release(destroyClient)
    } finally {
      command.lifetime?.signal.removeEventListener("abort", onCallerAbort)
      client.removeListener("error", onLeaseClientError)
    }
  }
}
