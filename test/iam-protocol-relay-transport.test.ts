import assert from "node:assert/strict"
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { afterEach, test } from "node:test"

import { loadConfig } from "../dist/config/runtime.js"
import { createLiveTestBffServer } from "./doubles/server.ts"

const servers: Server[] = []
const webOrigin = "http://web.example.test"
const webServiceHeaders = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
}

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

function bff(iamBaseUrl: string, limits: { timeoutMs?: number; responseBytes?: number } = {}): Server {
  return createLiveTestBffServer(
    loadConfig({
      KOKORO_BFF_SHARED_SECRET: "test-secret",
      KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/unused_bff_relay_fixture?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
      KOKORO_IAM_BASE_URL: iamBaseUrl,
      KOKORO_IAM_ISSUER_URL: `${webOrigin}/iam`,
      KOKORO_IAM_WEB_ORIGIN: webOrigin,
      KOKORO_IAM_WEB_CALLBACK_URI: `${webOrigin}/api/auth/callback/kokoro-iam`,
      KOKORO_IAM_WEB_POST_LOGOUT_URI: `${webOrigin}/auth/sign-in`,
      ...(limits.timeoutMs === undefined ? {} : { KOKORO_UPSTREAM_TIMEOUT_MS: String(limits.timeoutMs) }),
      ...(limits.responseBytes === undefined ? {} : { KOKORO_UPSTREAM_MAX_RESPONSE_BYTES: String(limits.responseBytes) }),
    }),
  )
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

test("BFF relays only Web-authenticated OIDC discovery to the fixed IAM origin", async () => {
  const upstreamCalls: Array<{
    url: string | undefined
    headers: IncomingMessage["headers"]
  }> = []
  const iam = await listen(
    createServer((request: IncomingMessage, response: ServerResponse) => {
      upstreamCalls.push({ url: request.url, headers: request.headers })
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      response.end(JSON.stringify({ issuer: `${webOrigin}/iam` }))
    }),
  )
  const base = await listen(bff(iam))

  const absent = await fetch(`${base}/iam/.well-known/openid-configuration`)
  assert.equal(absent.status, 403)
  assert.equal(upstreamCalls.length, 0)

  const accepted = await fetch(`${base}/iam/.well-known/openid-configuration`, {
    headers: webServiceHeaders,
  })
  assert.equal(accepted.status, 200)
  assert.deepEqual(await accepted.json(), { issuer: `${webOrigin}/iam` })
  assert.equal(accepted.headers.get("cache-control"), "no-store")
  assert.equal(upstreamCalls.length, 1)
  assert.equal(upstreamCalls[0]?.url, "/iam/.well-known/openid-configuration")
  assert.equal(upstreamCalls[0]?.headers["x-kokoro-internal-secret"], undefined)
})

test("BFF preserves IAM signed interaction query and filters Product Session cookie", async () => {
  let forwardedCookie: string | undefined
  const iam = await listen(
    createServer((request, response) => {
      forwardedCookie = request.headers.cookie
      response.writeHead(302, {
        location: `${webOrigin}/auth/select-tenant?client_id=client-1&ba_param=scope&ba_param=state&sig=abc%2Bdef`,
        "cache-control": "no-store",
      })
      response.end()
    }),
  )
  const base = await listen(bff(iam))
  const response = await fetch(`${base}/iam/oauth2/authorize?client_id=client-1`, {
    headers: {
      ...webServiceHeaders,
      cookie: "authjs.session-token=private; kokoro-issuer.session_token=issuer-token",
    },
    redirect: "manual",
  })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get("location"), `${webOrigin}/auth/select-tenant?client_id=client-1&ba_param=scope&ba_param=state&sig=abc%2Bdef`)
  assert.equal(forwardedCookie, "kokoro-issuer.session_token=issuer-token")
})

test("relay rejects path aliases, wrong methods and browser credentials before IAM I/O", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam))
  for (const path of [
    "/iam/oauth2/%74oken",
    "/iam//oauth2/token",
    "/iam/oauth2/../token",
    "/iam/OAuth2/token",
    "/iam/internal/v1/users",
    "/iam/oauth2/register",
  ]) {
    const response = await fetch(`${base}${path}`, {
      headers: webServiceHeaders,
      redirect: "manual",
    })
    assert.equal(response.status, 404, path)
  }
  assert.equal(
    (
      await fetch(`${base}/iam/oauth2/token`, {
        method: "POST",
        headers: { ...webServiceHeaders, origin: webOrigin },
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await fetch(`${base}/iam/get-session`, {
        headers: {
          ...webServiceHeaders,
          authorization: "Bearer browser-token",
        },
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await fetch(`${base}/iam/sign-in/email`, {
        method: "POST",
        headers: webServiceHeaders,
        body: "{}",
      })
    ).status,
    403,
  )
  assert.equal(calls, 0)
})

test("token Basic is only relayed on the exact endpoint and cookies are never forwarded", async () => {
  let authorization = ""
  let cookie: string | undefined
  const iam = await listen(
    createServer((request, response) => {
      authorization = request.headers.authorization ?? ""
      cookie = request.headers.cookie
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      response.end('{"access_token":"owner-token"}')
    }),
  )
  const base = await listen(bff(iam))
  const response = await fetch(`${base}/iam/oauth2/token`, {
    method: "POST",
    headers: {
      ...webServiceHeaders,
      authorization: "Basic Y2xpZW50OnNlY3JldA==",
      cookie: "authjs.session-token=private",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=authorization_code&code=opaque",
  })
  assert.equal(response.status, 200)
  assert.equal(authorization, "Basic Y2xpZW50OnNlY3JldA==")
  assert.equal(cookie, undefined)
})

test("native 429 and logout security headers survive, while hostile redirect and cookies fail closed", async () => {
  let mode: "rate" | "logout" | "hostile" = "rate"
  const iam = await listen(
    createServer((_request, response) => {
      if (mode === "rate")
        response.writeHead(429, {
          "retry-after": "60",
          "cache-control": "no-store",
          "content-type": "application/json",
        })
      if (mode === "logout")
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          pragma: "no-cache",
          "set-cookie": [
            "kokoro-issuer.session_token.oauth_logout_confirmation=state; Path=/iam/oauth2/end-session/confirm; HttpOnly; SameSite=Lax",
            "kokoro-issuer.session_token=active; Path=/iam; HttpOnly; SameSite=Lax",
          ],
        })
      if (mode === "hostile")
        response.writeHead(302, {
          location: "https://evil.example/steal",
          "set-cookie": "authjs.session-token=leak; Path=/; HttpOnly",
        })
      response.end(mode === "logout" ? "<html>Confirm</html>" : "{}")
    }),
  )
  const base = await listen(bff(iam))

  const rate = await fetch(`${base}/iam/.well-known/openid-configuration`, {
    headers: webServiceHeaders,
  })
  assert.equal(rate.status, 429)
  assert.equal(rate.headers.get("retry-after"), "60")

  mode = "logout"
  const logout = await fetch(`${base}/iam/oauth2/end-session`, {
    headers: webServiceHeaders,
  })
  assert.equal(logout.status, 200)
  assert.equal(logout.headers.get("content-security-policy"), "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
  assert.equal(logout.headers.get("x-content-type-options"), "nosniff")
  assert.equal(logout.headers.get("pragma"), "no-cache")
  assert.equal(logout.headers.getSetCookie().length, 2)

  mode = "hostile"
  const hostile = await fetch(`${base}/iam/.well-known/openid-configuration`, {
    headers: webServiceHeaders,
    redirect: "manual",
  })
  assert.equal(hostile.status, 502)
  assert.equal(hostile.headers.get("location"), null)
  assert.equal(hostile.headers.getSetCookie().length, 0)
})

test("only native logout GET presents trusted browser navigation semantics to IAM", async () => {
  const calls: Array<{ path: string | undefined; method: string | undefined; mode: string | undefined; accept: string | undefined }> = []
  const iam = await listen(
    createServer((request, response) => {
      calls.push({ path: request.url, method: request.method, mode: request.headers["sec-fetch-mode"], accept: request.headers.accept })
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      response.end("{}")
    }),
  )
  const base = await listen(bff(iam))

  const logout = await fetch(`${base}/iam/oauth2/end-session`, {
    headers: { ...webServiceHeaders, accept: "text/html", "sec-fetch-mode": "cors" },
  })
  assert.equal(logout.status, 200)

  const ordinary = await fetch(`${base}/iam/get-session`, {
    headers: { ...webServiceHeaders, "sec-fetch-mode": "navigate" },
  })
  assert.equal(ordinary.status, 200)

  const logoutPost = await fetch(`${base}/iam/oauth2/end-session`, {
    method: "POST",
    headers: { ...webServiceHeaders, origin: webOrigin, "sec-fetch-mode": "navigate" },
  })
  assert.equal(logoutPost.status, 200)

  assert.deepEqual(calls, [
    { path: "/iam/oauth2/end-session", method: "GET", mode: "navigate", accept: "text/html" },
    { path: "/iam/get-session", method: "GET", mode: "cors", accept: "*/*" },
    { path: "/iam/oauth2/end-session", method: "POST", mode: "cors", accept: "*/*" },
  ])
})

test("duplicate Authorization never downgrades to an anonymous issuer request", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam))
  const target = new URL(`${base}/iam/get-session`)
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        method: "GET",
        headers: ["x-kokoro-service", "web-bff", "x-kokoro-internal-secret", "test-secret", "Authorization", "Basic first", "Authorization", "Bearer second"],
      },
      (response) => {
        response.resume()
        response.on("end", () => resolve(response.statusCode ?? 0))
      },
    )
    request.once("error", reject)
    request.end()
  })
  assert.ok(status === 400 || status === 403)
  assert.equal(calls, 0)
})

test("duplicate issuer Cookie headers are rejected rather than silently discarded", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam))
  const target = new URL(`${base}/iam/get-session`)
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        method: "GET",
        headers: [
          "x-kokoro-service",
          "web-bff",
          "x-kokoro-internal-secret",
          "test-secret",
          "Cookie",
          "kokoro-issuer.session_token=one",
          "Cookie",
          "kokoro-issuer.session_token=two",
        ],
      },
      (response) => {
        response.resume()
        response.on("end", () => resolve(response.statusCode ?? 0))
      },
    )
    request.once("error", reject)
    request.end()
  })
  assert.equal(status, 400)
  assert.equal(calls, 0)
})

test("slow inbound body shares the relay deadline and never opens an IAM request", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam, { timeoutMs: 120 }))
  const target = new URL(`${base}/iam/sign-in/email`)
  const started = Date.now()
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        method: "POST",
        headers: {
          ...webServiceHeaders,
          origin: webOrigin,
          "content-type": "application/json",
          "content-length": "1000",
        },
      },
      (response) => {
        response.resume()
        response.on("end", () => {
          clearTimeout(timer)
          resolve(response.statusCode ?? 0)
        })
      },
    )
    const timer = setTimeout(() => {
      request.destroy()
      reject(new Error("BFF did not enforce inbound deadline"))
    }, 600)
    request.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    request.write('{"email":"a')
  })
  assert.equal(status, 503)
  assert.ok(Date.now() - started < 1000)
  assert.equal(calls, 0)
})

test("oversized inbound body is rejected before IAM I/O", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam))
  const response = await fetch(`${base}/iam/sign-in/email`, {
    method: "POST",
    headers: {
      ...webServiceHeaders,
      origin: webOrigin,
      "content-type": "application/json",
    },
    body: "x".repeat(65_537),
  })
  assert.equal(response.status, 413)
  assert.equal(calls, 0)
})

test("oversized inbound headers never reach IAM", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam))
  const response = await fetch(`${base}/iam/get-session`, {
    headers: { ...webServiceHeaders, "x-oversized": "x".repeat(17_000) },
  })
  assert.ok(response.status === 413 || response.status === 431)
  assert.equal(calls, 0)
})

test("aborted inbound upload never opens an IAM request", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam, { timeoutMs: 100 }))
  const target = new URL(`${base}/iam/sign-in/email`)
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest({
      host: target.hostname,
      port: Number(target.port),
      path: target.pathname,
      method: "POST",
      headers: {
        ...webServiceHeaders,
        origin: webOrigin,
        "content-length": "1000",
      },
    })
    request.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error)
    })
    request.write("partial")
    setTimeout(() => {
      request.destroy()
      resolve()
    }, 20)
  })
  await new Promise((resolve) => setTimeout(resolve, 130))
  assert.equal(calls, 0)
})

test("upstream response body cap cancels the live IAM stream", async () => {
  let closed!: () => void
  const upstreamClosed = new Promise<void>((resolve) => {
    closed = resolve
  })
  const iam = await listen(
    createServer((_request, response) => {
      response.once("close", closed)
      response.writeHead(200, { "content-type": "application/json" })
      response.write("x".repeat(128))
      response.write("y")
    }),
  )
  const base = await listen(bff(iam, { responseBytes: 64 }))
  const result = await fetch(`${base}/iam/get-session`, {
    headers: webServiceHeaders,
  })
  assert.equal(result.status, 503)
  await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("IAM stream was not cancelled")), 500))])
})

test("upstream response header cap cancels the live IAM stream", async () => {
  let closed!: () => void
  const upstreamClosed = new Promise<void>((resolve) => {
    closed = resolve
  })
  const iam = await listen(
    createServer((_request, response) => {
      response.once("close", closed)
      response.writeHead(200, {
        "set-cookie": `large=${"x".repeat(8500)}; Path=/iam; HttpOnly; SameSite=Lax`,
      })
      response.write("pending")
    }),
  )
  const base = await listen(bff(iam))
  const result = await fetch(`${base}/iam/get-session`, {
    headers: webServiceHeaders,
  })
  assert.equal(result.status, 503)
  await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("IAM header stream was not cancelled")), 500))])
})

test("native logout navigation enforces the same upstream body cap and closes the socket", async () => {
  let closed!: () => void
  const upstreamClosed = new Promise<void>((resolve) => {
    closed = resolve
  })
  const iam = await listen(
    createServer((_request, response) => {
      response.once("close", closed)
      response.writeHead(200, { "content-type": "text/html" })
      response.write("x".repeat(128))
      response.write("y")
    }),
  )
  const base = await listen(bff(iam, { responseBytes: 64 }))
  const result = await fetch(`${base}/iam/oauth2/end-session`, {
    headers: { ...webServiceHeaders, accept: "text/html" },
  })
  assert.equal(result.status, 503)
  await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("IAM logout stream was not cancelled")), 500))])
})

test("native logout navigation shares the bounded upstream deadline", async () => {
  let closed!: () => void
  const upstreamClosed = new Promise<void>((resolve) => {
    closed = resolve
  })
  const iam = await listen(
    createServer((_request, response) => {
      response.once("close", closed)
      response.writeHead(200, { "content-type": "text/html" })
      response.write("pending")
    }),
  )
  const base = await listen(bff(iam, { timeoutMs: 120 }))
  const result = await fetch(`${base}/iam/oauth2/end-session`, {
    headers: { ...webServiceHeaders, accept: "text/html" },
  })
  assert.equal(result.status, 503)
  await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("IAM logout deadline did not close socket")), 500))])
})
