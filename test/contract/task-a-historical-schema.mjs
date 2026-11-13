import { restoreProjectGrantSchema } from "../../scripts/project-grant-public-contract.mjs"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"

const digest = (value) => createHash("sha256").update(value).digest("hex")

const historicalScheduledConsumerColumns = `  source_high_watermark BIGINT NOT NULL DEFAULT 0,
  consumer_next_poll_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  consumer_lease_owner TEXT,
  consumer_lease_token TEXT,
  consumer_lease_until TIMESTAMPTZ(3),
  consumer_fence BIGINT NOT NULL DEFAULT 0,
  consumer_failure_count BIGINT NOT NULL DEFAULT 0,
`
const historicalScheduledConsumerConstraints = `  CONSTRAINT ck_bff_scheduled_agent_scope_source CHECK (source_high_watermark >= 0),
  CONSTRAINT ck_bff_scheduled_agent_scope_consumer CHECK (
    (consumer_lease_owner IS NULL AND consumer_lease_token IS NULL AND consumer_lease_until IS NULL)
    OR (consumer_lease_owner IS NOT NULL AND consumer_lease_token IS NOT NULL AND consumer_lease_until IS NOT NULL)
  )`
const historicalScheduledSourceEvents = `CREATE TABLE IF NOT EXISTS bff_scheduled_agent_source_event (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  source_sequence BIGINT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_run_id TEXT NOT NULL,
  source_owner TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  source_occurred_at TIMESTAMPTZ(3) NOT NULL,
  event_type TEXT NOT NULL,
  source_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,task_id,source_sequence),
  UNIQUE (tenant_id,task_id,source_event_id),
  CONSTRAINT ck_bff_scheduled_agent_source_identity CHECK (
    source_sequence >= 1 AND length(btrim(source_event_id)) > 0
    AND length(btrim(source_run_id)) > 0 AND source_owner='kokoro-agent'
    AND source_digest ~ '^[0-9a-f]{64}$' AND jsonb_typeof(source_payload)='object'
  )
);

`

// Historical proof input only. Project the exact approved Task A schema back
// to d166a51 before the existing Final Answer, Message Actions and Project inverses.
export function restoreTaskAHistoricalSchema(schema) {
  if (schema.includes("-- PROJECT-GRANT-SQL-BEGIN")) {
    try {
      schema = restoreProjectGrantSchema(schema)
    } catch {
      assert.fail("Task A current SQL drift")
    }
  }
  assert.equal(digest(schema), "ad9a8500129ba74b394b10ad57e7d8e5481622a1a59d7e94de568b2f5653c9df", "Task A current SQL drift")
  const historical = schema
    // A-13: verified external channel connections.
    .replace(/^CREATE TABLE IF NOT EXISTS bff_agent_connection \([\s\S]*?(?=^CREATE TABLE IF NOT EXISTS bff_project \()/mu, "")
    // A-06: Project website references.
    .replace(/^  (?:website_urls|websites_state_version) [^\n]+\n/gmu, "")
    // A-10: release exact Conversation workspace outputs.
    .replace(/^CREATE TABLE IF NOT EXISTS bff_project_scope_release_outbox \([\s\S]*?^\);/mu, (table) =>
      table
        .replace("  project_id TEXT,\n", "  project_id TEXT NOT NULL,\n")
        .replace("('project','conversation','conversation_workspace')", "('project','conversation')")
        .replace(/^  CONSTRAINT ck_bff_project_release_parent_kind [^\n]+\n/mu, ""),
    )
    // A-03: same-Run input command and pending index.
    .replace(/^-- Same-Run input is an independent command,[\s\S]*?(?=^-- Transactional Chat -> Agent command queue\.)/mu, "")
    // A-12: canonical scheduled Chat replaces the independent source consumer.
    .replace(/^CREATE TABLE IF NOT EXISTS bff_scheduled_agent_scope \([\s\S]*?^\);/mu, (table) =>
      table
        .replace("  active_run_id TEXT,\n", "  active_run_id TEXT,\n" + historicalScheduledConsumerColumns)
        .replace("\n);", ",\n" + historicalScheduledConsumerConstraints + "\n);"),
    )
    .replace(/^CREATE TABLE IF NOT EXISTS bff_scheduled_agent_dispatch \([\s\S]*?^\);/mu, (table) =>
      table.replace("  user_message_id TEXT NOT NULL,\n  assistant_message_id TEXT NOT NULL,\n", "").replaceAll(",'submitted'", ""),
    )
    .replace("-- A deleted conversation must compensate", (anchor) => historicalScheduledSourceEvents + anchor)
    // A-09 / A-10: favorite state and proven output display path.
    .replace(/^  (?:source_display_path|favorited_at) [^\n]+\n/gmu, "")
  assert.equal(digest(historical), "d0108a23eb57f8bfa9c2166bf82b1f5056d91fa6871da3738442af155d423083", "Task A historical SQL parent drift")
  return historical
}
