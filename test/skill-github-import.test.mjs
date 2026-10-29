import test from "node:test"
import assert from "node:assert/strict"
test("Github adapter rejects short refs, arbitrary URLs and redirects before bytes are accepted", async () => {
  const module = await import("../src/infrastructure/clients/github-skill-import.ts").catch(() => ({}))
  assert.equal(typeof module.GithubSkillImportClient, "function", "immutable public repository adapter missing")
  let calls = 0
  const client = new module.GithubSkillImportClient(async () => {
    calls++
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    })
  })
  await assert.rejects(() => client.fetch({ owner: "owner", repository: "repo", commit: "main", path: "" }, AbortSignal.timeout(1000)))
  assert.equal(calls, 0)
  await assert.rejects(() => client.fetch({ owner: "owner", repository: "repo", commit: "a".repeat(40), path: "" }, AbortSignal.timeout(1000)))
  assert.equal(calls, 1)
})

function archive(files) {
  const crc = (bytes) => {
    let x = 0xffffffff
    for (const b of bytes) {
      x ^= b
      for (let i = 0; i < 8; i++) x = (x >>> 1) ^ (x & 1 ? 0xedb88320 : 0)
    }
    return (x ^ 0xffffffff) >>> 0
  }
  const local = [],
    central = []
  let offset = 0
  for (const [path, body] of files) {
    const name = Buffer.from(path),
      bytes = Buffer.from(body),
      l = Buffer.alloc(30),
      c = Buffer.alloc(46)
    l.writeUInt32LE(0x04034b50)
    l.writeUInt16LE(20, 4)
    l.writeUInt16LE(0x800, 6)
    l.writeUInt32LE(crc(bytes), 14)
    l.writeUInt32LE(bytes.length, 18)
    l.writeUInt32LE(bytes.length, 22)
    l.writeUInt16LE(name.length, 26)
    c.writeUInt32LE(0x02014b50)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(0x800, 8)
    c.writeUInt32LE(crc(bytes), 16)
    c.writeUInt32LE(bytes.length, 20)
    c.writeUInt32LE(bytes.length, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(offset, 42)
    local.push(l, name, bytes)
    central.push(c, name)
    offset += l.length + name.length + bytes.length
  }
  const dir = Buffer.concat(central),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, dir, end])
}
test("Github public snapshot verifies repository identity and immutable commit then selects exact subdirectory bytes", async () => {
  const { GithubSkillImportClient, githubSkillPackage } = await import("../src/infrastructure/clients/github-skill-import.ts")
  const zip = archive([
    ["root/other/secret.txt", "not selected"],
    ["root/skills/one/SKILL.md", "---\nname: One\ndescription: Real description\n---\n# One"],
    ["root/skills/one/code.ts", "export {}"],
  ])
  const pkg = githubSkillPackage(zip, "skills/one")
  assert.ok(pkg.includes(Buffer.from('{"schema_version":2,"entry":"SKILL.md"}')))
  assert.ok(!pkg.includes(Buffer.from("not selected")))
  assert.throws(() => githubSkillPackage(archive([["root/skills/../SKILL.md", "# Bad"]]), "skills"))
  assert.throws(() =>
    githubSkillPackage(
      archive([
        ["root/SKILL.md", "# One"],
        ["root/SKILL.md", "# Two"],
      ]),
      "",
    ),
  )
  assert.throws(() =>
    githubSkillPackage(
      archive([
        ["root/SKILL.md", "# One"],
        ["root/manifest.json", '{"schema_version":2,"entry":"bad"}'],
      ]),
      "",
    ),
  )
  const malformed = Buffer.from(zip)
  malformed[malformed.indexOf(Buffer.from("# One"))] ^= 1
  assert.throws(() => githubSkillPackage(malformed, "skills/one"))
  const calls = [],
    commit = "a".repeat(40)
  const client = new GithubSkillImportClient(async (url, options) => {
    calls.push([url, options])
    if (url.endsWith(`/commits/${commit}`)) return Response.json({ sha: commit })
    if (url.startsWith("https://codeload.github.com/"))
      return new Response(zip, {
        headers: { "content-type": "application/zip" },
      })
    return Response.json({
      id: 1,
      private: false,
      full_name: "owner/repo",
      html_url: "https://github.com/owner/repo",
      owner: { login: "owner", html_url: "https://github.com/owner" },
      stargazers_count: 2,
      forks_count: 3,
    })
  })
  const result = await client.fetch({ owner: "owner", repository: "repo", commit, path: "skills/one" }, AbortSignal.timeout(1000))
  assert.deepEqual(result.bytes, pkg)
  assert.equal(result.repository.repo_stats.stars, "2")
  assert.equal(calls.length, 3)
  assert.ok(
    calls.every(([, options]) => options.redirect === "error" && options.credentials === "omit" && !Object.keys(options.headers).includes("authorization")),
  )
})

test("URL-only GitHub preview HTTP resolves default branch to immutable SHA and real metadata", async () => {
  const { createServer } = await import("node:http")
  const { once } = await import("node:events")
  const { skillGithubPreviewRoute } = await import("../src/http/routes/skill-github-import.ts")
  const original = globalThis.fetch,
    calls = [],
    commit = "b".repeat(40)
  const zip = archive([["root/SKILL.md", "---\nname: Real skill\ndescription: Actual description\n---\n# Real body"]])
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("http://127.0.0.1:")) return original(url, options)
    calls.push(String(url))
    if (String(url).endsWith("/commits/main")) return Response.json({ sha: commit })
    if (String(url).startsWith("https://codeload.github.com/"))
      return new Response(zip, {
        headers: { "content-type": "application/zip" },
      })
    return Response.json({
      id: 1,
      private: false,
      full_name: "owner/repo",
      html_url: "https://github.com/owner/repo",
      owner: { login: "owner", html_url: "https://github.com/owner" },
      stargazers_count: 0,
      forks_count: 0,
      default_branch: "main",
    })
  }
  const server = createServer((req, res) => {
    void skillGithubPreviewRoute(
      req,
      res,
      {
        requestId: "preview-id",
        identity: { namespace: "tenant", userId: "user" },
      },
      async () => {},
    )
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const response = await original(`http://127.0.0.1:${server.address().port}/v1/skills/github/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repository_url: "https://github.com/owner/repo",
      }),
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.data.selector, {
      owner: "owner",
      repository: "repo",
      commit,
      path: "",
    })
    assert.deepEqual(body.data.metadata, {
      display_name: "Real skill",
      summary: "Actual description",
      tags: [],
    })
    assert.equal(body.data.selection_required, false)
    assert.ok(calls.includes(`https://codeload.github.com/owner/repo/zip/${commit}`))
  } finally {
    globalThis.fetch = original
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("GitHub preview discovers explicit multiple valid paths and fixes branch SHA without arbitrary network targets", async () => {
  const { GithubSkillImportClient } = await import("../src/infrastructure/clients/github-skill-import.ts")
  const commit = "c".repeat(40),
    body = "---\nname: Actual\ndescription: Actual\n---\n"
  const zip = archive([
    ["root/skills/b/SKILL.md", body],
    ["root/skills/a/SKILL.md", body],
    ["root/unqualified/SKILL.md", "# no metadata"],
  ])
  const calls = []
  const client = new GithubSkillImportClient(async (url, options) => {
    calls.push(String(url))
    assert.equal(options.redirect, "error")
    assert.equal(options.credentials, "omit")
    if (String(url).endsWith("/commits/feature%2Fskills")) return Response.json({ sha: commit })
    if (String(url).includes("codeload"))
      return new Response(zip, {
        headers: { "content-type": "application/zip" },
      })
    return Response.json({
      id: 1,
      private: false,
      full_name: "owner/repo",
      html_url: "https://github.com/owner/repo",
      owner: { login: "owner", html_url: "https://github.com/owner" },
      stargazers_count: 1,
      forks_count: 0,
      default_branch: "feature/skills",
    })
  })
  const result = await client.preview({ repository_url: "https://github.com/owner/repo" }, AbortSignal.timeout(1000))
  assert.deepEqual(result, {
    selection_required: true,
    repository_url: "https://github.com/owner/repo",
    commit,
    paths: ["skills/a", "skills/b"],
  })
  const selected = await client.preview({ repository_url: "https://github.com/owner/repo", path: "skills/b" }, AbortSignal.timeout(1000))
  assert.equal(selected.selector.commit, commit)
  assert.equal(selected.selector.path, "skills/b")
  assert.deepEqual(selected.metadata, {
    display_name: "Actual",
    summary: "Actual",
    tags: [],
  })
  assert.ok(calls.includes("https://api.github.com/repos/owner/repo/commits/feature%2Fskills"))
  const before = calls.length
  for (const repository_url of [
    "http://github.com/owner/repo",
    "https://github.com@evil.test/owner/repo",
    "https://github.com:443/owner/repo",
    "https://github.com/owner/repo?token=x",
    "https://github.com/owner/..",
    "https://github.com/owner/repo/tree/main",
  ])
    await assert.rejects(client.preview({ repository_url }, AbortSignal.timeout(1000)))
  assert.equal(calls.length, before)
})
test("GitHub URL resolution rejects private repository and malformed default commit without archive reads", async () => {
  const { GithubSkillImportClient } = await import("../src/infrastructure/clients/github-skill-import.ts")
  for (const mode of ["private", "commit"]) {
    let calls = 0
    const client = new GithubSkillImportClient(async (url) => {
      calls++
      if (String(url).includes("/commits/")) return Response.json({ sha: "main" })
      return Response.json({
        id: 1,
        private: mode === "private",
        full_name: "owner/repo",
        html_url: "https://github.com/owner/repo",
        owner: { login: "owner", html_url: "https://github.com/owner" },
        stargazers_count: 0,
        forks_count: 0,
        default_branch: "main",
      })
    })
    await assert.rejects(client.preview({ repository_url: "https://github.com/owner/repo" }, AbortSignal.timeout(1000)))
    assert.equal(calls, mode === "private" ? 1 : 2)
  }
})

import { createBffServer } from "../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
import { createServer } from "node:http"
import { once } from "node:events"
const correctionConfig = {
  host: "127.0.0.1",
  port: 4300,
  mode: "live",
  domain: "dev.kokoro.localhost",
  tenantId: "tenant",
  iamBaseUrl: null,
  sharedSecret: "secret",
  upstreamSecret: null,
  upstreamTimeoutMs: 100,
  upstreamMaxResponseBytes: 1048576,
  schedulerServiceToken: null,
  schedulerTargetUrl: null,
  agentEnabled: false,
  postgresUrl: null,
  redisUrl: null,
  agUi: DEFAULT_AGUI_CONFIG,
  upstreams: {},
  platformProjection: { baseUrl: null, credentialFile: null, timeoutMs: 100 },
  skillDraft: {
    enabled: false,
    platformBaseUrl: null,
    credentialFile: null,
    timeoutMs: 100,
  },
}
const correctionHeaders = {
  authorization: "Bearer session",
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
  "content-type": "application/json",
  "idempotency-key": "readmit-1",
}

test("GitHub real HTTP final source block fences import and preview with current session", async (t) => {
  for (const operation of ["import", "preview"])
    for (const mode of ["revoke", "subject", "dependency", "abort", "unchanged"])
      await t.test(`${operation}: ${mode}`, async () => {
        const original = globalThis.fetch,
          commit = "a".repeat(40),
          effects = []
        const zip = archive([["root/SKILL.md", "---\nname: Real skill\ndescription: Real metadata\n---\n# Body"]])
        let release,
          started,
          identityMode = "unchanged",
          admissions = 0,
          receiptReads = 0
        const gate = new Promise((resolve) => {
            release = resolve
          }),
          sourceStarted = new Promise((resolve) => {
            started = resolve
          })
        const source = createServer(async (_req, res) => {
          res.writeHead(200, {
            "content-type": "application/zip",
            "content-length": zip.length,
          })
          res.write(zip.subarray(0, -1))
          started()
          await gate
          res.end(zip.subarray(-1))
        })
        source.listen(0, "127.0.0.1")
        await once(source, "listening")
        const sourceUrl = `http://127.0.0.1:${source.address().port}/archive`
        globalThis.fetch = async (url, options) => {
          if (String(url).startsWith("https://codeload.github.com/")) return original(sourceUrl, options)
          if (String(url).startsWith("https://api.github.com/")) {
            if (String(url).includes("/commits/")) return Response.json({ sha: commit })
            return Response.json({
              id: 1,
              private: false,
              full_name: "owner/repo",
              html_url: "https://github.com/owner/repo",
              owner: { login: "owner", html_url: "https://github.com/owner" },
              stargazers_count: 0,
              forks_count: 0,
              default_branch: "main",
            })
          }
          return original(url, options)
        }
        const server = createBffServer(
          {
            ...correctionConfig,
            storage: { objectOrigin: sourceUrl.replace("/archive", "") },
          },
          {
            sessionAdmission: {
              verify: async () => {
                admissions++
                if (identityMode === "revoke") return { ok: false, status: 401, code: "session_invalid" }
                if (identityMode === "dependency")
                  return {
                    ok: false,
                    status: 503,
                    code: "iam_admission_unavailable",
                  }
                return {
                  ok: true,
                  identity: {
                    namespace: "tenant",
                    userId: identityMode === "subject" ? "other" : "user",
                  },
                  platformAdmin: false,
                }
              },
            },
            skillAuthorization: { check: async () => ({ ok: true }) },
            businessStore: {
              services: {},
              getReceipt: async () => {
                receiptReads++
                if (receiptReads === 1) return null // Initial read-only preflight; original postfetch effect oracle remains below.
                effects.push("receipt")
                throw Error("test stop before write")
              },
              claimReceipt: async () => {
                effects.push("claim")
              },
              compareAndSetReceipt: async () => {
                effects.push("CAS")
              },
            },
            skillProductClient: {
              command: async (name) => {
                effects.push(name)
                throw Error("test stop before owner write")
              },
            },
          },
        )
        server.listen(0, "127.0.0.1")
        await once(server, "listening")
        const controller = new AbortController()
        try {
          const headers = { ...correctionHeaders }
          if (operation === "preview") delete headers["idempotency-key"]
          const pending = original(`http://127.0.0.1:${server.address().port}/v1/skills/github/${operation}`, {
            method: "POST",
            headers,
            signal: controller.signal,
            body: JSON.stringify(
              operation === "preview" ? { repository_url: "https://github.com/owner/repo" } : { owner: "owner", repository: "repo", commit, path: "" },
            ),
          }).then(
            async (response) => ({
              status: response.status,
              body: await response.json(),
            }),
            (error) => ({ aborted: error.name }),
          )
          await Promise.race([sourceStarted, new Promise((_, reject) => setTimeout(() => reject(Error("source never started")), 3000).unref())])
          assert.equal(receiptReads, operation === "import" ? 1 : 0, "only the initial exact receipt lookup precedes the source read")
          assert.deepEqual(effects, [])
          if (mode === "abort") {
            controller.abort()
            await pending
            await new Promise((resolve) => setTimeout(resolve, 20))
          } else identityMode = mode
          release()
          const result = await pending
          if (mode === "unchanged") {
            assert.equal(result.status, operation === "preview" ? 200 : 503)
            assert.equal(admissions, 2)
            assert.deepEqual(effects, operation === "preview" ? [] : ["receipt"])
          } else {
            if (mode !== "abort") assert.equal(result.status, mode === "dependency" ? 503 : 404)
            assert.deepEqual(effects, [], "no receipt/Create/Begin/PUT/Complete after stale admission")
          }
        } finally {
          release()
          globalThis.fetch = original
          server.closeAllConnections()
          source.closeAllConnections()
          await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => source.close(resolve))])
        }
      })
})

test("GitHub archive retains its separate UTF8 relative-file 256-byte ceiling", async () => {
  const { githubSkillPackage } = await import("../src/infrastructure/clients/github-skill-import.ts")
  const body = "---\nname: Actual\ndescription: Actual\n---\n# Actual"
  for (const file of ["a".repeat(256), `${"界".repeat(85)}a`]) {
    assert.equal(Buffer.byteLength(file), 256)
    const bytes = githubSkillPackage(
      archive([
        ["root/SKILL.md", body],
        [`root/${file}`, "actual bytes"],
      ]),
      "",
    )
    assert.ok(bytes.includes(Buffer.from("actual bytes")))
    assert.throws(
      () =>
        githubSkillPackage(
          archive([
            ["root/SKILL.md", body],
            [`root/${file}a`, "actual bytes"],
          ]),
          "",
        ),
      /github_package_invalid/u,
    )
  }
})

test("GitHub preview counts SKILL.md filename bytes and imports the selected immutable multibyte directory", async () => {
  const { GithubSkillImportClient } = await import("../src/infrastructure/clients/github-skill-import.ts")
  const commit = "b".repeat(40),
    path = `${"界".repeat(82)}a`,
    body = "---\nname: Actual\ndescription: Actual\n---\n# Actual"
  assert.equal(Buffer.byteLength(`${path}/SKILL.md`), 256)
  let zip = archive([
    [`root/${path}/SKILL.md`, body],
    ["root/short/SKILL.md", body],
  ])
  const calls = []
  const client = new GithubSkillImportClient(async (url) => {
    calls.push(String(url))
    if (String(url).includes("/commits/")) return Response.json({ sha: commit })
    if (String(url).startsWith("https://codeload.github.com/")) return new Response(zip, { headers: { "content-type": "application/zip" } })
    return Response.json({
      id: 1,
      private: false,
      full_name: "owner/repo",
      html_url: "https://github.com/owner/repo",
      owner: { login: "owner", html_url: "https://github.com/owner" },
      stargazers_count: 1,
      forks_count: 0,
      default_branch: "main",
    })
  })
  const result = await client.preview({ repository_url: "https://github.com/owner/repo" }, AbortSignal.timeout(1000))
  assert.deepEqual(result.paths, ["short", path].sort())
  assert.equal(result.selection_required, true)
  assert.equal(result.commit, commit)
  calls.length = 0
  const selected = await client.fetch({ owner: "owner", repository: "repo", commit: result.commit, path }, AbortSignal.timeout(1000))
  assert.equal(selected.selector.path, path)
  assert.equal(selected.selector.commit, commit)
  assert.equal(selected.repository.path, path)
  assert.ok(selected.bytes.includes(Buffer.from(body)))
  assert.ok(calls.includes(`https://api.github.com/repos/owner/repo/commits/${commit}`))
  assert.ok(calls.includes(`https://codeload.github.com/owner/repo/zip/${commit}`))
  assert.ok(!calls.some((url) => url.endsWith("/commits/main")))
  calls.length = 0
  await assert.rejects(() => client.fetch({ owner: "owner", repository: "repo", commit, path: "a".repeat(257) }, AbortSignal.timeout(1000)))
  assert.equal(calls.length, 0)
  zip = archive([[`root/${path}a/SKILL.md`, body]])
  await assert.rejects(() => client.preview({ repository_url: "https://github.com/owner/repo" }, AbortSignal.timeout(1000)), /github_package_invalid/u)
})

for (const provenanceKind of ["github", "ai"])
  for (const lostPut of [false, true, "create", "complete"])
    test(`shared ${provenanceKind} import uses one Create and original Begin proof (recovery=${lostPut})`, async (t) => {
      const { importSkillBytes } = await import("../src/http/routes/skill-ai-import.ts")
      const wire = await import("../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts")
      const { create } = await import("@bufbuild/protobuf")
      const { createHash } = await import("node:crypto")
      const bytes = Buffer.from("owner verified zip fixture"),
        digest = createHash("sha256").update(bytes).digest("hex")
      const facts = { asset_ref: "asset", content_sha256: digest, size_bytes: String(bytes.length), mime_type: "application/zip" }
      const provenance =
        provenanceKind === "github"
          ? {
              github: {
                ...facts,
                repository_id: "1",
                repository_url: "https://github.com/acme/skills",
                owner_login: "acme",
                owner_url: "https://github.com/acme",
                commit: "a".repeat(40),
                path: "one",
              },
            }
          : {
              ai: {
                ...facts,
                conversation_id: "conversation",
                run_ref: "run",
                artifact_ref: "artifact",
                source_event_id: "event",
                source_event_seq: "1",
                source_event_digest: "a".repeat(64),
              },
            }
      let row = null,
        currentVersion = 1n,
        creates = 0,
        puts = 0,
        completes = 0
      const begins = []
      let caller = new AbortController()
      const store = {
        getReceipt: async () => row,
        claimReceipt: async (_scope, fingerprint) => {
          row = { fingerprint, status: 102, body: {} }
          return { claimed: true, receipt: null }
        },
        compareAndSetReceipt: async (_scope, _fingerprint, _expected, replacement) => {
          row = replacement
          return { updated: true, receipt: row }
        },
      }
      const client = {
        command: async (operation, context, body) => {
          if (operation === "createSkillDraft") {
            creates++
            if (lostPut === "create" && creates === 1) caller.abort(new Error("caller cancellation"))
            return create(wire.CreateSkillDraftResponseSchema, { skillId: { value: "skill" }, status: 1, revision: 1n, stateVersion: currentVersion })
          }
          if (operation === "beginSkillPackageUpload") {
            begins.push({ commandId: context.commandId, body })
            assert.equal(body.expected_state_version, "1")
            currentVersion = 2n
            return create(wire.BeginSkillPackageUploadResponseSchema, {
              skillId: { value: "skill" },
              attemptId: "attempt",
              attemptEpoch: 1n,
              uploadId: "upload",
              stateVersion: 2n,
              transferReference: {
                url: "http://object.test/upload",
                method: "PUT",
                requiredHeaders: { "content-type": "application/zip" },
                expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60), nanos: 0 },
              },
            })
          }
          if (operation === "completeSkillPackageUpload") {
            completes++
            if (lostPut === "complete" && completes === 1) caller.abort(new Error("caller cancellation"))
            assert.equal(body.expected_state_version, "2")
            return create(wire.CompleteSkillPackageUploadResponseSchema, { skillId: { value: "skill" }, contentSha256: digest, scanState: 2, stateVersion: 3n })
          }
          assert.equal(operation, "validateSkillDraft")
          assert.equal(body.expected_state_version, "3")
          return create(wire.ValidateSkillDraftResponseSchema, {
            skillId: { value: "skill" },
            valid: true,
            contentDigest: digest,
            manifestIdentity: `skill-md-v1:sha256:${digest}`,
            stateVersion: 4n,
          })
        },
        getPackageUpload: async () =>
          create(wire.GetSkillPackageUploadResponseSchema, {
            skillId: { value: "skill" },
            attemptId: "attempt",
            attemptEpoch: 1n,
            uploadId: "upload",
            stateVersion: currentVersion,
            ...(completes ? { sourceVersionId: "VERSION" } : {}),
          }),
      }
      t.mock.method(globalThis, "fetch", async () => {
        puts++
        if (lostPut === true && puts === 1) throw Error("PUT ACK lost")
        return new Response(null, { headers: { "x-amz-version-id": "VERSION" } })
      })
      const run = () =>
        importSkillBytes(
          { identity: { namespace: "tenant", userId: "subject" }, requestId: "request" },
          "intent",
          bytes,
          { display_name: "Actual", summary: "Owner", tags: [], example_prompts: [], category_keys: [] },
          provenance,
          client,
          store,
          "http://object.test",
          AbortSignal.any([caller.signal, AbortSignal.timeout(1000)]),
          Date.now() + 1000,
        )
      if (lostPut) {
        await assert.rejects(run(), lostPut === true ? /PUT ACK lost/ : /caller cancellation/)
        caller = new AbortController()
      }
      assert.equal((await run()).valid, true)
      assert.equal(creates, lostPut === "create" ? 2 : 1)
      assert.equal(completes, lostPut === "complete" ? 2 : 1)
      assert.ok(begins.length >= 2)
      assert.ok(begins.every((value) => value.commandId === "intent.begin"))
      assert.ok(begins.every((value) => JSON.stringify(value.body) === JSON.stringify(begins[0].body)))
    })

// Discovery counts Skills across a repository; packaging counts files in one selected Skill.
for (const count of [129, 252, 512, 513])
  test(`GitHub repository discovery keeps every valid choice up to512 (documents=${count})`, async () => {
    const { GithubSkillImportClient } = await import("../src/infrastructure/clients/github-skill-import.ts")
    const body = "---\nname: Actual\ndescription: Actual\n---\n",
      paths = Array.from({ length: count }, (_, i) => `skills/skill-${String(i).padStart(3, "0")}`),
      zip = archive(paths.map((path) => [`root/${path}/SKILL.md`, body])),
      commit = "b".repeat(40)
    let calls = 0
    const client = new GithubSkillImportClient(async (url, options) => {
      calls++
      assert.equal(options.redirect, "error")
      assert.equal(options.credentials, "omit")
      if (String(url).includes("codeload"))
        return new Response(zip, {
          headers: { "content-type": "application/zip" },
        })
      if (String(url).includes("/commits/")) return Response.json({ sha: commit })
      return Response.json({
        id: 1,
        private: false,
        full_name: "owner/repo",
        html_url: "https://github.com/owner/repo",
        owner: { login: "owner", html_url: "https://github.com/owner" },
        stargazers_count: 0,
        forks_count: 0,
        default_branch: "main",
      })
    })
    const result = client.preview({ repository_url: "https://github.com/owner/repo" }, AbortSignal.timeout(10000))
    if (count > 512) await assert.rejects(result, { message: "github_package_invalid" })
    else
      assert.deepEqual(await result, {
        selection_required: true,
        repository_url: "https://github.com/owner/repo",
        commit,
        paths,
      })
    assert.equal(calls, 3)
  })
for (const path of ["", "selected"])
  for (const count of [128, 129])
    test(`GitHub selected Skill keeps128-file package bound (root=${path === ""},files=${count})`, async () => {
      const { githubSkillPackage } = await import("../src/infrastructure/clients/github-skill-import.ts")
      const prefix = `root/${path ? `${path}/` : ""}`,
        zip = archive([
          [`${prefix}SKILL.md`, "---\nname: Actual\ndescription: Actual\n---\n"],
          ...Array.from({ length: count - 1 }, (_, i) => [`${prefix}references/${i}.md`, "reference"]),
        ])
      if (count > 128)
        assert.throws(() => githubSkillPackage(zip, path), {
          message: "github_package_invalid",
        })
      else assert.ok(githubSkillPackage(zip, path).length > 0)
    })
test("GitHub512-choice response stays below existing1MiB even at conservative JSON escaping ceiling", () => {
  // At most6 JSON bytes per UTF16 code unit, even allowing controls the producer rejects.
  const upperBound = 512 * (6 * 256 + 3) + 6 * 2048 + 64 + 256
  assert.equal(upperBound, 800576)
  assert.ok(upperBound < 1048576)
})

// Trusted-context local HTTP fixture; owner/Storage commands below are explicit doubles, not normal imports.
async function githubPersistedResumeFixture(t, stage = "selected") {
  const { importSkillBytes } = await import("../src/http/routes/skill-ai-import.ts")
  const { skillCommandId } = await import("../src/http/routes/skill-drafts.ts")
  const wire = await import("../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts")
  const { create } = await import("@bufbuild/protobuf")
  const { createHash } = await import("node:crypto")
  const context = { identity: { namespace: "resume-tenant", userId: "resume-subject" }, requestId: "github-persisted-resume" }
  const key = "original-github-key",
    selector = { owner: "owner", repository: "repo", commit: "a".repeat(40), path: "one" }
  const commandId = skillCommandId({ rawHeaders: ["Idempotency-Key", key] }, context, "github-import")
  const bytes = Buffer.from("verified immutable package fixture"),
    digest = createHash("sha256").update(bytes).digest("hex")
  const provenance = {
    github: {
      repository_id: "1",
      repository_url: "https://github.com/owner/repo",
      owner_login: "owner",
      owner_url: "https://github.com/owner",
      commit: selector.commit,
      path: selector.path,
      content_sha256: digest,
      size_bytes: String(bytes.length),
      mime_type: "application/zip",
      repo_stats: { stars: "2", forks: "3", observed_at: "2026-10-27T00:00:00.000Z", metadata_source_url: "https://api.github.com/repos/owner/repo" },
    },
  }
  const originalFetch = globalThis.fetch,
    scopes = [],
    commands = [],
    checkpoints = new Map()
  let row = null,
    seeding = true,
    completeAttempted = false,
    githubReads = 0,
    puts = 0,
    readmits = 0
  const store = {
    services: {},
    getReceipt: async (scope) => {
      scopes.push(scope)
      return structuredClone(row)
    },
    claimReceipt: async (_scope, fingerprint) => {
      row = { fingerprint, status: 102, body: {} }
      return { claimed: true, receipt: structuredClone(row) }
    },
    compareAndSetReceipt: async (_scope, fingerprint, expected, replacement) => {
      assert.equal(fingerprint, row.fingerprint)
      assert.deepEqual(row, expected)
      row = structuredClone(replacement)
      checkpoints.set(row.body.stage ?? "terminal", structuredClone(row))
      return { updated: true, receipt: structuredClone(row) }
    },
  }
  const client = {
    command: async (operation, identity, body) => {
      commands.push({ operation, identity, body: structuredClone(body) })
      if (operation === "createSkillDraft")
        return create(wire.CreateSkillDraftResponseSchema, { skillId: { value: "skill" }, status: 1, revision: 1n, stateVersion: 1n })
      if (operation === "beginSkillPackageUpload")
        return create(wire.BeginSkillPackageUploadResponseSchema, {
          skillId: { value: "skill" },
          attemptId: "attempt",
          attemptEpoch: 1n,
          uploadId: "upload",
          stateVersion: 2n,
          transferReference: {
            url: "http://object.test/upload",
            method: "PUT",
            requiredHeaders: { "content-type": "application/zip" },
            expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60), nanos: 0 },
          },
        })
      if (operation === "completeSkillPackageUpload") {
        completeAttempted = true
        if (seeding && stage === "selected") throw Error("Complete ACK unavailable")
        return create(wire.CompleteSkillPackageUploadResponseSchema, { skillId: { value: "skill" }, contentSha256: digest, scanState: 2, stateVersion: 3n })
      }
      assert.equal(operation, "validateSkillDraft")
      if (seeding) throw Error("Validate ACK unavailable")
      return create(wire.ValidateSkillDraftResponseSchema, {
        skillId: { value: "skill" },
        valid: true,
        contentDigest: digest,
        manifestIdentity: `zip-v2:sha256:${digest}`,
        stateVersion: 4n,
      })
    },
    getPackageUpload: async () =>
      create(wire.GetSkillPackageUploadResponseSchema, {
        skillId: { value: "skill" },
        attemptId: "attempt",
        attemptEpoch: 1n,
        uploadId: "upload",
        stateVersion: seeding ? 2n : 999n,
        ...(completeAttempted ? { sourceVersionId: "ORIGINAL-VERSION" } : {}),
      }),
  }
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url) === "http://object.test/upload") {
      puts++
      assert.equal(init.method, "PUT")
      return new Response(null, { headers: { "x-amz-version-id": "ORIGINAL-VERSION" } })
    }
    githubReads++
    throw Error("GitHub is unavailable during recovery")
  })
  await assert.rejects(
    importSkillBytes(
      context,
      commandId,
      bytes,
      { display_name: "Actual", summary: "Frozen metadata", tags: [], example_prompts: [], category_keys: [] },
      provenance,
      client,
      store,
      "http://object.test",
      AbortSignal.timeout(1000),
      performance.now() + 1000,
    ),
    /ACK unavailable/,
  )
  assert.equal(row.body.stage, stage)
  const initial = structuredClone(row),
    initialPuts = puts
  commands.length = 0
  scopes.length = 0
  seeding = false
  const invoke = async (
    input = selector,
    readmit = async () => {
      readmits++
    },
  ) => {
    const { skillGithubImportRoute } = await import("../src/http/routes/skill-github-import.ts")
    const server = createServer((req, res) => {
      void skillGithubImportRoute(req, res, context, { storage: { objectOrigin: "http://object.test" } }, store, client, readmit)
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    try {
      const response = await originalFetch(`http://127.0.0.1:${server.address().port}/v1/skills/github/import`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(input),
      })
      return { status: response.status, body: await response.json() }
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
  return {
    invoke,
    initial,
    checkpoints,
    commands,
    scopes,
    selector,
    commandId,
    store,
    context,
    initialPuts,
    get row() {
      return row
    },
    set row(value) {
      row = value
    },
    get githubReads() {
      return githubReads
    },
    get puts() {
      return puts
    },
    get readmits() {
      return readmits
    },
  }
}

for (const stage of ["selected", "completed"])
  test(`GitHub persisted ${stage} resumes its exact owner checkpoint without refetching or replacing bytes`, async (t) => {
    const h = await githubPersistedResumeFixture(t, stage),
      result = await h.invoke()
    assert.equal(result.status, 201)
    assert.equal(result.body.data.valid, true)
    assert.equal(h.githubReads, 0)
    assert.equal(h.puts, h.initialPuts)
    assert.equal(h.readmits, 1)
    assert.ok(h.scopes.every((scope) => scope === JSON.stringify([h.context.identity.namespace, h.context.identity.userId, "skill-import-v1", h.commandId])))
    assert.deepEqual(
      h.commands.map((value) => value.operation),
      stage === "selected" ? ["completeSkillPackageUpload", "validateSkillDraft"] : ["validateSkillDraft"],
    )
    if (stage === "selected") {
      const complete = h.commands[0]
      assert.equal(complete.identity.commandId, h.initial.body.selected.commandId)
      assert.equal(complete.body.expected_state_version, "2")
      assert.equal(complete.body.source_version_id, "ORIGINAL-VERSION")
      assert.equal(complete.body.content_sha256, h.initial.body.frozen.content_sha256)
      assert.equal(complete.body.size_bytes, h.initial.body.frozen.size_bytes)
    }
    assert.equal(h.commands.at(-1).body.expected_state_version, "3", "Validate uses original Complete ACK, never current999")
  })

for (const field of ["owner", "repository", "commit", "path"])
  test(`GitHub persisted selected rejects changed ${field} before source reads or owner commands`, async (t) => {
    const h = await githubPersistedResumeFixture(t),
      input = { ...h.selector, [field]: field === "commit" ? "b".repeat(40) : "other" }
    assert.equal((await h.invoke(input)).status, 409)
    assert.equal(h.githubReads, 0)
    assert.equal(h.commands.length, 0)
    assert.deepEqual(h.row, h.initial)
  })

for (const invalid of ["fingerprint", "frozen-extra", "selected-digest"])
  test(`GitHub persisted selected fails closed on invalid ${invalid} with no fresh-source fallback`, async (t) => {
    const h = await githubPersistedResumeFixture(t)
    if (invalid === "fingerprint") h.row = { ...h.row, fingerprint: "0".repeat(64) }
    if (invalid === "frozen-extra") h.row.body.frozen.extra = true
    if (invalid === "selected-digest") h.row.body.selected.requestDigest = "0".repeat(64)
    const before = structuredClone(h.row)
    assert.equal((await h.invoke()).status, 503)
    assert.equal(h.githubReads, 0)
    assert.equal(h.commands.length, 0)
    assert.deepEqual(h.row, before)
  })

for (const stage of ["frozen", "created", "admitted", "terminal"])
  test(`GitHub persisted ${stage} still requires real source bytes or terminal selector verification`, async (t) => {
    const h = await githubPersistedResumeFixture(t, "completed")
    h.row =
      stage === "terminal"
        ? {
            fingerprint: h.initial.fingerprint,
            status: 201,
            body: {
              skill_id: "skill",
              source_ref: "skill:skill",
              status: "draft",
              state_version: "4",
              valid: true,
              content_digest: "a".repeat(64),
              manifest_identity: `zip-v2:sha256:${"a".repeat(64)}`,
            },
          }
        : h.checkpoints.get(stage)
    assert.ok(h.row)
    const before = structuredClone(h.row)
    assert.equal((await h.invoke()).status, 503)
    assert.equal(h.githubReads, 1)
    assert.equal(h.commands.length, 0)
    assert.deepEqual(h.row, before)
  })

test("GitHub persisted selected re-admits before any recovery owner call and does not bypass receipt faults", async (t) => {
  const h = await githubPersistedResumeFixture(t)
  const { ConnectError, Code } = await import("@connectrpc/connect")
  assert.notEqual(
    (
      await h.invoke(h.selector, async () => {
        throw new ConnectError("Current session changed", Code.PermissionDenied)
      })
    ).status,
    201,
  )
  assert.equal(h.githubReads, 0)
  assert.equal(h.commands.length, 0)
  assert.deepEqual(h.row, h.initial)
  h.store.getReceipt = async () => {
    throw Error("Receipt dependency unavailable")
  }
  assert.equal((await h.invoke()).status, 503)
  assert.equal(h.githubReads, 0)
  assert.equal(h.commands.length, 0)
  assert.deepEqual(h.row, h.initial)
})

for (const point of ["receipt", "readmit"])
  test(`GitHub persisted selected cancellation at ${point} fences late checkpoint recovery`, async (t) => {
    const h = await githubPersistedResumeFixture(t),
      controller = new AbortController()
    const { resumeGithubSkillImport } = await import("../src/http/routes/skill-ai-import.ts")
    let finish,
      began,
      readmits = 0
    const started = new Promise((resolve) => {
      began = resolve
    })
    if (point === "receipt")
      h.store.getReceipt = async () => {
        began()
        return new Promise((resolve) => {
          finish = resolve
        })
      }
    const pending = resumeGithubSkillImport(
      h.context,
      h.commandId,
      h.selector,
      {},
      h.store,
      "http://object.test",
      controller.signal,
      performance.now() + 1000,
      async () => {
        readmits++
        began()
        await new Promise((resolve) => {
          finish = resolve
        })
      },
    )
    await started
    controller.abort(Error("original caller cancelled"))
    finish(point === "receipt" ? h.initial : undefined)
    await assert.rejects(pending, /original caller cancelled/)
    assert.equal(readmits, point === "receipt" ? 0 : 1)
    assert.equal(h.githubReads, 0)
    assert.equal(h.commands.length, 0)
    assert.deepEqual(h.row, h.initial)
  })

test("GitHub persisted selected cannot downgrade into byte-requiring steps after the exact receipt is reread", async (t) => {
  const h = await githubPersistedResumeFixture(t)
  let reads = 0
  h.store.getReceipt = async () => structuredClone(++reads === 1 ? h.initial : h.checkpoints.get("frozen"))
  assert.equal((await h.invoke()).status, 503)
  assert.equal(h.githubReads, 0)
  assert.equal(h.commands.length, 0)
  assert.equal(h.puts, h.initialPuts)
  assert.deepEqual(h.row, h.initial)
})
