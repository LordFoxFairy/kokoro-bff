import type { IncomingMessage, ServerResponse } from "node:http"

import { failure, ok } from "../../contracts/index.js"
import { MoriMockBffStore } from "../../adapters/mori.js"
import { moriExportInput, moriGenerationInput, moriPageInput, moriProjectInput, moriSongPlanInput } from "../../modules/mori/input.js"
import { reply } from "../response.js"
import { headerString, queryOf, type Context } from "../request.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"

export async function mockMoriBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[],
  context: Context,
  mori: MoriMockBffStore,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
  json: Record<string, unknown>,
): Promise<boolean> {
  if (segments[0] !== "mori") return false
  const method = request.method || "GET"

  if (segments.length === 2 && segments[1] === "projects" && method === "GET") {
    const pagination = moriPageInput(request)
    const projects = pagination === null ? null : mori.listProjectsPage(pagination.cursor, pagination.limit)
    if (pagination === null) await reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId), context, idempotency, mutation)
    else if (projects === null) await reply(response, 400, failure("invalid_cursor", "cursor is invalid", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok({ projects: projects.items, next_cursor: projects.next_cursor }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 2 && segments[1] === "projects" && method === "POST") {
    const input = moriProjectInput(json)
    if (input === null) await reply(response, 400, failure("invalid_project", "Project input does not match the Mori contract", context.requestId), context, idempotency, mutation)
    else await reply(response, 201, ok(mori.createProject(input.title, input.description), context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 3 && segments[1] === "projects" && method === "GET") {
    const project = mori.findProject(segments[2] || "")
    if (project === undefined) await reply(response, 404, failure("project_not_found", "Mori project was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok(project, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "projects" && segments[3] === "song_plans" && method === "POST") {
    const projectRef = segments[2] || ""
    if (mori.findProject(projectRef) === undefined) {
      await reply(response, 404, failure("project_not_found", "Mori project was not found", context.requestId), context, idempotency, mutation)
      return true
    }
    const input = moriSongPlanInput(json)
    if (input === null) await reply(response, 400, failure("invalid_song_plan", "Song Plan input does not match the Mori contract", context.requestId), context, idempotency, mutation)
    else await reply(response, 201, ok(mori.createSongPlan(projectRef, input), context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "projects" && segments[3] === "generations" && method === "POST") {
    const projectRef = segments[2] || ""
    if (mori.findProject(projectRef) === undefined) {
      await reply(response, 404, failure("project_not_found", "Mori project was not found", context.requestId), context, idempotency, mutation)
      return true
    }
    const input = moriGenerationInput(json)
    if (input === null) {
      await reply(response, 400, failure("invalid_generation", "Generation input does not match the Mori contract", context.requestId), context, idempotency, mutation)
      return true
    }
    const generation = mori.createGeneration(projectRef, input)
    await reply(response, 202, ok({ generation_ref: generation.generation_ref, status: generation.status }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 3 && segments[1] === "generations" && method === "GET") {
    const generation = mori.findGeneration(segments[2] || "")
    if (generation === undefined) await reply(response, 404, failure("generation_not_found", "Mori generation was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok(generation, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "generations" && segments[3] === "cancel" && method === "POST") {
    const generation = mori.cancelGeneration(segments[2] || "")
    if (generation === null) await reply(response, 404, failure("generation_not_found", "Mori generation was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 202, ok({ generation_ref: generation.generation_ref, status: generation.status }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "generations" && segments[3] === "events" && method === "GET") {
    const generationRef = segments[2] || ""
    const lastEventId = headerString(request.headers["last-event-id"]).trim() || null
    const result = mori.eventsSince(generationRef, lastEventId)
    if (result === null) {
      await reply(response, 404, failure("generation_not_found", "Mori generation was not found", context.requestId), context, idempotency, mutation)
      return true
    }
    if (result.invalid) {
      await reply(response, 400, failure("invalid_event_cursor", "Last-Event-ID is invalid", context.requestId), context, idempotency, mutation)
      return true
    }
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    })
    const body = result.events.length === 0
      ? ": keep-alive\n\n"
      : result.events.map((event) => `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(ok(event.data, context.requestId))}\n\n`).join("")
    response.end(body)
    return true
  }

  if (segments.length === 4 && segments[1] === "projects" && segments[3] === "candidates" && method === "GET") {
    const projectRef = segments[2] || ""
    if (mori.findProject(projectRef) === undefined) {
      await reply(response, 404, failure("project_not_found", "Mori project was not found", context.requestId), context, idempotency, mutation)
      return true
    }
    const pagination = moriPageInput(request)
    const candidates = pagination === null ? null : mori.listCandidates(projectRef, pagination.cursor, pagination.limit)
    if (pagination === null) await reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId), context, idempotency, mutation)
    else if (candidates === null) await reply(response, 400, failure("invalid_cursor", "cursor is invalid", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok({ candidates: candidates.items, next_cursor: candidates.next_cursor }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "candidates" && segments[3] === "promote" && method === "POST") {
    const version = mori.promoteCandidate(segments[2] || "")
    if (version === null) await reply(response, 404, failure("candidate_not_found", "Mori candidate was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 201, ok({
      version_ref: version.version_ref,
      project_ref: version.project_ref,
      source_candidate_ref: version.source_candidate_ref,
      status: version.status,
    }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "versions" && segments[3] === "remix" && method === "POST") {
    const version = mori.findVersion(segments[2] || "")
    const sourceInput = version === undefined ? null : mori.generationInputForVersion(version.version_ref)
    if (version === undefined || sourceInput === null) {
      await reply(response, 404, failure("version_not_found", "Mori version was not found", context.requestId), context, idempotency, mutation)
      return true
    }
    const input = Object.keys(json).length === 0 ? sourceInput : moriGenerationInput(json)
    if (input === null) await reply(response, 400, failure("invalid_generation", "Remix input does not match the Mori contract", context.requestId), context, idempotency, mutation)
    else {
      const generation = mori.createGeneration(version.project_ref, input)
      await reply(response, 202, ok({ generation_ref: generation.generation_ref, status: generation.status }, context.requestId), context, idempotency, mutation)
    }
    return true
  }

  if (segments.length === 2 && segments[1] === "library" && method === "GET") {
    const kind = queryOf(request).get("kind")?.trim() || "all"
    if (kind !== "all" && kind !== "version") {
      await reply(response, 400, failure("invalid_library_kind", "kind must be all or version", context.requestId), context, idempotency, mutation)
      return true
    }
    const pagination = moriPageInput(request)
    const library = pagination === null ? null : mori.listLibrary(kind, pagination.cursor, pagination.limit)
    if (pagination === null) await reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId), context, idempotency, mutation)
    else if (library === null) await reply(response, 400, failure("invalid_cursor", "cursor is invalid", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok({ items: library.items, next_cursor: library.next_cursor }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "versions" && segments[3] === "exports" && method === "POST") {
    const format = moriExportInput(json)
    if (format === null) {
      await reply(response, 400, failure("invalid_export", "Export format must be mp3 or wav", context.requestId), context, idempotency, mutation)
      return true
    }
    const exportRecord = mori.createExport(segments[2] || "", format)
    if (exportRecord === null) await reply(response, 404, failure("version_not_found", "Mori version was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 202, ok({ export_ref: exportRecord.export_ref, status: exportRecord.status }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 3 && segments[1] === "exports" && method === "GET") {
    const exportRecord = mori.findExport(segments[2] || "")
    if (exportRecord === undefined) await reply(response, 404, failure("export_not_found", "Mori export was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok(exportRecord, context.requestId), context, idempotency, mutation)
    return true
  }

  await reply(response, 404, failure("mori_route_not_found", "Mori business route was not found", context.requestId), context, idempotency, mutation)
  return true
}
