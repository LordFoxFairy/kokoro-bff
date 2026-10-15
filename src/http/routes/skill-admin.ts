import { IamPublisherProfileClient } from "../../infrastructure/clients/iam-publisher-profile.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { JsonValue } from "@bufbuild/protobuf"
import { z } from "zod"
import { ConnectError, Code } from "@connectrpc/connect"
import type { RequestContext } from "../../domain/request-context.js"
import type { SkillAdminConnectClient, SkillAdminCommand } from "../../infrastructure/clients/platform/skill-admin-connect.js"
import { projectSkillProductAck, projectSkillProductRecord, assertSkillWireKnown } from "../../infrastructure/clients/platform/skill-product-response.js"
import { skillIdSchema, parseSkillProductInput } from "../skill-product-input.js"
import { skillCategoryKeysSchema } from "../../infrastructure/clients/platform/skill-product-schema.js"
import { runSkillRoute, assertSkillReadRequest, skillCommandId, skillMetadataWire } from "./skill-drafts.js"
import { readSkillBody as readBody } from "./skill-drafts.js"
import { send } from "../response.js"

const operations = {
  versions: ["createAdminSkillVersion", "adminVersion"],
  publish: ["publishOfficialSkill", "officialPublish"],
  withdraw: ["withdrawAdminSkill", "discard"],
  quarantine: ["quarantineSkill", "discard"],
  restore: ["restoreSkill", "discard"],
  audience: ["setAdminSkillPublicationAudience", "audience"],
  discard: ["discardAdminSkillDraft", "discard"],
} as const
const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    status: z.enum(["draft", "active", "withdrawn", "quarantined", "disabled", "discarded"]).optional(),
    source_kind: z.enum(["personal", "official", "third_party"]).optional(),
    category_key: skillCategoryKeysSchema.element.optional(),
    query: z.string().min(1).max(1024).optional(),
  })
  .strict()
export async function skillAdminRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  path: string[],
  client: SkillAdminConnectClient | null,
  iamBaseUrl?: string | null,
) {
  await runSkillRoute(request, response, context, async (signal, deadlineAt) => {
    if (!client) throw new ConnectError("Skills admin dependency missing", Code.Unavailable)
    const enrich = <T>(value: T) =>
      new IamPublisherProfileClient(iamBaseUrl ?? "", 5000).enrich(
        context.identity.namespace,
        /^Bearer ([^\s,]+)$/iu.exec(request.headers.authorization ?? "")?.[1] ?? "",
        context.requestId,
        value,
        signal,
      )
    const common = { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId }
    if (request.method === "GET") {
      if (path.length === 2) {
        const query = querySchema.parse(Object.fromEntries(assertSkillReadRequest(request, Object.keys(querySchema.shape))))
        const status =
          query.status === undefined ? undefined : ["", "draft", "active", "withdrawn", "quarantined", "disabled", "discarded"].indexOf(query.status)
        const { limit, cursor, ...filters } = query
        const result = await client.list(
          common,
          {
            ...filters,
            ...(status === undefined ? {} : { status }),
            page: { ...(limit === undefined ? {} : { limit }), ...(cursor === undefined ? {} : { cursor }) },
          } as Record<string, JsonValue>,
          signal,
          deadlineAt,
        )
        assertSkillWireKnown(result)
        if (result.skills.length > (limit ?? 50) || !result.page || (result.page.nextCursor !== undefined && result.page.nextCursor.length > 2048))
          throw new Error("skill_response_invalid")
        signal.throwIfAborted()
        send(response, 200, {
          data: await enrich({ skills: result.skills.map((skill) => projectSkillProductRecord(skill)), next_cursor: result.page.nextCursor ?? null }),
        })
      } else {
        assertSkillReadRequest(request)
        const skillId = skillIdSchema.parse(path[2])
        const result = await client.get({ ...common, skillId }, signal, deadlineAt)
        signal.throwIfAborted()
        send(response, 200, { data: await enrich(projectSkillProductRecord(result.skill, skillId)) })
      }
      return
    }
    if (
      request.method !== "POST" ||
      new URL(request.url!, "http://bff.local").search ||
      request.headers["content-type"]?.split(";", 1)[0] !== "application/json"
    )
      throw new ConnectError("Skills admin route invalid", Code.InvalidArgument)
    if (path.length === 2) {
      const commandId = skillCommandId(request, context, "createAdminSkillDraft")
      const input = parseSkillProductInput("adminDraft", await readBody(request, 65_536))
      const result = await client.command(
        "createAdminSkillDraft",
        { ...common, commandId },
        { metadata: skillMetadataWire(input.metadata) },
        signal,
        deadlineAt,
      )
      signal.throwIfAborted()
      send(response, 201, { data: await enrich(projectSkillProductAck(result)) })
      return
    }
    if (path.length !== 4 || !Object.hasOwn(operations, path[3]!)) throw new ConnectError("Skills admin route invalid", Code.InvalidArgument)
    const operation = operations[path[3] as keyof typeof operations]
    const skillId = skillIdSchema.parse(path[2]),
      commandId = skillCommandId(request, context, operation[0])
    const input = parseSkillProductInput(operation[1], await readBody(request, 65_536))
    const members = { ...input, skill_id: { value: skillId }, ...("metadata" in input ? { metadata: skillMetadataWire(input.metadata) } : {}) } as Record<
      string,
      JsonValue
    >
    const result = await client.command(operation[0] as SkillAdminCommand, { ...common, commandId }, members, signal, deadlineAt)
    signal.throwIfAborted()
    send(response, operation[0] === "createAdminSkillVersion" ? 201 : 200, {
      data: await enrich(projectSkillProductAck(result, operation[0] === "createAdminSkillVersion" ? undefined : skillId)),
    })
  })
}
