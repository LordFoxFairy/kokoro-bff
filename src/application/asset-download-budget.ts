import { performance } from "node:perf_hooks"

/** One monotonic deadline belongs to the entire ordinary ASSET download. */
export function assetDownloadRemaining(signal: AbortSignal, deadlineAt: number): number {
  const remaining = Math.floor(deadlineAt - performance.now())
  if (signal.aborted || !Number.isFinite(remaining) || remaining < 1) throw new Error("ASSET_DOWNLOAD_INTERRUPTED")
  return remaining
}

/** Fence even non-cooperative dependencies, and retire a value arriving after the fence. */
export function withinAssetDownloadBudget<T>(signal: AbortSignal, deadlineAt: number, start: () => Promise<T>, retireLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let remaining: number
    try {
      remaining = assetDownloadRemaining(signal, deadlineAt)
    } catch (error) {
      reject(error)
      return
    }
    let settled = false
    const finish = (outcome: { ok: true; value: T } | { ok: false; error: unknown }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener("abort", interrupt)
      if (outcome.ok) resolve(outcome.value)
      else reject(outcome.error)
    }
    const interrupt = (): void => finish({ ok: false, error: new Error("ASSET_DOWNLOAD_INTERRUPTED") })
    const timer = setTimeout(interrupt, remaining)
    signal.addEventListener("abort", interrupt, { once: true })
    // A synchronous start can abort too; its eventual value still needs retirement.
    try {
      assetDownloadRemaining(signal, deadlineAt)
      void start().then(
        (value) => {
          if (!settled) {
            try {
              assetDownloadRemaining(signal, deadlineAt)
              finish({ ok: true, value })
              return
            } catch {
              interrupt()
            }
          }
          try {
            retireLate?.(value)
          } catch {
            // Retirement is best effort after the caller has already been fenced.
          }
        },
        (error: unknown) => finish({ ok: false, error }),
      )
    } catch (error) {
      finish({ ok: false, error })
    }
  })
}
