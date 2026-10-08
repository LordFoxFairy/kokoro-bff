import assert from "node:assert/strict"
import { lstat, readFile } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { test } from "node:test"

const INPUT_ENV = "KOKORO_SKILL_PACKAGE_INSPECTION_INPUT_FILE"
const REQUIRE_REAL = process.env.REQUIRE_REAL_INTEGRATION === "1"
const MAX_INPUT_BYTES = 2 * 1024 * 1024
const MAX_PUBLIC_JSON_BYTES = 1_048_576
const REQUEST_TIMEOUT_MS = 15_000
const UINT64_MAX = 18_446_744_073_709_551_615n

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertClosedKeys(value, expected, label) {
  assert.ok(isRecord(value), `${label} must be an object`)
  const actual = Object.keys(value)
  const allowed = new Set(expected)
  assert.ok(actual.length === expected.length && actual.every((key) => allowed.has(key)), `${label} must retain its closed key set`)
}

function assertCanonicalUint64(value, allowZero, label) {
  const pattern = allowZero ? /^(?:0|[1-9][0-9]*)$/u : /^[1-9][0-9]*$/u
  assert.ok(typeof value === "string" && pattern.test(value), `${label} must be a canonical decimal uint64 string`)
  assert.ok(BigInt(value) <= UINT64_MAX, `${label} must fit uint64`)
}

function assertFixtureString(value, label, allowEmpty = false) {
  assert.ok(typeof value === "string" && (allowEmpty || value.length > 0), `${label} must be ${allowEmpty ? "a string" : "a nonempty string"}`)
}

async function loadProtectedInput(path) {
  assert.ok(isAbsolute(path), `${INPUT_ENV} must be an absolute path`)
  const metadata = await lstat(path)
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), `${INPUT_ENV} must name a regular non-symlink file`)
  assert.equal(metadata.mode & 0o777, 0o600, `${INPUT_ENV} must have mode 0600`)
  assert.ok(metadata.size > 0 && metadata.size <= MAX_INPUT_BYTES, `${INPUT_ENV} must be nonempty and at most ${MAX_INPUT_BYTES} bytes`)

  let document
  try {
    document = JSON.parse(await readFile(path, "utf8"))
  } catch {
    throw new Error(`${INPUT_ENV} must contain valid JSON`)
  }
  assertClosedKeys(
    document,
    ["bff_base_url", "user_access_token", "web_secret", "managed_skill_id", "installation_id", "source_ref", "revision", "files"],
    INPUT_ENV,
  )
  for (const key of ["bff_base_url", "user_access_token", "web_secret", "managed_skill_id", "installation_id", "source_ref", "revision"]) {
    assertFixtureString(document[key], `${INPUT_ENV}.${key}`)
  }
  assert.ok(!/[\s\u0000]/u.test(document.user_access_token), `${INPUT_ENV}.user_access_token must be one bearer value`)
  assert.ok(!/[\r\n\u0000]/u.test(document.web_secret), `${INPUT_ENV}.web_secret must not contain header controls`)

  let baseUrl
  try {
    baseUrl = new URL(document.bff_base_url)
  } catch {
    throw new Error(`${INPUT_ENV}.bff_base_url must be a valid URL`)
  }
  assert.equal(baseUrl.protocol, "http:", `${INPUT_ENV}.bff_base_url must use local HTTP`)
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname), `${INPUT_ENV}.bff_base_url must be loopback`)
  assert.ok(
    baseUrl.username === "" && baseUrl.password === "" && baseUrl.pathname === "/" && baseUrl.search === "" && baseUrl.hash === "",
    `${INPUT_ENV}.bff_base_url must be an origin without credentials`,
  )

  assert.equal(document.source_ref, `skill:${document.managed_skill_id}`, `${INPUT_ENV}.source_ref must bind the managed_skill_id`)
  assertCanonicalUint64(document.revision, false, `${INPUT_ENV}.revision`)
  assert.ok(Array.isArray(document.files) && document.files.length > 0 && document.files.length <= 128, `${INPUT_ENV}.files must contain 1..128 expected files`)
  const paths = new Set()
  for (const [index, file] of document.files.entries()) {
    const label = `${INPUT_ENV}.files[${index}]`
    assertClosedKeys(file, ["path", "size_bytes", "text"], label)
    assertFixtureString(file.path, `${label}.path`)
    assertFixtureString(file.text, `${label}.text`, true)
    assertCanonicalUint64(file.size_bytes, true, `${label}.size_bytes`)
    assert.equal(BigInt(file.size_bytes), BigInt(Buffer.byteLength(file.text, "utf8")), `${label}.size_bytes must equal the original UTF-8 text bytes`)
    assert.equal(paths.has(file.path), false, `${INPUT_ENV}.files paths must be unique`)
    paths.add(file.path)
  }
  assert.equal(paths.has("SKILL.md"), true, `${INPUT_ENV}.files must include SKILL.md`)

  return {
    baseUrl: baseUrl.origin,
    userAccessToken: document.user_access_token,
    webSecret: document.web_secret,
    managedSkillId: document.managed_skill_id,
    installationId: document.installation_id,
    sourceRef: document.source_ref,
    revision: document.revision,
    files: document.files,
  }
}

const inputPath = process.env[INPUT_ENV]
if (!inputPath && REQUIRE_REAL) throw new Error(`${INPUT_ENV} is required when REQUIRE_REAL_INTEGRATION=1`)
const fixture = inputPath ? await loadProtectedInput(inputPath) : undefined
const unavailableReason = `${INPUT_ENV} is absent; real Skill package inspection remains unverified`

async function fetchBoundedJson(path, requestId, label) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetch(new URL(path, fixture.baseUrl), {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${fixture.userAccessToken}`,
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": fixture.webSecret,
        "x-request-id": requestId,
      },
    })
    if (response.status !== 200) {
      controller.abort()
      assert.equal(response.status, 200, `${label} must return HTTP 200`)
    }
    assert.equal(response.headers.get("x-request-id"), requestId, `${label} must echo the explicit request ID`)
    assert.equal(response.headers.get("cache-control"), "no-store", `${label} must return Cache-Control: no-store`)
    assert.match(response.headers.get("content-type") ?? "", /^application\/json(?:\s*;|$)/iu, `${label} must return JSON`)

    const declaredLength = response.headers.get("content-length")
    if (declaredLength !== null) {
      assert.ok(/^(?:0|[1-9][0-9]*)$/u.test(declaredLength), `${label} Content-Length must be canonical when present`)
      assert.ok(BigInt(declaredLength) <= BigInt(MAX_PUBLIC_JSON_BYTES), `${label} declared response exceeds the public JSON budget`)
    }
    assert.ok(response.body !== null, `${label} must return a response body`)
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PUBLIC_JSON_BYTES) {
        controller.abort()
        throw new Error(`${label} response exceeds the public JSON budget`)
      }
      chunks.push(Buffer.from(value))
    }
    let json
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))
      json = JSON.parse(text)
    } catch {
      throw new Error(`${label} must return valid UTF-8 JSON`)
    }
    return json
  } catch (error) {
    if (error instanceof assert.AssertionError || (error instanceof Error && error.message.startsWith(label))) throw error
    throw new Error(`${label} request did not complete within its bounded HTTP read`)
  } finally {
    clearTimeout(timeout)
  }
}

function assertPackageData(document, selectedPath, label) {
  assertClosedKeys(document, ["data"], `${label} response`)
  assertClosedKeys(document.data, ["source_ref", "revision", "files", "selected_file"], `${label} data`)
  assert.ok(document.data.source_ref === fixture.sourceRef, `${label} source_ref must match the protected owner fixture`)
  assert.ok(document.data.revision === fixture.revision, `${label} revision must match the protected owner fixture`)
  assert.ok(Array.isArray(document.data.files), `${label} files must be an array`)
  assert.equal(document.data.files.length, fixture.files.length, `${label} must return the complete file directory`)
  for (const [index, file] of document.data.files.entries()) {
    assertClosedKeys(file, ["path", "size_bytes"], `${label} data.files[${index}]`)
    const expected = fixture.files[index]
    assert.ok(file.path === expected.path && file.size_bytes === expected.size_bytes, `${label} must preserve the ordered file directory`)
  }

  if (selectedPath === undefined) {
    assert.equal(document.data.selected_file, null, `${label} directory read must return selected_file=null`)
    return
  }
  assertClosedKeys(document.data.selected_file, ["path", "text"], `${label} selected_file`)
  assert.ok(document.data.selected_file.path === selectedPath, `${label} selected_file.path must equal the requested file_path`)
  const expected = fixture.files.find((file) => file.path === selectedPath)
  assert.ok(expected !== undefined, `${label} requested fixture file must exist`)
  assert.ok(document.data.selected_file.text === expected.text, `${label} selected_file.text must preserve the exact original text`)
  assert.equal(
    Buffer.byteLength(document.data.selected_file.text, "utf8"),
    Number(expected.size_bytes),
    `${label} selected text byte length must match its directory entry`,
  )
}

function realIntegrationTest(name, request) {
  if (fixture === undefined) {
    test(name, { skip: unavailableReason }, () => {})
    return
  }
  test(name, { timeout: REQUEST_TIMEOUT_MS + 5_000 }, request)
}

realIntegrationTest("real HTTP reads the current user's managed Skill package directory", async () => {
  const label = "managed package directory"
  const document = await fetchBoundedJson(`/v1/self/skills/${encodeURIComponent(fixture.managedSkillId)}/package`, "r343-managed-package-directory", label)
  assertPackageData(document, undefined, label)
  assert.ok(document.data.source_ref === `skill:${fixture.managedSkillId}`, `${label} source_ref must bind the requested managed skill_id`)
})

realIntegrationTest("real HTTP preserves the exact managed Skill SKILL.md text", async () => {
  const label = "managed SKILL.md"
  const url = new URL(`/v1/self/skills/${encodeURIComponent(fixture.managedSkillId)}/package`, fixture.baseUrl)
  url.searchParams.set("file_path", "SKILL.md")
  const document = await fetchBoundedJson(`${url.pathname}${url.search}`, "r343-managed-package-skill-md", label)
  assertPackageData(document, "SKILL.md", label)
})

realIntegrationTest("real HTTP reads the current user's installed Skill package directory", async () => {
  const label = "installed package directory"
  const document = await fetchBoundedJson(
    `/v1/skill-installations/${encodeURIComponent(fixture.installationId)}/package`,
    "r343-installed-package-directory",
    label,
  )
  assertPackageData(document, undefined, label)
})

realIntegrationTest("real HTTP preserves the exact installed Skill SKILL.md text", async () => {
  const label = "installed SKILL.md"
  const url = new URL(`/v1/skill-installations/${encodeURIComponent(fixture.installationId)}/package`, fixture.baseUrl)
  url.searchParams.set("file_path", "SKILL.md")
  const document = await fetchBoundedJson(`${url.pathname}${url.search}`, "r343-installed-package-skill-md", label)
  assertPackageData(document, "SKILL.md", label)
})
