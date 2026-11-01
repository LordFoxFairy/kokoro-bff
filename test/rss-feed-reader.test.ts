import assert from "node:assert/strict"
import test from "node:test"
import { spawn, spawnSync } from "node:child_process"
import { createServer as createHttpsServer, request as httpsRequest } from "node:https"
import { createServer as createTcpServer } from "node:net"
import type { Socket } from "node:net"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { lookup } from "node:dns"
import { createRssFeedReader, readRssFeed } from "../src/infrastructure/clients/rss-feed-reader.js"
const result = spawnSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "/dev/stdout",
    "-out",
    "/dev/stdout",
    "-days",
    "1",
    "-subj",
    "/CN=feed.example.com",
    "-addext",
    "subjectAltName=DNS:feed.example.com",
  ],
  { encoding: "utf8" },
)
assert.equal(result.status, 0, "in-memory TLS fixture certificate generation")
const key = result.stdout.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/)?.[0]
const cert = result.stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0]
assert.ok(key && cert)
const publicLookup = ((_host: string, _options: unknown, callback: Function) => callback(null, [{ address: "8.8.8.8", family: 4 }])) as typeof lookup
const input = (signal = new AbortController().signal) => ({ url: "https://feed.example.com/feed", signal })
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof Error && error.message === code)
async function peer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const sockets = new Set<Socket>()
  let hits = 0
  const optionsSeen: any[] = []
  const server = createHttpsServer({ key, cert }, (req, res) => {
    hits++
    handler(req, res)
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const request = ((options: any, callback: any) => {
    optionsSeen.push(options)
    // Observe the production single-address lookup before mapping only the test socket.
    options.lookup(options.hostname, { all: false }, (error: any, address: string, family: number) => {
      assert.equal(error, null)
      assert.equal(address, "8.8.8.8")
      assert.equal(family, 4)
    })
    return httpsRequest({ ...options, hostname: "127.0.0.1", port: address.port, ca: cert, lookup: undefined }, callback)
  }) as typeof httpsRequest
  return {
    port: address.port,
    reader: createRssFeedReader({ lookup: publicLookup, request }),
    request,
    optionsSeen,
    get hits() {
      return hits
    },
    get socketCount() {
      return sockets.size
    },
    async close() {
      for (const s of sockets) s.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
function xml(res: ServerResponse, body = "<rss/>") {
  res.writeHead(200, { "Content-Type": "application/rss+xml; charset=UTF-8" })
  res.end(body)
}
test("real TLS complete bytes, original Host/SNI/strict certificate and fixed public pin", async () => {
  const p = await peer((req, res) => {
    assert.equal(req.headers.host, "feed.example.com")
    assert.equal(req.headers.authorization, undefined)
    assert.equal(req.headers.cookie, undefined)
    xml(res)
  })
  try {
    assert.equal(Buffer.from(await p.reader(input())).toString(), "<rss/>")
    assert.equal(p.hits, 1)
    const o = p.optionsSeen[0]
    assert.equal(o.hostname, "feed.example.com")
    assert.equal(o.servername, "feed.example.com")
    assert.equal(o.rejectUnauthorized, true)
    assert.equal(o.agent, false)
    assert.equal(o.autoSelectFamily, false)
    assert.equal(o.maxHeaderSize, 16384)
    assert.equal(o.headers["Accept-Encoding"], "identity")
  } finally {
    await p.close()
  }
})
test("pre-abort performs zero DNS and zero request", async () => {
  let dns = 0,
    requests = 0
  const ac = new AbortController()
  ac.abort()
  const r = createRssFeedReader({
    lookup: ((..._args: any[]) => {
      dns++
    }) as typeof lookup,
    request: ((..._args: any[]) => {
      requests++
      throw Error()
    }) as typeof httpsRequest,
  })
  await rejects(r(input(ac.signal)), "rss_feed_cancelled")
  assert.equal(dns, 0)
  assert.equal(requests, 0)
})
test("all DNS answers must be public; malformed, mixed, empty, oversized answers never send", async () => {
  for (const answers of [
    [],
    [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    [{ address: "8.8.8.8", family: 6 }],
    Array.from({ length: 33 }, () => ({ address: "8.8.8.8", family: 4 })),
  ]) {
    let sends = 0
    const r = createRssFeedReader({
      lookup: ((_h: any, _o: any, cb: any) => cb(null, answers)) as typeof lookup,
      request: ((..._a: any[]) => {
        sends++
        throw Error()
      }) as typeof httpsRequest,
    })
    await rejects(r(input()), "rss_feed_address_forbidden")
    assert.equal(sends, 0)
  }
})
test("eight physically pending DNS calls retain slots after cancellation; late callbacks never send", async () => {
  const callbacks: Function[] = []
  let sends = 0
  const r = createRssFeedReader({
    lookup: ((_h: any, _o: any, cb: any) => callbacks.push(cb)) as typeof lookup,
    request: ((..._a: any[]) => {
      sends++
      throw Error()
    }) as typeof httpsRequest,
  })
  const controllers = Array.from({ length: 8 }, () => new AbortController())
  const pending = controllers.map((ac) => r(input(ac.signal)))
  controllers.forEach((ac) => ac.abort())
  await Promise.all(pending.map((p) => rejects(p, "rss_feed_cancelled")))
  await rejects(r(input()), "rss_feed_dns_busy")
  assert.equal(callbacks.length, 8)
  callbacks.forEach((cb) => cb(null, [{ address: "8.8.8.8", family: 4 }]))
  assert.equal(sends, 0)
  const next = new AbortController()
  const ninth = r(input(next.signal))
  assert.equal(callbacks.length, 9, "physical completion frees the slot")
  next.abort()
  await rejects(ninth, "rss_feed_cancelled")
  callbacks[8]!(null, [{ address: "8.8.8.8", family: 4 }])
  assert.equal(sends, 0)
})
test("DNS errors are closed and do not reveal host or original exception", async () => {
  const r = createRssFeedReader({ lookup: ((_h: any, _o: any, cb: any) => cb(Error("secret host"))) as typeof lookup, request: httpsRequest })
  await rejects(r(input()), "rss_feed_dns_unavailable")
})
for (const [name, handler, code] of [
  [
    "redirect",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.writeHead(302, { Location: "https://other.example.com/" })
      s.end()
    },
    "rss_feed_response_invalid",
  ],
  [
    "304",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.writeHead(304)
      s.end()
    },
    "rss_feed_response_invalid",
  ],
  [
    "compressed",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.writeHead(200, { "Content-Type": "application/xml", "Content-Encoding": "gzip" })
      s.end("x")
    },
    "rss_feed_response_invalid",
  ],
  ["missing MIME", (_q: IncomingMessage, s: ServerResponse) => s.end("x"), "rss_feed_response_invalid"],
  [
    "HTML",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.setHeader("Content-Type", "text/html")
      s.end("x")
    },
    "rss_feed_response_invalid",
  ],
  [
    "unknown MIME parameter",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.setHeader("Content-Type", "text/xml; boundary=x")
      s.end("x")
    },
    "rss_feed_response_invalid",
  ],
  [
    "bad charset",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.setHeader("Content-Type", "text/xml; charset=latin1")
      s.end("x")
    },
    "rss_feed_response_invalid",
  ],
  [
    "duplicate MIME",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.setHeader("Content-Type", ["text/xml", "text/xml"])
      s.end("x")
    },
    "rss_feed_response_invalid",
  ],
  [
    "declared too large",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.setHeader("Content-Type", "text/xml")
      s.setHeader("Content-Length", 1048577)
      s.end()
    },
    "rss_feed_too_large",
  ],
  [
    "actual too large",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.setHeader("Content-Type", "text/xml")
      s.end(Buffer.alloc(1048577, 120))
    },
    "rss_feed_too_large",
  ],
  [
    "trailers",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.setHeader("Content-Type", "text/xml")
      s.setHeader("Trailer", "X-Later")
      s.write("x")
      s.addTrailers({ "X-Later": "x" })
      s.end()
    },
    "rss_feed_response_invalid",
  ],
  [
    "truncated",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.setHeader("Content-Type", "text/xml")
      s.setHeader("Content-Length", 100)
      s.write("x")
      setTimeout(() => s.destroy(), 10)
    },
    "rss_feed_response_invalid",
  ],
  [
    "oversized headers",
    (_q: IncomingMessage, s: ServerResponse) => {
      s.setHeader("Content-Type", "text/xml")
      s.setHeader("X-Large", "x".repeat(17000))
      s.end()
    },
    "rss_feed_response_invalid",
  ],
] as const)
  test(`real TLS rejects ${name} without followup`, async () => {
    const p = await peer(handler)
    try {
      await rejects(p.reader(input()), code)
      assert.equal(p.optionsSeen.length, 1)
      assert.equal(p.hits, 1)
    } finally {
      await p.close()
    }
  })
for (const mime of ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml; charset=utf8"])
  test(`accepted MIME ${mime}`, async () => {
    const p = await peer((_q, res) => {
      res.setHeader("Content-Type", mime)
      res.end("x")
    })
    try {
      assert.equal(Buffer.from(await p.reader(input())).toString(), "x")
    } finally {
      await p.close()
    }
  })
test("wrong SAN fails default TLS hostname verification", async () => {
  const p = await peer((_q, res) => xml(res))
  try {
    await rejects(p.reader({ ...input(), url: "https://wrong.example.com/feed" }), "rss_feed_unavailable")
    assert.equal(p.hits, 0)
  } finally {
    await p.close()
  }
})
test("abort while body is pending closes own socket and returns no partial bytes", async () => {
  let accepted!: () => void
  const ready = new Promise<void>((r) => (accepted = r))
  const p = await peer((_q, res) => {
    res.setHeader("Content-Type", "text/xml")
    res.write("<rss>")
    accepted()
  })
  try {
    const ac = new AbortController()
    const pending = p.reader(input(ac.signal))
    await ready
    ac.abort()
    await rejects(pending, "rss_feed_cancelled")
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(p.socketCount, 0)
  } finally {
    await p.close()
  }
})
test("real idle deadline fires around 5 seconds and closes socket", async () => {
  const p = await peer((_q, res) => {
    res.setHeader("Content-Type", "text/xml")
    res.flushHeaders()
  })
  try {
    const start = performance.now()
    await rejects(p.reader(input()), "rss_feed_timeout")
    const elapsed = performance.now() - start
    assert.ok(elapsed >= 4900 && elapsed < 7000, `idle duration ${elapsed}`)
  } finally {
    await p.close()
  }
})
test("real drip progress cannot reset the 10 second total deadline", async () => {
  let interval: ReturnType<typeof setInterval> | undefined
  const p = await peer((_q, res) => {
    res.setHeader("Content-Type", "text/xml")
    res.write("x")
    interval = setInterval(() => res.write("x"), 700)
    res.on("close", () => clearInterval(interval))
  })
  try {
    const start = performance.now()
    await rejects(p.reader(input()), "rss_feed_timeout")
    const elapsed = performance.now() - start
    assert.ok(elapsed >= 9900 && elapsed < 12000, `total duration ${elapsed}`)
  } finally {
    clearInterval(interval)
    await p.close()
  }
})
test("environment proxy settings including NODE_USE_ENV_PROXY cannot divert native reader", async () => {
  let connections = 0
  const trap = createTcpServer((s) => {
    connections++
    s.destroy()
  })
  await new Promise<void>((r) => trap.listen(0, "127.0.0.1", r))
  const a = trap.address()
  assert.ok(a && typeof a !== "string")
  const keys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NODE_USE_ENV_PROXY"]
  const before = keys.map((k) => process.env[k])
  const p = await peer((_q, res) => xml(res))
  try {
    for (const k of keys) process.env[k] = k === "NODE_USE_ENV_PROXY" ? "1" : `http://127.0.0.1:${a.port}`
    assert.equal(Buffer.from(await p.reader(input())).toString(), "<rss/>")
    assert.equal(connections, 0)
    assert.equal(p.optionsSeen[0].agent, false)
  } finally {
    keys.forEach((k, i) => {
      const v = before[i]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    })
    await p.close()
    await new Promise<void>((r) => trap.close(() => r()))
  }
})
test("fixed production entry rejects private URL before network", async () =>
  await rejects(readRssFeed({ url: "https://127.0.0.1/", signal: new AbortController().signal }), "rss_feed_url_invalid"))

// Startup flags matter: this child starts with proxy support enabled, not just env mutated after startup.
test("startup NODE_USE_ENV_PROXY and --use-env-proxy still cannot divert agent:false", async () => {
  let connections = 0
  const trap = createTcpServer((socket) => {
    connections++
    socket.destroy()
  })
  await new Promise<void>((resolve) => trap.listen(0, "127.0.0.1", resolve))
  const address = trap.address()
  assert.ok(address && typeof address !== "string")
  const p = await peer((_q, res) => xml(res))
  try {
    const program = `import {lookup} from 'node:dns';import {request} from 'node:https';import {createRssFeedReader} from './src/infrastructure/clients/rss-feed-reader.ts';const reader=createRssFeedReader({lookup:(_h,_o,cb)=>cb(null,[{address:'8.8.8.8',family:4}]),request:(options,cb)=>request({...options,hostname:'127.0.0.1',port:Number(process.env.RSS_TEST_PORT),ca:process.env.RSS_TEST_CA,lookup:undefined},cb)});const result=await reader({url:'https://feed.example.com/feed',signal:new AbortController().signal});if(Buffer.from(result).toString()!=='<rss/>')process.exitCode=1;`
    const proxy = `http://127.0.0.1:${address.port}`
    const child = spawn(process.execPath, ["--use-env-proxy", "--import", "tsx", "--input-type=module", "-e", program], {
      env: {
        ...process.env,
        NODE_USE_ENV_PROXY: "1",
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        ALL_PROXY: proxy,
        http_proxy: proxy,
        https_proxy: proxy,
        all_proxy: proxy,
        NO_PROXY: "",
        no_proxy: "",
        RSS_TEST_PORT: String(p.port),
        RSS_TEST_CA: cert,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (b) => (output += b))
    child.stderr.on("data", (b) => (output += b))
    const status = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject)
      child.on("close", resolve)
    })
    assert.equal(status, 0, output)
    assert.equal(connections, 0)
    assert.equal(p.hits, 1)
  } finally {
    await p.close()
    await new Promise<void>((resolve) => trap.close(() => resolve()))
  }
})
test("exact one MiB body and its declared length are accepted", async () => {
  const body = Buffer.alloc(1048576, 120)
  const p = await peer((_q, res) => {
    res.setHeader("Content-Type", "text/xml")
    res.setHeader("Content-Length", body.length)
    res.end(body)
  })
  try {
    assert.deepEqual(Buffer.from(await p.reader(input())), body)
  } finally {
    await p.close()
  }
})

test("32 public DNS answers use exactly the first validated pin and one lookup", async () => {
  const p = await peer((_q, res) => xml(res))
  let calls = 0
  const reader = createRssFeedReader({
    lookup: ((_h: any, options: any, callback: any) => {
      calls++
      assert.deepEqual(options, { all: true, verbatim: true })
      callback(
        null,
        Array.from({ length: 32 }, (_, i) => ({ address: i === 0 ? "8.8.8.8" : "1.1.1.1", family: 4 })),
      )
    }) as typeof lookup,
    request: p.request,
  })
  try {
    assert.equal(Buffer.from(await reader(input())).toString(), "<rss/>")
    assert.equal(calls, 1)
    assert.equal(p.optionsSeen.length, 1)
  } finally {
    await p.close()
  }
})
