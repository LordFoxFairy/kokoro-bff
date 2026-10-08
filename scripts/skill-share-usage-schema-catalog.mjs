function normalizedIndexDefinition(value) {
  return value.replace(" ON kokoro_bff.", " ON ")
}
function normalizeCatalog(catalog) {
  return Object.fromEntries(
    Object.entries(catalog)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => [
        name,
        {
          columns: [...value.columns].sort((a, b) => a.name.localeCompare(b.name)),
          constraints: [...value.constraints].filter((row) => row.contype !== "n").sort((a, b) => a.name.localeCompare(b.name)),
          indexes: [...value.indexes]
            .map((row) => ({ ...row, definition: normalizedIndexDefinition(row.definition) }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        },
      ]),
  )
}
const OLD = {
  bff_share: {
    columns: [
      { name: "conversation_id", type: "text", nullable: false, default_value: null },
      { name: "created_at", type: "timestamp(3) with time zone", nullable: false, default_value: "CURRENT_TIMESTAMP(3)" },
      { name: "expires_at", type: "timestamp(3) with time zone", nullable: true, default_value: null },
      { name: "revoked_at", type: "timestamp(3) with time zone", nullable: true, default_value: null },
      { name: "share_id", type: "text", nullable: false, default_value: null },
      { name: "tenant_id", type: "text", nullable: false, default_value: null },
      { name: "url", type: "text", nullable: false, default_value: null },
    ],
    constraints: [
      { name: "bff_share_pkey", contype: "p", definition: "PRIMARY KEY (share_id)" },
      { name: "ck_bff_share_expiry", contype: "c", definition: "CHECK (((expires_at IS NULL) OR (expires_at > created_at)))" },
      { name: "ck_bff_share_identity", contype: "c", definition: "CHECK (((length(btrim(tenant_id)) > 0) AND (length(btrim(conversation_id)) > 0)))" },
      { name: "ck_bff_share_revoke_after_create", contype: "c", definition: "CHECK (((revoked_at IS NULL) OR (revoked_at >= created_at)))" },
      { name: "ck_bff_share_url", contype: "c", definition: "CHECK ((length(btrim(url)) > 0))" },
    ],
    indexes: [
      { name: "bff_share_pkey", definition: "CREATE UNIQUE INDEX bff_share_pkey ON bff_share USING btree (share_id)" },
      {
        name: "ix_bff_share_active_lookup",
        definition: "CREATE INDEX ix_bff_share_active_lookup ON bff_share USING btree (share_id, tenant_id, conversation_id) WHERE (revoked_at IS NULL)",
      },
      {
        name: "uq_bff_share_active_conversation",
        definition: "CREATE UNIQUE INDEX uq_bff_share_active_conversation ON bff_share USING btree (tenant_id, conversation_id) WHERE (revoked_at IS NULL)",
      },
    ],
  },
}
const CURRENT = {
  bff_share: {
    columns: [
      { name: "conversation_id", type: "text", nullable: true, default_value: null },
      { name: "created_at", type: "timestamp(3) with time zone", nullable: false, default_value: "CURRENT_TIMESTAMP(3)" },
      { name: "creator_subject_id", type: "text", nullable: true, default_value: null },
      { name: "expires_at", type: "timestamp(3) with time zone", nullable: true, default_value: null },
      { name: "resource_kind", type: "text", nullable: false, default_value: "'conversation'::text" },
      { name: "revoked_at", type: "timestamp(3) with time zone", nullable: true, default_value: null },
      { name: "share_id", type: "text", nullable: false, default_value: null },
      { name: "skill_source_ref", type: "text", nullable: true, default_value: null },
      { name: "tenant_id", type: "text", nullable: false, default_value: null },
      { name: "url", type: "text", nullable: false, default_value: null },
    ],
    constraints: [
      { name: "bff_share_pkey", contype: "p", definition: "PRIMARY KEY (share_id)" },
      {
        name: "ck_bff_share_bounded_identity",
        contype: "c",
        definition:
          "CHECK (((char_length(tenant_id) <= 255) AND ((creator_subject_id IS NULL) OR (char_length(creator_subject_id) <= 255)) AND ((skill_source_ref IS NULL) OR (char_length(skill_source_ref) <= 197))))",
      },
      { name: "ck_bff_share_expiry", contype: "c", definition: "CHECK (((expires_at IS NULL) OR (expires_at > created_at)))" },
      { name: "ck_bff_share_identity", contype: "c", definition: "CHECK ((length(btrim(tenant_id)) > 0))" },
      {
        name: "ck_bff_share_resource",
        contype: "c",
        definition:
          "CHECK ((((resource_kind = 'conversation'::text) AND (conversation_id IS NOT NULL) AND (length(btrim(conversation_id)) > 0) AND (creator_subject_id IS NULL) AND (skill_source_ref IS NULL)) OR ((resource_kind = 'skill_revision'::text) AND (conversation_id IS NULL) AND (creator_subject_id IS NOT NULL) AND (length(btrim(creator_subject_id)) > 0) AND (skill_source_ref IS NOT NULL) AND (length(btrim(skill_source_ref)) > 0))))",
      },
      { name: "ck_bff_share_revoke_after_create", contype: "c", definition: "CHECK (((revoked_at IS NULL) OR (revoked_at >= created_at)))" },
      { name: "ck_bff_share_url", contype: "c", definition: "CHECK ((length(btrim(url)) > 0))" },
    ],
    indexes: [
      { name: "bff_share_pkey", definition: "CREATE UNIQUE INDEX bff_share_pkey ON bff_share USING btree (share_id)" },
      {
        name: "ix_bff_share_active_lookup",
        definition:
          "CREATE INDEX ix_bff_share_active_lookup ON bff_share USING btree (share_id, tenant_id, conversation_id) WHERE ((revoked_at IS NULL) AND (resource_kind = 'conversation'::text))",
      },
      {
        name: "ix_bff_share_active_skill_lookup",
        definition:
          "CREATE INDEX ix_bff_share_active_skill_lookup ON bff_share USING btree (share_id, tenant_id, skill_source_ref) WHERE ((revoked_at IS NULL) AND (resource_kind = 'skill_revision'::text))",
      },
      {
        name: "uq_bff_share_active_conversation",
        definition:
          "CREATE UNIQUE INDEX uq_bff_share_active_conversation ON bff_share USING btree (tenant_id, conversation_id) WHERE ((revoked_at IS NULL) AND (resource_kind = 'conversation'::text))",
      },
      {
        name: "uq_bff_share_active_skill_revision",
        definition:
          "CREATE UNIQUE INDEX uq_bff_share_active_skill_revision ON bff_share USING btree (tenant_id, creator_subject_id, skill_source_ref) WHERE ((revoked_at IS NULL) AND (resource_kind = 'skill_revision'::text))",
      },
    ],
  },
  bff_skill_usage_run_terminal: {
    columns: [
      { name: "observed_at", type: "timestamp(3) with time zone", nullable: false, default_value: "CURRENT_TIMESTAMP(3)" },
      { name: "run_id", type: "text", nullable: false, default_value: null },
      { name: "session_id", type: "text", nullable: false, default_value: null },
      { name: "source_digest", type: "text", nullable: false, default_value: null },
      { name: "source_event_id", type: "text", nullable: false, default_value: null },
      { name: "source_occurred_at", type: "timestamp(3) with time zone", nullable: false, default_value: null },
      { name: "source_owner", type: "text", nullable: false, default_value: null },
      { name: "source_sequence", type: "bigint", nullable: false, default_value: null },
      { name: "status", type: "text", nullable: false, default_value: null },
      { name: "tenant_id", type: "text", nullable: false, default_value: null },
    ],
    constraints: [
      { name: "bff_skill_usage_run_terminal_pkey", contype: "p", definition: "PRIMARY KEY (tenant_id, run_id)" },
      {
        name: "ck_bff_skill_usage_terminal_identity",
        contype: "c",
        definition:
          "CHECK (((length(btrim(tenant_id)) > 0) AND (length(btrim(run_id)) > 0) AND (length(btrim(session_id)) > 0) AND (source_owner = 'kokoro-agent'::text) AND (length(btrim(source_event_id)) > 0) AND (source_sequence > 0) AND (source_digest ~ '^[0-9a-f]{64}$'::text)))",
      },
      {
        name: "ck_bff_skill_usage_terminal_status",
        contype: "c",
        definition: "CHECK ((status = ANY (ARRAY['completed'::text, 'cancelled'::text, 'failed'::text])))",
      },
    ],
    indexes: [
      {
        name: "bff_skill_usage_run_terminal_pkey",
        definition: "CREATE UNIQUE INDEX bff_skill_usage_run_terminal_pkey ON bff_skill_usage_run_terminal USING btree (tenant_id, run_id)",
      },
    ],
  },
  bff_skill_usage_observation: {
    columns: [
      { name: "counted_at", type: "timestamp(3) with time zone", nullable: true, default_value: null },
      { name: "ready_source_digest", type: "text", nullable: false, default_value: null },
      { name: "ready_source_event_id", type: "text", nullable: false, default_value: null },
      { name: "ready_source_occurred_at", type: "timestamp(3) with time zone", nullable: false, default_value: null },
      { name: "ready_source_owner", type: "text", nullable: false, default_value: null },
      { name: "ready_source_sequence", type: "bigint", nullable: false, default_value: null },
      { name: "run_id", type: "text", nullable: false, default_value: null },
      { name: "session_id", type: "text", nullable: false, default_value: null },
      { name: "source_ref", type: "text", nullable: false, default_value: null },
      { name: "tenant_id", type: "text", nullable: false, default_value: null },
    ],
    constraints: [
      { name: "bff_skill_usage_observation_pkey", contype: "p", definition: "PRIMARY KEY (tenant_id, run_id, source_ref)" },
      {
        name: "ck_bff_skill_usage_observation_identity",
        contype: "c",
        definition:
          "CHECK (((length(btrim(tenant_id)) > 0) AND (length(btrim(run_id)) > 0) AND (length(btrim(session_id)) > 0) AND (source_ref ~ '^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$'::text) AND (ready_source_owner = 'kokoro-agent'::text) AND (length(btrim(ready_source_event_id)) > 0) AND (ready_source_sequence > 0) AND (ready_source_digest ~ '^[0-9a-f]{64}$'::text)))",
      },
    ],
    indexes: [
      {
        name: "bff_skill_usage_observation_pkey",
        definition: "CREATE UNIQUE INDEX bff_skill_usage_observation_pkey ON bff_skill_usage_observation USING btree (tenant_id, run_id, source_ref)",
      },
      {
        name: "ix_bff_skill_usage_observation_counted",
        definition:
          "CREATE INDEX ix_bff_skill_usage_observation_counted ON bff_skill_usage_observation USING btree (tenant_id, source_ref, run_id) WHERE (counted_at IS NOT NULL)",
      },
    ],
  },
  bff_skill_usage_coverage: {
    columns: [
      { name: "checkpoint_at", type: "timestamp(3) with time zone", nullable: true, default_value: null },
      { name: "checkpoint_id", type: "text", nullable: true, default_value: null },
      { name: "status", type: "text", nullable: false, default_value: "'unavailable'::text" },
      { name: "tenant_id", type: "text", nullable: false, default_value: null },
    ],
    constraints: [
      { name: "bff_skill_usage_coverage_pkey", contype: "p", definition: "PRIMARY KEY (tenant_id)" },
      {
        name: "ck_bff_skill_usage_coverage_checkpoint",
        contype: "c",
        definition:
          "CHECK ((((status = 'unavailable'::text) AND (checkpoint_id IS NULL) AND (checkpoint_at IS NULL)) OR ((status = 'complete'::text) AND (checkpoint_id IS NOT NULL) AND (length(btrim(checkpoint_id)) > 0) AND (checkpoint_at IS NOT NULL))))",
      },
      { name: "ck_bff_skill_usage_coverage_status", contype: "c", definition: "CHECK ((status = ANY (ARRAY['unavailable'::text, 'complete'::text])))" },
    ],
    indexes: [
      {
        name: "bff_skill_usage_coverage_pkey",
        definition: "CREATE UNIQUE INDEX bff_skill_usage_coverage_pkey ON bff_skill_usage_coverage USING btree (tenant_id)",
      },
    ],
  },
}
function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}
export function classifySkillShareUsageCatalog(catalog) {
  if (catalog === null || typeof catalog !== "object" || Array.isArray(catalog)) return "drift"
  const normalized = normalizeCatalog(catalog)
  if (equal(normalized, normalizeCatalog(OLD))) return "old"
  return equal(normalized, normalizeCatalog(CURRENT)) ? "current" : "drift"
}
export const skillShareUsageCatalogFixtures = Object.freeze({ old: OLD, current: CURRENT })
