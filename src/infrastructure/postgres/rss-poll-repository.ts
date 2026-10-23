import { randomUUID } from "node:crypto"
import type { Pool, QueryResultRow } from "pg"
import { ArchiveSqlLease } from "./archive-sql-lease.js"
import { Sha256StableIdGenerator } from "../identifiers/scheduled-task-outbox-id.js"
import { canonicalEpoch, triggerFromWire } from "../../domain/scheduled-task/trigger.js"
import { rssOrderBatch } from "../../domain/scheduled-task/rss-order.js"
import type { RssPollRepository, RssPollClaim } from "../../application/ports/rss-poll-repository.js"
import type { RssPollIdentity, RssPollLease, RssPollSummary, RssFrozenLaunch, RssErrorCode } from "../../domain/scheduled-task/rss-poll.types.js"
import type { RssFeedEntry } from "../../domain/scheduled-task/rss-feed.js"
type Receipt = QueryResultRow & { fingerprint: string; response_body: Record<string, unknown> }
type Task = QueryResultRow & {
  task_id: string
  owner_id: string
  project_id: string | null
  revision: string
  trigger_epoch: string
  trigger_kind: string
  rss_url: string | null
  rss_conditions: unknown
  title: string
  prompt: string
  expires_at: Date | null
  enabled: boolean
  status: "active" | "paused" | "failed"
  auto_approve: boolean
}
type Poll = QueryResultRow & {
  source_epoch: string
  task_revision: string
  subject_id: string
  initialized: boolean
  seen_count: number
  poll_sequence: string
  next_poll_at: Date
  last_error_code: RssErrorCode | null
  lease_token: string | null
  lease_until: Date | null
  fence: string
  failure_count: number
}
const hash = new Sha256StableIdGenerator()
function summary(input: RssPollIdentity, outcome: RssPollSummary["outcome"], observed = 0, enqueued = 0): RssPollSummary {
  return { poll_id: `rss_poll_${hash.generate(JSON.stringify([input.scope, input.digest]))}`, outcome, observed_count: observed, enqueued_count: enqueued }
}
function sameTask(row: Task | undefined, input: RssPollIdentity, now: Date): row is Task {
  return (
    !!row &&
    row.owner_id === input.subjectId &&
    row.trigger_kind === "rss" &&
    row.trigger_epoch === input.epoch &&
    row.revision === String(input.revision) &&
    row.enabled &&
    row.status === "active" &&
    (row.expires_at === null || row.expires_at > now) &&
    (row.project_id ?? undefined) === input.projectId
  )
}
export class PostgresRssPollRepository implements RssPollRepository {
  public constructor(private readonly pool: Pool) {}
  private async transaction<T>(identity: RssPollIdentity, work: (db: ArchiveSqlLease) => Promise<T>): Promise<T> {
    const db = await ArchiveSqlLease.acquire(this.pool, identity)
    try {
      await db.begin()
      const value = await work(db)
      identity.signal.throwIfAborted()
      await db.query("COMMIT")
      return value
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      db.release()
    }
  }
  private async lockTask(db: ArchiveSqlLease, input: RssPollIdentity): Promise<Task | undefined> {
    const binding = (
      await db.query<{ project_id: string | null }>(`SELECT project_id FROM bff_scheduled_task WHERE tenant_id=$1 AND task_id=$2 AND owner_id=$3`, [
        input.tenantId,
        input.taskId,
        input.subjectId,
      ])
    ).rows[0]
    if (!binding) return undefined
    if (binding.project_id !== null) {
      const parent = await db.query(
        `SELECT project_id FROM bff_project WHERE tenant_id=$1 AND project_id=$2 AND owner_id=$3 AND deleted_at IS NULL FOR SHARE`,
        [input.tenantId, binding.project_id, input.subjectId],
      )
      if (parent.rowCount !== 1) return undefined
    }
    const row = (
      await db.query<Task>(
        `SELECT task_id,owner_id,project_id,revision::text,trigger_epoch::text,trigger_kind,rss_url,rss_conditions,title,prompt,expires_at,enabled,status,auto_approve FROM bff_scheduled_task WHERE tenant_id=$1 AND task_id=$2 AND owner_id=$3 FOR UPDATE`,
        [input.tenantId, input.taskId, input.subjectId],
      )
    ).rows[0]
    return row?.project_id === binding.project_id ? row : undefined
  }
  private async now(db: ArchiveSqlLease) {
    const row = (
      await db.query<{ now: Date; nanoseconds: string }>(
        `SELECT clock_timestamp() AS now,(EXTRACT(EPOCH FROM clock_timestamp())*1000000000)::numeric(30,0)::text AS nanoseconds`,
      )
    ).rows[0]
    if (!row || !(row.now instanceof Date) || !Number.isFinite(row.now.getTime())) throw Error("rss_poll_clock_invalid")
    return row
  }
  private async finish(db: ArchiveSqlLease, input: RssPollIdentity, result: RssPollSummary): Promise<RssPollSummary> {
    const response = { schema_version: 3, kind: "rss_poll", state: "terminal", response: result }
    await db.query(`UPDATE bff_idempotency_receipt SET status=202,response_body=$3::jsonb WHERE scope=$1 AND fingerprint=$2`, [
      input.scope,
      input.digest,
      JSON.stringify(response),
    ])
    return result
  }
  public async release(lease: RssPollLease): Promise<void> {
    const deadlineAt = Math.min(lease.identity.deadlineAt, performance.now() + 2000)
    if (performance.now() >= deadlineAt) return
    const identity = { ...lease.identity, deadlineAt, signal: new AbortController().signal }
    await this.transaction(identity, async (db) => {
      const receipt = (await db.query<Receipt>(`SELECT fingerprint,response_body FROM bff_idempotency_receipt WHERE scope=$1 FOR UPDATE`, [identity.scope]))
        .rows[0]
      if (
        !receipt ||
        receipt.fingerprint !== identity.digest ||
        receipt.response_body.schema_version !== 3 ||
        receipt.response_body.kind !== "rss_poll" ||
        receipt.response_body.state !== "pending" ||
        receipt.response_body.claim_token !== lease.token
      )
        return
      await this.lockTask(db, identity)
      const poll = (
        await db.query<{ lease_token: string | null; fence: string }>(
          `SELECT lease_token,fence::text FROM bff_scheduled_rss_poll WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE`,
          [identity.tenantId, identity.taskId],
        )
      ).rows[0]
      if (!poll || poll.lease_token !== lease.token || poll.fence !== lease.fence) return
      await db.query(
        `UPDATE bff_scheduled_rss_poll SET fence=fence+1,lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND task_id=$2`,
        [identity.tenantId, identity.taskId],
      )
      await db.query(
        `UPDATE bff_idempotency_receipt SET response_body=jsonb_set(response_body,'{lease_until}','null'::jsonb) WHERE scope=$1 AND fingerprint=$2`,
        [identity.scope, identity.digest],
      )
    })
  }
  public async claim(input: RssPollIdentity): Promise<RssPollClaim> {
    canonicalEpoch(input.epoch)
    return this.transaction(input, async (db) => {
      const token = randomUUID()
      const envelope: {
        schema_version: number
        kind: string
        state: string
        claim_token: string
        lease_until: string | null
        rss_poll: Record<string, unknown>
      } = {
        schema_version: 3,
        kind: "rss_poll",
        state: "pending",
        claim_token: token,
        lease_until: null,
        rss_poll: { tenant_id: input.tenantId, task_id: input.taskId, subject_id: input.subjectId, revision: input.revision, epoch: input.epoch },
      }
      const inserted = await db.query(
        `INSERT INTO bff_idempotency_receipt(scope,fingerprint,status,response_body) VALUES($1,$2,102,$3::jsonb) ON CONFLICT(scope) DO NOTHING`,
        [input.scope, input.digest, JSON.stringify(envelope)],
      )
      const receipt = (await db.query<Receipt>(`SELECT fingerprint,response_body FROM bff_idempotency_receipt WHERE scope=$1 FOR UPDATE`, [input.scope]))
        .rows[0]
      if (!receipt) throw Error("rss_receipt_missing")
      if (receipt.fingerprint !== input.digest || receipt.response_body.schema_version !== 3 || receipt.response_body.kind !== "rss_poll")
        return { outcome: "conflict" }
      const time = await this.now(db)
      if (receipt.response_body.state === "terminal") return { outcome: "terminal", summary: receipt.response_body.response as RssPollSummary }
      if (
        inserted.rowCount !== 1 &&
        typeof receipt.response_body.lease_until === "string" &&
        Date.parse(receipt.response_body.lease_until) > time.now.getTime()
      )
        return { outcome: "pending" }
      const task = await this.lockTask(db, input)
      const current = await this.now(db)
      if (!sameTask(task, input, current.now)) return { outcome: "terminal", summary: await this.finish(db, input, summary(input, "ineligible")) }
      const poll = (
        await db.query<Poll>(
          `SELECT source_epoch::text,task_revision::text,subject_id,initialized,seen_count,poll_sequence::text,next_poll_at,last_error_code,lease_token,lease_until,fence::text,failure_count FROM bff_scheduled_rss_poll WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE`,
          [input.tenantId, input.taskId],
        )
      ).rows[0]
      const locked = await this.now(db)
      if (!poll || poll.source_epoch !== input.epoch || poll.task_revision !== String(input.revision) || poll.subject_id !== input.subjectId)
        throw Error("rss_poll_binding_invalid")
      if (poll.lease_until !== null && poll.lease_until > locked.now) return { outcome: "pending" }
      if (poll.seen_count === 100000 || poll.last_error_code === "limit_reached")
        return { outcome: "terminal", summary: await this.finish(db, input, summary(input, "limit_reached")) }
      if (poll.next_poll_at > locked.now) return { outcome: "terminal", summary: await this.finish(db, input, summary(input, "not_due")) }
      const updated = await db.query<{ fence: string }>(
        `UPDATE bff_scheduled_rss_poll SET lease_owner=$3,lease_token=$3,lease_until=clock_timestamp()+interval '30 seconds',fence=fence+1,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND task_id=$2 RETURNING fence::text`,
        [input.tenantId, input.taskId, token],
      )
      envelope.lease_until = new Date(locked.now.getTime() + 60000).toISOString()
      await db.query(`UPDATE bff_idempotency_receipt SET response_body=$3::jsonb WHERE scope=$1 AND fingerprint=$2`, [
        input.scope,
        input.digest,
        JSON.stringify(envelope),
      ])
      const trigger = triggerFromWire({ trigger_kind: "rss", feed_url: task.rss_url, conditions: task.rss_conditions })
      if (!trigger) throw Error("rss_poll_trigger_invalid")
      const seen = (
        await db.query<{ item_identity: string }>(
          `SELECT item_identity FROM bff_scheduled_rss_seen WHERE tenant_id=$1 AND task_id=$2 AND source_epoch=$3::bigint`,
          [input.tenantId, input.taskId, input.epoch],
        )
      ).rows.map((row) => row.item_identity)
      return {
        outcome: "claimed",
        lease: {
          identity: input,
          token,
          fence: updated.rows[0]!.fence,
          task: {
            ...trigger,
            triggerEpoch: input.epoch,
            id: task.task_id,
            title: task.title,
            prompt: task.prompt,
            revision: input.revision,
            enabled: task.enabled,
            status: task.status,
            autoApprove: task.auto_approve,
            ...(task.project_id === null ? {} : { projectId: task.project_id }),
            ...(task.expires_at === null ? {} : { expiresAt: task.expires_at }),
          },
          initialized: poll.initialized,
          seen,
          observedAt: locked.now.toISOString(),
          pollId: summary(input, "unchanged").poll_id,
        },
      }
    })
  }
  public async settle(
    input: Readonly<{ lease: RssPollLease; entries: readonly RssFeedEntry[]; launches: readonly RssFrozenLaunch[]; error: RssErrorCode | null }>,
  ): Promise<RssPollSummary> {
    const lease = input.lease,
      id = lease.identity
    return this.transaction(id, async (db) => {
      const receipt = (await db.query<Receipt>(`SELECT fingerprint,response_body FROM bff_idempotency_receipt WHERE scope=$1 FOR UPDATE`, [id.scope])).rows[0]
      const clock = await this.now(db)
      if (
        !receipt ||
        receipt.fingerprint !== id.digest ||
        receipt.response_body.claim_token !== lease.token ||
        typeof receipt.response_body.lease_until !== "string" ||
        Date.parse(receipt.response_body.lease_until) <= clock.now.getTime()
      )
        throw Error("rss_receipt_claim_lost")
      const task = await this.lockTask(db, id)
      const poll = (
        await db.query<Poll>(
          `SELECT source_epoch::text,task_revision::text,subject_id,initialized,seen_count,poll_sequence::text,next_poll_at,last_error_code,lease_token,lease_until,fence::text,failure_count FROM bff_scheduled_rss_poll WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE`,
          [id.tenantId, id.taskId],
        )
      ).rows[0]
      const time = await this.now(db)
      if (!sameTask(task, id, time.now)) return this.finish(db, id, summary(id, "ineligible"))
      if (
        !poll ||
        poll.fence !== lease.fence ||
        poll.lease_token !== lease.token ||
        poll.source_epoch !== id.epoch ||
        poll.task_revision !== String(id.revision) ||
        poll.subject_id !== id.subjectId ||
        poll.lease_until === null ||
        poll.lease_until <= time.now
      )
        throw Error("rss_poll_claim_lost")
      if (input.entries.length > 200 || input.launches.length > 200 || new Set(input.entries.map((x) => x.identity)).size !== input.entries.length)
        throw Error("rss_poll_entries_invalid")
      let error = input.error
      const known = new Set(
        (
          await db.query<{ item_identity: string }>(`SELECT item_identity FROM bff_scheduled_rss_seen WHERE tenant_id=$1 AND task_id=$2 AND source_epoch=$3`, [
            id.tenantId,
            id.taskId,
            id.epoch,
          ])
        ).rows.map((row) => row.item_identity),
      )
      const fresh = input.entries.filter((entry) => !known.has(entry.identity))
      const launches = input.launches
        .filter((launch) => !known.has(launch.item.identity))
        .sort((a, b) => Buffer.compare(Buffer.from(a.item.identity), Buffer.from(b.item.identity)))
      if (!poll.initialized && launches.length) throw Error("rss_poll_baseline_dispatch_invalid")
      if (poll.seen_count + fresh.length > 100000) error = "limit_reached"
      await db.query(
        `INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,subject_id,session_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,task_id) DO NOTHING`,
        [id.tenantId, id.taskId, id.subjectId, `scheduled:${id.taskId}`],
      )
      const scope = (
        await db.query<{ subject_id: string; session_id: string; rss_order_high_watermark: string | null }>(
          `SELECT subject_id,session_id,rss_order_high_watermark FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE`,
          [id.tenantId, id.taskId],
        )
      ).rows[0]
      if (!scope || scope.subject_id !== id.subjectId || scope.session_id !== `scheduled:${id.taskId}`) throw Error("rss_poll_scope_invalid")
      const capacity = (
        await db.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2 AND source_kind='rss' AND status IN('pending','leased','retryable','admitted')`,
          [id.tenantId, id.taskId],
        )
      ).rows[0]
      if (error === null && BigInt(capacity?.count ?? "0") + BigInt(launches.length) > 1000n) error = "queue_full"
      if (error !== null) {
        const delay = Math.min(3600000, 60000 * 2 ** Math.min(poll.failure_count, 6))
        await db.query(
          `UPDATE bff_scheduled_rss_poll SET failure_count=failure_count+1,last_error_code=$3,next_poll_at=clock_timestamp()+($4*interval '1 millisecond'),lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND task_id=$2`,
          [id.tenantId, id.taskId, error, Math.min(3600000, delay + Math.floor(Math.random() * delay * 0.1))],
        )
        return this.finish(db, id, summary(id, error === "limit_reached" ? "limit_reached" : "backoff"))
      }
      const order = rssOrderBatch({
        observedNanoseconds: time.nanoseconds,
        highWatermark: scope.rss_order_high_watermark,
        identities: launches.map((launch) => launch.item.identity),
      })
      for (let index = 0; index < launches.length; index++) {
        const launch = launches[index]!
        if (!fresh.some((entry) => entry.identity === launch.item.identity)) throw Error("rss_poll_launch_invalid")
        await db.query(
          `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,source_kind,source_revision,source_epoch,source_item_identity,source_observed_at,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload)
 VALUES($1,$2,$3,'rss',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
          [
            launch.dispatchId,
            id.tenantId,
            id.taskId,
            id.revision,
            id.epoch,
            launch.item.identity,
            time.now,
            `rss:${id.epoch}:${launch.item.identity}`,
            order.keys[index],
            id.subjectId,
            id.requestId,
            launch.idempotencyKey,
            hash.generate(JSON.stringify(launch.body)),
            launch.runId,
            launch.identityAssertionRef,
            JSON.stringify(launch.body),
          ],
        )
      }
      for (const entry of [...fresh].sort((a, b) => Buffer.compare(Buffer.from(a.identity), Buffer.from(b.identity)))) {
        const launch = launches.find((value) => value.item.identity === entry.identity)
        await db.query(
          `INSERT INTO bff_scheduled_rss_seen(tenant_id,task_id,source_epoch,item_identity,content_digest,first_poll_sequence,first_seen_at,matched,dispatch_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id.tenantId,
            id.taskId,
            id.epoch,
            entry.identity,
            hash.generate(JSON.stringify(entry)),
            (BigInt(poll.poll_sequence) + 1n).toString(),
            time.now,
            launch !== undefined,
            launch?.dispatchId ?? null,
          ],
        )
      }
      if (launches.length)
        await db.query(`UPDATE bff_scheduled_agent_scope SET rss_order_high_watermark=$3,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND task_id=$2`, [
          id.tenantId,
          id.taskId,
          order.highWatermark,
        ])
      await db.query(
        `UPDATE bff_scheduled_rss_poll SET initialized=true,poll_sequence=poll_sequence+1,seen_count=seen_count+$3,last_checked_at=$4,next_poll_at=$4::timestamptz+interval '1 minute',failure_count=0,last_error_code=NULL,lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND task_id=$2`,
        [id.tenantId, id.taskId, fresh.length, time.now],
      )
      return this.finish(
        db,
        id,
        summary(id, !poll.initialized ? "baseline" : launches.length ? "enqueued" : "unchanged", input.entries.length, launches.length),
      )
    })
  }
}
