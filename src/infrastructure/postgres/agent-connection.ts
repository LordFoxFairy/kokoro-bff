import type { Pool } from "pg"
import type { LineConnectionConfig, TelegramConnectionConfig } from "../../config/runtime.js"
import { newAgentConnectionSetupId, proofDigest, secretMatches, type ConnectionCommand, type ConnectionProvider } from "../../domain/agent-connection.js"

type Slot = {
  state_version: number
  bot_id: string | null
  setup_id: string | null
  setup_expires_at: Date | null
  setup_live: boolean | null
  proof_digest: string | null
  external_user_id: string | null
  connected_at: Date | null
}

type Lifetime = { signal: AbortSignal; timeoutMs: number }
type Scope = Lifetime & { tenantId: string; subjectId: string; platform: ConnectionProvider }
type Bot = TelegramConnectionConfig | LineConnectionConfig
type Setup = { setup_id: string; expires_at: string }
type State =
  | { platform: ConnectionProvider; state_version: string; status: "disconnected" | "expired" }
  | { platform: ConnectionProvider; state_version: string; status: "connected"; connected_at: string }
  | ({ platform: "telegram"; state_version: string; status: "awaiting_telegram"; continue_url: string } & Setup)
  | ({ platform: "telegram"; state_version: string; status: "awaiting_confirmation" } & Setup)
  | ({ platform: "line"; state_version: string; status: "awaiting_line"; continue_url: string } & Setup)
  | ({ platform: "line"; state_version: string; status: "awaiting_line_approval" | "awaiting_line_callback" } & Setup)
type Failure = { kind: "stale" | "conflict" | "already_connected" | "proof_invalid" | "identity_in_use" | "provider_unavailable" }
type Result = { kind: "state"; data: State } | Failure
type LineContinuation = {
  kind: "line_continuation"
  data: Setup & {
    platform: "line"
    status: "awaiting_line_callback"
    state_version: string
  }
  nonce: string
}

const revisionLimit = 2_147_483_647
const columns = "state_version,bot_id,setup_id,setup_expires_at,setup_expires_at > clock_timestamp() AS setup_live,proof_digest,external_user_id,connected_at"
const ownership = "tenant_id=$1 AND subject_id=$2 AND provider=$3"
const clearSetup = "setup_id=NULL,setup_expires_at=NULL,proof_digest=NULL,provider_update_id=NULL"
const clearSlot = `${clearSetup},bot_id=NULL,external_user_id=NULL,connected_at=NULL`
const ownerValues = (scope: Scope) => [scope.tenantId, scope.subjectId, scope.platform]

async function select(pool: Pool, text: string, values: unknown[], lifetime: Lifetime): Promise<Slot | null> {
  lifetime.signal.throwIfAborted()
  const options = { text, values, query_timeout: lifetime.timeoutMs }
  return (await pool.query<Slot>(options)).rows[0] ?? null
}

const read = (pool: Pool, scope: Scope): Promise<Slot | null> =>
  select(pool, `SELECT ${columns} FROM bff_agent_connection WHERE ${ownership}`, ownerValues(scope), scope)

function state(row: Slot | null, platform: ConnectionProvider, bot: Bot | null): State {
  const state_version = String(row?.state_version ?? 1)
  if (row?.connected_at) return { platform, state_version, status: "connected", connected_at: row.connected_at.toISOString() }
  if (!row?.setup_id || !row.setup_expires_at) return { platform, state_version, status: "disconnected" }
  if (!row.setup_live || !bot || row.bot_id !== bot.botId) return { platform, state_version, status: "expired" }
  const setup = { setup_id: row.setup_id, expires_at: row.setup_expires_at.toISOString() }
  if (platform === "line" && "accountId" in bot) {
    if (row.external_user_id === null)
      return {
        platform,
        state_version,
        ...setup,
        status: "awaiting_line",
        continue_url: `https://line.me/R/oaMessage/${encodeURIComponent(bot.accountId)}/?${encodeURIComponent(`Kokoro connect ${row.setup_id}`)}`,
      }
    return { platform, state_version, ...setup, status: row.proof_digest ? "awaiting_line_callback" : "awaiting_line_approval" }
  }
  if (platform === "telegram" && "username" in bot) {
    if (row.proof_digest) return { platform, state_version, ...setup, status: "awaiting_confirmation" }
    return { platform, state_version, ...setup, status: "awaiting_telegram", continue_url: `https://t.me/${bot.username}?start=${row.setup_id}` }
  }
  throw new Error("agent connection configuration does not match the platform")
}

export async function readAgentConnection(pool: Pool, scope: Scope, bot: Bot | null): Promise<Result> {
  const row = await read(pool, scope)
  return bot || row?.connected_at ? { kind: "state", data: state(row, scope.platform, bot) } : { kind: "provider_unavailable" }
}

function uniqueBoundIdentity(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "uq_bff_agent_connection_bound_identity"
  )
}

export async function changeAgentConnection(pool: Pool, scope: Scope, bot: Bot | null, command: ConnectionCommand): Promise<Result> {
  if ((command.action === "start" || command.action === "confirm") && bot === null) return { kind: "provider_unavailable" }
  const row = await read(pool, scope)
  const revision = row?.state_version ?? 1
  const expected = Number(command.expected_state_version)
  const current = state(row, scope.platform, bot)
  if (command.action === "cancel" && row?.connected_at) return { kind: "already_connected" }
  const telegramCancel = command.action === "cancel" && scope.platform === "telegram"
  const racedOnlyWithClaim = telegramCancel && row?.setup_id === command.setup_id && row.proof_digest !== null && revision === expected + 1
  if (revision !== expected && !racedOnlyWithClaim) return { kind: "stale" }

  let set: string,
    guard = ""
  const values: unknown[] = [...ownerValues(scope), revision]
  switch (command.action) {
    case "start": {
      if (current.status !== "disconnected" && current.status !== "expired") return { kind: "conflict" }
      const setup = newAgentConnectionSetupId()
      const botId = bot!.botId
      if (row === null) {
        const created = await select(
          pool,
          `INSERT INTO bff_agent_connection
            (tenant_id,subject_id,provider,state_version,bot_id,setup_id,setup_expires_at)
          VALUES ($1,$2,$3,2,$4,$5,clock_timestamp()+interval '10 minutes')
          ON CONFLICT (tenant_id,subject_id,provider) DO NOTHING RETURNING ${columns}`,
          [...ownerValues(scope), botId, setup],
          scope,
        )
        return created ? { kind: "state", data: state(created, scope.platform, bot) } : { kind: "stale" }
      }
      values.push(botId, setup)
      set = "bot_id=$5,setup_id=$6,setup_expires_at=clock_timestamp()+interval '10 minutes',proof_digest=NULL,provider_update_id=NULL,external_user_id=NULL"
      guard = " AND connected_at IS NULL AND (setup_id IS NULL OR bot_id<>$5 OR setup_expires_at<=clock_timestamp())"
      break
    }
    case "cancel":
      if (!row?.setup_id || row.setup_id !== command.setup_id) return { kind: "conflict" }
      // A callback racing after the read may advance the same attempt once.
      // The exact setup predicate excludes replaced, cancelled or confirmed attempts.
      values[3] = expected
      values.push(command.setup_id)
      set = clearSlot
      guard = " AND setup_id=$5 AND connected_at IS NULL"
      break
    case "confirm": {
      if (current.status !== "awaiting_confirmation" || row?.setup_id !== command.setup_id) return { kind: "conflict" }
      const digest = proofDigest(command.proof)
      if (!row.proof_digest || !secretMatches(row.proof_digest, digest)) return { kind: "proof_invalid" }
      values.push(command.setup_id, bot!.botId, digest)
      set = `${clearSetup},connected_at=clock_timestamp()`
      guard = " AND setup_id=$5 AND bot_id=$6 AND proof_digest=$7 AND connected_at IS NULL AND setup_expires_at>clock_timestamp()"
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
  const revisionPredicate = telegramCancel ? "(state_version=$4 OR (state_version::bigint=$4::bigint+1 AND proof_digest IS NOT NULL))" : "state_version=$4"
  try {
    const updated = await select(
      pool,
      `WITH locked AS MATERIALIZED (
      SELECT tenant_id AS lock_tenant,subject_id AS lock_subject FROM bff_agent_connection
      WHERE ${ownership} FOR UPDATE NOWAIT
    ) UPDATE bff_agent_connection SET state_version=state_version+1,${set}
      FROM locked WHERE ${ownership} AND tenant_id=locked.lock_tenant AND subject_id=locked.lock_subject
      AND state_version<${revisionLimit} AND ${revisionPredicate}${guard} RETURNING ${columns}`,
      values,
      scope,
    )
    return updated ? { kind: "state", data: state(updated, scope.platform, bot) } : { kind: "stale" }
  } catch (error) {
    if (uniqueBoundIdentity(error)) return { kind: "identity_in_use" }
    throw error
  }
}

type ProviderClaim = Lifetime & { tenantId: string; setupId: string; botId: string; externalUserId: string }

export async function claimTelegramSetup(pool: Pool, input: ProviderClaim & { updateId: string; proof: string }): Promise<boolean> {
  const slot = await select(
    pool,
    `WITH locked AS MATERIALIZED (
    SELECT setup_id AS lock_setup FROM bff_agent_connection
    WHERE tenant_id=$1 AND provider='telegram' AND setup_id=$2 AND bot_id=$3
    FOR UPDATE NOWAIT
  ) UPDATE bff_agent_connection SET state_version=state_version+1,external_user_id=$4,provider_update_id=$5,proof_digest=$6
    FROM locked WHERE setup_id=locked.lock_setup AND tenant_id=$1 AND provider='telegram' AND setup_id=$2 AND bot_id=$3
    AND connected_at IS NULL AND proof_digest IS NULL AND setup_expires_at>clock_timestamp()
    AND state_version<${revisionLimit} RETURNING ${columns}`,
    [input.tenantId, input.setupId, input.botId, input.externalUserId, input.updateId, proofDigest(input.proof)],
    input,
  )
  return slot !== null
}

export async function claimLineSetup(pool: Pool, input: ProviderClaim & { updateId: string }): Promise<boolean> {
  const slot = await select(
    pool,
    `WITH locked AS MATERIALIZED (
    SELECT setup_id AS lock_setup FROM bff_agent_connection
    WHERE tenant_id=$1 AND provider='line' AND setup_id=$2 AND bot_id=$3
    FOR UPDATE NOWAIT
  ) UPDATE bff_agent_connection SET state_version=state_version+1,external_user_id=$4,provider_update_id=$5
    FROM locked WHERE setup_id=locked.lock_setup AND tenant_id=$1 AND provider='line' AND setup_id=$2 AND bot_id=$3
    AND connected_at IS NULL AND external_user_id IS NULL AND setup_expires_at>clock_timestamp()
    AND state_version<${revisionLimit} RETURNING ${columns}`,
    [input.tenantId, input.setupId, input.botId, input.externalUserId, input.updateId],
    input,
  )
  return slot !== null
}

export async function authorizeLineSetup(
  pool: Pool,
  scope: Scope & { platform: "line" },
  config: LineConnectionConfig | null,
  setupId: string,
  expectedRevision: string,
): Promise<LineContinuation | Failure> {
  if (!config) return { kind: "provider_unavailable" }
  const row = await read(pool, scope)
  const revision = row?.state_version ?? 1
  if (revision !== Number(expectedRevision) || revision >= revisionLimit) return { kind: "stale" }
  if (row?.setup_id !== setupId || state(row, "line", config).status !== "awaiting_line_approval") return { kind: "conflict" }

  // The public setup ID indexes the one row. Only the hash of the full nonce,
  // including a new random suffix, is stored and accepted by the callback.
  const nonce = setupId + newAgentConnectionSetupId()
  const updated = await select(
    pool,
    `WITH locked AS MATERIALIZED (
    SELECT setup_id AS lock_setup FROM bff_agent_connection
    WHERE ${ownership} AND setup_id=$4 AND bot_id=$5 FOR UPDATE NOWAIT
  ) UPDATE bff_agent_connection SET state_version=state_version+1,proof_digest=$7
    FROM locked WHERE ${ownership} AND setup_id=locked.lock_setup AND setup_id=$4 AND bot_id=$5
    AND state_version=$6 AND connected_at IS NULL AND external_user_id IS NOT NULL
    AND proof_digest IS NULL AND setup_expires_at>clock_timestamp() RETURNING ${columns}`,
    [...ownerValues(scope), setupId, config.botId, revision, proofDigest(nonce)],
    scope,
  )
  if (!updated?.setup_expires_at) return { kind: "stale" }
  return {
    kind: "line_continuation",
    nonce,
    data: {
      platform: "line",
      status: "awaiting_line_callback",
      state_version: String(updated.state_version),
      setup_id: setupId,
      expires_at: updated.setup_expires_at.toISOString(),
    },
  }
}

export async function completeLineSetup(pool: Pool, input: ProviderClaim & { nonce: string }): Promise<void> {
  try {
    await select(
      pool,
      `WITH locked AS MATERIALIZED (
      SELECT setup_id AS lock_setup FROM bff_agent_connection
      WHERE tenant_id=$1 AND provider='line' AND setup_id=$2 AND bot_id=$3 FOR UPDATE NOWAIT
    ) UPDATE bff_agent_connection SET state_version=state_version+1,${clearSetup},connected_at=clock_timestamp()
      FROM locked WHERE setup_id=locked.lock_setup AND tenant_id=$1 AND provider='line' AND setup_id=$2 AND bot_id=$3
      AND connected_at IS NULL AND external_user_id=$4 AND proof_digest=$5 AND setup_expires_at>clock_timestamp()
      AND state_version<${revisionLimit} RETURNING ${columns}`,
      [input.tenantId, input.setupId, input.botId, input.externalUserId, proofDigest(input.nonce)],
      input,
    )
  } catch (error) {
    if (!uniqueBoundIdentity(error)) throw error
  }
}
