import assert from "node:assert/strict"
import { createServer, connect } from "node:net"

export function relayEndpoints(targetUrl) {
  const target = new URL(targetUrl)
  // Capture immutable primitives before the separate client-facing URL is changed.
  return { upstreamHost: target.hostname, upstreamPort: Number(target.port || 5432), proxyUrl: new URL(targetUrl) }
}

export async function commitAckRelay(targetUrl) {
  const { upstreamHost, upstreamPort, proxyUrl } = relayEndpoints(targetUrl)
  const sockets = new Set()
  let commitSeen = false
  let blockedBytes = 0
  let connections = 0
  let connectionOverflow = false
  let upstreamConnected = false
  let clientPendingBytes = 0
  let backendPendingBytes = 0
  const clientPackets = []
  const backendPackets = []
  const socketErrors = new Set()
  const remember = (list, type, length) => {
    list.push({ type, length })
    if (list.length > 128) list.shift()
  }
  const server = createServer((front) => {
    connections += 1
    if (connections > 1) {
      connectionOverflow = true
      front.destroy()
      return
    }
    const back = connect({ host: upstreamHost, port: upstreamPort })
    sockets.add(front)
    sockets.add(back)
    let pending = Buffer.alloc(0)
    let backendPending = Buffer.alloc(0)
    let startup = true
    let suppress = false
    back.once("connect", () => {
      upstreamConnected = true
    })
    for (const [side, socket] of [
      ["client", front],
      ["backend", back],
    ]) {
      socket.on("error", (error) => {
        const code = typeof error.code === "string" && /^[A-Z0-9_]+$/u.test(error.code) ? error.code : "unknown"
        socketErrors.add(`${side}:${code}`)
        front.destroy()
        back.destroy()
      })
      socket.on("close", () => {
        sockets.delete(socket)
      })
    }
    front.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk])
      clientPendingBytes = pending.length
      while (pending.length >= (startup ? 4 : 5)) {
        const length = pending.readInt32BE(startup ? 0 : 1) + (startup ? 0 : 1)
        if (length < (startup ? 8 : 5) || length > 1048576) {
          remember(clientPackets, "invalid", length)
          front.destroy()
          back.destroy()
          return
        }
        if (pending.length < length) return
        const packet = pending.subarray(0, length)
        pending = pending.subarray(length)
        clientPendingBytes = pending.length
        remember(clientPackets, startup ? "startup" : String.fromCharCode(packet[0]), length)
        if (!startup && packet[0] === 81 && packet.subarray(5).toString("utf8") === "COMMIT\0") {
          suppress = true
          commitSeen = true
        }
        back.write(packet)
        startup = false
      }
    })
    back.on("data", (chunk) => {
      // Diagnostic metadata only: no packet body, SQL, authentication value or URL is recorded.
      backendPending = Buffer.concat([backendPending, chunk])
      backendPendingBytes = backendPending.length
      while (backendPending.length >= 5) {
        const length = backendPending.readInt32BE(1) + 1
        if (length < 5 || length > 1048576) {
          remember(backendPackets, "invalid", length)
          backendPending = Buffer.alloc(0)
          backendPendingBytes = 0
          break
        }
        if (backendPending.length < length) break
        remember(backendPackets, String.fromCharCode(backendPending[0]), length)
        backendPending = backendPending.subarray(length)
        backendPendingBytes = backendPending.length
      }
      if (suppress) blockedBytes += chunk.length
      else front.write(chunk)
    })
    front.on("end", () => back.end())
    back.on("end", () => front.end())
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  proxyUrl.hostname = "127.0.0.1"
  proxyUrl.port = String(address.port)
  proxyUrl.searchParams.set("sslmode", "disable")
  return {
    url: proxyUrl.toString(),
    observed: () => ({
      commitSeen,
      blockedBytes,
      connections,
      connectionOverflow,
      sockets: sockets.size,
      upstreamConnected,
      clientPendingBytes,
      backendPendingBytes,
      clientPackets: [...clientPackets],
      backendPackets: [...backendPackets],
      socketErrors: [...socketErrors].sort(),
    }),
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

export async function waitFor(predicate, timeoutMs = 1800) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error("fixture observation deadline exceeded")
}
