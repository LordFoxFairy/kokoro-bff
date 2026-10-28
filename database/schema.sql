-- kokoro-bff business facts and durable command receipts.
-- This schema is owned by BFF. It is never joined from another repository.

CREATE TABLE IF NOT EXISTS bff_project (
  project_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instruction TEXT,
  recommended_mcp_refs JSONB NOT NULL DEFAULT '[]'::jsonb CONSTRAINT ck_bff_project_mcp_refs CHECK (jsonb_typeof(recommended_mcp_refs) = 'array' AND jsonb_array_length(recommended_mcp_refs) <= 16),
  mcp_recommendations_state_version INTEGER NOT NULL DEFAULT 1 CONSTRAINT ck_bff_project_mcp_version CHECK (mcp_recommendations_state_version >= 1),
  selected_skill_installation_ids TEXT[] NOT NULL DEFAULT '{}' CONSTRAINT ck_bff_project_skill_selection CHECK (cardinality(selected_skill_installation_ids) <= 16 AND array_position(selected_skill_installation_ids, NULL) IS NULL),
  deleted_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bff_project_owner_slug
  ON bff_project (tenant_id, owner_id, slug);
CREATE INDEX IF NOT EXISTS ix_bff_project_owner_list
  ON bff_project (tenant_id, owner_id, created_at ASC, project_id ASC)
  WHERE deleted_at IS NULL;

-- PROJECT-PIN-SQL-BEGIN
CREATE TABLE IF NOT EXISTS bff_project_pin (
  tenant_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  pinned_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, subject_id, project_id)
);
CREATE INDEX IF NOT EXISTS ix_bff_project_pin_subject_list
  ON bff_project_pin (tenant_id, subject_id, pinned_at DESC, project_id COLLATE "C" ASC);
CREATE INDEX IF NOT EXISTS ix_bff_project_pin_parent_cleanup
  ON bff_project_pin (tenant_id, project_id);
-- PROJECT-PIN-SQL-END

CREATE TABLE IF NOT EXISTS bff_project_deletion (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_subject_id TEXT NOT NULL,
  operation TEXT NOT NULL CONSTRAINT ck_bff_project_deletion_operation CHECK (operation = 'project.delete:v1'),
  idempotency_key TEXT NOT NULL CONSTRAINT ck_bff_project_deletion_key CHECK (length(idempotency_key) BETWEEN 1 AND 128 AND idempotency_key COLLATE "C" !~ '[^!-~]' AND strpos(idempotency_key, ',') = 0),
  request_fingerprint TEXT NOT NULL CONSTRAINT ck_bff_project_deletion_fingerprint CHECK (length(request_fingerprint) = 64 AND request_fingerprint COLLATE "C" !~ '[^0-9a-f]'),
  response_data JSONB NOT NULL CONSTRAINT ck_bff_project_deletion_response_data CHECK (response_data = jsonb_build_object('project_id', project_id, 'logical_release_state', 'pending', 'physical_cleanup_state', 'pending')),
  response_status INTEGER NOT NULL CONSTRAINT ck_bff_project_deletion_response_status CHECK (response_status = 202),
  location TEXT NOT NULL CONSTRAINT ck_bff_project_deletion_location CHECK (location = '/v1/projects/' || project_id || '/deletion'),
  conversation_count INTEGER NOT NULL CONSTRAINT ck_bff_project_deletion_conversation_count CHECK (conversation_count >= 0),
  release_command_count INTEGER NOT NULL,
  logical_release_state TEXT NOT NULL DEFAULT 'pending' CONSTRAINT ck_bff_project_deletion_logical_state CHECK (logical_release_state IN ('pending','blocked','released')),
  physical_cleanup_state TEXT NOT NULL DEFAULT 'pending' CONSTRAINT ck_bff_project_deletion_physical_state CHECK (physical_cleanup_state = 'pending'),
  blocked_code TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, project_id),
  CONSTRAINT uq_bff_project_deletion_command UNIQUE (tenant_id, owner_subject_id, operation, project_id, idempotency_key),
  CONSTRAINT ck_bff_project_deletion_release_count CHECK (release_command_count = conversation_count + 1)
);

CREATE TABLE IF NOT EXISTS bff_project_scope_release_outbox (
  command_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_subject_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CONSTRAINT ck_bff_project_release_scope_kind CHECK (scope_kind IN ('project','conversation')),
  scope_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CONSTRAINT ck_bff_project_release_state CHECK (state IN ('pending','leased','released','blocked')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CONSTRAINT ck_bff_project_release_attempt_count CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ(3),
  fence BIGINT NOT NULL DEFAULT 0 CONSTRAINT ck_bff_project_release_fence CHECK (fence >= 0),
  last_error_code TEXT,
  released_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT uq_bff_project_release_scope UNIQUE (tenant_id, project_id, scope_kind, scope_id),
  CONSTRAINT ck_bff_project_release_actor CHECK (actor_id = owner_subject_id),
  CONSTRAINT ck_bff_project_release_project_scope CHECK (scope_kind <> 'project' OR scope_id = project_id),
  CONSTRAINT ck_bff_project_release_digest CHECK (length(request_digest) = 64 AND request_digest COLLATE "C" !~ '[^0-9a-f]'),
  CONSTRAINT ck_bff_project_release_lease CHECK (
    (state = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS ix_bff_project_release_claim
  ON bff_project_scope_release_outbox (available_at, created_at, command_id)
  WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS bff_project_instruction_revision (
  revision_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  current BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS ix_bff_project_instruction_revision
  ON bff_project_instruction_revision (tenant_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS bff_project_task (
  task_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CONSTRAINT ck_bff_project_task_status CHECK (status IN ('todo', 'in_progress', 'done')),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
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
  frequency TEXT NOT NULL CONSTRAINT ck_bff_scheduled_task_frequency CHECK (frequency IN ('daily', 'weekly', 'monthly', 'once')),
  task_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  weekdays SMALLINT[],
  month_days SMALLINT[],
  local_date DATE,
  run_at TIMESTAMPTZ(3),
  expires_at TIMESTAMPTZ(3),
  auto_approve BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL CONSTRAINT ck_bff_scheduled_task_status CHECK (status IN ('active', 'paused', 'failed')),
  CONSTRAINT ck_bff_scheduled_task_calendar CHECK (
    (frequency='daily' AND weekdays IS NULL AND month_days IS NULL AND local_date IS NULL AND run_at IS NULL)
    OR (frequency='weekly' AND weekdays IS NOT NULL AND month_days IS NULL AND local_date IS NULL AND run_at IS NULL
      AND array_ndims(weekdays)=1 AND array_lower(weekdays,1)=1 AND cardinality(weekdays) BETWEEN 1 AND 7
      AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[] AND array_position(weekdays,NULL) IS NULL)
    OR (frequency='monthly' AND month_days IS NOT NULL AND weekdays IS NULL AND local_date IS NULL AND run_at IS NULL
      AND array_ndims(month_days)=1 AND array_lower(month_days,1)=1 AND cardinality(month_days) BETWEEN 1 AND 31
      AND month_days <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[] AND array_position(month_days,NULL) IS NULL)
    OR (frequency='once' AND weekdays IS NULL AND month_days IS NULL AND local_date IS NOT NULL AND run_at IS NOT NULL)
  ),
  revision BIGINT NOT NULL DEFAULT 1 CONSTRAINT ck_bff_scheduled_task_revision CHECK (revision >= 1),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS ix_bff_scheduled_task_owner
  ON bff_scheduled_task (tenant_id, owner_id, created_at ASC, task_id ASC);

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
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

-- BFF canonical Chat product facts. Agent run identifiers are opaque and
-- are checked only by the application boundary. Deleted conversations remain for retention and
-- audit cleanup; public reads select status = active only.
CREATE TABLE IF NOT EXISTS bff_conversation (
  conversation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  project_ref TEXT,
  title TEXT NOT NULL,
  archived_at TIMESTAMPTZ(3),
  status TEXT NOT NULL DEFAULT 'active' CONSTRAINT ck_bff_conversation_status CHECK (status IN ('active', 'deleted')),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at TIMESTAMPTZ(3),
  CONSTRAINT ck_bff_conversation_identity CHECK (length(btrim(tenant_id)) > 0 AND length(btrim(owner_id)) > 0),
  CONSTRAINT ck_bff_conversation_title CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT ck_bff_conversation_deleted CHECK ((status = 'deleted' AND deleted_at IS NOT NULL) OR (status = 'active' AND deleted_at IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_bff_conversation_owner_updated
  ON bff_conversation (tenant_id, owner_id, updated_at DESC, conversation_id ASC)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_bff_conversation_owner_project_updated
  ON bff_conversation (tenant_id, owner_id, project_ref, updated_at DESC, conversation_id ASC)
  WHERE status = 'active';

-- SET47: organization state is orthogonal to active/deleted; no capability or Run state.
CREATE INDEX IF NOT EXISTS ix_bff_conversation_owner_archived
  ON bff_conversation (tenant_id, owner_id, archived_at DESC, conversation_id COLLATE "C" ASC)
  WHERE status = 'active' AND archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bff_conversation_owner_unarchived_updated
  ON bff_conversation (tenant_id, owner_id, updated_at DESC, conversation_id ASC)
  WHERE status = 'active' AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bff_conversation_owner_project_unarchived_updated
  ON bff_conversation (tenant_id, owner_id, project_ref, updated_at DESC, conversation_id ASC)
  WHERE status = 'active' AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS bff_message (
  message_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  run_id TEXT,
  -- MESSAGE-REGENERATION-COLUMNS-BEGIN
  origin TEXT NOT NULL DEFAULT 'normal',
  regenerated_from_message_id TEXT,
  regeneration_user_message_id TEXT,
  -- MESSAGE-REGENERATION-COLUMNS-END
  role TEXT NOT NULL CONSTRAINT ck_bff_message_role CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  ordered_parts JSONB,
  parts_format_version SMALLINT,
  parts_public_sequence BIGINT,
  selected_skill_source_refs JSONB NOT NULL DEFAULT '[]'::jsonb CONSTRAINT ck_bff_message_skill_selection CHECK (jsonb_typeof(selected_skill_source_refs) = 'array' AND jsonb_array_length(selected_skill_source_refs) <= 16),
  status TEXT NOT NULL CONSTRAINT ck_bff_message_status CHECK (status IN ('pending', 'streaming', 'completed', 'failed')),
  agent_failure_code TEXT,
  agent_failure_retryable BOOLEAN,
  message_seq BIGINT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- MESSAGE-REGENERATION-CONSTRAINT-BEGIN
  CONSTRAINT ck_bff_message_regeneration CHECK (
    (origin='normal' AND regenerated_from_message_id IS NULL AND regeneration_user_message_id IS NULL)
    OR (origin='regeneration_input' AND role='user' AND run_id IS NOT NULL
      AND regenerated_from_message_id IS NOT NULL AND length(btrim(regenerated_from_message_id))>0
      AND regeneration_user_message_id IS NOT NULL AND length(btrim(regeneration_user_message_id))>0)
    OR (origin='regeneration_answer' AND role='assistant' AND run_id IS NOT NULL
      AND regenerated_from_message_id IS NOT NULL AND length(btrim(regenerated_from_message_id))>0
      AND regeneration_user_message_id IS NOT NULL AND length(btrim(regeneration_user_message_id))>0)
  ),
  -- MESSAGE-REGENERATION-CONSTRAINT-END
  CONSTRAINT uq_bff_message_conversation_sequence UNIQUE (tenant_id, conversation_id, message_seq),
  CONSTRAINT ck_bff_message_identity CHECK (length(btrim(tenant_id)) > 0 AND length(btrim(conversation_id)) > 0),
  CONSTRAINT ck_bff_message_sequence CHECK (message_seq >= 1),
  CONSTRAINT ck_bff_message_ordered_parts CHECK (
    (ordered_parts IS NULL AND parts_format_version IS NULL AND parts_public_sequence IS NULL)
    OR (
      role = 'assistant' AND ordered_parts IS NOT NULL
      AND jsonb_typeof(ordered_parts) = 'array'
      AND parts_format_version IS NOT NULL AND parts_public_sequence IS NOT NULL
      AND parts_format_version = 1 AND parts_public_sequence >= 0
    )
  ),
  CONSTRAINT ck_bff_message_agent_failure CHECK (
    (agent_failure_code IS NULL AND agent_failure_retryable IS NULL)
    OR (
      agent_failure_code IS NOT NULL
      AND agent_failure_retryable IS NOT NULL
      AND agent_failure_code IN (
        'token_budget_exceeded',
        'recursion_limit_exceeded',
        'assembly_failed',
        'enqueue_failed',
        'dispatch_exhausted',
        'contract_incompatible',
        'internal_error',
        'model_unavailable',
        'dependency_unavailable',
        'model_access_denied', 'model_settlement_pending'
      )
      AND (agent_failure_retryable = FALSE OR agent_failure_code IN ('model_unavailable', 'dependency_unavailable'))
      AND role = 'assistant'
      AND status = 'failed'
      AND run_id IS NOT NULL
      AND length(btrim(run_id)) > 0
    )
  )
);
CREATE INDEX IF NOT EXISTS ix_bff_message_tenant_conversation_sequence
  ON bff_message (tenant_id, conversation_id, message_seq ASC, message_id ASC);

-- Transactional Chat -> Agent command queue. A user message, its provisional
-- assistant message, expected AG-UI run fence, and this row commit together.
-- MESSAGE-FEEDBACK-SQL-BEGIN
CREATE TABLE IF NOT EXISTS bff_message_feedback (
  tenant_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  feedback TEXT NOT NULL CONSTRAINT ck_bff_message_feedback_value CHECK (feedback IN ('up', 'down')),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, subject_id, message_id),
  CONSTRAINT ck_bff_message_feedback_identity CHECK (
    length(btrim(tenant_id)) > 0 AND length(btrim(subject_id)) > 0
    AND length(btrim(conversation_id)) > 0 AND length(btrim(message_id)) > 0
  )
);
CREATE INDEX IF NOT EXISTS ix_bff_message_feedback_parent_cleanup
  ON bff_message_feedback (tenant_id, conversation_id);
-- MESSAGE-FEEDBACK-SQL-END

CREATE TABLE IF NOT EXISTS bff_agent_dispatch_outbox (
  outbox_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  conversation_dispatch_seq BIGINT NOT NULL,
  subject_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  run_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  identity_assertion_ref TEXT NOT NULL,
  execution_project_ref TEXT,
  execution_context_retired_at TIMESTAMPTZ(3),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admission_unknown_seen BOOLEAN NOT NULL DEFAULT FALSE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_owner TEXT,
  lease_token TEXT,
  lease_until TIMESTAMPTZ(3),
  fence BIGINT NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_at TIMESTAMPTZ(3),
  completed_at TIMESTAMPTZ(3),
  admitted_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_bff_agent_dispatch_outbox PRIMARY KEY (outbox_id),
  CONSTRAINT uq_bff_agent_dispatch_business UNIQUE (tenant_id, conversation_id, idempotency_key),
  CONSTRAINT uq_bff_agent_dispatch_sequence UNIQUE (tenant_id, conversation_id, conversation_dispatch_seq),
  CONSTRAINT uq_bff_agent_dispatch_run UNIQUE (tenant_id, run_id),
  CONSTRAINT ck_bff_agent_dispatch_identity CHECK (
    length(btrim(tenant_id)) > 0
    AND length(btrim(conversation_id)) > 0
    AND length(btrim(subject_id)) > 0
    AND length(btrim(actor_id)) > 0
    AND length(btrim(request_id)) > 0
    AND length(btrim(idempotency_key)) > 0
    AND length(btrim(run_id)) > 0
    AND length(btrim(user_message_id)) > 0
    AND length(btrim(assistant_message_id)) > 0
    AND length(btrim(identity_assertion_ref)) > 0
  ),
  CONSTRAINT ck_bff_agent_dispatch_digest CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_bff_agent_dispatch_payload CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT ck_bff_agent_dispatch_status CHECK (status IN ('pending', 'leased', 'retryable', 'admitted', 'terminal', 'failed')),
  CONSTRAINT ck_bff_agent_dispatch_attempt CHECK (attempt_count >= 0),
  CONSTRAINT ck_bff_agent_dispatch_sequence CHECK (conversation_dispatch_seq >= 1),
  CONSTRAINT ck_bff_agent_dispatch_fence CHECK (fence >= 0),
  CONSTRAINT ck_bff_agent_dispatch_lease CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL)
  ),
  CONSTRAINT ck_bff_agent_dispatch_completion CHECK (
    (status = 'admitted' AND admitted_at IS NOT NULL AND completed_at IS NULL)
    OR (status = 'terminal' AND admitted_at IS NOT NULL AND completed_at IS NOT NULL)
    OR (status = 'failed' AND admitted_at IS NULL AND completed_at IS NOT NULL AND admission_unknown_seen = FALSE)
    OR (status IN ('pending', 'leased', 'retryable') AND admitted_at IS NULL AND completed_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS ix_bff_agent_dispatch_ready
  ON bff_agent_dispatch_outbox
    (available_at ASC, tenant_id ASC, conversation_id ASC, conversation_dispatch_seq ASC, outbox_id ASC)
  WHERE status IN ('pending', 'retryable');
CREATE INDEX IF NOT EXISTS ix_bff_agent_dispatch_lease
  ON bff_agent_dispatch_outbox
    (lease_until ASC, tenant_id ASC, conversation_id ASC, conversation_dispatch_seq ASC, outbox_id ASC)
  WHERE status = 'leased';
CREATE INDEX IF NOT EXISTS ix_bff_agent_dispatch_conversation
  ON bff_agent_dispatch_outbox
    (tenant_id, conversation_id, conversation_dispatch_seq ASC, outbox_id ASC);

-- ScheduledTask execution ordering is independent from both the deletable task
-- fact and the public Chat projection.  Referential integrity is maintained by
-- the repository while holding the scope row; these tables intentionally have
-- owner integrity is enforced by same-transaction scope locks.
CREATE TABLE IF NOT EXISTS bff_scheduled_agent_scope (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  active_dispatch_id TEXT,
  active_run_id TEXT,
  source_high_watermark BIGINT NOT NULL DEFAULT 0,
  consumer_next_poll_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  consumer_lease_owner TEXT,
  consumer_lease_token TEXT,
  consumer_lease_until TIMESTAMPTZ(3),
  consumer_fence BIGINT NOT NULL DEFAULT 0,
  consumer_failure_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, task_id),
  UNIQUE (tenant_id, session_id),
  CONSTRAINT ck_bff_scheduled_agent_scope_identity CHECK (
    length(btrim(tenant_id)) > 0 AND length(btrim(task_id)) > 0
    AND length(btrim(session_id)) > 0 AND length(btrim(subject_id)) > 0
  ),
  CONSTRAINT ck_bff_scheduled_agent_scope_active CHECK (
    (active_dispatch_id IS NULL AND active_run_id IS NULL)
    OR (active_dispatch_id IS NOT NULL AND active_run_id IS NOT NULL)
  ),
  CONSTRAINT ck_bff_scheduled_agent_scope_source CHECK (source_high_watermark >= 0),
  CONSTRAINT ck_bff_scheduled_agent_scope_consumer CHECK (
    (consumer_lease_owner IS NULL AND consumer_lease_token IS NULL AND consumer_lease_until IS NULL)
    OR (consumer_lease_owner IS NOT NULL AND consumer_lease_token IS NOT NULL AND consumer_lease_until IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS bff_scheduled_agent_dispatch (
  dispatch_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  occurrence TEXT NOT NULL,
  occurrence_order_key TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  run_id TEXT NOT NULL,
  identity_assertion_ref TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admission_unknown_seen BOOLEAN NOT NULL DEFAULT FALSE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_owner TEXT,
  lease_token TEXT,
  lease_until TIMESTAMPTZ(3),
  fence BIGINT NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_at TIMESTAMPTZ(3),
  admitted_at TIMESTAMPTZ(3),
  completed_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (tenant_id, task_id, occurrence),
  UNIQUE (tenant_id, task_id, idempotency_key),
  UNIQUE (tenant_id, run_id),
  CONSTRAINT ck_bff_scheduled_agent_dispatch_order CHECK (occurrence_order_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{9}Z$'),
  CONSTRAINT ck_bff_scheduled_agent_dispatch_digest CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_bff_scheduled_agent_dispatch_payload CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT ck_bff_scheduled_agent_dispatch_status CHECK (status IN ('pending','leased','retryable','admitted','terminal','failed')),
  CONSTRAINT ck_bff_scheduled_agent_dispatch_lease CHECK (
    (status='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL)
  ),
  CONSTRAINT ck_bff_scheduled_agent_dispatch_completion CHECK (
    (status='admitted' AND admitted_at IS NOT NULL AND completed_at IS NULL)
    OR (status='terminal' AND admitted_at IS NOT NULL AND completed_at IS NOT NULL)
    OR (status='failed' AND admitted_at IS NULL AND completed_at IS NOT NULL AND admission_unknown_seen=FALSE)
    OR (status IN ('pending','leased','retryable') AND admitted_at IS NULL AND completed_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS ix_bff_scheduled_agent_dispatch_ready
  ON bff_scheduled_agent_dispatch (available_at,tenant_id,task_id,occurrence_order_key,dispatch_id)
  WHERE status IN ('pending','retryable');
CREATE INDEX IF NOT EXISTS ix_bff_scheduled_agent_dispatch_lease
  ON bff_scheduled_agent_dispatch (lease_until,tenant_id,task_id,occurrence_order_key,dispatch_id)
  WHERE status='leased';
CREATE INDEX IF NOT EXISTS ix_bff_scheduled_agent_dispatch_head
  ON bff_scheduled_agent_dispatch (tenant_id,task_id,occurrence_order_key,dispatch_id);

CREATE TABLE IF NOT EXISTS bff_scheduled_agent_source_event (
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

-- A deleted conversation must compensate every launch that may already have
-- crossed the Agent boundary. These run.cancel commands are committed in the
-- deletion transaction and delivered independently from launch settlement.
CREATE TABLE IF NOT EXISTS bff_agent_cancellation_outbox (
  cancellation_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  conversation_dispatch_seq BIGINT NOT NULL,
  run_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  identity_assertion_ref TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'cancel_requested',
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
  CONSTRAINT pk_bff_agent_cancellation_outbox PRIMARY KEY (cancellation_id),
  CONSTRAINT uq_bff_agent_cancellation_command UNIQUE (tenant_id, command_id),
  CONSTRAINT uq_bff_agent_cancellation_run UNIQUE (tenant_id, run_id),
  CONSTRAINT ck_bff_agent_cancellation_identity CHECK (
    length(btrim(tenant_id)) > 0
    AND length(btrim(conversation_id)) > 0
    AND length(btrim(run_id)) > 0
    AND length(btrim(subject_id)) > 0
    AND length(btrim(actor_id)) > 0
    AND length(btrim(request_id)) > 0
    AND length(btrim(command_id)) > 0
    AND length(btrim(identity_assertion_ref)) > 0
  ),
  CONSTRAINT ck_bff_agent_cancellation_sequence CHECK (conversation_dispatch_seq >= 1),
  CONSTRAINT ck_bff_agent_cancellation_payload CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT ck_bff_agent_cancellation_status CHECK (
    status IN ('cancel_requested', 'leased', 'retryable', 'succeeded', 'failed')
  ),
  CONSTRAINT ck_bff_agent_cancellation_attempt CHECK (attempt_count >= 0),
  CONSTRAINT ck_bff_agent_cancellation_fence CHECK (fence >= 0),
  CONSTRAINT ck_bff_agent_cancellation_lease CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL)
  ),
  CONSTRAINT ck_bff_agent_cancellation_completion CHECK (
    (status IN ('succeeded', 'failed') AND completed_at IS NOT NULL)
    OR (status NOT IN ('succeeded', 'failed') AND completed_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS ix_bff_agent_cancellation_ready
  ON bff_agent_cancellation_outbox
    (available_at ASC, tenant_id ASC, conversation_id ASC, conversation_dispatch_seq ASC, cancellation_id ASC)
  WHERE status IN ('cancel_requested', 'retryable');
CREATE INDEX IF NOT EXISTS ix_bff_agent_cancellation_lease
  ON bff_agent_cancellation_outbox
    (lease_until ASC, tenant_id ASC, conversation_id ASC, conversation_dispatch_seq ASC, cancellation_id ASC)
  WHERE status = 'leased';
CREATE INDEX IF NOT EXISTS ix_bff_agent_cancellation_conversation
  ON bff_agent_cancellation_outbox
    (tenant_id, conversation_id, conversation_dispatch_seq ASC, cancellation_id ASC);

-- A share is revocable and optionally expires. Revoked/expired rows are kept
-- until the documented retention job removes them; only active, unexpired rows
-- are public. One active share per tenant/conversation is the business rule.
-- Replacement transaction marks rows matching
-- expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP(3) as revoked
-- before the partial unique index is evaluated.
CREATE TABLE IF NOT EXISTS bff_share (
  share_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL DEFAULT 'conversation',
  conversation_id TEXT,
  creator_subject_id TEXT,
  skill_source_ref TEXT,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at TIMESTAMPTZ(3),
  revoked_at TIMESTAMPTZ(3),
  CONSTRAINT ck_bff_share_identity CHECK (length(btrim(tenant_id)) > 0),
  CONSTRAINT ck_bff_share_bounded_identity CHECK (
    char_length(tenant_id) <= 255
    AND (creator_subject_id IS NULL OR char_length(creator_subject_id) <= 255)
    AND (skill_source_ref IS NULL OR char_length(skill_source_ref) <= 197)
  ),
  CONSTRAINT ck_bff_share_resource CHECK (
    (resource_kind = 'conversation' AND conversation_id IS NOT NULL AND length(btrim(conversation_id)) > 0 AND creator_subject_id IS NULL AND skill_source_ref IS NULL)
    OR
    (resource_kind = 'skill_revision' AND conversation_id IS NULL AND creator_subject_id IS NOT NULL AND length(btrim(creator_subject_id)) > 0 AND skill_source_ref IS NOT NULL AND length(btrim(skill_source_ref)) > 0)
  ),
  CONSTRAINT ck_bff_share_url CHECK (length(btrim(url)) > 0),
  CONSTRAINT ck_bff_share_expiry CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT ck_bff_share_revoke_after_create CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bff_share_active_conversation
  ON bff_share (tenant_id, conversation_id)
  WHERE revoked_at IS NULL AND resource_kind = 'conversation';
CREATE UNIQUE INDEX IF NOT EXISTS uq_bff_share_active_skill_revision
  ON bff_share (tenant_id, creator_subject_id, skill_source_ref)
  WHERE revoked_at IS NULL AND resource_kind = 'skill_revision';
CREATE INDEX IF NOT EXISTS ix_bff_share_active_lookup
  ON bff_share (share_id, tenant_id, conversation_id)
  WHERE revoked_at IS NULL AND resource_kind = 'conversation';
CREATE INDEX IF NOT EXISTS ix_bff_share_active_skill_lookup
  ON bff_share (share_id, tenant_id, skill_source_ref)
  WHERE revoked_at IS NULL AND resource_kind = 'skill_revision';

CREATE TABLE IF NOT EXISTS bff_skill_usage_run_terminal (
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  source_owner TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_sequence BIGINT NOT NULL,
  source_digest TEXT NOT NULL,
  source_occurred_at TIMESTAMPTZ(3) NOT NULL,
  observed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, run_id),
  CONSTRAINT ck_bff_skill_usage_terminal_status CHECK (status IN ('completed', 'cancelled', 'failed')),
  CONSTRAINT ck_bff_skill_usage_terminal_identity CHECK (
    length(btrim(tenant_id)) > 0 AND length(btrim(run_id)) > 0 AND length(btrim(session_id)) > 0
    AND source_owner = 'kokoro-agent' AND length(btrim(source_event_id)) > 0
    AND source_sequence > 0 AND source_digest ~ '^[0-9a-f]{64}$'
  )
);
CREATE TABLE IF NOT EXISTS bff_skill_usage_observation (
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ready_source_owner TEXT NOT NULL,
  ready_source_event_id TEXT NOT NULL,
  ready_source_sequence BIGINT NOT NULL,
  ready_source_digest TEXT NOT NULL,
  ready_source_occurred_at TIMESTAMPTZ(3) NOT NULL,
  counted_at TIMESTAMPTZ(3),
  PRIMARY KEY (tenant_id, run_id, source_ref),
  CONSTRAINT ck_bff_skill_usage_observation_identity CHECK (
    length(btrim(tenant_id)) > 0 AND length(btrim(run_id)) > 0 AND length(btrim(session_id)) > 0
    AND source_ref ~ '^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$'
    AND ready_source_owner = 'kokoro-agent' AND length(btrim(ready_source_event_id)) > 0
    AND ready_source_sequence > 0 AND ready_source_digest ~ '^[0-9a-f]{64}$'
  )
);
CREATE INDEX IF NOT EXISTS ix_bff_skill_usage_observation_counted
  ON bff_skill_usage_observation (tenant_id, source_ref, run_id)
  WHERE counted_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS bff_skill_usage_coverage (
  tenant_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'unavailable',
  checkpoint_id TEXT,
  checkpoint_at TIMESTAMPTZ(3),
  CONSTRAINT ck_bff_skill_usage_coverage_status CHECK (status IN ('unavailable', 'complete')),
  CONSTRAINT ck_bff_skill_usage_coverage_checkpoint CHECK (
    (status = 'unavailable' AND checkpoint_id IS NULL AND checkpoint_at IS NULL)
    OR (status = 'complete' AND checkpoint_id IS NOT NULL AND length(btrim(checkpoint_id)) > 0 AND checkpoint_at IS NOT NULL)
  )
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
  projection_state JSONB NOT NULL DEFAULT '{"text_message_ids":[]}'::jsonb,
  expected_run_id TEXT,
  latest_run_id TEXT,
  latest_run_start_sequence BIGINT,
  terminal_run_id TEXT,
  retention_floor_sequence BIGINT NOT NULL DEFAULT 0,
  consumer_subject_id TEXT,
  consumer_state TEXT NOT NULL DEFAULT 'active',
  consumer_next_poll_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  consumer_lease_owner TEXT,
  consumer_lease_token TEXT,
  consumer_lease_until TIMESTAMPTZ(3),
  consumer_fence BIGINT NOT NULL DEFAULT 0,
  consumer_failure_count BIGINT NOT NULL DEFAULT 0,
  consumer_last_error_code TEXT,
  consumer_last_error_at TIMESTAMPTZ(3),
  consumer_last_polled_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_bff_agui_stream PRIMARY KEY (tenant_id, session_id),
  CONSTRAINT ck_bff_agui_stream_version CHECK (version >= 0),
  CONSTRAINT ck_bff_agui_stream_source_high_watermark CHECK (source_high_watermark >= 0),
  CONSTRAINT ck_bff_agui_stream_next_public_sequence CHECK (next_public_sequence >= 1),
  CONSTRAINT ck_bff_agui_stream_latest_run_start CHECK (
    latest_run_start_sequence IS NULL
    OR (latest_run_start_sequence >= 1 AND latest_run_start_sequence < next_public_sequence)
  ),
  CONSTRAINT ck_bff_agui_stream_projection_state CHECK (jsonb_typeof(projection_state) = 'object'),
  CONSTRAINT ck_bff_agui_stream_expected_run CHECK (expected_run_id IS NULL OR length(btrim(expected_run_id)) > 0),
  CONSTRAINT ck_bff_agui_stream_retention_floor CHECK (retention_floor_sequence >= 0),
  CONSTRAINT ck_bff_agui_stream_consumer_state CHECK (consumer_state IN ('active', 'blocked', 'stopped')),
  CONSTRAINT ck_bff_agui_stream_consumer_fence CHECK (consumer_fence >= 0),
  CONSTRAINT ck_bff_agui_stream_consumer_failure_count CHECK (consumer_failure_count >= 0),
  CONSTRAINT ck_bff_agui_stream_consumer_identity CHECK (consumer_subject_id IS NULL OR length(btrim(consumer_subject_id)) > 0),
  CONSTRAINT ck_bff_agui_stream_consumer_lease CHECK (
    (consumer_lease_owner IS NULL AND consumer_lease_token IS NULL AND consumer_lease_until IS NULL)
    OR (consumer_lease_owner IS NOT NULL AND consumer_lease_token IS NOT NULL AND consumer_lease_until IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS ix_bff_agui_stream_consumer_due
  ON bff_agui_stream (consumer_next_poll_at ASC, tenant_id ASC, session_id ASC)
  WHERE consumer_state = 'active' AND consumer_subject_id IS NOT NULL;

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
  CONSTRAINT ck_bff_agui_source_event_owner CHECK (source_owner IN ('kokoro-agent', 'kokoro-bff')),
  CONSTRAINT ck_bff_agui_source_event_sequence CHECK (source_sequence >= 1),
  CONSTRAINT ck_bff_agui_source_event_digest CHECK (length(source_digest) = 64)
);

-- BFF owns only the durable Conversation-to-Artifact relationship. Storage owns
-- the Artifact metadata and bytes; source claims here are immutable cross-checks.
CREATE TABLE IF NOT EXISTS bff_conversation_artifact (
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  source_owner TEXT NOT NULL DEFAULT 'kokoro-agent',
  source_event_id TEXT NOT NULL,
  source_sequence BIGINT NOT NULL,
  source_digest TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  source_artifact_kind TEXT NOT NULL,
  source_content_sha256 TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_mime TEXT NOT NULL,
  source_size_bytes BIGINT NOT NULL,
  delivered_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT pk_bff_conversation_artifact PRIMARY KEY (tenant_id, conversation_id, artifact_id),
  CONSTRAINT uq_bff_conversation_artifact_source UNIQUE (tenant_id, conversation_id, source_owner, source_event_id),
  CONSTRAINT ck_bff_conversation_artifact_identity CHECK (
    length(btrim(tenant_id)) > 0 AND length(btrim(conversation_id)) > 0
    AND length(btrim(artifact_id)) > 0 AND length(btrim(run_id)) > 0
    AND length(btrim(source_event_id)) > 0 AND length(btrim(source_asset_id)) > 0
  ),
  CONSTRAINT ck_bff_conversation_artifact_owner CHECK (source_owner = 'kokoro-agent'),
  CONSTRAINT ck_bff_conversation_artifact_sequence CHECK (source_sequence >= 1),
  CONSTRAINT ck_bff_conversation_artifact_digest CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_bff_conversation_artifact_kind CHECK (source_artifact_kind IN ('document', 'code', 'image', 'audio', 'video', 'data', 'archive', 'other')),
  CONSTRAINT ck_bff_conversation_artifact_content_sha256 CHECK (source_content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_bff_conversation_artifact_display CHECK (
    length(btrim(source_title)) > 0 AND length(btrim(source_mime)) > 0
    AND source_size_bytes BETWEEN 0 AND 9007199254740991
  )
);
CREATE INDEX IF NOT EXISTS ix_bff_conversation_artifact_library
  ON bff_conversation_artifact (tenant_id, delivered_at DESC, conversation_id ASC, artifact_id ASC);
CREATE INDEX IF NOT EXISTS ix_bff_conversation_artifact_snapshot
  ON bff_conversation_artifact (tenant_id, conversation_id, delivered_at DESC, artifact_id ASC);

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
  CONSTRAINT ck_bff_agui_event_source_owner CHECK (source_owner IN ('kokoro-agent', 'kokoro-bff')),
  CONSTRAINT ck_bff_agui_event_frame_index CHECK (frame_index >= 0),
  CONSTRAINT ck_bff_agui_event_type CHECK (length(event_type) >= 1),
  CONSTRAINT ck_bff_agui_event_payload CHECK (jsonb_typeof(event_payload) = 'object')
);
CREATE INDEX IF NOT EXISTS ix_bff_agui_event_retention
  ON bff_agui_event (tenant_id, session_id, recorded_at ASC, public_sequence ASC);

-- Compact safe Run process state. Immutable as-of pages are reconstructed from
-- bff_agui_event; these rows provide current integrity/provenance and GC pins.
CREATE TABLE IF NOT EXISTS bff_agui_run_process (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  projection_schema_version INTEGER NOT NULL DEFAULT 1,
  start_source_owner TEXT NOT NULL,
  start_source_event_id TEXT NOT NULL,
  start_source_sequence BIGINT NOT NULL,
  start_source_digest TEXT NOT NULL,
  start_source_occurred_at TIMESTAMPTZ(3) NOT NULL,
  start_public_sequence BIGINT NOT NULL,
  start_public_cursor TEXT NOT NULL,
  todo_observed BOOLEAN NOT NULL DEFAULT FALSE,
  todos JSONB,
  todo_digest TEXT,
  todo_source_owner TEXT,
  todo_source_event_id TEXT,
  todo_source_sequence BIGINT,
  todo_source_digest TEXT,
  todo_source_occurred_at TIMESTAMPTZ(3),
  todo_public_sequence BIGINT,
  todo_public_cursor TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, session_id, run_id),
  CONSTRAINT ck_bff_agui_run_process_identity CHECK (length(btrim(subject_id)) > 0 AND length(btrim(run_id)) > 0),
  CONSTRAINT ck_bff_agui_run_process_schema CHECK (projection_schema_version = 1),
  CONSTRAINT ck_bff_agui_run_process_start CHECK (start_source_owner = 'kokoro-agent' AND start_source_sequence >= 1 AND start_public_sequence >= 1 AND start_source_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_bff_agui_run_process_todo CHECK (
    (NOT todo_observed AND todos IS NULL AND todo_digest IS NULL AND todo_source_owner IS NULL AND todo_source_event_id IS NULL AND todo_source_sequence IS NULL AND todo_source_digest IS NULL AND todo_source_occurred_at IS NULL AND todo_public_sequence IS NULL AND todo_public_cursor IS NULL)
    OR (todo_observed AND todos IS NOT NULL AND jsonb_typeof(todos) = 'array' AND todo_digest IS NOT NULL
      AND todo_source_owner IS NOT NULL AND todo_source_owner = 'kokoro-agent' AND todo_source_event_id IS NOT NULL
      AND todo_source_sequence IS NOT NULL AND todo_source_sequence >= 1 AND todo_source_digest IS NOT NULL
      AND todo_source_digest ~ '^[0-9a-f]{64}$' AND todo_source_occurred_at IS NOT NULL
      AND todo_public_sequence IS NOT NULL AND todo_public_sequence >= start_public_sequence AND todo_public_cursor IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS bff_agui_run_activity (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  projection_schema_version INTEGER NOT NULL DEFAULT 1,
  activity_kind TEXT NOT NULL,
  safe_payload JSONB NOT NULL,
  payload_digest TEXT NOT NULL,
  first_source_owner TEXT NOT NULL,
  first_source_event_id TEXT NOT NULL,
  first_source_sequence BIGINT NOT NULL,
  first_source_digest TEXT NOT NULL,
  first_source_occurred_at TIMESTAMPTZ(3) NOT NULL,
  first_public_sequence BIGINT NOT NULL,
  first_public_cursor TEXT NOT NULL,
  latest_source_owner TEXT NOT NULL,
  latest_source_event_id TEXT NOT NULL,
  latest_source_sequence BIGINT NOT NULL,
  latest_source_digest TEXT NOT NULL,
  latest_source_occurred_at TIMESTAMPTZ(3) NOT NULL,
  latest_public_sequence BIGINT NOT NULL,
  latest_public_cursor TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, session_id, run_id, activity_id),
  CONSTRAINT ck_bff_agui_run_activity_schema CHECK (projection_schema_version = 1),
  CONSTRAINT ck_bff_agui_run_activity_payload CHECK (jsonb_typeof(safe_payload) = 'object' AND activity_kind IN ('skill','tool','subagent')),
  CONSTRAINT ck_bff_agui_run_activity_provenance CHECK (first_source_owner = 'kokoro-agent' AND latest_source_owner = 'kokoro-agent' AND first_source_sequence >= 1 AND latest_source_sequence >= first_source_sequence AND first_public_sequence >= 1 AND latest_public_sequence >= first_public_sequence AND payload_digest ~ '^[0-9a-f]{64}$' AND first_source_digest ~ '^[0-9a-f]{64}$' AND latest_source_digest ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS ix_bff_agui_run_activity_page
  ON bff_agui_run_activity (tenant_id, session_id, run_id, first_public_sequence, activity_id);

-- A compact tombstone keeps a scope-bound answer for cursors whose frame was
-- reclaimed. It prevents an expired cursor from being confused with an
-- unknown/foreign cursor while the tombstone retention window is active.
-- Full interaction read projection. History remains in the AG-UI ledger.
CREATE TABLE IF NOT EXISTS bff_agui_run_interaction (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  projection_schema_version INTEGER NOT NULL DEFAULT 1,
  interaction_revision BIGINT NOT NULL,
  pause_revision BIGINT NOT NULL,
  pause_ref TEXT,
  phase TEXT NOT NULL,
  groups JSONB NOT NULL,
  action_command_id TEXT,
  action_pause_revision BIGINT,
  action_kind TEXT,
  interaction_digest TEXT NOT NULL,
  source_owner TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_sequence BIGINT NOT NULL,
  source_digest TEXT NOT NULL,
  source_occurred_at TIMESTAMPTZ(3) NOT NULL,
  public_sequence BIGINT NOT NULL,
  public_cursor TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_bff_agui_run_interaction PRIMARY KEY (tenant_id, session_id, run_id),
  CONSTRAINT ck_bff_agui_run_interaction_identity CHECK (
    length(btrim(tenant_id)) > 0 AND length(btrim(session_id)) > 0
    AND length(btrim(run_id)) > 0 AND length(btrim(subject_id)) > 0
  ),
  CONSTRAINT ck_bff_agui_run_interaction_version CHECK (projection_schema_version = 1),
  CONSTRAINT ck_bff_agui_run_interaction_revision CHECK (
    interaction_revision BETWEEN 1 AND 9007199254740991
    AND pause_revision BETWEEN 0 AND interaction_revision
  ),
  CONSTRAINT ck_bff_agui_run_interaction_locator CHECK (
    (pause_revision = 0 AND pause_ref IS NULL)
    OR (pause_revision > 0 AND pause_ref IS NOT NULL AND length(btrim(pause_ref)) > 0)
  ),
  CONSTRAINT ck_bff_agui_run_interaction_phase CHECK (phase IN ('active', 'waiting', 'resuming', 'terminal')),
  CONSTRAINT ck_bff_agui_run_interaction_groups CHECK (
    jsonb_typeof(groups) = 'array' AND
    CASE WHEN jsonb_typeof(groups) = 'array' THEN
      CASE WHEN phase IN ('waiting', 'resuming') THEN jsonb_array_length(groups) > 0 AND pause_revision > 0
           ELSE jsonb_array_length(groups) = 0 END
    ELSE FALSE END
  ),
  CONSTRAINT ck_bff_agui_run_interaction_action CHECK (
    (action_command_id IS NULL AND action_pause_revision IS NULL AND action_kind IS NULL)
    OR (action_command_id IS NOT NULL AND length(btrim(action_command_id)) > 0
        AND action_pause_revision IS NOT NULL AND action_pause_revision BETWEEN 1 AND pause_revision
        AND action_kind IS NOT NULL AND action_kind IN ('accepted', 'native_consumed', 'validation_failed', 'unknown', 'cancelled'))
  ),
  CONSTRAINT ck_bff_agui_run_interaction_resuming CHECK (
    phase <> 'resuming' OR (action_kind IS NOT NULL AND action_kind IN ('accepted', 'unknown') AND action_pause_revision = pause_revision)
  ),
  CONSTRAINT ck_bff_agui_run_interaction_validation CHECK (
    phase <> 'waiting' OR action_kind IS NULL OR action_kind <> 'validation_failed' OR action_pause_revision < pause_revision
  ),
  CONSTRAINT ck_bff_agui_run_interaction_digest CHECK (interaction_digest ~ '^[0-9a-f]{64}$' AND source_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_bff_agui_run_interaction_source CHECK (
    source_owner = 'kokoro-agent' AND length(btrim(source_event_id)) > 0
    AND source_sequence BETWEEN 1 AND 9007199254740991
  ),
  CONSTRAINT ck_bff_agui_run_interaction_public CHECK (
    public_sequence BETWEEN 1 AND 9007199254740991 AND public_cursor ~ '^agui_[0-9a-f]{32}$'
  )
);

CREATE TABLE IF NOT EXISTS bff_agui_cursor_tombstone (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  cursor TEXT NOT NULL,
  public_sequence BIGINT NOT NULL,
  expired_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_bff_agui_cursor_tombstone PRIMARY KEY (tenant_id, session_id, cursor),
  CONSTRAINT ck_bff_agui_cursor_tombstone_sequence CHECK (public_sequence >= 1),
  CONSTRAINT ck_bff_agui_cursor_tombstone_cursor CHECK (length(cursor) BETWEEN 16 AND 160)
);
CREATE INDEX IF NOT EXISTS ix_bff_agui_cursor_tombstone_expiry
  ON bff_agui_cursor_tombstone (expired_at ASC, tenant_id ASC, session_id ASC);

-- R257: current caller-owned personalization; no foreign-owner profile or history.
CREATE TABLE IF NOT EXISTS bff_personalization (
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  occupation TEXT NOT NULL,
  about TEXT NOT NULL,
  instructions TEXT NOT NULL,
  revision BIGINT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_bff_personalization PRIMARY KEY (tenant_id, owner_id),
  CONSTRAINT ck_bff_personalization_scope CHECK (tenant_id <> '' AND owner_id <> ''),
  CONSTRAINT ck_bff_personalization_nickname CHECK (char_length(nickname) <= 128),
  CONSTRAINT ck_bff_personalization_occupation CHECK (char_length(occupation) <= 256),
  CONSTRAINT ck_bff_personalization_about CHECK (char_length(about) <= 2000),
  CONSTRAINT ck_bff_personalization_instructions CHECK (char_length(instructions) <= 8000),
  CONSTRAINT ck_bff_personalization_revision CHECK (revision >= 1 AND revision <= 9007199254740991)
);

-- Caller-owned bounded knowledge; tombstones retain identity but erase deleted text.
CREATE TABLE IF NOT EXISTS bff_personal_knowledge (
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  knowledge_id UUID NOT NULL,
  name TEXT NOT NULL,
  when_to_use TEXT NOT NULL,
  content TEXT NOT NULL,
  revision BIGINT NOT NULL CONSTRAINT ck_bff_knowledge_revision CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at TIMESTAMPTZ(3),
  CONSTRAINT pk_bff_personal_knowledge PRIMARY KEY (tenant_id, owner_id, knowledge_id),
  CONSTRAINT ck_bff_knowledge_scope CHECK (tenant_id <> '' AND owner_id <> ''),
  CONSTRAINT ck_bff_knowledge_content CHECK (
    (deleted_at IS NOT NULL AND name = '' AND when_to_use = '' AND content = '') OR
    (deleted_at IS NULL AND char_length(name) BETWEEN 1 AND 500 AND name ~ '[^[:space:]]'
     AND char_length(when_to_use) BETWEEN 1 AND 500 AND when_to_use ~ '[^[:space:]]'
     AND char_length(content) BETWEEN 1 AND 2000 AND content ~ '[^[:space:]]')
  )
);
CREATE INDEX IF NOT EXISTS ix_bff_knowledge_owner_list
  ON bff_personal_knowledge (tenant_id, owner_id, created_at DESC, knowledge_id ASC) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS bff_personal_knowledge_usage (
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  revision BIGINT NOT NULL CONSTRAINT ck_bff_knowledge_usage_revision CHECK (revision BETWEEN 1 AND 9007199254740991),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_bff_personal_knowledge_usage PRIMARY KEY (tenant_id, owner_id),
  CONSTRAINT ck_bff_knowledge_usage_scope CHECK (tenant_id <> '' AND owner_id <> '')
);
