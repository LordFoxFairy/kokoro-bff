import { createServer, type Server } from "node:http"
import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

import type { BffConfig } from "../src/config.js"
import { proxyUpstream } from "../dist/upstream.js"

const servers: Server[] = []

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

function config(overrides: Partial<BffConfig> = {}): BffConfig {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    sharedSecret: "test-secret",
    upstreamSecret: "bff-upstream-secret",
    iamServiceToken: null,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    upstreamTimeoutMs: 100,
    upstreamMaxResponseBytes: 1024,
    upstreams: {},
    ...overrides,
  }
}

function call(baseUrl: string) {
  return proxyUpstream(
    config(),
    baseUrl,
    "/owner",
    "GET",
    "request-upstream",
    new Headers(),
    undefined,
  )
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close))
})

describe("owner upstream transport", () => {
  it("returns a successful response with its status, headers, and body", async () => {
    const baseUrl = await listen(createServer((_request, response) => {
      response.writeHead(201, { "content-type": "application/json" })
      response.end('{"ok":true}')
    }))

    const result = await call(baseUrl)

    assert.equal(result.status, 201)
    assert.equal(result.headers.get("content-type"), "application/json")
    assert.equal(result.body.toString("utf8"), '{"ok":true}')
  })

  it("rejects a request that exceeds the configured timeout", async () => {
    const baseUrl = await listen(createServer(() => {
      // Keep the owner request open until the BFF timeout destroys it.
    }))

    await assert.rejects(call(baseUrl), (error: unknown) => {
      assert.equal(error instanceof Error, true)
      assert.equal((error as Error & { code?: string }).code, "upstream_timeout")
      return true
    })
  })

  it("rejects a response that exceeds the configured body limit", async () => {
    const baseUrl = await listen(createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" })
      response.end(Buffer.alloc(1025, "x"))
    }))

    await assert.rejects(call(baseUrl), (error: unknown) => {
      assert.equal(error instanceof Error, true)
      assert.equal((error as Error & { code?: string }).code, "upstream_response_too_large")
      return true
    })
  })

  it("normalizes connection failures to a stable upstream error", async () => {
    const server = createServer()
    const baseUrl = await listen(server)
    await close(server)

    await assert.rejects(call(baseUrl), (error: unknown) => {
      assert.equal(error instanceof Error, true)
      assert.equal((error as Error & { code?: string }).code, "upstream_connection_error")
      return true
    })
  })
})
