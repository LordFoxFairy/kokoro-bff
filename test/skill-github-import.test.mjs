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
          admissions = 0
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
    const bytes = githubSkillPackage(archive([["root/SKILL.md", body], [`root/${file}`, "actual bytes"]]), "")
    assert.ok(bytes.includes(Buffer.from("actual bytes")))
    assert.throws(() => githubSkillPackage(archive([["root/SKILL.md", body], [`root/${file}a`, "actual bytes"]]), ""), /github_package_invalid/u)
  }
})

test("GitHub preview counts SKILL.md filename bytes and imports the selected immutable multibyte directory", async () => {
  const { GithubSkillImportClient } = await import("../src/infrastructure/clients/github-skill-import.ts")
  const commit = "b".repeat(40), path = `${"界".repeat(82)}a`, body = "---\nname: Actual\ndescription: Actual\n---\n# Actual"
  assert.equal(Buffer.byteLength(`${path}/SKILL.md`), 256)
  let zip = archive([[`root/${path}/SKILL.md`, body], ["root/short/SKILL.md", body]])
  const calls = []
  const client = new GithubSkillImportClient(async (url) => {
    calls.push(String(url))
    if (String(url).includes("/commits/")) return Response.json({ sha: commit })
    if (String(url).startsWith("https://codeload.github.com/")) return new Response(zip, { headers: { "content-type": "application/zip" } })
    return Response.json({ id: 1, private: false, full_name: "owner/repo", html_url: "https://github.com/owner/repo",
      owner: { login: "owner", html_url: "https://github.com/owner" }, stargazers_count: 1, forks_count: 0, default_branch: "main" })
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
