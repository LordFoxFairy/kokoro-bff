import { performance } from "node:perf_hooks"
import type { PoolClient, QueryResult, QueryResultRow } from "pg"

import type { PostgresBffDatabase } from "./client.js"

export const MOVE_BUDGET_MS = 4500
const MOVE_LOCK_WAIT_MS = 1000

export function moveRemaining(deadline: number, signal: AbortSignal): number {
  if (signal.aborted || performance.now() >= deadline) throw new Error("MOVE_SESSION_UNAVAILABLE")
  return Math.max(1, Math.floor(deadline - performance.now()))
}

export class MoveSqlLease {
  private released = false

  public constructor(
    private readonly client: PoolClient,
    private readonly deadline: number,
    private readonly signal: AbortSignal,
  ) {}

  public release(destroy = false): void {
    if (this.released) return
    this.released = true
    this.client.release(destroy)
  }

  private bounded<Row extends QueryResultRow>(sql: string, params?: unknown[], limitMs?: number): Promise<QueryResult<Row>> {
    const budget = Math.min(moveRemaining(this.deadline, this.signal), limitMs ?? Number.POSITIVE_INFINITY)
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (): void => {
        clearTimeout(timer)
        this.signal.removeEventListener("abort", abort)
      }
      const fail = (): void => {
        if (settled) return
        settled = true
        finish()
        this.release(true)
        reject(new Error("MOVE_SESSION_UNAVAILABLE"))
      }
      const abort = (): void => fail()
      const timer = setTimeout(fail, budget)
      this.signal.addEventListener("abort", abort, { once: true })
      if (this.signal.aborted) {
        fail()
        return
      }
      Promise.resolve()
        .then(() => {
          if (settled) throw new Error("MOVE_SESSION_UNAVAILABLE")
          return this.client.query<Row>(sql, params ?? [])
        })
        .then(
          (result) => {
            if (settled) return
            settled = true
            finish()
            resolve(result)
          },
          (error: unknown) => {
            if (settled) return
            settled = true
            finish()
            reject(error)
          },
        )
    })
  }

  public command(sql: string): Promise<QueryResult> {
    return this.bounded(sql)
  }

  public async query<Row extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<Row>> {
    const budget = moveRemaining(this.deadline, this.signal)
    const lockBudget = Math.min(MOVE_LOCK_WAIT_MS, budget)
    await this.bounded("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)", [`${budget}ms`, `${lockBudget}ms`])
    return this.bounded<Row>(sql, params)
  }

  public async rollback(): Promise<void> {
    if (this.released) return
    try {
      await this.bounded("ROLLBACK", undefined, 250)
    } catch {
      this.release(true)
    }
  }
}

export function acquireMoveLease(pool: PostgresBffDatabase["pool"], deadline: number, signal: AbortSignal): Promise<MoveSqlLease> {
  const budget = moveRemaining(deadline, signal)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
    }
    const fail = (): void => {
      if (settled) return
      settled = true
      finish()
      reject(new Error("MOVE_SESSION_UNAVAILABLE"))
    }
    const abort = (): void => fail()
    const timer = setTimeout(fail, budget)
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) {
      fail()
      return
    }
    pool.connect().then(
      (client) => {
        if (settled) {
          client.release(true)
          return
        }
        settled = true
        finish()
        resolve(new MoveSqlLease(client, deadline, signal))
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        finish()
        reject(error)
      },
    )
  })
}
