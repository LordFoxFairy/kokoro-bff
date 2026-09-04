import { EventSchemas } from "@ag-ui/core"
import type { IncomingMessage, ServerResponse } from "node:http"

/** Match EventEncoder's SSE shape: one JSON AG-UI event per data frame. */
export function agUiSseFrame(event: unknown, cursor: string): string {
  const parsed = EventSchemas.parse(event)
  return `id: ${cursor}\ndata: ${JSON.stringify(parsed)}\n\n`
}

export type AgUiSseBudget = {
  maxFrames: number
  maxBytes: number
  maxDurationMs: number
}

export type AgUiSseFrameInput = {
  cursor: string
  payload: unknown
}

export type AgUiSseWriteStatus = "written" | "aborted" | "budget_exhausted"

export type AgUiSseWriteResult = {
  status: AgUiSseWriteStatus
  lastCursor: string | null
  writtenFrames: number
}

type DrainResult = "drained" | "aborted" | "budget_exhausted"
type ChunkWriteResult = { status: DrainResult; accepted: boolean }

export class AgUiSseWriter {
  private readonly startedAt: number
  private frameCount = 0
  private byteCount = 0

  public constructor(
    private readonly request: IncomingMessage,
    private readonly response: ServerResponse,
    private readonly budget: AgUiSseBudget,
    private readonly now: () => number = Date.now,
  ) {
    if (
      !Number.isSafeInteger(budget.maxFrames) || budget.maxFrames < 1
      || !Number.isSafeInteger(budget.maxBytes) || budget.maxBytes < 1
      || !Number.isSafeInteger(budget.maxDurationMs) || budget.maxDurationMs < 1
    ) throw new Error("AG-UI SSE budget must contain positive safe integers")
    this.startedAt = this.now()
  }

  private stopped(): boolean {
    return this.request.aborted || this.response.destroyed || this.response.writableEnded
  }

  private durationExhausted(): boolean {
    return this.now() - this.startedAt >= this.budget.maxDurationMs
  }

  private waitForDrain(): Promise<DrainResult> {
    if (this.stopped()) return Promise.resolve("aborted")
    const remainingMs = this.budget.maxDurationMs - (this.now() - this.startedAt)
    if (remainingMs <= 0) return Promise.resolve("budget_exhausted")
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>
      const finish = (result: DrainResult): void => {
        clearTimeout(timer)
        this.request.off("aborted", onAbort)
        this.response.off("close", onAbort)
        this.response.off("error", onAbort)
        this.response.off("drain", onDrain)
        resolve(result)
      }
      const onAbort = (): void => finish("aborted")
      const onDrain = (): void => finish("drained")
      timer = setTimeout(() => finish("budget_exhausted"), remainingMs)
      this.request.once("aborted", onAbort)
      this.response.once("close", onAbort)
      this.response.once("error", onAbort)
      this.response.once("drain", onDrain)
    })
  }

  private async writeChunk(chunk: string): Promise<ChunkWriteResult> {
    if (this.stopped()) return { status: "aborted", accepted: false }
    if (this.durationExhausted()) return { status: "budget_exhausted", accepted: false }
    const bytes = Buffer.byteLength(chunk)
    if (this.byteCount + bytes > this.budget.maxBytes) return { status: "budget_exhausted", accepted: false }
    const accepted = this.response.write(chunk)
    this.byteCount += bytes
    if (accepted) return { status: "drained", accepted: true }
    return { status: await this.waitForDrain(), accepted: true }
  }

  public async writeFrames(frames: readonly AgUiSseFrameInput[]): Promise<AgUiSseWriteResult> {
    let lastCursor: string | null = null
    let writtenFrames = 0
    for (const frame of frames) {
      if (this.frameCount >= this.budget.maxFrames) {
        return { status: "budget_exhausted", lastCursor, writtenFrames }
      }
      const result = await this.writeChunk(agUiSseFrame(frame.payload, frame.cursor))
      if (result.accepted) {
        this.frameCount += 1
        writtenFrames += 1
        lastCursor = frame.cursor
      }
      if (result.status !== "drained") return { status: result.status, lastCursor, writtenFrames }
    }
    return { status: "written", lastCursor, writtenFrames }
  }

  public async writeComment(comment: string): Promise<AgUiSseWriteStatus> {
    const result = await this.writeChunk(`: ${comment}\n\n`)
    return result.status === "drained" ? "written" : result.status
  }
}
