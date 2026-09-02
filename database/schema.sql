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
CREATE UNIQUE INDEX IF NOT EXISTS bff_project_tenant_slug_idx ON bff_project (tenant_id, slug);

CREATE TABLE IF NOT EXISTS bff_project_instruction_revision (
  revision_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  current BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bff_project_instruction_revision_idx
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
  status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bff_project_task_tenant_project_idx
  ON bff_project_task (tenant_id, project_id, updated_at DESC, task_id ASC);

CREATE TABLE IF NOT EXISTS bff_scheduled_task (
  task_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  task_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  next_run_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  auto_approve BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bff_scheduled_task_tenant_idx ON bff_scheduled_task (tenant_id, created_at ASC);

CREATE TABLE IF NOT EXISTS bff_idempotency_receipt (
  scope TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
