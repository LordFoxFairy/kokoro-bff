import type { Pool } from "pg"
import type { TelegramConnectionConfig } from "../../config/runtime.js"
import { newTelegramSetupId, proofDigest, secretMatches, type ConnectionCommand } from "../../domain/agent-connection.js"

type Slot = {
  state_version: number
  bot_id: string | null
  setup_id: string | null
  setup_expires_at: Date | null
  setup_live: boolean | null
  proof_digest: string | null
  connected_at: Date | null
}

type Scope = { tenantId: string; subjectId: string; signal: AbortSignal; timeoutMs: number }
type CommonState = { platform: "telegram"; state_version: string }
type State = CommonState &
  (
    | { status: "disconnected" | "expired" }
    | { status: "awaiting_telegram"; setup_id: string; expires_at: string; continue_url: string }
    | { status: "awaiting_confirmation"; setup_id: string; expires_at: string }
    | { status: "connected"; connected_at: string }
  )
type Result =
  | { kind: "state"; data: State }
  | { kind: "stale" | "conflict" | "already_connected" | "proof_invalid" | "identity_in_use" | "provider_unavailable" }

const revisionLimit = 2_147_483_647
const columns =
  "state_version,bot_id,setup_id,setup_expires_at,setup_expires_at > clock_timestamp() AS setup_live,proof_digest,connected_at"
const ownership = "tenant_id=$1 AND subject_id=$2 AND provider='telegram'"
const clearSetup = "setup_id=NULL,setup_expires_at=NULL,proof_digest=NULL,provider_update_id=NULL"
const clearSlot = `${clearSetup},bot_id=NULL,external_user_id=NULL,connected_at=NULL`

async function select(pool: Pool, text: string, values: unknown[], scope: Pick<Scope, "signal" | "timeoutMs">): Promise<Slot | null> {
  scope.signal.throwIfAborted()
  const options = { text, values, query_timeout: scope.timeoutMs }
  return (await pool.query<Slot>(options)).rows[0] ?? null
}

const read = (pool: Pool, scope: Scope): Promise<Slot | null> =>
  select(pool, `SELECT ${columns} FROM bff_agent_connection WHERE ${ownership}`, [scope.tenantId, scope.subjectId], scope)

function state(row: Slot | null, config: TelegramConnectionConfig | null): State {
  const common = { platform: "telegram" as const, state_version: String(row?.state_version ?? 1) }
  if (row?.connected_at) return { ...common, status: "connected", connected_at: row.connected_at.toISOString() }
  if (!row?.setup_id || !row.setup_expires_at) return { ...common, status: "disconnected" }
  if (!row.setup_live || !config || row.bot_id !== config.botId) return { ...common, status: "expired" }
  const setup = { setup_id: row.setup_id, expires_at: row.setup_expires_at.toISOString() }
  if (row.proof_digest) return { ...common, ...setup, status: "awaiting_confirmation" }
  return { ...common, ...setup, status: "awaiting_telegram", continue_url: `https://t.me/${config.username}?start=${row.setup_id}` }
}

export async function readTelegramConnection(pool: Pool, scope: Scope, config: TelegramConnectionConfig | null): Promise<Result> {
  const row = await read(pool, scope)
  return config || row?.connected_at ? { kind: "state", data: state(row, config) } : { kind: "provider_unavailable" }
}

function uniqueBoundIdentity(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === "uq_bff_agent_connection_bound_identity"
}

export async function changeTelegramConnection(pool: Pool, scope: Scope, config: TelegramConnectionConfig | null, command: ConnectionCommand): Promise<Result> {
  if ((command.action === "start" || command.action === "confirm") && config === null) return { kind: "provider_unavailable" }
  const row = await read(pool, scope)
  const revision = row?.state_version ?? 1
  const expected = Number(command.expected_state_version)
  const current = state(row, config)
  if (command.action === "cancel" && row?.connected_at) return { kind: "already_connected" }
  const racedOnlyWithClaim = command.action === "cancel" && row?.setup_id === command.setup_id && row.proof_digest !== null &&
    revision === expected + 1
  if (revision !== expected && !racedOnlyWithClaim) return { kind: "stale" }

  let set: string, guard = ""
  const values: unknown[] = [scope.tenantId, scope.subjectId, revision]
  switch (command.action) {
    case "start": {
      if (current.status !== "disconnected" && current.status !== "expired") return { kind: "conflict" }
      const setup = newTelegramSetupId()
      const botId = config!.botId
      if (row === null) {
        const created = await select(pool, `INSERT INTO bff_agent_connection
            (tenant_id,subject_id,provider,state_version,bot_id,setup_id,setup_expires_at)
          VALUES ($1,$2,'telegram',2,$3,$4,clock_timestamp()+interval '10 minutes')
          ON CONFLICT (tenant_id,subject_id,provider) DO NOTHING RETURNING ${columns}`,
        [scope.tenantId, scope.subjectId, botId, setup], scope)
        return created ? { kind: "state", data: state(created, config) } : { kind: "stale" }
      }
      values.push(botId, setup)
      set = "bot_id=$4,setup_id=$5,setup_expires_at=clock_timestamp()+interval '10 minutes',proof_digest=NULL,provider_update_id=NULL,external_user_id=NULL"
      guard = " AND connected_at IS NULL AND (setup_id IS NULL OR bot_id<>$4 OR setup_expires_at<=clock_timestamp())"
      break
    }
    case "cancel":
      if (!row?.setup_id || row.setup_id !== command.setup_id) return { kind: "conflict" }
      // A callback racing after the read may advance the same attempt once.
      // The exact setup predicate excludes replaced, cancelled or confirmed attempts.
      values[2] = expected
      values.push(command.setup_id)
      set = clearSlot
      guard = " AND setup_id=$4 AND connected_at IS NULL"
      break
    case "confirm": {
      if (current.status !== "awaiting_confirmation" || row?.setup_id !== command.setup_id) return { kind: "conflict" }
      const digest = proofDigest(command.proof)
      if (!row.proof_digest || !secretMatches(row.proof_digest, digest)) return { kind: "proof_invalid" }
      values.push(command.setup_id, config!.botId, digest)
      set = `${clearSetup},connected_at=clock_timestamp()`
      guard = " AND setup_id=$4 AND bot_id=$5 AND proof_digest=$6 AND connected_at IS NULL AND setup_expires_at>clock_timestamp()"
      break
    }
    case "disconnect":
      if (current.status === "disconnected") return { kind: "state", data: current }
      if (current.status !== "connected") return { kind: "conflict" }
      set = clearSlot
      guard = " AND connected_at IS NOT NULL"
      break
  }

  if (revision >= revisionLimit) return { kind: "stale" }
  const revisionPredicate = command.action === "cancel"
    ? "(state_version=$3 OR (state_version::bigint=$3::bigint+1 AND proof_digest IS NOT NULL))"
    : "state_version=$3"
  try {
    const updated = await select(pool, `WITH locked AS MATERIALIZED (
      SELECT tenant_id AS lock_tenant,subject_id AS lock_subject FROM bff_agent_connection
      WHERE ${ownership} FOR UPDATE NOWAIT
    ) UPDATE bff_agent_connection SET state_version=state_version+1,${set}
      FROM locked WHERE ${ownership} AND tenant_id=locked.lock_tenant AND subject_id=locked.lock_subject
      AND state_version<${revisionLimit} AND ${revisionPredicate}${guard} RETURNING ${columns}`, values, scope)
    return updated ? { kind: "state", data: state(updated, config) } : { kind: "stale" }
  } catch (error) {
    if (uniqueBoundIdentity(error)) return { kind: "identity_in_use" }
    throw error
  }
}

export async function claimTelegramSetup(
  pool: Pool,
  input: { tenantId: string; setupId: string; botId: string; externalUserId: string; updateId: string; proof: string; signal: AbortSignal; timeoutMs: number },
): Promise<boolean> {
  const slot = await select(pool, `WITH locked AS MATERIALIZED (
    SELECT setup_id AS lock_setup FROM bff_agent_connection
    WHERE tenant_id=$1 AND provider='telegram' AND setup_id=$2 AND bot_id=$3
    FOR UPDATE NOWAIT
  ) UPDATE bff_agent_connection SET state_version=state_version+1,external_user_id=$4,provider_update_id=$5,proof_digest=$6
    FROM locked WHERE setup_id=locked.lock_setup AND tenant_id=$1 AND provider='telegram' AND setup_id=$2 AND bot_id=$3
    AND connected_at IS NULL AND proof_digest IS NULL AND setup_expires_at>clock_timestamp()
    AND state_version<${revisionLimit} RETURNING ${columns}`,
  [input.tenantId, input.setupId, input.botId, input.externalUserId, input.updateId, proofDigest(input.proof)], input)
  return slot !== null
}
