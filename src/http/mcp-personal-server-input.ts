import { z } from "zod"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import type { McpPersonalServerFields, McpPersonalServerMutation } from "../infrastructure/clients/platform/mcp-personal-server-binding.js"

const invalidUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
const bytes = (value: string): number => Buffer.byteLength(value, "utf8")
const boundedText = (min: number, max: number, lineBreaks = false) =>
  z.string().refine((value) => {
    if (invalidUnicode.test(value) || bytes(value) < min || bytes(value) > max) return false
    return lineBreaks
      ? ![...value].some((character) => {
          const code = character.charCodeAt(0)
          return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
        })
      : !/[\0\r\n]/u.test(value)
  })
const displayName = boundedText(1, 100).refine((value) => Boolean(value.trim()))
const notes = boundedText(1, 4000, true)
const serverUrl = boundedText(1, 255).refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.hash === "" && url.toString() === value
  } catch {
    return false
  }
})
const stateVersion = z
  .string()
  .regex(/^[1-9][0-9]{0,9}(?![\s\S])/u)
  .refine((value) => BigInt(value) <= 2_147_483_647n)
const forbiddenHeaders = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "proxy-connection",
  "forwarded",
  "traceparent",
  "tracestate",
  "baggage",
  "transfer-encoding",
])
const headerName = z
  .string()
  .transform((value) => value.toLowerCase())
  .refine(
    (value) =>
      /^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/u.test(value) &&
      !forbiddenHeaders.has(value) &&
      !["proxy-", "sec-", "x-kokoro-", "x-forwarded-"].some((prefix) => value.startsWith(prefix)),
  )
const header = z.object({ name: headerName, value: boundedText(1, 4096) }).strict()
const headerWrites = z
  .array(header)
  .max(32)
  .refine((values) => new Set(values.map(({ name }) => name)).size === values.length)
  .refine((values) => values.reduce((total, value) => total + bytes(value.value), 0) <= 32_768)
const headerRemovals = z
  .array(headerName)
  .max(32)
  .refine((values) => new Set(values).size === values.length)
const oauthClient = z.object({ client_id: boundedText(1, 1024), client_secret: boundedText(1, 4096) }).strict()

const register = z
  .object({
    display_name: displayName,
    server_url: serverUrl,
    notes: notes.optional(),
    headers: headerWrites.optional(),
    oauth_client: oauthClient.optional(),
  })
  .strict()
const prepare = z.object({ expected_state_version: stateVersion }).strict()
const update = z
  .object({
    expected_state_version: stateVersion,
    display_name: displayName.optional(),
    notes: notes.optional(),
    clear_notes: z.boolean().optional(),
    server_url: serverUrl.optional(),
    header_upserts: headerWrites.optional(),
    header_removals: headerRemovals.optional(),
    oauth_client: oauthClient.optional(),
    revoke_oauth_client: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.notes !== undefined && value.clear_notes === true) context.addIssue({ code: "custom", message: "notes conflict" })
    if (value.oauth_client !== undefined && value.revoke_oauth_client === true) context.addIssue({ code: "custom", message: "OAuth client conflict" })
    const upserts = new Set((value.header_upserts ?? []).map(({ name }) => name))
    if ((value.header_removals ?? []).some((name) => upserts.has(name))) context.addIssue({ code: "custom", message: "header change conflict" })
    if (
      value.display_name === undefined &&
      value.notes === undefined &&
      value.clear_notes !== true &&
      value.server_url === undefined &&
      (value.header_upserts?.length ?? 0) === 0 &&
      (value.header_removals?.length ?? 0) === 0 &&
      value.oauth_client === undefined &&
      value.revoke_oauth_client !== true
    )
      context.addIssue({ code: "custom", message: "empty update" })
  })

/** Parses the exact browser-private URL MCP mutation shapes; secret values are only forwarded to Platform. */
export function parseMcpPersonalServer(operation: McpPersonalServerMutation, body: Uint8Array): McpPersonalServerFields {
  if (body.byteLength > 65_536) throw new Error("mcp_personal_body_too_large")
  try {
    const raw = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(body))
    if (operation === "registerServer") {
      const value = register.parse(raw)
      return {
        displayName: value.display_name,
        serverUrl: value.server_url,
        ...(value.notes === undefined ? {} : { notes: value.notes }),
        headers: value.headers ?? [],
        ...(value.oauth_client === undefined
          ? {}
          : { oauthClient: { clientId: value.oauth_client.client_id, clientSecret: value.oauth_client.client_secret } }),
      }
    }
    if (operation === "prepareServer" || operation === "deleteServer") return { expectedStateVersion: prepare.parse(raw).expected_state_version }
    const value = update.parse(raw)
    return {
      expectedStateVersion: value.expected_state_version,
      ...(value.display_name === undefined ? {} : { displayName: value.display_name }),
      ...(value.notes === undefined ? {} : { notes: value.notes }),
      clearNotes: value.clear_notes ?? false,
      ...(value.server_url === undefined ? {} : { serverUrl: value.server_url }),
      headerUpserts: value.header_upserts ?? [],
      headerRemovals: value.header_removals ?? [],
      ...(value.oauth_client === undefined ? {} : { oauthClient: { clientId: value.oauth_client.client_id, clientSecret: value.oauth_client.client_secret } }),
      revokeOauthClient: value.revoke_oauth_client ?? false,
    }
  } catch {
    throw new Error("invalid_mcp_personal_request")
  }
}
