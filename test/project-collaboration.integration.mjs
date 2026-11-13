import assert from "node:assert/strict"
import { randomUUID, createHash } from "node:crypto"
import { test } from "node:test"
import { Pool } from "pg"
import { createProjectGrantStore } from "../dist/infrastructure/postgres/project-grants.js"
import {
  createProjectLookup,
  createProjectCapabilityLookup,
  createProjectReadStore,
  createProjectMutationStore,
} from "../dist/infrastructure/postgres/project-store.js"

// Root allocates/installs/reclaims this owned database. No skip, installer, truncate or drop here.
test("real PG Project grants gate current metadata/instruction reads and actual editor writes without changing private ownership", async (t) => {
  const raw = process.env.KOKORO_TEST_POSTGRES_URL
  assert.ok(raw, "Root-owned Project collaboration fixture URL is required")
  const url = new URL(raw)
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /^\/kokoro_bff_project_collab_[0-9a-f]{32}$/u)
  assert.deepEqual(url.searchParams.getAll("schema"), ["kokoro_bff"])
  const pool = new Pool({
    connectionString: raw,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
    max: 5,
  })
  t.after(() => pool.end())
  const tenantId = `b10_${randomUUID()}`,
    projectId = `project_${randomUUID()}`
  const owner = { tenantId, subjectId: "owner" },
    recipient = { tenantId, subjectId: "recipient" },
    outsider = { tenantId, subjectId: "outsider" }
  const grants = createProjectGrantStore(pool),
    reads = createProjectReadStore(pool),
    writes = createProjectMutationStore(pool)
  const privateLookup = createProjectLookup(pool),
    readLookup = createProjectCapabilityLookup(pool, "read")
  const readAccess = (scope) => grants.access(scope, projectId, new AbortController().signal, performance.now() + 5000)
  const set = async (role, version, key, expires_at = null) =>
    grants.mutate({
      ...owner,
      projectId,
      targetSubjectId: recipient.subjectId,
      expectedAccessVersion: version,
      body: role === null ? null : { role, expires_at },
      receiptScope: JSON.stringify([tenantId, key]),
      fingerprint: key.padEnd(64, "a"),
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 5000,
    })
  const record = () =>
    pool.query("SELECT owner_id,name,instruction,access_version::text FROM bff_project WHERE tenant_id=$1 AND project_id=$2", [tenantId, projectId])
  await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'Collaboration','owner-slug')", [
    projectId,
    tenantId,
    owner.subjectId,
  ])
  assert.equal(await readAccess(recipient), null)
  assert.deepEqual(await reads.list(recipient), [])
  assert.equal(await writes.updateInstruction(recipient, projectId, "denied"), null)
  assert.equal((await set("viewer", "1", "viewer")).kind, "committed")
  assert.equal((await readLookup.find(recipient, projectId)).id, projectId)
  assert.equal(await readLookup.find(recipient, "owner-slug"), null, "shared access never resolves another owner's legacy slug")
  assert.equal(await privateLookup.find(recipient, projectId), null, "private owner finder is not globally loosened")
  assert.equal((await reads.list(recipient)).length, 1)
  assert.equal(await writes.updateInstruction(recipient, projectId, "viewer cannot write"), null)
  assert.equal((await set("editor", "2", "editor")).kind, "committed")
  assert.equal((await writes.updateInstruction(recipient, projectId, "editor saved")).instruction, "editor saved")
  const history = await reads.revisions(owner, projectId)
  assert.equal(history[0].actor_name, "recipient")
  assert.equal(history[0].instruction, "editor saved")
  assert.equal((await record()).rows[0].owner_id, "owner")
  assert.equal((await readLookup.find(owner, projectId)).instruction, "editor saved")
  assert.equal(await readLookup.find(outsider, projectId), null)
  assert.equal(await readLookup.find({ ...recipient, tenantId: `${tenantId}_other` }, projectId), null)
  const concurrent = await Promise.all([set("viewer", "3", "race-a"), set("viewer", "3", "race-b")])
  assert.deepEqual(concurrent.map((x) => x.kind).sort(), ["committed", "precondition_failed"])
  assert.equal((await set("editor", "4", "editor-again")).kind, "committed")
  const collisionId = `project_${randomUUID()}`
  await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'Private collision',$4)", [
    collisionId,
    tenantId,
    recipient.subjectId,
    projectId,
  ])
  assert.equal((await readLookup.find(recipient, projectId)).id, projectId, "shared lookup is canonical even when the caller owns a matching slug")
  assert.equal((await privateLookup.find(recipient, projectId)).id, collisionId, "legacy private owner finder remains unchanged")
  const blocker = await pool.connect()
  let lockOpen = false,
    waiting
  try {
    await blocker.query("BEGIN")
    lockOpen = true
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
    await blocker.query("SELECT project_id FROM bff_project WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [tenantId, projectId])
    waiting = writes.updateInstruction(recipient, projectId, "must not appear after revoke")
    const deadline = performance.now() + 5000
    let observed = false
    while (performance.now() < deadline) {
      const state = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity a
        WHERE a.datname=current_database() AND a.pid<>pg_backend_pid()
          AND $1::integer=ANY(pg_blocking_pids(a.pid))) AS blocked`,
        [blockerPid],
      )
      if (state.rows[0].blocked) {
        observed = true
        break
      }
    }
    assert.equal(observed, true, "the exact owned blocker must actually block the editor before revocation")
    await blocker.query("UPDATE bff_project_grant SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND project_id=$2 AND subject_id=$3", [
      tenantId,
      projectId,
      recipient.subjectId,
    ])
    await blocker.query("UPDATE bff_project SET access_version=access_version+1 WHERE tenant_id=$1 AND project_id=$2", [tenantId, projectId])
    await blocker.query("COMMIT")
    lockOpen = false
  } finally {
    if (lockOpen) await blocker.query("ROLLBACK")
    blocker.release()
  }
  assert.equal(await waiting, null, "editor rechecks a fresh grant snapshot after waiting for the same Project lock")
  assert.equal((await record()).rows[0].instruction, "editor saved")
  assert.equal(await readAccess(recipient), null)
  assert.deepEqual(
    (await reads.list(recipient)).map((project) => project.id),
    [collisionId],
  )
  assert.equal(await readLookup.find(recipient, projectId), null, "revoked canonical ID never falls back to the caller's same-named slug")
  assert.equal(await writes.updateInstruction(recipient, projectId, "no slug fallback"), null)
  const replay = await set("editor", "2", "editor")
  assert.equal(replay.kind, "committed")
  assert.equal(replay.replayed, true)
  assert.equal(await readAccess(recipient), null, "historical receipt does not regrant")
  assert.equal((await set("viewer", "6", "expiry", new Date(Date.now() + 60_000).toISOString())).kind, "committed")
  await pool.query(
    "UPDATE bff_project_grant SET expires_at=date_trunc('milliseconds',clock_timestamp()) WHERE tenant_id=$1 AND project_id=$2 AND subject_id=$3",
    [tenantId, projectId, recipient.subjectId],
  )
  assert.equal(await readAccess(recipient), null)
  assert.deepEqual(
    (await reads.list(recipient)).map((project) => project.id),
    [collisionId],
  )
  assert.equal(await readLookup.find(recipient, projectId), null, "revoked canonical ID never falls back to the caller's same-named slug")
  assert.equal(await writes.updateInstruction(recipient, projectId, "no slug fallback"), null)
})

// No provider or Agent HTTP is called: this proves local delegation/fence/immutable queue facts only.
test("real PG shared scheduled edits keep creator, require own explicit executor and retire only known-unsent revisions", async (t) => {
  const raw = process.env.KOKORO_TEST_POSTGRES_URL
  assert.ok(raw, "Root-owned Project collaboration fixture URL is required")
  const url = new URL(raw)
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /^\/kokoro_bff_project_collab_[0-9a-f]{32}$/u)
  assert.deepEqual(url.searchParams.getAll("schema"), ["kokoro_bff"])
  const pool = new Pool({
    connectionString: raw,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
    max: 5,
  })
  t.after(() => pool.end())
  const [
    { PostgresScheduledTaskRepository },
    { PostgresScheduledAgentDispatchRepository },
    { PostgresSchedulerDispatchReceiptRepository },
    { PostgresAgentDispatchOutboxRepository },
    { ScheduledChatSubmission },
    { buildScheduledAgentLaunch, scheduledConversationId },
  ] = await Promise.all([
    import("../dist/infrastructure/postgres/scheduled-task-repository.js"),
    import("../dist/infrastructure/postgres/scheduled-agent-dispatch-repository.js"),
    import("../dist/infrastructure/postgres/scheduler-dispatch-receipt-repository.js"),
    import("../dist/infrastructure/postgres/agent-dispatch-outbox-repository.js"),
    import("../dist/infrastructure/postgres/scheduled-chat-submission.js"),
    import("../dist/infrastructure/clients/agent/launch.js"),
  ])
  const tenantId = `b10_scheduled_${randomUUID()}`,
    projectId = `project_${randomUUID()}`
  const owner = { tenantId, subjectId: "owner" },
    editor = { tenantId, subjectId: "editor" }
  const database = { pool, notifyAgUiProjection: async () => undefined },
    tasks = new PostgresScheduledTaskRepository(database)
  const grants = createProjectGrantStore(pool),
    scheduled = new PostgresScheduledAgentDispatchRepository(database)
  const receipts = new PostgresSchedulerDispatchReceiptRepository(pool),
    ordinary = new PostgresAgentDispatchOutboxRepository(database)
  const submission = new ScheduledChatSubmission(ordinary)
  const lineage = (scope, key, expectedRevision) => ({
    ...scope,
    actorId: scope.subjectId,
    requestId: `request-${key}`,
    idempotencyKey: key,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  })
  const set = async (role, version, key) =>
    grants.mutate({
      ...owner,
      projectId,
      targetSubjectId: editor.subjectId,
      expectedAccessVersion: version,
      body: { role, expires_at: null },
      receiptScope: JSON.stringify([tenantId, key]),
      fingerprint: key.padEnd(64, "a"),
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 5000,
    })
  await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'Scheduled collaboration',$1)", [
    projectId,
    tenantId,
    owner.subjectId,
  ])
  assert.equal((await set("editor", "1", "grant-editor")).kind, "committed")
  const task = await tasks.createScheduledTask(
    editor,
    {
      projectId,
      title: "Shared task",
      prompt: "original",
      frequency: "daily",
      time: "08:00",
      timezone: "UTC",
      autoApprove: false,
    },
    `scheduled_${randomUUID()}`,
    lineage(editor, "create"),
  )
  assert.equal(Object.hasOwn(task, "executionActorId"), false)
  const createdDetails = await tasks.findScheduledTask(editor, task.id)
  assert.equal(createdDetails.ownerId, "editor")
  assert.equal(createdDetails.executionActorId, "editor")
  assert.equal(task.enabled, true)
  await tasks.updateScheduledTask(owner, task.id, { prompt: "owner's new prompt", enabled: true }, lineage(owner, "cross-edit", 1))
  const paused = await tasks.findScheduledTask(owner, task.id)
  assert.equal(paused.ownerId, "editor")
  assert.equal(paused.executionActorId, null)
  assert.equal(paused.enabled, false)
  assert.equal(paused.status, "paused")
  await tasks.updateScheduledTask(owner, task.id, { enabled: true }, lineage(owner, "enable-own", 2))
  const enabled = await tasks.findScheduledTask(owner, task.id)
  assert.equal(enabled.ownerId, "editor")
  assert.equal(enabled.executionActorId, "owner")
  assert.equal(enabled.enabled, true)
  await assert.rejects(() => tasks.updateScheduledTask(owner, task.id, { title: "stale" }, lineage(owner, "stale", 2)), /PRECONDITION_FAILED/)
  const accept = async (current, sequence) => {
    const key = `occurrence-${sequence}`,
      digest = String(sequence).padStart(64, "0"),
      requestId = `callback-${sequence}`
    const launch = buildScheduledAgentLaunch({
      identity: { namespace: tenantId, userId: current.executionActorId },
      requestId,
      sessionId: scheduledConversationId(tenantId, task.id),
      occurrenceIdentity: digest,
      content: current.prompt,
      projectRef: projectId,
    })
    const snapshot = {
      tenantId,
      taskId: task.id,
      schedule: `kokoro.scheduled.${task.id}`,
      occurrence: `2030-01-01T00:00:0${sequence}Z`,
      idempotencyKey: key,
      actorId: current.executionActorId,
      taskRevision: current.revision,
      launch: { requestId, ...launch },
    }
    const claim = await receipts.claim(JSON.stringify([tenantId, key]), digest)
    assert.equal(claim.outcome, "claimed")
    const prepared = await receipts.prepareSnapshot(claim.claim, snapshot)
    assert.ok(prepared)
    const response = { status: 202, body: { data: launch.receipt } },
      rejection = { status: 409, body: {} }
    assert.deepEqual(
      await scheduled.accept({
        claim: { ...claim.claim, ...prepared },
        snapshot,
        response,
        rejections: {
          task_not_found: rejection,
          task_not_active: rejection,
          task_changed: rejection,
        },
      }),
      { outcome: "accepted" },
    )
    return launch.receipt.run_id
  }
  const options = {
    workerId: "b10-worker",
    leaseDurationMs: 10000,
    settlementReserveMs: 100,
    maxAttempts: 8,
  }
  const firstRun = await accept(enabled, 1),
    lease = await scheduled.claim(options)
  assert.equal(lease.runId, firstRun)
  assert.equal(lease.subjectId, "owner")
  await tasks.updateScheduledTask(owner, task.id, { prompt: "new revision" }, lineage(owner, "same-executor-save", 3))
  const changed = await tasks.findScheduledTask(owner, task.id)
  assert.equal(changed.executionActorId, "owner")
  assert.equal(changed.enabled, true)
  const row = async (runId) => (await pool.query("SELECT * FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId])).rows[0]
  assert.equal((await row(firstRun)).status, "failed")
  assert.ok(Number((await row(firstRun)).fence) > lease.fence)
  assert.equal((await submission.deliver(lease, 2000)).outcome, "not_admitted")
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM bff_agent_dispatch_outbox WHERE tenant_id=$1", [tenantId])).rows[0].n, 0)
  const uncertainRun = await accept(changed, 2),
    uncertain = await scheduled.claim(options)
  assert.equal(uncertain.runId, uncertainRun)
  assert.equal(await scheduled.markUnknown(uncertain, 0, "local_commit_unknown"), true)
  const before = await row(uncertainRun)
  const next = await tasks.updateScheduledTask(owner, task.id, { prompt: "after unknown" }, lineage(owner, "after-unknown", 4))
  assert.equal(next.revision, 5)
  const after = await row(uncertainRun)
  assert.equal(after.status, "retryable")
  assert.equal(after.task_revision, before.task_revision)
  assert.deepEqual(after.payload, before.payload)
  assert.equal(after.subject_id, before.subject_id)
  assert.equal(after.admission_unknown_seen, true)
  const recovering = await scheduled.claim(options)
  assert.equal((await submission.deliver(recovering, 2000)).outcome, "submitted")
  const durable = (
    await pool.query("SELECT subject_id,actor_id,payload FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenantId, uncertainRun])
  ).rows[0]
  assert.equal(durable.subject_id, "owner")
  assert.equal(durable.actor_id, "owner")
  assert.equal(durable.payload.launch.content, changed.prompt)
  await tasks.updateScheduledTask(owner, task.id, { prompt: "after durable submission" }, lineage(owner, "after-submitted", 5))
  assert.equal((await row(uncertainRun)).status, "submitted")
  assert.deepEqual(
    (await pool.query("SELECT subject_id,actor_id,payload FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenantId, uncertainRun])).rows[0],
    durable,
  )
  assert.equal((await set("viewer", "2", "downgrade")).kind, "committed")
  await assert.rejects(() => tasks.updateScheduledTask(editor, task.id, { prompt: "viewer denial" }, lineage(editor, "denied", 6)), /EDIT_FORBIDDEN/)
})

test("real PG scheduled same-key actors remain independent and replay the original immutable ACK and persisted legacy ID", async (t) => {
  const raw = process.env.KOKORO_TEST_POSTGRES_URL
  assert.ok(raw, "Root-owned Project collaboration fixture URL is required")
  const url = new URL(raw)
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /^\/kokoro_bff_project_collab_[0-9a-f]{32}$/u)
  assert.deepEqual(url.searchParams.getAll("schema"), ["kokoro_bff"])
  const pool = new Pool({ connectionString: raw, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 5 })
  t.after(() => pool.end())
  const { PostgresScheduledTaskRepository } = await import("../dist/infrastructure/postgres/scheduled-task-repository.js")
  const tenantId = `b10_keys_${randomUUID()}`,
    projectId = `project_${randomUUID()}`,
    taskId = `scheduled_${randomUUID()}`
  const owner = { tenantId, subjectId: "owner" },
    editor = { tenantId, subjectId: "editor" },
    tasks = new PostgresScheduledTaskRepository({ pool })
  await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'Key isolation',$1)", [
    projectId,
    tenantId,
    owner.subjectId,
  ])
  const grants = createProjectGrantStore(pool)
  assert.equal(
    (
      await grants.mutate({
        ...owner,
        projectId,
        targetSubjectId: editor.subjectId,
        expectedAccessVersion: "1",
        body: { role: "editor", expires_at: null },
        receiptScope: JSON.stringify([tenantId, "grant"]),
        fingerprint: "a".repeat(64),
        signal: new AbortController().signal,
        deadlineAt: performance.now() + 5000,
      })
    ).kind,
    "committed",
  )
  const lineage = (scope, key, expectedRevision) => ({
    tenantId,
    actorId: scope.subjectId,
    requestId: `request-${scope.subjectId}-${key}`,
    idempotencyKey: key,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  })
  const input = { projectId, title: "Original create", prompt: "Original prompt", frequency: "daily", time: "08:00", timezone: "UTC", autoApprove: false }
  const created = await tasks.createScheduledTask(owner, input, taskId, lineage(owner, "create"))
  const first = await tasks.updateScheduledTask(owner, taskId, { title: "Owner save" }, lineage(owner, "same-save", 1))
  assert.equal(first.revision, 2)
  // The exact prior generator bytes model an already persisted owner command. Its payload/identity are never rewritten by new workers.
  const legacyId = `scheduled_outbox_${createHash("sha256").update([tenantId, taskId, "scheduler.replace", "same-save"].join("\u001f")).digest("hex").slice(0, 32)}`
  await pool.query(
    "UPDATE bff_scheduled_task_outbox SET outbox_id=$4 WHERE tenant_id=$1 AND task_id=$2 AND actor_id=$3 AND command_type='scheduler.replace' AND idempotency_key='same-save'",
    [tenantId, taskId, owner.subjectId, legacyId],
  )
  const fact = async () =>
    (
      await pool.query(
        "SELECT outbox_id,actor_id,payload,aggregate_revision::text FROM bff_scheduled_task_outbox WHERE tenant_id=$1 AND task_id=$2 AND command_type='scheduler.replace' ORDER BY actor_id",
        [tenantId, taskId],
      )
    ).rows
  const original = (await fact())[0]
  const second = await tasks.updateScheduledTask(editor, taskId, { title: "Editor save" }, lineage(editor, "same-save", 2))
  assert.equal(second.revision, 3)
  const rows = await fact()
  assert.equal(rows.length, 2)
  assert.equal(new Set(rows.map((row) => row.outbox_id)).size, 2)
  assert.deepEqual(
    rows.find((row) => row.actor_id === "owner"),
    original,
  )
  assert.deepEqual(await tasks.updateScheduledTask(owner, taskId, { title: "Owner save" }, lineage(owner, "same-save", 1)), first)
  assert.deepEqual(await tasks.createScheduledTask(owner, input, taskId, lineage(owner, "create")), created)
  assert.equal((await tasks.findScheduledTask(owner, taskId)).title, "Editor save")
  assert.equal((await tasks.findScheduledTask(owner, taskId)).executionActorId, "owner")
  // Select this owned legacy command deterministically without executing Scheduler HTTP or editing its immutable identity/payload.
  await pool.query(
    "UPDATE bff_scheduled_task_outbox SET status='succeeded',completed_at=clock_timestamp() WHERE tenant_id=$1 AND task_id=$2 AND command_type='scheduler.register'",
    [tenantId, taskId],
  )
  await pool.query(
    "UPDATE bff_scheduled_task_outbox SET created_at=CASE WHEN actor_id=$3 THEN '2020-01-01T00:00:00Z'::timestamptz ELSE '2020-01-01T00:00:00.001Z'::timestamptz END WHERE tenant_id=$1 AND task_id=$2 AND command_type='scheduler.replace'",
    [tenantId, taskId, owner.subjectId],
  )
  const claims = await tasks.claimScheduledTaskOutbox({ workerId: "legacy-identity-worker", now: new Date(), limit: 100, leaseDurationMs: 5000 })
  const legacy = claims.find((command) => command.outboxId === legacyId)
  assert.ok(legacy)
  assert.equal(legacy.actorId, "owner")
  assert.deepEqual(legacy.payload, original.payload)
  assert.equal(await tasks.markScheduledTaskOutboxSucceeded(legacy, new Date()), true)
  assert.deepEqual(
    (await fact()).find((row) => row.actor_id === "owner"),
    original,
  )
})

// One reader-switch fixture covers the shared snapshot/page/FINAL boundary without Agent/model execution.
test("real PG shared Conversation reader sees only user and FINAL pages/delivery, and fresh revoke removes all read paths", async (t) => {
  const raw = process.env.KOKORO_TEST_POSTGRES_URL
  assert.ok(raw, "Root-owned Project collaboration fixture URL is required")
  const url = new URL(raw)
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /^\/kokoro_bff_project_collab_[0-9a-f]{32}$/u)
  assert.deepEqual(url.searchParams.getAll("schema"), ["kokoro_bff"])
  const pool = new Pool({ connectionString: raw, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 4 })
  t.after(() => pool.end())
  const [{ PostgresChatSessionStore }, { PostgresConversationArtifactLibrary }, { privateChatMessage }] = await Promise.all([
    import("../dist/infrastructure/postgres/chat-session-store.js"),
    import("../dist/infrastructure/postgres/conversation-artifact-library.js"),
    import("../dist/application/chat/mappers.js"),
  ])
  const tenant = `b10_read_${randomUUID()}`,
    project = `project_${randomUUID()}`,
    conversation = `conversation_${randomUUID()}`,
    user = `message_${randomUUID()}`,
    assistant = `message_${randomUUID()}`,
    hidden = `message_${randomUUID()}`,
    artifact = `artifact_${randomUUID()}`
  const readPool = {
    connect: async () => {
      const client = await pool.connect()
      return new Proxy(client, {
        get(target, key) {
          if (key === "query")
            return async (...args) => {
              try {
                return await target.query(...args)
              } catch (error) {
                // SQLSTATE and a fixed phase only: never SQL text, parameters, body or connection URL.
                t.diagnostic(
                  JSON.stringify({
                    phase: String(args[0]).includes("CROSS JOIN LATERAL") ? "parts-slice" : "reader-query",
                    sqlstate: typeof error.code === "string" ? error.code : "non-pg",
                  }),
                )
                throw error
              }
            }
          const value = Reflect.get(target, key)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  }
  const database = { pool: readPool },
    chats = new PostgresChatSessionStore(database),
    library = new PostgresConversationArtifactLibrary(database)
  const lifetime = () => ({ scope: "all", signal: new AbortController().signal, deadlineAt: performance.now() + 5000 })
  await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,'creator','Shared',$1)", [project, tenant])
  await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,project_ref,title) VALUES($1,$2,'creator',$3,'Shared conversation')", [
    conversation,
    tenant,
    project,
  ])
  await pool.query("INSERT INTO bff_project_grant(tenant_id,project_id,subject_id,grant_role,granted_by) VALUES($1,$2,'reader','viewer','creator')", [
    tenant,
    project,
  ])
  await pool.query(
    `INSERT INTO bff_message(message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq,selected_skill_source_refs)
    VALUES($1,$2,$3,'run','user','literal user text','completed',1,'["skill:private-selection"]'),($4,$2,$3,'legacy-private','assistant','private legacy/process answer','completed',2,'[]')`,
    [user, tenant, conversation, hidden],
  )
  const part = (id, text, seq) => ({
    kind: "text",
    part_id: `text:${id}`,
    segment_id: id,
    text,
    completed: true,
    first_sequence: String(seq),
    latest_sequence: String(seq),
  })
  await pool.query(
    `INSERT INTO bff_message(message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq,ordered_parts,parts_format_version,parts_public_sequence,final_segment_id)
    VALUES($1,$2,$3,'run','assistant','private intermediate plus final','completed',3,$4::jsonb,1,2,'final')`,
    [assistant, tenant, conversation, JSON.stringify([part("private", "peer private intermediate", 1), part("final", "public final answer", 2)])],
  )
  await pool.query(
    `INSERT INTO bff_conversation_artifact(tenant_id,conversation_id,artifact_id,run_id,source_owner,source_event_id,source_sequence,source_digest,source_asset_id,source_artifact_kind,source_content_sha256,source_title,source_mime,source_size_bytes,source_display_path,delivered_at,favorited_at,source_subject_id)
    VALUES($1,$2,$3,'run','kokoro-agent','source',1,$4,'private-asset','document',$4,'Result','text/plain',6,'private/internal/path',CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3),'creator')`,
    [tenant, conversation, artifact, "a".repeat(64)],
  )
  const snapshot = await chats.readSnapshot(tenant, "reader", conversation, project, lifetime())
  assert.equal(snapshot.projectAccess.role, "viewer")
  assert.deepEqual(
    snapshot.messages.map((m) => m.messageId),
    [user, assistant],
  )
  assert.equal(Object.hasOwn(privateChatMessage(snapshot.messages[0]), "selected_skill_source_refs"), false)
  assert.equal(snapshot.deliveries[0].assetId, undefined)
  assert.equal(snapshot.deliveries[0].displayPath, undefined)
  const first = await chats.listMessages(tenant, "reader", conversation, 1, null, project, lifetime())
  assert.deepEqual(
    first.messages.map((m) => m.messageId),
    [user],
  )
  const second = await chats.listMessages(tenant, "reader", conversation, 1, first.next_cursor, project, lifetime())
  assert.deepEqual(
    second.messages.map((m) => m.messageId),
    [assistant],
  )
  const parts = await chats.readMessageParts({
    ...lifetime(),
    tenantId: tenant,
    subjectId: "reader",
    conversationId: conversation,
    messageId: assistant,
    projectRef: project,
    cursor: null,
    limit: 10,
  })
  assert.equal(parts.items.length, 1)
  assert.equal(parts.items[0].text, "public final answer")
  assert.equal(parts.items[0].segment_id, "final")
  const candidate = await library.findCandidate(tenant, "reader", conversation, artifact)
  assert.equal(candidate.projectAccess.role, "viewer")
  assert.equal(candidate.favorited, false, "another actor's private favorite is not inherited")
  assert.equal(await library.findCandidate(`${tenant}_other`, "reader", conversation, artifact), null)
  assert.equal(await chats.readSnapshot(tenant, "outsider", conversation, project, lifetime()), null)
  assert.equal(await chats.readSnapshot(tenant, "reader", conversation, undefined, { ...lifetime(), scope: "direct" }), null)
  await pool.query("UPDATE bff_project_grant SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND project_id=$2 AND subject_id='reader'", [tenant, project])
  assert.equal(await chats.readSnapshot(tenant, "reader", conversation, project, lifetime()), null)
  assert.equal(await chats.listMessages(tenant, "reader", conversation, 1, first.next_cursor, project, lifetime()), null)
  assert.equal(
    await chats.readMessageParts({
      ...lifetime(),
      tenantId: tenant,
      subjectId: "reader",
      conversationId: conversation,
      messageId: assistant,
      projectRef: project,
      cursor: null,
      limit: 10,
    }),
    null,
  )
  assert.equal(await library.findCandidate(tenant, "reader", conversation, artifact), null)
  assert.ok(await chats.readSnapshot(tenant, "creator", conversation, project, lifetime()), "creator's original access remains")
})

// Real owner repositories and source projection only; never executes an Agent/model or creates a network service.
test("real PG creator-editor-creator source cursors preserve public order, same-key actor scope, repeat identity and stale fences", async (t) => {
  const raw = process.env.KOKORO_TEST_POSTGRES_URL
  assert.ok(raw, "Root-owned Project collaboration fixture URL is required")
  const url = new URL(raw)
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /^\/kokoro_bff_project_collab_[0-9a-f]{32}$/u)
  assert.deepEqual(url.searchParams.getAll("schema"), ["kokoro_bff"])
  const pool = new Pool({ connectionString: raw, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 5 })
  t.after(() => pool.end())
  const [
    { ChatTurnApplicationService },
    { Sha256StableIdGenerator },
    { PostgresAgentDispatchOutboxRepository },
    { PostgresAgUiConsumerRepository },
    { PostgresAgUiProjectionRepository },
    { AgUiProjectionService },
  ] = await Promise.all([
    import("../dist/application/chat-turn-service.js"),
    import("../dist/infrastructure/identifiers/scheduled-task-outbox-id.js"),
    import("../dist/infrastructure/postgres/agent-dispatch-outbox-repository.js"),
    import("../dist/infrastructure/postgres/agui-consumer-repository.js"),
    import("../dist/infrastructure/postgres/agui-projection-repository.js"),
    import("../dist/application/agui/project-session-events.js"),
  ])
  const tenant = `b10_sources_${randomUUID()}`,
    project = `project_${randomUUID()}`,
    conversation = `conv_${randomUUID()}`
  const [{ PostgresChatSessionStore }, { createChatSessionReads }] = await Promise.all([
    import("../dist/infrastructure/postgres/chat-session-store.js"),
    import("../dist/application/chat/session-reads.js"),
  ])
  const database = { pool, notifyAgUiProjection: async () => undefined },
    outbox = new PostgresAgentDispatchOutboxRepository(database),
    turns = new ChatTurnApplicationService(outbox, new Sha256StableIdGenerator()),
    consumers = new PostgresAgUiConsumerRepository(database),
    repository = new PostgresAgUiProjectionRepository(database),
    projection = new AgUiProjectionService(repository)
  await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,'creator','Source switching',$1)", [project, tenant])
  await pool.query("INSERT INTO bff_project_grant(tenant_id,project_id,subject_id,grant_role,granted_by) VALUES($1,$2,'editor','editor','creator')", [
    tenant,
    project,
  ])
  const input = (subject, key) => ({
    tenantId: tenant,
    conversationId: conversation,
    projectRef: project,
    subjectId: subject,
    actorId: subject,
    requestId: `request-${subject}-${key}`,
    idempotencyKey: key,
    content: `${subject} literal user input`,
    selectedSkillSourceRefs: [],
  })
  const chats = new PostgresChatSessionStore(database),
    wireReads = createChatSessionReads(chats),
    grants = createProjectGrantStore(pool)
  const expectedHistory = []
  let firstPayload
  const setRole = async (role, version, key) =>
    grants.mutate({
      tenantId: tenant,
      subjectId: "creator",
      projectId: project,
      targetSubjectId: "editor",
      expectedAccessVersion: version,
      body: { role, expires_at: null },
      receiptScope: JSON.stringify([tenant, key]),
      fingerprint: key.padEnd(64, "a"),
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 5000,
    })
  const firstInput = input("creator", "same-key"),
    first = await turns.submit(firstInput)
  let firstLease,
    lastPublic = "0"
  const expectedWatermarks = new Map([
    ["creator", 0],
    ["editor", 0],
  ])
  for (const [subject, intent, receipt] of [
    ["creator", firstInput, first],
    ["editor", input("editor", "same-key"), null],
    ["creator", input("creator", "second"), null],
  ]) {
    const ack = receipt ?? (await turns.submit(intent))
    assert.ok(ack, `phase=submit actor=${subject} key=${intent.idempotencyKey}`)
    const commands = await outbox.claimAgentDispatchOutbox({ workerId: `dispatch-${subject}`, limit: 1, leaseDurationMs: 30000, maxAttempts: 8 })
    assert.equal(commands.length, 1)
    assert.equal(commands[0].subjectId, subject)
    assert.equal(commands[0].actorId, subject)
    assert.equal(commands[0].runId, ack.run_id)
    assert.deepEqual(
      commands[0].payload.launch.shared_conversation_context,
      { project_ref: project, conversation_id: conversation, messages: expectedHistory, has_earlier_messages: false },
      "each actor freezes only the already confirmed user/FINAL history",
    )
    if (firstPayload === undefined) firstPayload = structuredClone(commands[0].payload)

    assert.equal(await outbox.markAgentDispatchAdmitted(commands[0]), true)
    const ownBusy = await wireReads.snapshot(tenant, subject, conversation, project)
    assert.equal(ownBusy.execution_head.can_control, true)
    const peerBusy = await wireReads.snapshot(tenant, subject === "creator" ? "editor" : "creator", conversation, project)
    assert.equal(peerBusy.execution_head.can_control, false)
    assert.deepEqual(peerBusy.execution_head.pending_pauses, [])
    assert.equal(peerBusy.execution_process, null)
    assert.ok(peerBusy.messages?.every((message) => message.can_regenerate === false))
    if (subject === "editor") {
      assert.equal((await setRole("viewer", "1", "demote-busy")).kind, "committed")
      const downgraded = await wireReads.snapshot(tenant, "editor", conversation, project)
      assert.equal(downgraded.execution_head.can_control, false)
      assert.equal(downgraded.execution_process, null)
      assert.ok(downgraded.messages?.every((message) => message.can_regenerate === false))
      assert.equal((await setRole("editor", "2", "restore-editor")).kind, "committed")
    }

    const leases = await consumers.claimConsumers({
      workerId: `source-${subject}`,
      limit: 1,
      now: new Date().toISOString(),
      leaseUntil: new Date(Date.now() + 30000).toISOString(),
    })
    assert.equal(leases.length, 1)
    const lease = leases[0]
    assert.equal(lease.subjectId, subject)
    assert.equal(lease.sourceHighWatermark, expectedWatermarks.get(subject))
    if (firstLease === undefined) firstLease = lease
    else {
      const current = await repository.readStream(tenant, conversation, subject)
      assert.equal(
        await repository.commitProjection({
          tenantId: tenant,
          sessionId: conversation,
          sourceSubjectId: "creator",
          expectedVersion: current.version,
          sourceHighWatermark: 5,
          projectionState: { textMessageIds: [] },
          sources: [],
          consumerLease: firstLease,
        }),
        "lease_conflict",
      )
    }
    const start = expectedWatermarks.get(subject)
    const source = (offset, kind, payload) => {
      const seq = start + offset,
        timestamp = new Date(seq * 1000).toISOString(),
        id = `source-${seq}`
      return {
        sourceRunId: ack.run_id,
        sourceEventId: id,
        sourceSequence: seq,
        sourceOccurredAt: timestamp,
        sourcePayload: { kind, payload },
        event: { event_id: id, seq, session_id: conversation, run_id: ack.run_id, timestamp, kind, payload },
      }
    }
    const segment = `final-${ack.run_id}`
    const events = [
      source(1, "run.created", {}),
      source(2, "message.completed", { segment_id: segment, content: `${subject} final` }),
      source(3, "delivery.created", {
        artifact_id: `artifact-${ack.run_id}`,
        asset_id: `asset-${ack.run_id}`,
        artifact_kind: "document",
        content_hash: "a".repeat(64),
        tool_call_id: `tool-${ack.run_id}`,
        title: "Final",
        mime: "text/plain",
        size: 6,
      }),
      source(4, "run.completed", { status: "completed", final_segment_id: segment }),
    ]
    const result = await projection.ingest(tenant, conversation, events, lease)
    assert.equal(result.sourceHighWatermark, start + 4)
    expectedWatermarks.set(subject, start + 4)
    expectedHistory.push({ message_id: ack.user_message_id, sequence: String(expectedHistory.length + 1), role: "user", content: intent.content })
    expectedHistory.push({ message_id: ack.assistant_message_id, sequence: String(expectedHistory.length + 1), role: "assistant", content: `${subject} final` })
    const { readRunFinalAnswer } = await import("../dist/infrastructure/postgres/run-final-answer-read.js")
    const finalQuery = (actor = subject) => ({
      tenantId: tenant,
      subjectId: actor,
      conversationId: conversation,
      runId: ack.run_id,
      finalMessageId: segment,
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 5000,
    })
    const revision = (
      await pool.query("SELECT parts_public_sequence::text AS revision FROM bff_message WHERE tenant_id=$1 AND message_id=$2", [
        tenant,
        ack.assistant_message_id,
      ])
    ).rows[0].revision
    assert.deepEqual(
      await readRunFinalAnswer(pool, finalQuery()),
      { segment_id: segment, revision },
      "exact actual actor FINAL binding does not depend on Conversation creator",
    )
    assert.equal(
      await readRunFinalAnswer(pool, finalQuery(subject === "creator" ? "editor" : "creator")),
      null,
      "safe sharing never exposes another actor's private final binding",
    )
    if (subject === "editor") {
      assert.equal((await setRole("viewer", "3", "demote-final")).kind, "committed")
      assert.equal(await readRunFinalAnswer(pool, finalQuery()), null)
      const safe = await wireReads.snapshot(tenant, subject, conversation, project)
      assert.ok(
        safe.messages.some((message) => message.message_id === ack.assistant_message_id),
        "viewer retains the independently shared confirmed FINAL",
      )
      assert.equal(safe.execution_process, null)
      assert.equal((await setRole("editor", "4", "restore-final")).kind, "committed")
    }
    const ownDone = await wireReads.snapshot(tenant, subject, conversation, project)
    assert.equal(ownDone.execution_head, undefined)
    assert.equal(ownDone.execution_process, null)
    assert.equal(ownDone.messages.find((message) => message.message_id === ack.assistant_message_id).can_regenerate, true)
    const peerDone = await wireReads.snapshot(tenant, subject === "creator" ? "editor" : "creator", conversation, project)
    assert.ok(peerDone.messages.every((message) => message.can_regenerate === false))

    const positions = (
      await pool.query("SELECT public_sequence::text FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 ORDER BY bff_agui_event.public_sequence", [
        tenant,
        conversation,
      ])
    ).rows
    assert.ok(BigInt(positions.at(-1).public_sequence) > BigInt(lastPublic))
    lastPublic = positions.at(-1).public_sequence
    assert.equal((await projection.ingest(tenant, conversation, events, lease)).insertedSources, 0)
    await assert.rejects(
      () => projection.ingest(tenant, conversation, [{ ...events[0], sourcePayload: { changed: true } }], lease),
      /source identity|identity.*conflict/iu,
    )
    const artifactRow = (
      await pool.query("SELECT source_subject_id,run_id FROM bff_conversation_artifact WHERE tenant_id=$1 AND conversation_id=$2 AND artifact_id=$3", [
        tenant,
        conversation,
        `artifact-${ack.run_id}`,
      ])
    ).rows[0]
    assert.deepEqual(artifactRow, { source_subject_id: subject, run_id: ack.run_id })
  }
  assert.deepEqual(
    (
      await pool.query("SELECT subject_id,source_high_watermark::text FROM bff_agui_source_cursor WHERE tenant_id=$1 AND session_id=$2 ORDER BY subject_id", [
        tenant,
        conversation,
      ])
    ).rows,
    [
      { subject_id: "creator", source_high_watermark: "8" },
      { subject_id: "editor", source_high_watermark: "4" },
    ],
  )
  assert.deepEqual(await turns.submit(firstInput), first, "original actor replay returns the original ACK, not latest Run")
  assert.deepEqual(
    (await pool.query("SELECT payload FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenant, first.run_id])).rows[0].payload,
    firstPayload,
    "replay never rebuilds or rebinds an earlier shared history",
  )
  const sameKeys = (
    await pool.query(
      "SELECT actor_id,outbox_id FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 AND idempotency_key='same-key' ORDER BY actor_id",
      [tenant, conversation],
    )
  ).rows
  assert.deepEqual(
    sameKeys.map((row) => row.actor_id),
    ["creator", "editor"],
  )
  assert.notEqual(sameKeys[0].outbox_id, sameKeys[1].outbox_id)
})
