import "reflect-metadata"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { test } from "node:test"
import pg from "pg"
import { Test } from "@nestjs/testing"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { Code, ConnectError } from "@connectrpc/connect"
import { applyCanonicalSchema, loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { AgentDispatchModule } from "../dist/modules/agent-dispatch/agent-dispatch.module.js"
import { BFF_CONFIG, BFF_DATABASE, CHAT_TURN_SERVICE } from "../dist/common/tokens.js"
import { StorageService, ScanState, UploadPurpose, AssetOrigin, ArtifactKind } from "../dist/generated/storage-connect/kokoro/storage/v3/storage_pb.js"

const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip
integration(
  "A08 real PG and Nest freeze exact owner metadata, replay without reads, retain regeneration manifest and reject changed scope/association",
  { timeout: 30000 },
  async (t) => {
    assert.match(new URL(url).pathname, /^\/kokoro_bff_resources_[0-9a-f]{32}$/u)
    const pool = new pg.Pool({ connectionString: url, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 6 })
    let module
    let owner
    const tenantId = "resources_" + randomUUID(),
      subjectId = "owner",
      projectId = "project-one",
      otherProjectId = "project-two"
    const conversationId = "session-consumer",
      sourceConversation = "session-source",
      sha = "a".repeat(64)
    const calls = []
    let afterRead = async () => undefined
    let scan = ScanState.CLEAN
    let artifactFailure
    const metadata = {
      filename: "input.txt",
      mimeType: "text/plain",
      contentSha256: sha,
      sizeBytes: 5n,
      uploadPurpose: UploadPurpose.ASSET,
      scanState: ScanState.CLEAN,
      origin: AssetOrigin.UPLOADED,
    }
    try {
      assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_message') AS relation")).rows[0].relation, null)
      await applyCanonicalSchema(url, await loadCanonicalSchema())
      await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$3,$4,'One','one'),($2,$3,$4,'Two','two')", [
        projectId,
        otherProjectId,
        tenantId,
        subjectId,
      ])
      await pool.query(
        "INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,project_ref,title) VALUES($1,$3,$4,$5,'Consumer'),($2,$3,$4,$5,'Source')",
        [conversationId, sourceConversation, tenantId, subjectId, projectId],
      )
      await pool.query(
        `INSERT INTO bff_conversation_artifact(tenant_id,conversation_id,artifact_id,run_id,source_event_id,source_sequence,source_digest,source_asset_id,source_artifact_kind,source_content_sha256,source_title,source_mime,source_size_bytes,delivered_at)
      VALUES($1,$2,'artifact-old','source-run','delivery',1,$3,'asset-final','document',$3,'Final','text/plain',5,CURRENT_TIMESTAMP)`,
        [tenantId, sourceConversation, sha],
      )
      owner = createServer(
        connectNodeAdapter({
          routes(router) {
            router.service(StorageService, {
              async getAsset(request, context) {
                const scope = context.requestHeader.get("x-kokoro-scope-kind"),
                  id = context.requestHeader.get("x-kokoro-scope-id")
                assert.equal(context.requestHeader.get("x-kokoro-service"), "web-bff")
                assert.equal(context.requestHeader.get("x-kokoro-tenant-id"), tenantId)
                assert.equal(context.requestHeader.get("x-kokoro-subject-id"), subjectId)
                calls.push(["asset", request.assetId, scope, id])
                if (!(
                  (request.assetId === "asset-personal" && scope === "personal" && id === subjectId) ||
                  (request.assetId === "asset-project" && scope === "project" && id === projectId)
                ))
                  throw new ConnectError("missing", Code.NotFound)
                await afterRead()
                return { ...metadata, assetId: request.assetId, scanState: scan }
              },
              async getFinalArtifact(request, context) {
                calls.push(["artifact", request.artifactId])
                assert.equal(context.requestHeader.get("x-kokoro-scope-kind"), "conversation")
                assert.equal(context.requestHeader.get("x-kokoro-scope-id"), sourceConversation)
                if (artifactFailure !== undefined) throw new ConnectError("private fixture diagnostic", artifactFailure)
                await afterRead()
                return {
                  item: {
                    artifactId: "artifact-old",
                    assetId: "asset-final",
                    contentSha256: sha,
                    kind: ArtifactKind.DOCUMENT,
                    title: "Final",
                    sourceRunId: "source-run",
                    filename: "final.txt",
                    mimeType: "text/plain",
                    sizeBytes: 5n,
                    createdAt: { seconds: 1700000000n },
                    finalizedAt: { seconds: 1700000001n },
                  },
                }
              },
            })
          },
        }),
      )
      await new Promise((resolve) => owner.listen(0, "127.0.0.1", resolve))
      const config = {
        agentEnabled: false,
        upstreams: {},
        storage: { baseUrl: `http://127.0.0.1:${owner.address().port}`, secret: "fixture-storage-secret", objectOrigin: "http://127.0.0.1:9" },
      }
      module = await Test.createTestingModule({ imports: [AgentDispatchModule] })
        .overrideProvider(BFF_CONFIG)
        .useValue(config)
        .overrideProvider(BFF_DATABASE)
        .useValue({ pool, notifyAgUiProjection: async () => undefined })
        .compile()
      const service = module.get(CHAT_TURN_SERVICE)
      const input = (key, refs) => ({
        tenantId,
        subjectId,
        actorId: subjectId,
        conversationId,
        requestId: key,
        idempotencyKey: key,
        content: "Read the selected inputs",
        selectedSkillSourceRefs: [],
        selectedResourceRefs: refs,
      })
      const refs = [
        { kind: "asset", resource_id: "asset-personal" },
        { kind: "asset", resource_id: "asset-project" },
        { kind: "artifact", resource_id: "artifact-old" },
      ]
      let first, manifest
      const payload = async (runId) =>
        (await pool.query("SELECT payload FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId])).rows[0].payload
      await t.test("real Nest provider resolves all three sources and freezes one private canonical manifest", async () => {
        first = await service.submit(input("first", refs))
        assert.ok(first)
        manifest = (await payload(first.run_id)).launch.selected_resource_refs
        assert.deepEqual(
          manifest.map((ref) => ref.source_scope),
          [
            { kind: "personal", id: subjectId },
            { kind: "project", id: projectId },
            { kind: "conversation", id: sourceConversation },
          ],
        )
        assert.equal(manifest[2].source_run_id, "source-run")
        assert.notEqual(first.run_id, "source-run")
        assert.deepEqual(
          manifest.map((ref) => ref.size_bytes),
          ["5", "5", "5"],
        )
        assert.equal(calls.length, 4)
      })
      await t.test("same-key replay bypasses owner reads even if new metadata would fail", async () => {
        const before = calls.length
        scan = ScanState.PENDING
        assert.deepEqual(await service.submit(input("first", refs)), first)
        assert.equal(calls.length, before)
        scan = ScanState.CLEAN
      })
      await pool.query(
        "UPDATE bff_agent_dispatch_outbox SET status='terminal',admitted_at=CURRENT_TIMESTAMP(3),completed_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND run_id=$2",
        [tenantId, first.run_id],
      )
      await pool.query("UPDATE bff_message SET status='completed',content='answer' WHERE tenant_id=$1 AND message_id=$2", [
        tenantId,
        first.assistant_message_id,
      ])
      await t.test("regeneration and its replay retain the original manifest without resolving metadata", async () => {
        const before = calls.length
        const regen = {
          tenantId,
          subjectId,
          actorId: subjectId,
          conversationId,
          sourceMessageId: first.assistant_message_id,
          requestId: "regenerate",
          idempotencyKey: "regenerate",
          signal: new AbortController().signal,
          deadlineAt: performance.now() + 5000,
        }
        const receipt = await service.regenerate(regen)
        assert.ok(receipt)
        assert.deepEqual((await payload(receipt.run_id)).launch.selected_resource_refs, manifest)
        assert.deepEqual(await service.regenerate(regen), receipt)
        assert.equal(calls.length, before)
      })
      const count = async () =>
        Number((await pool.query("SELECT count(*) AS count FROM bff_agent_dispatch_outbox WHERE tenant_id=$1", [tenantId])).rows[0].count)
      await t.test("retired FINAL cannot create a new selection, while an outage stays a dependency failure", async () => {
        const before = await count()
        const selection = [{ kind: "artifact", resource_id: "artifact-old" }]
        try {
          artifactFailure = Code.NotFound
          await assert.rejects(service.submit(input("retired-artifact", selection)), /CHAT_RESOURCE_SELECTION_INVALID/)
          artifactFailure = Code.Unavailable
          await assert.rejects(service.submit(input("artifact-dependency", selection)), /storage_unavailable/)
          assert.equal(await count(), before)
        } finally {
          artifactFailure = undefined
        }
      })
      await t.test("Project changed during owner read is rejected before any new command facts", async () => {
        const before = await count()
        afterRead = async () => {
          await pool.query("UPDATE bff_conversation SET project_ref=$1 WHERE conversation_id=$2", [otherProjectId, conversationId])
        }
        await assert.rejects(service.submit(input("scope-race", [{ kind: "asset", resource_id: "asset-project" }])), /CHAT_RESOURCE_SELECTION_CHANGED/)
        assert.equal(await count(), before)
        afterRead = async () => undefined
        await pool.query("UPDATE bff_conversation SET project_ref=$1 WHERE conversation_id=$2", [projectId, conversationId])
      })
      await t.test("Artifact association changed during owner read is rejected, while an unscanned Asset never submits", async () => {
        const before = await count()
        afterRead = async () => {
          await pool.query("UPDATE bff_conversation_artifact SET source_content_sha256=$1 WHERE tenant_id=$2 AND artifact_id='artifact-old'", [
            "b".repeat(64),
            tenantId,
          ])
        }
        await assert.rejects(service.submit(input("artifact-race", [{ kind: "artifact", resource_id: "artifact-old" }])), /CHAT_RESOURCE_SELECTION_CHANGED/)
        afterRead = async () => undefined
        scan = ScanState.PENDING
        await assert.rejects(service.submit(input("pending", [{ kind: "asset", resource_id: "asset-personal" }])), /CHAT_RESOURCE_SELECTION_INVALID/)
        assert.equal(await count(), before)
      })
      await t.test("source Conversation or Artifact contention fails immediately and rolls back every new command fact", async () => {
        scan = ScanState.CLEAN
        await pool.query("UPDATE bff_conversation_artifact SET source_content_sha256=$1 WHERE tenant_id=$2 AND artifact_id='artifact-old'", [sha, tenantId])
        const before = await count()
        for (const [kind, statement] of [
          ["conversation", "UPDATE bff_conversation SET title=title WHERE tenant_id=$1 AND conversation_id=$2"],
          ["artifact", "UPDATE bff_conversation_artifact SET source_content_sha256=source_content_sha256 WHERE tenant_id=$1 AND conversation_id=$2"],
        ]) {
          const blocker = await pool.connect()
          try {
            await blocker.query("BEGIN")
            await blocker.query(statement, [tenantId, sourceConversation])
            const started = performance.now()
            await assert.rejects(
              service.submit(input(`source-lock-${kind}`, [{ kind: "artifact", resource_id: "artifact-old" }])),
              (error) => error.code === "55P03",
            )
            assert.ok(performance.now() - started < 750, "source contention must use NOWAIT rather than wait for the lock budget")
            assert.equal(await count(), before)
          } finally {
            await blocker.query("ROLLBACK")
            blocker.release()
          }
        }
      })
      await t.test("foreign source ownership and another source Project fail before any owner metadata read", async () => {
        const before = await count(),
          reads = calls.length
        await pool.query("UPDATE bff_conversation SET project_ref=$1 WHERE conversation_id=$2", [otherProjectId, sourceConversation])
        await assert.rejects(service.submit(input("cross-project", [{ kind: "artifact", resource_id: "artifact-old" }])), /CHAT_RESOURCE_SELECTION_INVALID/)
        await pool.query("UPDATE bff_conversation SET project_ref=$1,owner_id='foreign' WHERE conversation_id=$2", [projectId, sourceConversation])
        await assert.rejects(service.submit(input("foreign", [{ kind: "artifact", resource_id: "artifact-old" }])), /CHAT_RESOURCE_SELECTION_INVALID/)
        assert.equal(calls.length, reads)
        assert.equal(await count(), before)
      })
      await t.test("freezes a no-Artifact final answer in mixed order and revalidates fresh regeneration but never replays a source read", async () => {
        const history = "answer-source-session",
          consumer = "answer-consumer-session",
          mixed = "answer-mixed-session"
        const message = "assistant-source",
          run = "answer-source-run",
          segment = "answer-source-final"
        const original = "  Exact e\u0301 🧪\nfinal answer\n"
        await pool.query(
          `INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title)
           VALUES ($1,$4,$5,$6,'History'),($2,$4,$5,$6,'Consumer'),($3,$4,$5,$6,'Mixed')`,
          [history, consumer, mixed, tenantId, subjectId, projectId],
        )
        await pool.query(
          `INSERT INTO bff_message (message_id,tenant_id,conversation_id,run_id,role,content,ordered_parts,parts_format_version,parts_public_sequence,final_segment_id,status,message_seq)
           VALUES ($1,$2,$3,$4,'assistant','Aggregate must not become input',$5::jsonb,1,12,$6,'completed',1)`,
          [
            message,
            tenantId,
            history,
            run,
            JSON.stringify([
              {
                kind: "text",
                part_id: "text:" + segment,
                segment_id: segment,
                text: original,
                completed: true,
                first_sequence: "8",
                latest_sequence: "10",
              },
            ]),
            segment,
          ],
        )
        await pool.query(
          `INSERT INTO bff_agent_dispatch_outbox (outbox_id,tenant_id,conversation_id,conversation_dispatch_seq,subject_id,actor_id,request_id,idempotency_key,
             request_digest,run_id,user_message_id,assistant_message_id,identity_assertion_ref,execution_project_ref,payload,status,admitted_at)
           VALUES ('historical-source',$1,$2,1,$3,$3,'source','source',repeat('a',64),$4,'source-user',$5,'source-assertion',$6,'{}'::jsonb,'admitted',CURRENT_TIMESTAMP)`,
          [tenantId, history, subjectId, run, message, projectId],
        )
        const selected = { kind: "final_answer", resource_id: message }
        const final = {
          ...selected,
          source_scope: { kind: "conversation", id: history },
          source_run_id: run,
          source_final_segment_id: segment,
          source_revision: "12",
          content: original,
          content_sha256: createHash("sha256").update(original).digest("hex"),
          size_bytes: String(Buffer.byteLength(original)),
        }
        const request = { ...input("final-only", [selected]), conversationId: consumer }
        const reads = calls.length
        const accepted = await service.submit(request)
        assert.ok(accepted)
        assert.equal(calls.length, reads)
        const frozen = (await payload(accepted.run_id)).launch
        assert.equal(frozen.content, request.content)
        assert.deepEqual(frozen.selected_resource_refs, [final])
        const mixedInput = { ...input("mixed-final", [refs[0], selected, refs[1]]), conversationId: mixed }
        const mixedAccepted = await service.submit(mixedInput)
        const mixedFrozen = (await payload(mixedAccepted.run_id)).launch.selected_resource_refs
        assert.deepEqual(mixedFrozen, [manifest[0], final, manifest[1]])
        const mixedReads = calls.length
        await pool.query(
          "UPDATE bff_agent_dispatch_outbox SET status='terminal',admitted_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP WHERE run_id=$1",
          [accepted.run_id],
        )
        await pool.query("UPDATE bff_message SET status='completed',content='consumer answer' WHERE message_id=$1", [accepted.assistant_message_id])
        const regen = {
          tenantId,
          subjectId,
          actorId: subjectId,
          conversationId: consumer,
          sourceMessageId: accepted.assistant_message_id,
          requestId: "regen-final",
          idempotencyKey: "regen-final",
          signal: new AbortController().signal,
          deadlineAt: performance.now() + 10000,
        }
        await pool.query("UPDATE bff_message SET parts_public_sequence=13 WHERE message_id=$1", [message])
        const before = await count()
        await assert.rejects(service.regenerate(regen), /CHAT_RESOURCE_SELECTION_CHANGED/)
        assert.equal(await count(), before)
        await pool.query("UPDATE bff_message SET parts_public_sequence=12 WHERE message_id=$1", [message])
        const regenerated = await service.regenerate(regen)
        assert.deepEqual((await payload(regenerated.run_id)).launch.selected_resource_refs, [final])
        await pool.query("UPDATE bff_conversation SET status='deleted',deleted_at=CURRENT_TIMESTAMP WHERE conversation_id=$1", [history])
        assert.deepEqual(await service.regenerate(regen), regenerated)
        assert.deepEqual(await service.submit(request), accepted)
        await assert.rejects(service.submit({ ...request, requestId: "fresh-final", idempotencyKey: "fresh-final" }), /CHAT_RESOURCE_SELECTION_INVALID/)
        assert.equal(calls.length, mixedReads)
      })
    } finally {
      await module?.close()
      if (owner?.listening) await new Promise((resolve) => owner.close(resolve))
      await pool.end()
    }
  },
)
