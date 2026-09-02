import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { loadConfig } from "../dist/config.js"

describe("kokoro-bff optional Agent configuration", () => {
  it("defaults Agent to optional and disabled", () => {
    const config = loadConfig({ KOKORO_DOMAIN: "dev.kokoro.localhost" })
    assert.equal(config.agentEnabled, false)
    assert.equal(config.upstreamTimeoutMs, 5000)
    assert.equal(config.upstreamMaxResponseBytes, 1024 * 1024)
  })

  it("enables Agent explicitly for live execution", () => {
    const config = loadConfig({
      KOKORO_BFF_MODE: "live",
      KOKORO_DOMAIN: "app.example.com",
      KOKORO_BFF_SHARED_SECRET: "bff-secret",
      KOKORO_AGENT_ENABLED: "1",
      KOKORO_AGENT_BASE_URL: "http://kokoro-agent:4401",
    })
    assert.equal(config.agentEnabled, true)
    assert.equal(config.upstreams.agents, "http://kokoro-agent:4401")
  })

  it("loads owner transport limits from the environment", () => {
    const config = loadConfig({
      KOKORO_DOMAIN: "dev.kokoro.localhost",
      KOKORO_UPSTREAM_TIMEOUT_MS: "250",
      KOKORO_UPSTREAM_MAX_RESPONSE_BYTES: "4096",
    })
    assert.equal(config.upstreamTimeoutMs, 250)
    assert.equal(config.upstreamMaxResponseBytes, 4096)
  })
})
