import { iamUserContextHeaders } from "../../auth/iam-user-context.js"
import { isDeepStrictEqual } from "node:util"
import { createClient } from "../../generated/iam-http/client/client.gen.js"
import { resolveSkillListPublisherProfiles, resolveTenantPublisherProfiles } from "../../generated/iam-http/sdk.gen.js"
import {
  zResolveSkillListPublisherProfilesBody,
  zResolveSkillListPublisherProfilesResponse,
  zResolveTenantPublisherProfilesBody,
  zResolveTenantPublisherProfilesResponse,
} from "../../generated/iam-http/zod.gen.js"
import { strictParseRawJson } from "../raw-json.js"

// Reuse the pinned IAM component; callers must preserve raw-vs-parsed exactness.
export const skillPublisherProfileSchema = zResolveTenantPublisherProfilesResponse.shape.data.shape.items.element
export type SkillPublisherProfile = import("zod").infer<typeof skillPublisherProfileSchema>

/** One fresh bounded IAM batch per product page; no display-name inference or cache. */
export class IamPublisherProfileClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly credentialFile: string | null = null,
  ) {}
  async resolvePublic(
    tenant: string,
    token: string,
    requestId: string,
    refs: ReadonlyArray<{ kind: "user" | "organization"; id: string }>,
    signal: AbortSignal,
  ) {
    return this.resolveProfiles(tenant, { kind: "public", token }, requestId, refs, signal)
  }
  async resolve(tenant: string, subjectId: string, requestId: string, refs: ReadonlyArray<{ kind: "user" | "organization"; id: string }>, signal: AbortSignal) {
    return this.resolveProfiles(tenant, { kind: "private", subjectId }, requestId, refs, signal)
  }
  private async resolveProfiles(
    tenant: string,
    identity: { kind: "public"; token: string } | { kind: "private"; subjectId: string },
    requestId: string,
    refs: ReadonlyArray<{ kind: "user" | "organization"; id: string }>,
    signal: AbortSignal,
  ) {
    const publicList = identity.kind === "public"
    const requested = [...new Map(refs.map((ref) => [JSON.stringify([ref.kind, ref.id]), ref])).values()]
    if (requested.length === 0) return new Map()
    const body = (publicList ? zResolveSkillListPublisherProfilesBody : zResolveTenantPublisherProfilesBody).strict().parse({ refs: requested })
    const client = createClient({
      baseUrl: this.baseUrl,
      fetch: async (input, init) => {
        const response = await fetch(input, { ...init, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) })
        if (
          response.status !== 200 ||
          response.headers.has("set-cookie") ||
          response.headers.has("location") ||
          response.headers.get("x-request-id") !== requestId ||
          response.headers.get("cache-control") !== "no-store" ||
          response.headers.get("content-type")?.split(";", 1)[0] !== "application/json" ||
          !response.body
        ) {
          await response.body?.cancel()
          throw new Error("publisher_profile_unavailable")
        }
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = []
        let bytes = 0
        try {
          for (;;) {
            const part = await reader.read()
            if (part.done) break
            bytes += part.value.byteLength
            if (bytes > 262_144) throw new Error("publisher_profile_response_invalid")
            chunks.push(part.value)
          }
        } finally {
          void reader.cancel().catch(() => undefined)
          reader.releaseLock()
        }
        const raw = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))
        const parsed = (publicList ? zResolveSkillListPublisherProfilesResponse : zResolveTenantPublisherProfilesResponse).strict().parse(raw)
        if (!isDeepStrictEqual(parsed, JSON.parse(JSON.stringify(raw)))) throw new Error("publisher_profile_response_invalid")
        return new Response(JSON.stringify(parsed), { status: 200, headers: response.headers })
      },
    })
    const authentication =
      identity.kind === "public"
        ? { authorization: `Bearer ${identity.token}` }
        : await iamUserContextHeaders({ tenantId: tenant, subjectId: identity.subjectId, requestId, signal, credentialFile: this.credentialFile })
    const options = { client, throwOnError: true as const, body, headers: { ...authentication, "x-request-id": requestId }, signal }
    const response = publicList
      ? await resolveSkillListPublisherProfiles(options)
      : await resolveTenantPublisherProfiles({ ...options, path: { tenant_id: tenant } })
    if (!response.data) throw new Error("publisher_profile_unavailable")
    const result = new Map(response.data.data.items.map((item) => [JSON.stringify([item.kind, item.id]), item]))
    if (
      response.data.data.items.length !== requested.length ||
      result.size !== requested.length ||
      requested.some((ref) => !result.has(JSON.stringify([ref.kind, ref.id])))
    )
      throw new Error("publisher_profile_response_invalid")
    signal.throwIfAborted()
    return result
  }
  async enrich<T>(tenant: string, subjectId: string, requestId: string, value: T, signal: AbortSignal): Promise<T> {
    const refs: { kind: "user" | "organization"; id: string }[] = []
    const collect = (item: unknown): void => {
      if (typeof item !== "object" || item === null) return
      if (Array.isArray(item)) {
        item.forEach(collect)
        return
      }
      const record = item as Record<string, unknown>
      const publisher = (record.product as { publisher?: { kind?: unknown; iam?: { kind?: unknown; id?: unknown } } } | undefined)?.publisher
      if (publisher?.kind === "iam" && publisher.iam && ["user", "organization"].includes(publisher.iam.kind as string) && typeof publisher.iam.id === "string")
        refs.push(publisher.iam as { kind: "user" | "organization"; id: string })
      Object.values(record).forEach(collect)
    }
    collect(value)
    const profiles = await this.resolve(tenant, subjectId, requestId, refs, signal)
    const attach = (item: unknown): unknown => {
      if (typeof item !== "object" || item === null) return item
      if (Array.isArray(item)) return item.map(attach)
      const record = item as Record<string, unknown>,
        result = Object.fromEntries(Object.entries(record).map(([key, child]) => [key, attach(child)]))
      const publisher = (record.product as { publisher?: { kind?: unknown; iam?: { kind?: unknown; id?: unknown } } } | undefined)?.publisher
      if (publisher?.kind === "iam" && publisher.iam) {
        const profile = profiles.get(JSON.stringify([publisher.iam.kind, publisher.iam.id]))
        if (!profile) throw new Error("publisher_profile_response_invalid")
        result.publisher_profile = profile
      }
      return result
    }
    signal.throwIfAborted()
    return attach(value) as T
  }
}
