import { ok, type BffEnvelope } from "../contracts/index.js"
import { isRecord } from "../http/request.js"
import type { MoriGenerationStatus } from "./mori.js"

export type MoriOwnerResponseKind =
  | "project_list"
  | "project"
  | "song_plan"
  | "generation_receipt"
  | "generation"
  | "generation_event"
  | "candidate_list"
  | "promote"
  | "library_list"
  | "export_receipt"
  | "export"

export type MoriOwnerRoute = {
  path: string
  kind: MoriOwnerResponseKind
  stream: boolean
}

const generationStatuses = new Set<MoriGenerationStatus>([
  "queued",
  "preparing",
  "generating",
  "post_processing",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
])

function nonEmptyRef(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "." && value !== ".." && !value.includes("/")
}

function querySuffix(requestUrl: string | undefined, allowed: readonly string[]): string {
  const url = new URL(requestUrl || "/", "http://bff.local")
  const query = new URLSearchParams()
  for (const [name, value] of url.searchParams) {
    if (allowed.includes(name) && value.trim() !== "") query.append(name, value.trim())
  }
  const encoded = query.toString()
  return encoded === "" ? "" : `?${encoded}`
}

function route(
  tail: string[],
  method: string,
  requestUrl: string | undefined,
  kind: MoriOwnerResponseKind,
  allowedQuery: readonly string[],
  stream = false,
): MoriOwnerRoute {
  const encodedTail = tail.map((segment) => encodeURIComponent(segment)).join("/")
  return {
    path: `/internal/bff/mori/${encodedTail}${querySuffix(requestUrl, allowedQuery)}`,
    kind,
    stream,
  }
}

/**
 * Maps the public Mori contract to the Music owner's private BFF ingress.
 * The allowlist is intentional: a provider URL, task id, or arbitrary owner
 * path must never be selected by a browser request.
 */
export function musicOwnerRoute(
  businessPath: string[],
  method: string,
  requestUrl: string | undefined,
): MoriOwnerRoute | null {
  if (businessPath[0] !== "mori") return null
  const tail = businessPath.slice(1)
  const [first, second, third] = tail
  if (tail.some((segment) => !nonEmptyRef(segment) && segment !== "projects" && segment !== "generations" && segment !== "song_plans" && segment !== "candidates" && segment !== "promote" && segment !== "versions" && segment !== "remix" && segment !== "library" && segment !== "exports")) return null

  if (tail.length === 1 && first === "projects") {
    if (method === "GET") return route(tail, method, requestUrl, "project_list", ["cursor", "limit"])
    if (method === "POST") return route(tail, method, requestUrl, "project", [])
    return null
  }
  if (tail.length === 2 && first === "projects" && nonEmptyRef(second) && method === "GET") {
    return route(tail, method, requestUrl, "project", [])
  }
  if (tail.length === 3 && first === "projects" && nonEmptyRef(second) && third === "song_plans" && method === "POST") {
    return route(tail, method, requestUrl, "song_plan", [])
  }
  if (tail.length === 3 && first === "projects" && nonEmptyRef(second) && third === "generations" && method === "POST") {
    return route(tail, method, requestUrl, "generation_receipt", [])
  }
  if (tail.length === 3 && first === "generations" && nonEmptyRef(second) && third === "events" && method === "GET") {
    return route(tail, method, requestUrl, "generation_event", [], true)
  }
  if (tail.length === 2 && first === "generations" && nonEmptyRef(second) && method === "GET") {
    return route(tail, method, requestUrl, "generation", [])
  }
  if (tail.length === 3 && first === "generations" && nonEmptyRef(second) && third === "cancel" && method === "POST") {
    return route(tail, method, requestUrl, "generation_receipt", [])
  }
  if (tail.length === 3 && first === "projects" && nonEmptyRef(second) && third === "candidates" && method === "GET") {
    return route(tail, method, requestUrl, "candidate_list", ["cursor", "limit"])
  }
  if (tail.length === 3 && first === "candidates" && nonEmptyRef(second) && third === "promote" && method === "POST") {
    return route(tail, method, requestUrl, "promote", [])
  }
  if (tail.length === 3 && first === "versions" && nonEmptyRef(second) && third === "remix" && method === "POST") {
    return route(tail, method, requestUrl, "generation_receipt", [])
  }
  if (tail.length === 1 && first === "library" && method === "GET") {
    return route(tail, method, requestUrl, "library_list", ["kind", "cursor", "limit"])
  }
  if (tail.length === 3 && first === "versions" && nonEmptyRef(second) && third === "exports" && method === "POST") {
    return route(tail, method, requestUrl, "export_receipt", [])
  }
  if (tail.length === 2 && first === "exports" && nonEmptyRef(second) && method === "GET") {
    return route(tail, method, requestUrl, "export", [])
  }
  return null
}

function stringField(value: Record<string, unknown>, name: string): string | null {
  return typeof value[name] === "string" && value[name].trim() !== "" ? value[name].trim() : null
}

function nullableStringField(value: Record<string, unknown>, name: string): string | null | undefined {
  if (value[name] === null) return null
  return stringField(value, name) ?? undefined
}

function dateField(value: Record<string, unknown>, name: string): string | null {
  const field = stringField(value, name)
  return field !== null && Number.isFinite(Date.parse(field)) ? field : null
}

function integerField(value: Record<string, unknown>, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  const field = value[name]
  return typeof field === "number" && Number.isSafeInteger(field) && field >= minimum && field <= maximum ? field : null
}

function stringArrayField(value: Record<string, unknown>, name: string): string[] | null {
  const field = value[name]
  if (!Array.isArray(field) || !field.every((item) => typeof item === "string" && item.trim() !== "")) return null
  return field.map((item) => item.trim())
}

function cursorField(value: Record<string, unknown>, name: string): string | null | undefined {
  if (value[name] === null) return null
  return stringField(value, name) ?? undefined
}

function generationStatus(value: unknown): MoriGenerationStatus | null {
  return typeof value === "string" && generationStatuses.has(value as MoriGenerationStatus) ? value as MoriGenerationStatus : null
}

function projectProject(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const projectRef = stringField(value, "project_ref")
  const title = stringField(value, "title")
  const description = typeof value.description === "string" ? value.description : null
  const currentVersionRef = nullableStringField(value, "current_version_ref")
  const candidateCount = integerField(value, "candidate_count")
  const lastActivityAt = dateField(value, "last_activity_at")
  if (projectRef === null || title === null || description === null || currentVersionRef === undefined || candidateCount === null || lastActivityAt === null) return null
  return { project_ref: projectRef, title, description, current_version_ref: currentVersionRef, candidate_count: candidateCount, last_activity_at: lastActivityAt }
}

function projectSongPlan(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const songPlanRef = stringField(value, "song_plan_ref")
  const projectRef = stringField(value, "project_ref")
  const prompt = stringField(value, "prompt")
  const mood = stringField(value, "mood")
  const tempo = integerField(value, "tempo_bpm", 40, 240)
  const structure = stringArrayField(value, "structure")
  const instruments = stringArrayField(value, "instruments")
  const vocalDirection = stringField(value, "vocal_direction")
  const lyricsIntent = stringField(value, "lyrics_intent")
  const createdAt = dateField(value, "created_at")
  if (songPlanRef === null || projectRef === null || prompt === null || mood === null || tempo === null || structure === null || instruments === null || vocalDirection === null || lyricsIntent === null || createdAt === null) return null
  return { song_plan_ref: songPlanRef, project_ref: projectRef, prompt, mood, tempo_bpm: tempo, structure, instruments, vocal_direction: vocalDirection, lyrics_intent: lyricsIntent, created_at: createdAt }
}

function projectGenerationReceipt(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const generationRef = stringField(value, "generation_ref")
  const status = generationStatus(value.status)
  return generationRef === null || status === null ? null : { generation_ref: generationRef, status }
}

function projectGeneration(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const generationRef = stringField(value, "generation_ref")
  const projectRef = stringField(value, "project_ref")
  const songPlanRef = nullableStringField(value, "song_plan_ref")
  const mode = value.mode === "smart" || value.mode === "custom" ? value.mode : null
  const status = generationStatus(value.status)
  const progress = integerField(value, "progress", 0, 100)
  const candidateRefs = stringArrayField(value, "candidate_refs")
  const createdAt = dateField(value, "created_at")
  if (generationRef === null || projectRef === null || songPlanRef === undefined || mode === null || status === null || progress === null || candidateRefs === null || createdAt === null) return null
  return { generation_ref: generationRef, project_ref: projectRef, song_plan_ref: songPlanRef, mode, status, progress, candidate_refs: candidateRefs, created_at: createdAt }
}

function projectGenerationEvent(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const generationRef = stringField(value, "generation_ref")
  const projectRef = stringField(value, "project_ref")
  const status = generationStatus(value.status)
  const progress = integerField(value, "progress", 0, 100)
  const candidateRefs = stringArrayField(value, "candidate_refs")
  if (generationRef === null || projectRef === null || status === null || progress === null || candidateRefs === null) return null
  return { generation_ref: generationRef, project_ref: projectRef, status, progress, candidate_refs: candidateRefs }
}

function projectCandidate(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const fields = {
    candidate_ref: stringField(value, "candidate_ref"),
    generation_ref: stringField(value, "generation_ref"),
    version_ref: stringField(value, "version_ref"),
    project_ref: stringField(value, "project_ref"),
    title: stringField(value, "title"),
    duration_seconds: integerField(value, "duration_seconds", 1),
    audio_asset_ref: stringField(value, "audio_asset_ref"),
    waveform_asset_ref: stringField(value, "waveform_asset_ref"),
    style_tags: stringArrayField(value, "style_tags"),
    created_at: dateField(value, "created_at"),
  }
  return Object.values(fields).some((field) => field === null) ? null : fields
}

function projectPromote(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const fields = {
    version_ref: stringField(value, "version_ref"),
    project_ref: stringField(value, "project_ref"),
    source_candidate_ref: stringField(value, "source_candidate_ref"),
    status: value.status === "current" ? "current" : null,
  }
  return Object.values(fields).some((field) => field === null) ? null : fields
}

function projectLibraryItem(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const fields = {
    library_item_ref: stringField(value, "library_item_ref"),
    kind: value.kind === "version" ? "version" : null,
    project_ref: stringField(value, "project_ref"),
    project_title: stringField(value, "project_title"),
    version_ref: stringField(value, "version_ref"),
    title: stringField(value, "title"),
    duration_seconds: integerField(value, "duration_seconds", 1),
    audio_asset_ref: stringField(value, "audio_asset_ref"),
    waveform_asset_ref: stringField(value, "waveform_asset_ref"),
    created_at: dateField(value, "created_at"),
  }
  return Object.values(fields).some((field) => field === null) ? null : fields
}

function projectExportReceipt(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const exportRef = stringField(value, "export_ref")
  const status = value.status === "queued" || value.status === "processing" ? value.status : null
  return exportRef === null || status === null ? null : { export_ref: exportRef, status }
}

function projectExport(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const exportRef = stringField(value, "export_ref")
  const projectRef = stringField(value, "project_ref")
  const versionRef = stringField(value, "version_ref")
  const format = value.format === "mp3" || value.format === "wav" ? value.format : null
  const status = value.status === "queued" || value.status === "processing" || value.status === "succeeded" || value.status === "failed" ? value.status : null
  const downloadUrl = value.download_url === null ? null : stringField(value, "download_url")
  const createdAt = dateField(value, "created_at")
  if (exportRef === null || projectRef === null || versionRef === null || format === null || status === null || downloadUrl === undefined || createdAt === null) return null
  return { export_ref: exportRef, project_ref: projectRef, version_ref: versionRef, format, status, download_url: downloadUrl, created_at: createdAt }
}

function projectProjectList(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.projects)) return null
  const projects = value.projects.map(projectProject)
  const nextCursor = cursorField(value, "next_cursor")
  return nextCursor === undefined || projects.some((project) => project === null) ? null : { projects, next_cursor: nextCursor }
}

function projectCandidateList(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.candidates)) return null
  const candidates = value.candidates.map(projectCandidate)
  const nextCursor = cursorField(value, "next_cursor")
  return nextCursor === undefined || candidates.some((candidate) => candidate === null) ? null : { candidates, next_cursor: nextCursor }
}

function projectLibraryList(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null
  const items = value.items.map(projectLibraryItem)
  const nextCursor = cursorField(value, "next_cursor")
  return nextCursor === undefined || items.some((item) => item === null) ? null : { items, next_cursor: nextCursor }
}

/** Drops owner/provider fields and re-issues the BFF request id in the envelope. */
export function projectMoriResponse(
  kind: MoriOwnerResponseKind,
  body: unknown,
  requestId: string,
): BffEnvelope<unknown> | null {
  if (!isRecord(body) || !("data" in body)) return null
  const data = kind === "project_list"
    ? projectProjectList(body.data)
    : kind === "project"
      ? projectProject(body.data)
      : kind === "song_plan"
        ? projectSongPlan(body.data)
        : kind === "generation_receipt" || kind === "export_receipt"
          ? kind === "generation_receipt" ? projectGenerationReceipt(body.data) : projectExportReceipt(body.data)
          : kind === "generation"
            ? projectGeneration(body.data)
            : kind === "generation_event"
              ? projectGenerationEvent(body.data)
              : kind === "candidate_list"
                ? projectCandidateList(body.data)
                : kind === "promote"
                  ? projectPromote(body.data)
                  : kind === "library_list"
                    ? projectLibraryList(body.data)
                    : projectExport(body.data)
  return data === null ? null : ok(data, requestId)
}

function eventIdIsValid(id: string, generationRef: string): boolean {
  if (!id.startsWith(`${generationRef}:`)) return false
  const sequence = Number(id.slice(generationRef.length + 1))
  return Number.isSafeInteger(sequence) && sequence > 0
}

/** Re-frames owner SSE so only the public Mori event envelope reaches Web. */
export function projectMoriEventStream(generationRef: string, body: Buffer, requestId: string): Buffer | null {
  const text = body.toString("utf8").replace(/\r\n?/gu, "\n")
  if (text.trim() === "") return Buffer.from(": keep-alive\n\n")
  const frames = text.split("\n\n").filter((frame) => frame.trim() !== "")
  const output: string[] = []
  for (const frame of frames) {
    const lines = frame.split("\n")
    if (lines.every((line) => line.startsWith(":"))) {
      output.push(`${frame}\n\n`)
      continue
    }
    const idLine = lines.find((line) => line.startsWith("id:"))
    const eventLine = lines.find((line) => line.startsWith("event:"))
    const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart())
    const id = idLine?.slice(3).trim() ?? ""
    const event = eventLine?.slice(6).trim() ?? ""
    if (!event.startsWith("generation.") || !eventIdIsValid(id, generationRef) || dataLines.length === 0) return null
    let parsed: unknown
    try { parsed = JSON.parse(dataLines.join("\n")) as unknown } catch { return null }
    const projected = projectMoriResponse("generation_event", parsed, requestId)
    if (projected === null) return null
    output.push(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(projected)}\n\n`)
  }
  return Buffer.from(output.join(""))
}
