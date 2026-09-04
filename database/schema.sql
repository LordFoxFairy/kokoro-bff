-- kokoro-bff business facts and durable command receipts.
-- This schema is owned by BFF. It is never joined from another repository.

CREATE TABLE IF NOT EXISTS bff_project (
  project_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instruction TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bff_project_tenant_slug ON bff_project (tenant_id, slug);

CREATE TABLE IF NOT EXISTS bff_project_instruction_revision (
  revision_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  current BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_bff_project_instruction_revision
  ON bff_project_instruction_revision (tenant_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS bff_project_skill (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, project_id, skill_name)
);

CREATE TABLE IF NOT EXISTS bff_project_task (
  task_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CONSTRAINT ck_bff_project_task_status CHECK (status IN ('todo', 'in_progress', 'done')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_bff_project_task_tenant_project
  ON bff_project_task (tenant_id, project_id, updated_at DESC, task_id ASC);

CREATE TABLE IF NOT EXISTS bff_scheduled_task (
  task_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  frequency TEXT NOT NULL CONSTRAINT ck_bff_scheduled_task_frequency CHECK (frequency IN ('daily', 'weekly')),
  task_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  next_run_at TIMESTAMPTZ(3) NOT NULL,
  expires_at TIMESTAMPTZ(3),
  auto_approve BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL CONSTRAINT ck_bff_scheduled_task_status CHECK (status IN ('active', 'paused', 'failed')),
  revision BIGINT NOT NULL DEFAULT 1 CONSTRAINT ck_bff_scheduled_task_revision CHECK (revision >= 1),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS ix_bff_scheduled_task_tenant ON bff_scheduled_task (tenant_id, created_at ASC);

-- ScheduledTask owns this bounded outbox. It is intentionally not a generic
-- cross-domain queue: every row is one versioned Scheduler command for one
-- BFF task, with the original request lineage retained beside the payload.
CREATE TABLE IF NOT EXISTS bff_scheduled_task_outbox (
  outbox_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  aggregate_revision BIGINT NOT NULL,
  payload JSONB NOT NULL,
  actor_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_owner TEXT,
  lease_token TEXT,
  lease_until TIMESTAMPTZ(3),
  fence BIGINT NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_at TIMESTAMPTZ(3),
  completed_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_bff_scheduled_task_outbox PRIMARY KEY (outbox_id),
  CONSTRAINT uq_bff_scheduled_task_outbox_business UNIQUE (tenant_id, task_id, command_type, idempotency_key),
  CONSTRAINT ck_bff_scheduled_task_outbox_command_type CHECK (command_type IN ('scheduler.register', 'scheduler.replace', 'scheduler.delete')),
  CONSTRAINT ck_bff_scheduled_task_outbox_revision CHECK (aggregate_revision >= 1),
  CONSTRAINT ck_bff_scheduled_task_outbox_payload CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT ck_bff_scheduled_task_outbox_status CHECK (status IN ('pending', 'leased', 'retryable', 'succeeded', 'failed')),
  CONSTRAINT ck_bff_scheduled_task_outbox_attempts CHECK (attempt_count >= 0),
  CONSTRAINT ck_bff_scheduled_task_outbox_fence CHECK (fence >= 0),
  CONSTRAINT ck_bff_scheduled_task_outbox_lease CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL)
  ),
  CONSTRAINT ck_bff_scheduled_task_outbox_lineage CHECK (
    length(btrim(tenant_id)) > 0 AND length(btrim(actor_id)) > 0
    AND length(btrim(request_id)) > 0 AND length(btrim(idempotency_key)) > 0
  )
);
CREATE INDEX IF NOT EXISTS ix_bff_scheduled_task_outbox_ready
  ON bff_scheduled_task_outbox (available_at ASC, created_at ASC, outbox_id ASC)
  WHERE status IN ('pending', 'retryable');
CREATE INDEX IF NOT EXISTS ix_bff_scheduled_task_outbox_task
  ON bff_scheduled_task_outbox (tenant_id, task_id, created_at ASC, outbox_id ASC);
CREATE INDEX IF NOT EXISTS ix_bff_scheduled_task_outbox_lease
  ON bff_scheduled_task_outbox (lease_until ASC, created_at ASC, outbox_id ASC)
  WHERE status = 'leased';

CREATE TABLE IF NOT EXISTS bff_idempotency_receipt (
  scope TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Durable public AG-UI projection. Agent execution events are copied into this
-- BFF-owned ledger before any public SSE frame is emitted. The stream row is
-- also the per-tenant/session sequence allocator and projection-state fence.
CREATE TABLE IF NOT EXISTS bff_agui_stream (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  source_high_watermark BIGINT NOT NULL DEFAULT 0,
  next_public_sequence BIGINT NOT NULL DEFAULT 1,
  projection_state JSONB NOT NULL DEFAULT '{"text_message_ids":[],"tool_call_ids":[]}'::jsonb,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_bff_agui_stream PRIMARY KEY (tenant_id, session_id),
  CONSTRAINT ck_bff_agui_stream_version CHECK (version >= 0),
  CONSTRAINT ck_bff_agui_stream_source_high_watermark CHECK (source_high_watermark >= 0),
  CONSTRAINT ck_bff_agui_stream_next_public_sequence CHECK (next_public_sequence >= 1),
  CONSTRAINT ck_bff_agui_stream_projection_state CHECK (jsonb_typeof(projection_state) = 'object')
);

-- Every source fact is registered exactly once, including source event kinds
-- that intentionally produce no public frame. This prevents projection gaps
-- and gives conflicting reuse of an Agent identity a durable failure mode.
CREATE TABLE IF NOT EXISTS bff_agui_source_event (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_owner TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_sequence BIGINT NOT NULL,
  source_digest TEXT NOT NULL,
  source_occurred_at TIMESTAMPTZ(3) NOT NULL,
  projected_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_bff_agui_source_event PRIMARY KEY (tenant_id, session_id, source_owner, source_event_id),
  CONSTRAINT uq_bff_agui_source_event_sequence UNIQUE (tenant_id, session_id, source_owner, source_sequence),
  CONSTRAINT ck_bff_agui_source_event_owner CHECK (source_owner = 'kokoro-agent'),
  CONSTRAINT ck_bff_agui_source_event_sequence CHECK (source_sequence >= 1),
  CONSTRAINT ck_bff_agui_source_event_digest CHECK (length(source_digest) = 64)
);

-- One source fact may expand into multiple AG-UI frames. Each frame receives a
-- distinct opaque cursor backed by a monotonically increasing public sequence,
-- so reconnecting after the first expanded frame never drops the next frame.
CREATE TABLE IF NOT EXISTS bff_agui_event (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  public_sequence BIGINT NOT NULL,
  cursor TEXT NOT NULL,
  source_owner TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  frame_index INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL,
  source_occurred_at TIMESTAMPTZ(3) NOT NULL,
  recorded_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_bff_agui_event PRIMARY KEY (tenant_id, session_id, public_sequence),
  CONSTRAINT uq_bff_agui_event_cursor UNIQUE (cursor),
  CONSTRAINT uq_bff_agui_event_source_frame UNIQUE (tenant_id, session_id, source_owner, source_event_id, frame_index),
  CONSTRAINT ck_bff_agui_event_public_sequence CHECK (public_sequence >= 1),
  CONSTRAINT ck_bff_agui_event_cursor CHECK (length(cursor) BETWEEN 16 AND 160),
  CONSTRAINT ck_bff_agui_event_source_owner CHECK (source_owner = 'kokoro-agent'),
  CONSTRAINT ck_bff_agui_event_frame_index CHECK (frame_index >= 0),
  CONSTRAINT ck_bff_agui_event_type CHECK (length(event_type) >= 1),
  CONSTRAINT ck_bff_agui_event_payload CHECK (jsonb_typeof(event_payload) = 'object')
);
