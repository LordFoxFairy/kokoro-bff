import "reflect-metadata"
import assert from "node:assert/strict"
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http"
import { afterEach, describe, it } from "node:test"
import type { INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { BFF_CONFIG, BFF_DATABASE, MUSIC_IDEMPOTENCY, SESSION_ADMISSION } from "../dist/common/tokens.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { MusicModule } from "../dist/modules/music/music.module.js"
import type { BffConfig } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const applications: INestApplication[] = []
const owners: Server[] = []

async function listenMusic(configuration: BffConfig): Promise<string> {
  const module = await Test.createTestingModule({ imports: [MusicModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(configuration)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: Object.freeze({}) })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(new SessionAdmissionDouble({ "test-session": { namespace: "ns_test", userId: "user_test" } }))
    // The prior fixture had no persistent receipt store; these tests exercise HTTP owner projection.
    .overrideProvider(MUSIC_IDEMPOTENCY)
    .useValue({ entries: new Map() })
    .compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  applications.push(app)
  await app.listen(0, "127.0.0.1")
  return app.getUrl()
}

type OwnerCall = { method: string | undefined; path: string | undefined; headers: IncomingHttpHeaders; body: string }
type OwnerReply = { status: number; contentType?: string; body: string }

async function listenOwner(respond: (call: OwnerCall, index: number) => OwnerReply) {
  const calls: OwnerCall[] = []
  const owner = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const call = { method: request.method, path: request.url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") }
    const index = calls.push(call) - 1
    const reply = respond(call, index)
    response.writeHead(reply.status, { "content-type": reply.contentType ?? "application/json" })
    response.end(reply.body)
  })
  owners.push(owner)
  await new Promise<void>((resolve, reject) => {
    owner.once("error", reject)
    owner.listen(0, "127.0.0.1", resolve)
  })
  const address = owner.address()
  if (address === null || typeof address === "string") throw new Error("Music peer did not bind")
  const base = await listenMusic(config({ upstreams: { ...config().upstreams, music: `http://127.0.0.1:${address.port}` } }))
  return { base, calls }
}

function config(overrides: Partial<BffConfig> = {}): BffConfig {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "ns_test",
    iamBaseUrl: null,
    iamWebOrigin: "https://web.example.test",
    sharedSecret: "test-secret",
    upstreamSecret: "bff-upstream-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {
      system: null,
      model: null,
      capability: null,
      storage: null,
      scheduler: null,
      agents: null,
      billing: null,
      music: null,
    },
    ...overrides,
  }
}

function authHeaders(): Record<string, string> {
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    cookie: "kokoro-issuer.session_token=test-session",
    origin: "https://web.example.test",
  }
}

afterEach(async () => {
  await Promise.all([
    ...applications.splice(0).map((app) => {
      app.getHttpServer().closeAllConnections()
      return app.close()
    }),
    ...owners.splice(0).map((owner) => {
      owner.closeAllConnections()
      return new Promise<void>((resolve) => owner.close(() => resolve()))
    }),
  ])
})

const at = "2026-09-02T12:00:00.000Z"
const projectRef = "project_preview_first_light"
const generationRef = "generation_mori_1"
const versionRef = "version_mori_1"
const candidates = ["candidate_mori_1", "candidate_mori_2"]
const generation = {
  generation_ref: generationRef,
  project_ref: projectRef,
  song_plan_ref: "song_plan_preview_first_light",
  mode: "smart",
  status: "succeeded",
  progress: 100,
  candidate_refs: candidates,
  created_at: at,
}
const generationCommand = {
  song_plan_ref: generation.song_plan_ref,
  mode: "smart",
  prompt: "A warm late-night track for the drive home.",
  lyrics: null,
  lyrics_mode: "instrumental",
  style: "dream pop intimate organic",
  reference_asset_refs: [],
  voice_ref: null,
  duration_seconds: 180,
}

function ownerData(status: number, data: object): OwnerReply {
  return { status, body: JSON.stringify({ data: { ...data, provider_task_id: "private-provider" }, meta: { request_id: "owner-request" } }) }
}

function post(body: object, key?: string) {
  return {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json", ...(key === undefined ? {} : { "idempotency-key": key }) },
    body: JSON.stringify(body),
  }
}

function forwarded(calls: OwnerCall[]) {
  return calls.map(({ method, path, headers, body }) => [method, path, headers["idempotency-key"], body])
}

describe("Mori music projection", () => {
  it("projects the owner generation receipt and snapshot, replaying the 202 without a second owner command", async () => {
    const queued = { generation_ref: generationRef, status: "queued" }
    const { base, calls } = await listenOwner((_call, index) => (index === 0 ? ownerData(202, queued) : ownerData(200, generation)))
    const path = `/projects/${projectRef}/generations`
    const init = post(generationCommand, "mori-generation-1")
    const first = await fetch(`${base}/v1/mori${path}`, init)
    const receipt = (await first.json()) as { data: unknown; meta: { request_id: string } }
    assert.equal(first.status, 202)
    assert.deepEqual(receipt.data, queued)
    assert.ok(receipt.meta.request_id)

    const replay = await fetch(`${base}/v1/mori${path}`, init)
    assert.equal(replay.status, 202)
    assert.deepEqual(await replay.json(), receipt)
    const snapshot = await fetch(`${base}/v1/mori/generations/${generationRef}`, {
      headers: { ...authHeaders(), "last-event-id": `${generationRef}:1` },
    })
    assert.equal(snapshot.status, 200)
    assert.deepEqual(((await snapshot.json()) as { data: unknown }).data, generation)
    assert.deepEqual(forwarded(calls), [
      ["POST", `/internal/bff/mori${path}`, "mori-generation-1", init.body],
      ["GET", `/internal/bff/mori/generations/${generationRef}`, undefined, ""],
    ])
    assert.equal(calls[1]?.headers["last-event-id"], undefined)
  })

  it("rejects a missing mutation key before owner I/O and projects the owner's explicit cancellation receipt", async () => {
    const cancelled = { generation_ref: generationRef, status: "cancelled" }
    const { base, calls } = await listenOwner(() => ownerData(202, cancelled))
    const missing = await fetch(`${base}/v1/mori/projects/${projectRef}/generations`, post(generationCommand))
    assert.equal(missing.status, 400)
    assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "idempotency_key_required")
    assert.equal(calls.length, 0)

    const cancel = await fetch(`${base}/v1/mori/generations/${generationRef}/cancel`, post({}, "mori-cancel-1"))
    assert.equal(cancel.status, 202)
    assert.deepEqual(((await cancel.json()) as { data: unknown }).data, cancelled)
    assert.deepEqual(forwarded(calls), [["POST", `/internal/bff/mori/generations/${generationRef}/cancel`, "mori-cancel-1", "{}"]])
  })

  it("preserves the owner wire for projects, plans, candidates, versions, remix, library and export", async () => {
    const project = { title: "Blue Hour", description: "A patient electronic sketch." }
    const plan = {
      prompt: "A patient electronic sketch for the blue hour.",
      mood: "reflective spacious",
      tempo_bpm: 96,
      structure: ["intro", "verse", "chorus", "outro"],
      instruments: ["soft_synth", "sub_bass"],
      vocal_direction: "close and understated",
      lyrics_intent: "leave the day with a little more room to breathe",
    }
    const version = { version_ref: versionRef, project_ref: projectRef, source_candidate_ref: candidates[1], status: "current" }
    const asset = {
      project_ref: projectRef,
      version_ref: versionRef,
      title: project.title,
      duration_seconds: 180,
      audio_asset_ref: "audio-mori",
      waveform_asset_ref: "waveform-mori",
      created_at: at,
    }
    const exportRef = "export-mori"
    const cases = [
      {
        path: "/projects",
        init: post(project, "mori-project-1"),
        status: 201,
        data: { project_ref: projectRef, ...project, current_version_ref: null, candidate_count: 2, last_activity_at: at },
      },
      {
        path: `/projects/${projectRef}`,
        status: 200,
        data: { project_ref: projectRef, ...project, current_version_ref: null, candidate_count: 2, last_activity_at: at },
      },
      {
        path: `/projects/${projectRef}/song_plans`,
        init: post(plan, "mori-plan-1"),
        status: 201,
        data: { song_plan_ref: generation.song_plan_ref, project_ref: projectRef, ...plan, created_at: at },
      },
      {
        path: `/projects/${projectRef}/candidates`,
        status: 200,
        data: {
          candidates: candidates.map((candidate_ref, index) => ({
            ...asset,
            version_ref: `version_mori_${index + 1}`,
            candidate_ref,
            generation_ref: generationRef,
            style_tags: ["dream-pop"],
          })),
          next_cursor: null,
        },
      },
      { path: `/candidates/${candidates[1]}/promote`, init: post({}, "mori-promote-1"), status: 201, data: version },
      {
        path: `/versions/${versionRef}/remix`,
        init: post({}, "mori-remix-1"),
        status: 202,
        data: { generation_ref: "remix-mori", status: "queued" },
      },
      {
        path: `/versions/${versionRef}/exports`,
        init: post({ format: "wav" }, "mori-export-1"),
        status: 202,
        data: { export_ref: exportRef, status: "queued" },
      },
      {
        path: "/library?kind=all&limit=10",
        status: 200,
        data: {
          items: ["library-mori-1", "library-mori-2"].map((library_item_ref) => ({
            ...asset,
            library_item_ref,
            project_title: project.title,
            kind: "version",
          })),
          next_cursor: null,
        },
      },
      {
        path: `/exports/${exportRef}`,
        status: 200,
        data: {
          export_ref: exportRef,
          project_ref: projectRef,
          version_ref: versionRef,
          format: "wav",
          status: "succeeded",
          download_url: "https://download.kokoro.invalid/mori/export-mori",
          created_at: at,
        },
      },
    ]
    const error = { code: "invalid_cursor", message: "Invalid library cursor" }
    const { base, calls } = await listenOwner((_call, index) => {
      const row = cases[index]
      return row === undefined ? { status: 400, body: JSON.stringify({ error }) } : ownerData(row.status, row.data)
    })
    for (const row of cases) {
      const response = await fetch(`${base}/v1/mori${row.path}`, row.init ?? { headers: authHeaders() })
      assert.equal(response.status, row.status, row.path)
      assert.deepEqual(((await response.json()) as { data: unknown }).data, row.data, row.path)
    }
    const invalid = await fetch(`${base}/v1/mori/library?cursor=not-a-cursor`, { headers: authHeaders() })
    assert.equal(invalid.status, 400)
    assert.equal(((await invalid.json()) as { error: { code: string } }).error.code, "invalid_cursor")
    assert.deepEqual(forwarded(calls), [
      ...cases.map(({ path, init }) => [init?.method ?? "GET", `/internal/bff/mori${path}`, init?.headers["idempotency-key"], init?.body ?? ""]),
      ["GET", "/internal/bff/mori/library?cursor=not-a-cursor", undefined, ""],
    ])
  })

  it("fails closed when the live Music owner is not configured", async () => {
    const base = await listenMusic(config({ mode: "live" }))
    const response = await fetch(`${base}/v1/mori/projects/project_preview_first_light`, { headers: authHeaders() })
    const body = (await response.json()) as { error: { code: string } }
    assert.equal(response.status, 503)
    assert.equal(body.error.code, "music_owner_not_configured")
  })

  it("resumes the Music owner SSE strictly after Last-Event-ID", async () => {
    const path = `/generations/${generationRef}/events`
    const lastEventId = `${generationRef}:1`
    const { base, calls } = await listenOwner(({ headers }) => {
      const sequence = headers["last-event-id"] === lastEventId ? 2 : 1
      return {
        status: 200,
        contentType: "text/event-stream",
        body: [
          `id: ${generationRef}:${sequence}`,
          "event: generation.progress",
          `data: ${JSON.stringify({ data: { ...generation, status: "generating", progress: sequence, candidate_refs: [] } })}`,
          "",
          "",
        ].join("\n"),
      }
    })
    const first = await fetch(`${base}/v1/mori${path}`, { headers: authHeaders() })
    const firstEvents = await first.text()
    assert.equal(first.status, 200)
    assert.match(first.headers.get("content-type") ?? "", /text\/event-stream/u)
    assert.match(firstEvents, new RegExp(`id: ${generationRef}:1`, "u"))

    const replay = await fetch(`${base}/v1/mori${path}`, { headers: { ...authHeaders(), "last-event-id": lastEventId } })
    const replayEvents = await replay.text()
    assert.equal(replay.status, 200)
    assert.doesNotMatch(replayEvents, new RegExp(`id: ${generationRef}:1`, "u"))
    assert.match(replayEvents, new RegExp(`id: ${generationRef}:2`, "u"))

    const ambiguousStatus = await new Promise<number | undefined>((resolve, reject) => {
      const duplicate = request(`${base}/v1/mori${path}`, {
        headers: { ...authHeaders(), "last-event-id": [lastEventId, lastEventId] },
      }, (response) => {
        response.once("error", reject)
        response.once("end", () => resolve(response.statusCode))
        response.resume()
      })
      duplicate.once("error", reject)
      duplicate.end()
    })
    assert.equal(ambiguousStatus, 400)
    assert.deepEqual(
      calls.map(({ path, headers }) => [path, headers["last-event-id"]]),
      [
        [`/internal/bff/mori${path}`, undefined],
        [`/internal/bff/mori${path}`, lastEventId],
      ],
    )
  })
})
