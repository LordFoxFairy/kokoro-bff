import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { test } from "node:test"
import pg from "pg"
import { applyCanonicalSchema, loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { ChatTurnApplicationService } from "../dist/application/chat-turn-service.js"
import { PostgresAgentDispatchOutboxRepository } from "../dist/infrastructure/postgres/agent-dispatch-outbox-repository.js"

const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip
integration(
  "real PG ChatTurn freezes actor-owned personal material privately and reuses original input on replay/regeneration",
  { timeout: 30000 },
  async (t) => {
    assert.match(new URL(url).pathname, /^\/kokoro_bff_personal_context_[0-9a-f]{32}$/u)
    const pool = new pg.Pool({
      connectionString: url,
      options: "-c search_path=kokoro_bff -c timezone=UTC",
      max: 4,
    })
    let snapshotReads = 0
    let failSnapshot = false
    let retireAfterSnapshot
    // Only the injected read-failure substep is a fault seam; all transactions and data are real PG.
    const boundedPool = {
      connect: async () => {
        const client = await pool.connect()
        return new Proxy(client, {
          get(target, property) {
            if (property === "query")
              return (...args) => {
                if (typeof args[0] === "string" && args[0].startsWith("WITH usage AS")) {
                  snapshotReads++
                  if (failSnapshot) throw Error("fixture_personal_snapshot_read_failed")
                  const retirement = retireAfterSnapshot
                  return target.query(...args).then((result) => {
                    retirement?.abort(Error("fixture_retired_after_snapshot"))
                    return result
                  })
                }
                return target.query(...args)
              }
            const value = Reflect.get(target, property)
            return typeof value === "function" ? value.bind(target) : value
          },
        })
      },
    }
    try {
      assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_message') AS relation")).rows[0].relation, null)
      await applyCanonicalSchema(url, await loadCanonicalSchema())
      const repo = new PostgresAgentDispatchOutboxRepository({
        pool: boundedPool,
        notifyAgUiProjection: async () => undefined,
      })
      const turns = new ChatTurnApplicationService(repo, {
        generate: (material) => createHash("sha256").update(material).digest("hex"),
      })
      const tenantId = `personal_${randomUUID()}`,
        subjectId = "scope-owner",
        actorId = "human-actor"
      const projectId = `project_${randomUUID()}`
      await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug,instruction) VALUES($1,$2,$3,'fixture',$1,'project-only')", [
        projectId,
        tenantId,
        subjectId,
      ])
      const conversation = async () => {
        const id = `session_${randomUUID()}`
        await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,project_ref,title) VALUES($1,$2,$3,$4,'fixture')", [
          id,
          tenantId,
          subjectId,
          projectId,
        ])
        return id
      }
      const input = (conversationId, key) => ({
        tenantId,
        subjectId,
        actorId,
        conversationId,
        projectRef: projectId,
        requestId: key,
        idempotencyKey: key,
        content: "public question",
        selectedSkillSourceRefs: [],
        selectedMcpConnectionIds: [],
      })
      const submit = async (conversationId, key) => {
        const receipt = await turns.submit(input(conversationId, key))
        assert.ok(receipt)
        return receipt
      }
      const payload = async (receipt) =>
        (await pool.query("SELECT payload FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenantId, receipt.run_id])).rows[0].payload
      const complete = async (receipt) => {
        await pool.query(
          "UPDATE bff_agent_dispatch_outbox SET status='terminal',admitted_at=CURRENT_TIMESTAMP(3),completed_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND run_id=$2",
          [tenantId, receipt.run_id],
        )
        await pool.query(
          "UPDATE bff_message SET status='completed',content='public answer',ordered_parts=NULL,parts_format_version=NULL,parts_public_sequence=NULL WHERE tenant_id=$1 AND message_id=$2",
          [tenantId, receipt.assistant_message_id],
        )
      }
      const regenerate = async (conversationId, receipt, key) =>
        turns.regenerate({
          tenantId,
          subjectId,
          actorId,
          conversationId,
          projectRef: projectId,
          sourceMessageId: receipt.assistant_message_id,
          requestId: key,
          idempotencyKey: key,
          signal: new AbortController().signal,
          deadlineAt: performance.now() + 5000,
        })
      const putProfile = async (owner, instructions, tenant = tenantId) =>
        pool.query(
          `INSERT INTO bff_personalization(tenant_id,owner_id,nickname,occupation,about,instructions,revision)
      VALUES($1,$2,'','','',$3,1) ON CONFLICT(tenant_id,owner_id) DO UPDATE SET instructions=EXCLUDED.instructions,revision=bff_personalization.revision+1`,
          [tenant, owner, instructions],
        )
      let omittedConversation, omitted
      await t.test("absent facts keep old wire, existing empty profile is a real snapshot", async () => {
        omittedConversation = await conversation()
        omitted = await submit(omittedConversation, "no-facts")
        assert.equal(Object.hasOwn((await payload(omitted)).launch, "personal_context"), false)
        await complete(omitted)
        await putProfile(actorId, "")
        const empty = await submit(await conversation(), "empty-profile")
        assert.deepEqual((await payload(empty)).launch.personal_context, {
          schema_version: 1,
          owner: { tenant_ref: tenantId, user_ref: actorId },
          profile: {
            revision: 1,
            nickname: "",
            occupation: "",
            about: "",
            instructions: "",
          },
          knowledge: { usage_revision: 0, enabled: false, items: [] },
        })
        await complete(empty)
      })
      let selectedConversation, selected, frozen, activeRegeneration
      const marker = `private-${randomUUID()}-雪😀`
      const ids = ["01234567-89ab-4cde-8fab-000000000002", "01234567-89ab-4cde-8fab-000000000001"]
      await t.test("one statement freezes ordered active knowledge for the trusted actor, not Project subject or another tenant", async () => {
        await putProfile(actorId, marker)
        await putProfile(subjectId, "wrong-project-subject")
        await putProfile(actorId, "wrong-tenant", "foreign-tenant")
        await pool.query("INSERT INTO bff_personal_knowledge_usage(tenant_id,owner_id,enabled,revision) VALUES($1,$2,true,3)", [tenantId, actorId])
        for (const id of ids)
          await pool.query(
            "INSERT INTO bff_personal_knowledge(tenant_id,owner_id,knowledge_id,name,when_to_use,content,revision) VALUES($1,$2,$3,'知识','相关时',$4,2)",
            [tenantId, actorId, id, marker],
          )
        await pool.query(
          "INSERT INTO bff_personal_knowledge(tenant_id,owner_id,knowledge_id,name,when_to_use,content,revision,deleted_at) VALUES($1,$2,$3,'','','',2,CURRENT_TIMESTAMP(3))",
          [tenantId, actorId, randomUUID()],
        )
        selectedConversation = await conversation()
        const before = snapshotReads
        selected = await submit(selectedConversation, "selected")
        assert.equal(snapshotReads - before, 1)
        const launch = (await payload(selected)).launch
        frozen = launch.personal_context
        assert.equal(frozen.owner.user_ref, actorId)
        assert.equal(frozen.profile.instructions, marker)
        assert.equal(frozen.profile.revision, 2)
        assert.deepEqual(frozen.knowledge, {
          usage_revision: 3,
          enabled: true,
          items: [...ids].sort().map((knowledge_id) => ({
            knowledge_id,
            revision: 2,
            name: "知识",
            when_to_use: "相关时",
            content: marker,
          })),
        })
        assert.equal(launch.project_instruction, "project-only")
        assert.equal(JSON.stringify(launch.trace).includes(marker), false)
        const publicRows = await pool.query(
          "SELECT to_jsonb(m) AS value FROM bff_message m WHERE tenant_id=$1 UNION ALL SELECT to_jsonb(e) FROM bff_agui_event e WHERE tenant_id=$1",
          [tenantId],
        )
        assert.equal(JSON.stringify(publicRows.rows).includes(marker), false)
        await complete(selected)
      })
      await t.test("settings changes affect new turns; old-key replay never reads and regeneration keeps original material or omission", async () => {
        await putProfile(actorId, "new-profile")
        await pool.query("UPDATE bff_personal_knowledge_usage SET enabled=false,revision=4 WHERE tenant_id=$1 AND owner_id=$2", [tenantId, actorId])
        await pool.query(
          "UPDATE bff_personal_knowledge SET deleted_at=CURRENT_TIMESTAMP(3),name='',when_to_use='',content='',revision=revision+1 WHERE tenant_id=$1 AND owner_id=$2",
          [tenantId, actorId],
        )
        const before = snapshotReads
        failSnapshot = true
        assert.deepEqual(await turns.submit(input(selectedConversation, "selected")), selected)
        const again = await regenerate(selectedConversation, selected, "regenerate-selected")
        assert.ok(again)
        activeRegeneration = again
        assert.deepEqual((await payload(again)).launch.personal_context, frozen)
        const noFeature = await regenerate(omittedConversation, omitted, "regenerate-omitted")
        assert.ok(noFeature)
        assert.equal(Object.hasOwn((await payload(noFeature)).launch, "personal_context"), false)
        assert.equal(snapshotReads, before)
        failSnapshot = false
        const fresh = await submit(await conversation(), "new-settings")
        const current = (await payload(fresh)).launch.personal_context
        assert.equal(current.profile.instructions, "new-profile")
        assert.deepEqual(current.knowledge, {
          usage_revision: 4,
          enabled: false,
          items: [],
        })
        await complete(fresh)
      })
      await t.test("failed settings read and UTF-8 oversized complete launch leave no Message/outbox/interrupt effects", async () => {
        // Regeneration is only queued above. Seed its canonical admitted/running head here;
        // this is a PG fixture, not a claim that an Agent worker ran in this test.
        const admitted = await pool.query(
          "UPDATE bff_agent_dispatch_outbox SET status='admitted',admitted_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND run_id=$2 AND status='pending'",
          [tenantId, activeRegeneration.run_id],
        )
        assert.equal(admitted.rowCount, 1)
        const running = await pool.query(
          "UPDATE bff_agui_stream SET expected_run_id=$3,latest_run_id=$3,terminal_run_id=NULL WHERE tenant_id=$1 AND session_id=$2 AND consumer_subject_id=$4",
          [tenantId, selectedConversation, activeRegeneration.run_id, subjectId],
        )
        assert.equal(running.rowCount, 1)
        const head = (
          await pool.query(
            `SELECT d.run_id,d.subject_id,d.status,s.consumer_subject_id,s.expected_run_id,s.latest_run_id,s.terminal_run_id
          FROM bff_agent_dispatch_outbox d JOIN bff_agui_stream s ON s.tenant_id=d.tenant_id AND s.session_id=d.conversation_id
          WHERE d.tenant_id=$1 AND d.conversation_id=$2 AND d.status IN ('pending','leased','retryable','admitted')
          ORDER BY d.conversation_dispatch_seq,d.outbox_id LIMIT 1`,
            [tenantId, selectedConversation],
          )
        ).rows[0]
        assert.deepEqual(head, {
          run_id: activeRegeneration.run_id,
          subject_id: subjectId,
          status: "admitted",
          consumer_subject_id: subjectId,
          expected_run_id: activeRegeneration.run_id,
          latest_run_id: activeRegeneration.run_id,
          terminal_run_id: null,
        })
        const interruptedInput = (key) => ({ ...input(selectedConversation, key), interruptRunId: activeRegeneration.run_id })
        const effects = async () =>
          (
            await pool.query(
              `SELECT 'message' AS kind,to_jsonb(m) AS value FROM bff_message m WHERE tenant_id=$1
        UNION ALL SELECT 'dispatch',to_jsonb(d) FROM bff_agent_dispatch_outbox d WHERE tenant_id=$1
        UNION ALL SELECT 'cancel',to_jsonb(c) FROM bff_agent_cancellation_outbox c WHERE tenant_id=$1 ORDER BY kind,value`,
              [tenantId],
            )
          ).rows
        const before = await effects()
        failSnapshot = true
        await assert.rejects(turns.submit(interruptedInput("read-fails")), /fixture_personal_snapshot_read_failed/)
        assert.deepEqual(await effects(), before)
        failSnapshot = false
        retireAfterSnapshot = new AbortController()
        await assert.rejects(
          turns.submit(interruptedInput("retired-after-snapshot"), undefined, {
            signal: retireAfterSnapshot.signal,
            deadlineAt: performance.now() + 5000,
          }),
          /fixture_retired_after_snapshot/,
        )
        retireAfterSnapshot = undefined
        assert.deepEqual(await effects(), before)
        await pool.query("UPDATE bff_personal_knowledge_usage SET enabled=true,revision=5 WHERE tenant_id=$1 AND owner_id=$2", [tenantId, actorId])
        await pool.query(
          `INSERT INTO bff_personal_knowledge(tenant_id,owner_id,knowledge_id,name,when_to_use,content,revision)
        SELECT $1,$2,('01234567-89ab-4cde-8fab-'||lpad(to_hex(n),12,'0'))::uuid,repeat('😀',500),repeat('😀',500),repeat('😀',2000),1 FROM generate_series(1000,1099) n`,
          [tenantId, actorId],
        )
        await assert.rejects(turns.submit(interruptedInput("body-too-large")), /request_body_too_large/)
        assert.deepEqual(await effects(), before)
        await pool.query("UPDATE bff_personal_knowledge SET name='n',when_to_use='w',content='c' WHERE tenant_id=$1 AND owner_id=$2 AND deleted_at IS NULL", [
          tenantId,
          actorId,
        ])
        await pool.query(
          "INSERT INTO bff_personal_knowledge(tenant_id,owner_id,knowledge_id,name,when_to_use,content,revision) VALUES($1,$2,$3,'n','w','c',1)",
          [tenantId, actorId, randomUUID()],
        )
        await assert.rejects(turns.submit(interruptedInput("too-many-items")), /CHAT_PERSONAL_CONTEXT_INVALID/)
        assert.deepEqual(await effects(), before)
        // Positive control: the exact same current head accepts a healthy interrupt.
        // Disable knowledge rather than deleting the oversized fixture or weakening its bounds.
        await pool.query("UPDATE bff_personal_knowledge_usage SET enabled=false,revision=6 WHERE tenant_id=$1 AND owner_id=$2", [tenantId, actorId])
        const accepted = await turns.submit(interruptedInput("valid-interrupt"))
        assert.ok(accepted)
        assert.notEqual(accepted.run_id, activeRegeneration.run_id)
        assert.equal((await payload(accepted)).launch.message_id, accepted.user_message_id)
        const cancellations = (
          await pool.query("SELECT run_id,conversation_id,subject_id,actor_id,status,payload FROM bff_agent_cancellation_outbox WHERE tenant_id=$1", [tenantId])
        ).rows
        assert.deepEqual(cancellations, [
          {
            run_id: activeRegeneration.run_id,
            conversation_id: selectedConversation,
            subject_id: subjectId,
            actor_id: actorId,
            status: "cancel_requested",
            payload: { kind: "run.cancel", session_id: selectedConversation },
          },
        ])
      })
    } finally {
      await pool.end()
    }
  },
)
