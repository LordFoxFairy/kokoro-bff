import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import type { BffConfig } from "../../config/runtime.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { skillHandoffResultSchema } from "../../infrastructure/clients/platform/skill-product-schema.js"
import { importSkillBytes, resumeGithubSkillImport } from "./skill-ai-import.js"
import type { RequestContext } from "../../domain/request-context.js"
import { GithubSkillImportClient } from "../../infrastructure/clients/github-skill-import.js"
import { parseSkillProductInput } from "../skill-product-input.js"
import { readSkillBody as readBody } from "./skill-drafts.js"
import { send } from "../response.js"
import { runSkillRoute, skillCommandId } from "./skill-drafts.js"

/** URL-only browser input resolves only through the fixed public GitHub provider. */
export async function skillGithubPreviewRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  readmit: (signal: AbortSignal) => Promise<void>,
) {
  await runSkillRoute(request, response, context, async (signal) => {
    if (
      new URL(request.url!, "http://bff.local").search ||
      request.headers["idempotency-key"] !== undefined ||
      request.headers["content-type"]?.split(";", 1)[0] !== "application/json"
    )
      throw new ConnectError("GitHub preview input invalid", Code.InvalidArgument)
    const input = parseSkillProductInput("github", await readBody(request, 65_536))
    const result = await new GithubSkillImportClient().preview(input, signal)
    await readmit(signal)
    signal.throwIfAborted()
    send(response, 200, {
      data: result.selection_required
        ? result
        : {
            selection_required: false,
            selector: result.selector,
            metadata: result.metadata,
            repository: result.repository,
            content_sha256: result.contentSha256,
            size_bytes: String(result.bytes.length),
          },
    })
  })
}

/** A real durable draft is created before package PUT; the GitHub asset is absent, not manufactured. */
export async function skillGithubImportRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  config: BffConfig,
  store: BffBusinessStore | null,
  client: SkillProductConnectClient | null,
  readmit: (signal: AbortSignal) => Promise<void>,
) {
  await runSkillRoute(request, response, context, async (signal, deadlineAt) => {
    if (new URL(request.url!, "http://bff.local").search || request.headers["content-type"]?.split(";", 1)[0] !== "application/json")
      throw new ConnectError("GitHub import input invalid", Code.InvalidArgument)
    const commandId = skillCommandId(request, context, "github-import"),
      input = parseSkillProductInput("githubImport", await readBody(request, 65_536))
    if (!store || !client || !config.storage?.objectOrigin) throw new ConnectError("GitHub import dependency missing", Code.Unavailable)
    let result = await resumeGithubSkillImport(context, commandId, input, client, store, config.storage.objectOrigin, signal, deadlineAt, readmit)
    if (result === undefined) {
      const source = await new GithubSkillImportClient().fetch(input, signal)
      await readmit(signal)
      signal.throwIfAborted()
      result = await importSkillBytes(
        context,
        commandId,
        source.bytes,
        source.metadata,
        {
          github: {
            ...source.repository,
            content_sha256: source.contentSha256,
            size_bytes: String(source.bytes.length),
            mime_type: "application/zip",
          },
        },
        client,
        store,
        config.storage.objectOrigin,
        signal,
        deadlineAt,
      )
    }
    signal.throwIfAborted()
    const parsed = skillHandoffResultSchema.safeParse(result)
    if (!parsed.success) throw new Error("skill_response_invalid")
    send(response, 201, { data: parsed.data })
  })
}
