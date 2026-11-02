import { performance } from "node:perf_hooks"
import { Client } from "pg"
import { expectedMessageRegenerationCatalog, inspectMessageRegenerationCatalog } from "./message-regeneration-schema-catalog.mjs"
import { assertBffSchemaUrl, loadCanonicalSchema } from "./apply-schema.mjs"
/** One named additive operation. No runtime pool, retries, migration ledger or caller DDL. */
export async function evolveMessageDefinitionSchema({ mode, databaseUrl, signal, timeoutMs = 20000 }, definitionsFromCanonical) {
  const started = performance.now()
  const result = (state, code, cleanup = "complete") => ({
    state,
    code,
    cleanup,
    duration_ms: Math.ceil(performance.now() - started),
  })
  try {
    if (!["check", "apply"].includes(mode) || !Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 20000) throw new Error()
    assertBffSchemaUrl(databaseUrl)
    const database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
    if (!database || ["postgres", "template0", "template1"].includes(database)) throw new Error()
  } catch {
    return result("invalid_request", "invalid_request")
  }
  const deadline = started + timeoutMs
  // Reserve finite time for socket retirement; every normal stage shares the remaining budget.
  const workDeadline = deadline - 250
  let client
  let transaction = false
  let commitSent = false
  let closed = false
  let broken = false
  let interrupt
  let outcome
  let rollbackFailed = false
  const destroy = () => {
    broken = true
    // pg 8.23 owns this exact connection. Hard retirement is needed when a peer withholds FIN/ACK.
    // Client.end alone may await that peer; no other pool/client/socket is touched.
    client?.connection?.stream?.destroy()
  }
  const onError = () => {
    destroy()
    interrupt?.()
  }
  const onEnd = () => {
    closed = true
    interrupt?.()
  }
  const remaining = () => {
    const value = Math.floor(workDeadline - performance.now())
    if (value <= 0 || signal?.aborted || broken) throw new Error("unavailable")
    return value
  }
  const within = async (start) => {
    const budget = remaining()
    let timer
    const abort = () => {
      destroy()
      interrupt?.()
    }
    const stopped = new Promise((_, reject) => {
      interrupt = () => reject(new Error("unavailable"))
      timer = setTimeout(abort, budget)
      signal?.addEventListener("abort", abort, { once: true })
    })
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          remaining()
          return start()
        }),
        stopped,
      ])
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      interrupt = undefined
    }
  }
  const raw = (text, values) => within(() => client.query(text, values))
  const query = async (text, values) => {
    const budget = remaining()
    await raw("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)", [
      String(Math.min(5000, budget)),
      String(Math.min(2000, budget)),
    ])
    return raw(text, values)
  }
  try {
    const definitions = definitionsFromCanonical(await within(loadCanonicalSchema))
    client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: Math.min(5000, remaining()),
      query_timeout: 0,
      options: "-c search_path=kokoro_bff -c timezone=UTC -c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=5000",
      application_name: "kokoro-bff-message-regeneration-evolution",
    })
    client.on("error", onError)
    client.on("end", onEnd)
    await within(() => client.connect())
    const actual = await raw("SELECT current_database() AS name")
    if (actual.rows[0]?.name !== decodeURIComponent(new URL(databaseUrl).pathname.slice(1))) throw new Error("invalid_schema")
    await raw("BEGIN")
    transaction = true
    await query("SELECT pg_advisory_xact_lock(hashtext(current_database()),hashtext('kokoro_bff'))")
    if (!(await query("SELECT to_regclass('kokoro_bff.bff_message') AS relation")).rows[0]?.relation) throw Error("invalid_schema")
    await query(`LOCK TABLE kokoro_bff.bff_message IN ${mode === "apply" ? "ACCESS EXCLUSIVE" : "ACCESS SHARE"} MODE`)
    const expected = await expectedMessageRegenerationCatalog(query, definitions)
    const state = await inspectMessageRegenerationCatalog(query, expected)
    if (mode === "check") {
      await raw("ROLLBACK")
      transaction = false
      outcome = result(state === "missing" ? "update_required" : "current", "ok")
    } else {
      if (state === "missing") {
        await query(definitions.alter)
      }
      if ((await inspectMessageRegenerationCatalog(query, expected)) !== "current") throw new Error("invalid_schema")
      // Check cancellation before dispatch; only an actually dispatched COMMIT is unknown.
      remaining()
      await within(() => {
        commitSent = true
        return client.query("COMMIT")
      })
      transaction = false
      outcome = result(state === "missing" ? "updated" : "current", "ok")
    }
  } catch (error) {
    outcome = result(
      commitSent ? "unknown" : error?.message === "invalid_schema" ? "invalid_schema" : "unavailable",
      commitSent ? "commit_unknown" : error?.message === "invalid_schema" ? "invalid_schema" : "unavailable",
    )
    if (transaction && !commitSent && !broken) {
      try {
        await raw("ROLLBACK")
        transaction = false
      } catch {
        rollbackFailed = true
        destroy()
      }
    }
  } finally {
    if (client) {
      // A bounded terminal close is part of the operation, never an unawaited end promise.
      let ended
      const end = new Promise((resolve) => {
        ended = resolve
        if (closed) resolve()
        else client.once("end", resolve)
      })
      const budget = Math.max(1, Math.min(250, Math.floor(deadline - performance.now())))
      let forced = false
      const timer = setTimeout(
        () => {
          forced = true
          destroy()
        },
        Math.max(1, budget - 20),
      )
      try {
        void client.end().catch(destroy)
        let closeTimer
        const complete = await Promise.race([
          end.then(() => true),
          new Promise((resolve) => {
            closeTimer = setTimeout(() => resolve(false), budget)
          }),
        ])
        clearTimeout(closeTimer)
        if (!complete || forced) {
          destroy()
          if (commitSent) outcome = result("unknown", "commit_unknown", "failed")
          else if (["invalid_schema", "unavailable"].includes(outcome.state)) outcome = { ...outcome, cleanup: "failed" }
          else outcome = result("unavailable", "cleanup_failed", "failed")
        }
      } finally {
        clearTimeout(timer)
        client.removeListener("end", ended)
        // Keep the sanitized error listener until this retired connection's final close.
      }
    }
  }
  if (rollbackFailed && outcome.cleanup === "complete") outcome = { ...outcome, cleanup: "rollback_failed" }
  return { ...outcome, duration_ms: Math.ceil(performance.now() - started) }
}
