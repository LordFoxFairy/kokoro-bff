import { createHash } from "node:crypto"

// Test-only exact inverse certificate, not a schema, installer or migration.
// Parent read from frozen Git object 9fac77d25b4585d916b84c669a720e4c2ba62bb0.
export const rssSchemaParentSha256 = "b4bbfaf0fbf92a528ae38dc2b143ea8bcc08db765074c024b9552447a438e218"
export const rssSchemaCurrentSha256 = "21c5a45a3aec24825c867629fe32fd7e2bbbd5058377a9fdd4911d70d11f37f3"
const hunks = [
  {
    current:
      "  title TEXT NOT NULL,\n  prompt TEXT NOT NULL,\n  trigger_kind TEXT NOT NULL CONSTRAINT ck_bff_scheduled_task_trigger_kind CHECK (trigger_kind IN ('calendar', 'rss')),\n  trigger_epoch BIGINT NOT NULL CONSTRAINT ck_bff_scheduled_task_trigger_epoch CHECK (trigger_epoch >= 1),\n  rss_url TEXT,\n  rss_conditions JSONB,\n  frequency TEXT CONSTRAINT ck_bff_scheduled_task_frequency CHECK (frequency IN ('daily', 'weekly', 'monthly', 'once')),\n  task_time TEXT,\n  timezone TEXT,\n  weekdays SMALLINT[],\n  month_days SMALLINT[],\n",
    parent:
      "  title TEXT NOT NULL,\n  prompt TEXT NOT NULL,\n  frequency TEXT NOT NULL CONSTRAINT ck_bff_scheduled_task_frequency CHECK (frequency IN ('daily', 'weekly', 'monthly', 'once')),\n  task_time TEXT NOT NULL,\n  timezone TEXT NOT NULL,\n  weekdays SMALLINT[],\n  month_days SMALLINT[],\n",
  },
  {
    current:
      "  status TEXT NOT NULL CONSTRAINT ck_bff_scheduled_task_status CHECK (status IN ('active', 'paused', 'failed')),\n  CONSTRAINT ck_bff_scheduled_task_calendar CHECK (\n    ((trigger_kind='calendar' AND rss_url IS NULL AND rss_conditions IS NULL\n      AND frequency IS NOT NULL AND task_time IS NOT NULL AND timezone IS NOT NULL AND (\n    (frequency='daily' AND weekdays IS NULL AND month_days IS NULL AND local_date IS NULL AND run_at IS NULL)\n    OR (frequency='weekly' AND weekdays IS NOT NULL AND month_days IS NULL AND local_date IS NULL AND run_at IS NULL\n",
    parent:
      "  status TEXT NOT NULL CONSTRAINT ck_bff_scheduled_task_status CHECK (status IN ('active', 'paused', 'failed')),\n  CONSTRAINT ck_bff_scheduled_task_calendar CHECK (\n    (frequency='daily' AND weekdays IS NULL AND month_days IS NULL AND local_date IS NULL AND run_at IS NULL)\n    OR (frequency='weekly' AND weekdays IS NOT NULL AND month_days IS NULL AND local_date IS NULL AND run_at IS NULL\n",
  },
  {
    current:
      "      AND month_days <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[] AND array_position(month_days,NULL) IS NULL)\n    OR (frequency='once' AND weekdays IS NULL AND month_days IS NULL AND local_date IS NOT NULL AND run_at IS NOT NULL)\n    )) OR (trigger_kind='rss' AND rss_url IS NOT NULL AND octet_length(rss_url) BETWEEN 1 AND 2048\n      AND rss_conditions IS NOT NULL AND jsonb_typeof(rss_conditions)='array' AND jsonb_array_length(rss_conditions)<=8\n      AND frequency IS NULL AND task_time IS NULL AND timezone IS NULL\n      AND weekdays IS NULL AND month_days IS NULL AND local_date IS NULL AND run_at IS NULL)) IS TRUE\n  ),\n  revision BIGINT NOT NULL DEFAULT 1 CONSTRAINT ck_bff_scheduled_task_revision CHECK (revision >= 1),\n",
    parent:
      "      AND month_days <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[] AND array_position(month_days,NULL) IS NULL)\n    OR (frequency='once' AND weekdays IS NULL AND month_days IS NULL AND local_date IS NOT NULL AND run_at IS NOT NULL)\n  ),\n  revision BIGINT NOT NULL DEFAULT 1 CONSTRAINT ck_bff_scheduled_task_revision CHECK (revision >= 1),\n",
  },
  {
    current:
      "CREATE INDEX IF NOT EXISTS ix_bff_scheduled_task_owner\n  ON bff_scheduled_task (tenant_id, owner_id, created_at ASC, task_id ASC);\n\n-- RSS network reads never hold these rows. A fenced short transaction owns\n-- each current poll and atomically commits its seen items, dispatches and receipt.\nCREATE TABLE IF NOT EXISTS bff_scheduled_rss_poll (\n  tenant_id TEXT NOT NULL,\n  task_id TEXT NOT NULL,\n  source_epoch BIGINT NOT NULL,\n  task_revision BIGINT NOT NULL,\n  subject_id TEXT NOT NULL,\n  initialized BOOLEAN NOT NULL DEFAULT false,\n  poll_sequence BIGINT NOT NULL DEFAULT 0,\n  seen_count INTEGER NOT NULL DEFAULT 0,\n  next_poll_at TIMESTAMPTZ(3) NOT NULL,\n  last_checked_at TIMESTAMPTZ(3),\n  failure_count INTEGER NOT NULL DEFAULT 0,\n  last_error_code TEXT,\n  lease_owner TEXT,\n  lease_token TEXT,\n  lease_until TIMESTAMPTZ(3),\n  fence BIGINT NOT NULL DEFAULT 0,\n  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n  PRIMARY KEY (tenant_id, task_id),\n  CONSTRAINT ck_bff_scheduled_rss_poll_identity CHECK (\n    length(btrim(tenant_id))>0 AND length(btrim(task_id))>0 AND length(btrim(subject_id))>0\n  ),\n  CONSTRAINT ck_bff_scheduled_rss_poll_version CHECK (source_epoch>=1 AND task_revision>=1 AND fence>=0),\n  CONSTRAINT ck_bff_scheduled_rss_poll_counts CHECK (poll_sequence>=0 AND seen_count BETWEEN 0 AND 100000 AND failure_count>=0),\n  CONSTRAINT ck_bff_scheduled_rss_poll_initialized CHECK (\n    (initialized=false AND poll_sequence=0 AND seen_count=0)\n    OR (initialized=true AND poll_sequence>0 AND last_checked_at IS NOT NULL)\n  ),\n  CONSTRAINT ck_bff_scheduled_rss_poll_lease CHECK (\n    (lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL)\n    OR (lease_owner IS NOT NULL AND length(btrim(lease_owner))>0\n      AND lease_token IS NOT NULL AND length(btrim(lease_token))>0 AND lease_until IS NOT NULL)\n  ),\n  CONSTRAINT ck_bff_scheduled_rss_poll_error CHECK (last_error_code IS NULL OR last_error_code IN (\n    'rss_feed_url_invalid','rss_feed_address_forbidden','rss_feed_dns_unavailable','rss_feed_dns_busy',\n    'rss_feed_unavailable','rss_feed_timeout','rss_feed_cancelled','rss_feed_response_invalid','rss_feed_too_large',\n    'feed_invalid','queue_full','launch_too_large','limit_reached'\n  ))\n);\n-- Scheduler callbacks address an exact tenant/task. Its PK serves due/lease\n-- rechecks; there is no global poll scanner requiring another index.\n\nCREATE TABLE IF NOT EXISTS bff_scheduled_rss_seen (\n  tenant_id TEXT NOT NULL,\n  task_id TEXT NOT NULL,\n  source_epoch BIGINT NOT NULL,\n  item_identity TEXT NOT NULL,\n  content_digest TEXT NOT NULL,\n  first_poll_sequence BIGINT NOT NULL,\n  first_seen_at TIMESTAMPTZ(3) NOT NULL,\n  matched BOOLEAN NOT NULL,\n  dispatch_id TEXT,\n  PRIMARY KEY (tenant_id, task_id, source_epoch, item_identity),\n  CONSTRAINT ck_bff_scheduled_rss_seen_identity CHECK (\n    length(btrim(tenant_id))>0 AND length(btrim(task_id))>0 AND source_epoch>=1\n    AND item_identity ~ '^[0-9a-f]{64}$' AND content_digest ~ '^[0-9a-f]{64}$'\n  ),\n  CONSTRAINT ck_bff_scheduled_rss_seen_sequence CHECK (first_poll_sequence>0),\n  CONSTRAINT ck_bff_scheduled_rss_seen_dispatch CHECK (\n    (matched=false AND dispatch_id IS NULL)\n    OR (matched=true AND dispatch_id IS NOT NULL AND length(btrim(dispatch_id))>0)\n  )\n);\n-- The PK supports exact current-epoch dedup and bounded retirement by its\n-- tenant/task/epoch prefix. No TTL, extra queue or redundant global index.\n\n-- ScheduledTask owns this bounded outbox. It is intentionally not a generic\n",
    parent:
      "CREATE INDEX IF NOT EXISTS ix_bff_scheduled_task_owner\n  ON bff_scheduled_task (tenant_id, owner_id, created_at ASC, task_id ASC);\n\n-- ScheduledTask owns this bounded outbox. It is intentionally not a generic\n",
  },
  {
    current:
      "  active_dispatch_id TEXT,\n  active_run_id TEXT,\n  rss_order_high_watermark TEXT,\n  source_high_watermark BIGINT NOT NULL DEFAULT 0,\n  consumer_next_poll_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n",
    parent:
      "  active_dispatch_id TEXT,\n  active_run_id TEXT,\n  source_high_watermark BIGINT NOT NULL DEFAULT 0,\n  consumer_next_poll_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n",
  },
  {
    current:
      "    OR (active_dispatch_id IS NOT NULL AND active_run_id IS NOT NULL)\n  ),\n  CONSTRAINT ck_bff_scheduled_agent_scope_rss_order CHECK (rss_order_high_watermark IS NULL OR rss_order_high_watermark ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{9}Z$'),\n  CONSTRAINT ck_bff_scheduled_agent_scope_source CHECK (source_high_watermark >= 0),\n  CONSTRAINT ck_bff_scheduled_agent_scope_consumer CHECK (\n",
    parent:
      "    OR (active_dispatch_id IS NOT NULL AND active_run_id IS NOT NULL)\n  ),\n  CONSTRAINT ck_bff_scheduled_agent_scope_source CHECK (source_high_watermark >= 0),\n  CONSTRAINT ck_bff_scheduled_agent_scope_consumer CHECK (\n",
  },
  {
    current:
      "  tenant_id TEXT NOT NULL,\n  task_id TEXT NOT NULL,\n  source_kind TEXT NOT NULL,\n  source_revision BIGINT NOT NULL,\n  source_epoch BIGINT NOT NULL,\n  source_item_identity TEXT,\n  source_observed_at TIMESTAMPTZ(3),\n  occurrence TEXT NOT NULL,\n  occurrence_order_key TEXT NOT NULL,\n",
    parent: "  tenant_id TEXT NOT NULL,\n  task_id TEXT NOT NULL,\n  occurrence TEXT NOT NULL,\n  occurrence_order_key TEXT NOT NULL,\n",
  },
  {
    current:
      "  UNIQUE (tenant_id, task_id, idempotency_key),\n  UNIQUE (tenant_id, run_id),\n  CONSTRAINT ck_bff_scheduled_agent_dispatch_source CHECK (\n    source_revision>=1 AND source_epoch>=1 AND (\n      (source_kind='calendar' AND source_item_identity IS NULL AND source_observed_at IS NULL)\n      OR (source_kind='rss' AND source_item_identity IS NOT NULL AND source_item_identity ~ '^[0-9a-f]{64}$'\n        AND source_observed_at IS NOT NULL\n        AND occurrence='rss:' || source_epoch::text || ':' || source_item_identity)\n    ) IS TRUE\n  ),\n  CONSTRAINT ck_bff_scheduled_agent_dispatch_order CHECK (occurrence_order_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{9}Z$'),\n  CONSTRAINT ck_bff_scheduled_agent_dispatch_digest CHECK (request_digest ~ '^[0-9a-f]{64}$'),\n",
    parent:
      "  UNIQUE (tenant_id, task_id, idempotency_key),\n  UNIQUE (tenant_id, run_id),\n  CONSTRAINT ck_bff_scheduled_agent_dispatch_order CHECK (occurrence_order_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{9}Z$'),\n  CONSTRAINT ck_bff_scheduled_agent_dispatch_digest CHECK (request_digest ~ '^[0-9a-f]{64}$'),\n",
  },
  {
    current:
      "CREATE INDEX IF NOT EXISTS ix_bff_scheduled_agent_dispatch_head\n  ON bff_scheduled_agent_dispatch (tenant_id,task_id,occurrence_order_key,dispatch_id);\n\n-- Natural RSS item identity survives retries, receipt replay and process restart.\nCREATE UNIQUE INDEX IF NOT EXISTS uq_bff_scheduled_agent_dispatch_rss_item\n  ON bff_scheduled_agent_dispatch (tenant_id,task_id,source_epoch,source_item_identity)\n  WHERE source_kind='rss';\n-- Runtime counts this indexed set under the task lock across ALL epochs before\n-- enqueuing the whole batch; the 1000-row cap is a cross-row transaction invariant,\n-- not a CHECK that could falsely claim to count other rows.\nCREATE INDEX IF NOT EXISTS ix_bff_scheduled_agent_dispatch_rss_unfinished\n  ON bff_scheduled_agent_dispatch (tenant_id,task_id,source_revision,dispatch_id)\n  WHERE source_kind='rss' AND status IN ('pending','leased','retryable','admitted');\n\nCREATE TABLE IF NOT EXISTS bff_scheduled_agent_source_event (\n",
    parent:
      "CREATE INDEX IF NOT EXISTS ix_bff_scheduled_agent_dispatch_head\n  ON bff_scheduled_agent_dispatch (tenant_id,task_id,occurrence_order_key,dispatch_id);\n\nCREATE TABLE IF NOT EXISTS bff_scheduled_agent_source_event (\n",
  },
]
const digest = (value) => createHash("sha256").update(value).digest("hex")
export function restoreRssTriggerSchemaParent(source) {
  if (digest(source) !== rssSchemaCurrentSha256) throw Error("RSS schema current drift")
  let result = source
  for (const hunk of hunks) {
    if (result.split(hunk.current).length !== 2) throw Error("RSS schema hunk drift")
    result = result.replace(hunk.current, () => hunk.parent)
  }
  if (digest(result) !== rssSchemaParentSha256) throw Error("RSS schema parent drift")
  return result
}
