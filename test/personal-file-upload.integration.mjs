import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer, request as httpRequest } from "node:http"
import { test } from "node:test"

import { connectNodeAdapter } from "@connectrpc/connect-node"
import { Pool } from "pg"

import { createBffServer } from "../dist/bootstrap/server.js"
import { loadConfig } from "../dist/config/runtime.js"
import { StorageService, ScanState, UploadPurpose, UploadState } from "../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js"
import { PostgresIdempotencyRepository } from "../dist/infrastructure/postgres/idempotency-repository.js"

const postgresAdminUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integrationTest = postgresAdminUrl ? test : test.skip

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return `http://127.0.0.1:${server.address().port}`
}

function forward(request, response, target, dropAfterOwnerResponse) {
  const url = new URL(request.url ?? "/", target)
  const headers = { ...request.headers, host: url.host }
  const upstream = httpRequest(url, { method: request.method, headers }, (ownerResponse) => {
    const chunks = []
    ownerResponse.on("data", (chunk) => chunks.push(chunk))
    ownerResponse.on("error", () => response.destroy())
    ownerResponse.on("end", () => {
      if (dropAfterOwnerResponse(request.url ?? "")) {
        response.destroy()
        return
      }
      response.writeHead(ownerResponse.statusCode ?? 502, ownerResponse.headers)
      response.end(Buffer.concat(chunks))
    })
  })
  upstream.setTimeout(10_000, () => upstream.destroy())
  upstream.on("error", () => response.destroy())
  request.on("aborted", () => upstream.destroy())
  request.pipe(upstream)
}

function wireFile(filename, content) {
  const form = new FormData()
  form.append("files", new File([content], filename, { type: "text/plain" }))
  return new Request("http://bff.test/v1/library/files", { method: "POST", body: form })
}

async function post(base, key, filename, content, bearer = "owner") {
  const wire = wireFile(filename, content)
  const response = await fetch(`${base}/v1/library/files`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "web-secret",
      "idempotency-key": key,
      "content-type": wire.headers.get("content-type"),
    },
    body: Buffer.from(await wire.arrayBuffer()),
    signal: AbortSignal.timeout(10_000),
  })
  return { status: response.status, body: await response.json() }
}

integrationTest("personal upload survives lost Complete response and lost public response across independent BFF instances", { timeout: 30_000 }, async () => {
  const databaseName = `bff_personal_restart_${randomBytes(8).toString("hex")}`
  const admin = new Pool({ connectionString: postgresAdminUrl })
  const databaseUrl = new URL(postgresAdminUrl)
  databaseUrl.pathname = `/${databaseName}`
  databaseUrl.searchParams.set("schema", "kokoro_bff")
  const pools = []
  const servers = []
  let databaseCreated = false
  let bff = null
  try {
    await admin.query(`CREATE DATABASE ${databaseName}`)
    databaseCreated = true
    const setup = new Pool({ connectionString: databaseUrl.toString(), options: "-c search_path=kokoro_bff -c timezone=UTC" })
    pools.push(setup)
    await setup.query("CREATE SCHEMA kokoro_bff")
    await setup.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))

    const uploads = new Map()
    const commandUploads = new Map()
    const objectPuts = []
    const ownerCalls = { status: 0, asset: 0 }
    const objects = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      objectPuts.push({ uploadId: request.url?.slice(1), body: Buffer.concat(chunks) })
      response.writeHead(200)
      response.end()
    })
    const objectBase = await listen(objects)
    servers.push(objects)

    const owner = createServer(
      connectNodeAdapter({
        routes(router) {
          router.service(StorageService, {
            createUpload(command, context) {
              assert.equal(context.requestHeader.get("x-kokoro-scope-kind"), "personal")
              assert.equal(context.requestHeader.get("x-kokoro-scope-id"), "subject-1")
              assert.equal(command.uploadPurpose, UploadPurpose.ASSET)
              let uploadId = commandUploads.get(command.command.commandId)
              if (uploadId === undefined) {
                uploadId = `upload-${commandUploads.size + 1}`
                commandUploads.set(command.command.commandId, uploadId)
                uploads.set(uploadId, {
                  assetId: `asset-${commandUploads.size}`,
                  filename: command.filename,
                  mimeType: command.mimeType,
                  sha256: command.contentSha256,
                  sizeBytes: command.sizeBytes,
                  completed: false,
                  completes: 0,
                })
              }
              return {
                uploadId,
                uploadReference: {
                  url: `${objectBase}/${uploadId}`,
                  method: "PUT",
                  requiredHeaders: { "content-type": command.mimeType },
                  expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
                },
              }
            },
            getUploadStatus(command) {
              ownerCalls.status++
              const upload = uploads.get(command.uploadId)
              assert.ok(upload)
              return {
                uploadId: command.uploadId,
                state: upload.completed ? UploadState.COMPLETED : UploadState.PENDING,
                expectedSha256: upload.sha256,
                expectedSizeBytes: upload.sizeBytes,
                mimeType: upload.mimeType,
                ...(upload.completed ? { assetId: upload.assetId } : {}),
              }
            },
            completeUpload(command) {
              const upload = uploads.get(command.uploadId)
              assert.ok(upload)
              assert.equal(command.contentSha256, upload.sha256)
              upload.completed = true
              upload.completes++
              return { uploadId: command.uploadId, assetId: upload.assetId, scanState: ScanState.CLEAN }
            },
            getAsset(command) {
              ownerCalls.asset++
              const upload = [...uploads.values()].find((item) => item.assetId === command.assetId)
              assert.ok(upload?.completed)
              return {
                assetId: upload.assetId,
                filename: upload.filename,
                mimeType: upload.mimeType,
                sizeBytes: upload.sizeBytes,
                contentSha256: upload.sha256,
                uploadPurpose: UploadPurpose.ASSET,
                scanState: ScanState.CLEAN,
              }
            },
          })
        },
      }),
    )
    const ownerBase = await listen(owner)
    servers.push(owner)
    let loseCompleteResponse = false
    const storageProxy = createServer((request, response) => {
      forward(request, response, ownerBase, (path) => {
        if (!path.endsWith("/CompleteUpload") || !loseCompleteResponse) return false
        loseCompleteResponse = false
        return true
      })
    })
    const storageBase = await listen(storageProxy)
    servers.push(storageProxy)

    const admission = { revoked: false, calls: 0 }
    const config = loadConfig({
      KOKORO_TENANT_ID: "tenant-1",
      KOKORO_BFF_SHARED_SECRET: "web-secret",
      KOKORO_BFF_POSTGRES_URL: databaseUrl.toString(),
      KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:9/0",
      KOKORO_STORAGE_RPC_BASE_URL: storageBase,
      KOKORO_BFF_STORAGE_SECRET: "storage-secret",
      KOKORO_STORAGE_OBJECT_ORIGIN: objectBase,
    })
    const startBff = async () => {
      const pool = new Pool({ connectionString: databaseUrl.toString(), options: "-c search_path=kokoro_bff -c timezone=UTC" })
      pools.push(pool)
      bff = createBffServer(config, {
        businessStore: new PostgresIdempotencyRepository(pool),
        readiness: async () => {},
        sessionAdmission: {
          async verify({ token }) {
            admission.calls++
            return admission.revoked
              ? { ok: false, status: 401, code: "session_invalid" }
              : { ok: true, identity: { namespace: "tenant-1", userId: token === "owner" ? "subject-1" : "subject-2" } }
          },
        },
      })
      return listen(bff)
    }
    const stopBff = async () => {
      await bff.shutdown()
      bff = null
      await pools.at(-1).end()
      pools.pop()
    }
    const firstBase = await startBff()
    const firstContent = "file from first uncertain Complete"
    const firstSha = createHash("sha256").update(firstContent).digest("hex")
    loseCompleteResponse = true
    const uncertain = await post(firstBase, "complete-lost", "complete.txt", firstContent)
    assert.equal(uncertain.status, 503)
    assert.equal(uncertain.body.error.code, "storage_unavailable")
    assert.equal(uploads.size, 1, "Storage must have committed exactly one upload before losing Complete response")
    assert.equal(uploads.get("upload-1").completed, true)
    const uncertainReceipts = await pools
      .at(-1)
      .query("SELECT scope, status, response_body FROM bff_idempotency_receipt WHERE scope LIKE $1", ["%complete-lost%"])
    assert.equal(uncertainReceipts.rows.length, 1, "unknown Complete must retain only the durable upload checkpoint")
    assert.equal(uncertainReceipts.rows[0].status, 200)
    assert.equal(uncertainReceipts.rows[0].response_body.upload_id, "upload-1")
    await stopBff()

    const secondBase = await startBff()
    const recovered = await post(secondBase, "complete-lost", "complete.txt", firstContent)
    assert.equal(recovered.status, 200)
    assert.equal(recovered.body.data.file.asset_id, "asset-1")
    assert.equal(recovered.body.data.file.content_sha256, firstSha)
    assert.equal(uploads.get("upload-1").completes, 1)
    assert.equal(objectPuts.filter((item) => item.uploadId === "upload-1").length, 1)
    assert.equal((await post(secondBase, "complete-lost", "different.txt", firstContent)).status, 409)
    const recoveredReceipts = await pools
      .at(-1)
      .query("SELECT status, response_body FROM bff_idempotency_receipt WHERE scope = $1", [
        JSON.stringify(["tenant-1", "subject-1", "POST", "/library/files", "complete-lost"]),
      ])
    assert.equal(recoveredReceipts.rows.length, 1)
    assert.equal(recoveredReceipts.rows[0].status, 200)
    assert.equal(recoveredReceipts.rows[0].response_body.data.file.asset_id, "asset-1")

    let losePublicResponse = true
    const callerProxy = createServer((request, response) => {
      forward(request, response, secondBase, () => {
        if (!losePublicResponse) return false
        losePublicResponse = false
        return true
      })
    })
    const callerBase = await listen(callerProxy)
    servers.push(callerProxy)
    await assert.rejects(post(callerBase, "public-lost", "public.txt", "file with lost public response"))
    const committed = await pools
      .at(-1)
      .query("SELECT status, response_body FROM bff_idempotency_receipt WHERE scope = $1", [
        JSON.stringify(["tenant-1", "subject-1", "POST", "/library/files", "public-lost"]),
      ])
    assert.equal(committed.rows[0]?.status, 200)
    assert.equal(uploads.size, 2)
    await stopBff()

    const thirdBase = await startBff()
    const ownerCallsBeforeReplay = { ...ownerCalls }
    const replay = await post(thirdBase, "public-lost", "public.txt", "file with lost public response")
    assert.equal(replay.status, 200)
    assert.equal(replay.body.data.file.asset_id, committed.rows[0].response_body.data.file.asset_id)
    assert.equal(uploads.size, 2)
    assert.equal(
      [...uploads.values()].reduce((sum, upload) => sum + upload.completes, 0),
      2,
    )
    assert.deepEqual(ownerCalls, ownerCallsBeforeReplay, "terminal public receipt must replay without Storage I/O")
    admission.revoked = true
    assert.equal((await post(thirdBase, "public-lost", "public.txt", "file with lost public response")).status, 401)
    assert.ok(admission.calls >= 5)
    await stopBff()
  } finally {
    if (bff !== null) await bff.shutdown()
    for (const server of servers.reverse()) await new Promise((resolve) => server.close(resolve))
    for (const pool of pools.reverse()) await pool.end()
    if (databaseCreated) {
      const remaining = await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1", [databaseName])
      await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`)
      assert.equal(remaining.rows[0]?.count, 0, "test-owned PostgreSQL connections must drain before database deletion")
    }
    await admin.end()
  }
})
