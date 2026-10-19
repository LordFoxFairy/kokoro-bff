import { Code, ConnectError } from "@connectrpc/connect";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { BffServerComposition } from "../../bootstrap/runtime.js";
import type { AdmittedUserRequestContext } from "../../domain/request-context.js";
import type {
  CustomApiInput,
  CustomApiOperation,
} from "../../infrastructure/clients/platform/custom-api-binding.js";
import { send } from "../response.js";
import { connectorCommandFault } from "../../infrastructure/clients/platform/connector-command-fault.js";

const profileId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const version = z.string().regex(/^[1-9][0-9]{0,15}$/u);
const envName = z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/u);
const secret = z
  .string()
  .refine(
    (value) =>
      Buffer.byteLength(value, "utf8") >= 1 &&
      Buffer.byteLength(value, "utf8") <= 4096 &&
      !/[\0\r\n]/u.test(value),
  );
const write = z.object({ name: envName, value: secret }).strict();
const createInput = z
  .object({
    name: z.string().min(1).max(400),
    instructions: z.string().min(1).max(4000).optional(),
    environment: z.array(write).max(128),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !value.name.trim() ||
      (value.instructions !== undefined && !value.instructions.trim()) ||
      new Set(value.environment.map((entry) => entry.name)).size !==
        value.environment.length
    )
      context.addIssue({ code: "custom", message: "invalid" });
  });
const updateInput = z
  .object({
    expected_state_version: version,
    name: z.string().min(1).max(400).optional(),
    instructions: z.string().min(1).max(4000).optional(),
    clear_instructions: z.boolean().optional(),
    environment_upserts: z.array(write).max(128).optional(),
    environment_removals: z.array(envName).max(128).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.name !== undefined && !value.name.trim()) ||
      (value.instructions !== undefined && !value.instructions.trim()) ||
      (value.instructions !== undefined && value.clear_instructions) ||
      (value.name === undefined &&
        value.instructions === undefined &&
        !value.clear_instructions &&
        !value.environment_upserts?.length &&
        !value.environment_removals?.length) ||
      new Set(value.environment_upserts?.map((entry) => entry.name)).size !==
        (value.environment_upserts?.length ?? 0) ||
      new Set(value.environment_removals ?? []).size !==
        (value.environment_removals?.length ?? 0) ||
      value.environment_removals?.some((name) =>
        value.environment_upserts?.some((entry) => entry.name === name),
      )
    )
      context.addIssue({ code: "custom", message: "invalid" });
  });
const removeInput = z.object({ expected_state_version: version }).strict();
const contentType = /^application\/json(?:;\s*charset=utf-8)?$/iu;
const idempotency = /^[\x21-\x7e]{1,191}$/u;

export function customApiOperation(
  path: string[],
  method: string,
): CustomApiOperation | null {
  if (path[0] !== "connectors" || path[1] !== "custom-apis") return null;
  if (path.length === 2 && method === "POST") return "create";
  if (path.length === 2 && method === "GET") return "list";
  if (path.length === 3 && method === "GET") return "get";
  if (path.length === 3 && method === "PATCH") return "update";
  if (path.length === 3 && method === "DELETE") return "remove";
  return null;
}
function failure(
  response: ServerResponse,
  status: number,
  code: string,
  retryable = false,
): void {
  if (!response.destroyed && !response.writableEnded)
    send(response, status, {
      error: { code, message: "Custom API request failed", retryable },
    });
}
function commandId(request: IncomingMessage): string | null {
  const names = request.rawHeaders.filter(
    (_, index) =>
      index % 2 === 0 &&
      request.rawHeaders[index]?.toLowerCase() === "idempotency-key",
  );
  const value = request.headers["idempotency-key"];
  return names.length === 1 &&
    typeof value === "string" &&
    idempotency.test(value)
    ? value
    : null;
}
async function body(
  request: IncomingMessage,
  signal: AbortSignal,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of request) {
    signal.throwIfAborted();
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.byteLength;
    if (size > 128 * 1024) throw new Error("custom_api_body_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  );
}
function ownerFault(
  error: unknown,
  operation: CustomApiOperation,
): { status: number; code: string; retryable: boolean } | null {
  const receipt = connectorCommandFault(error, "custom_api", operation !== "list" && operation !== "get");
  if (receipt) return receipt;
  if (!(error instanceof ConnectError)) return null;
  if (error.code === Code.InvalidArgument)
    return {
      status: 400,
      code: "invalid_custom_api_request",
      retryable: false,
    };
  if (
    error.code === Code.NotFound &&
    operation !== "create" &&
    operation !== "list"
  )
    return { status: 404, code: "custom_api_not_found", retryable: false };
  if (error.code === Code.AlreadyExists)
    return { status: 409, code: "custom_api_conflict", retryable: false };
  if (error.code === Code.FailedPrecondition)
    return {
      status: 412,
      code: "custom_api_precondition_failed",
      retryable: false,
    };
  if (error.code === Code.Aborted)
    return {
      status: 409,
      code: "custom_api_command_in_progress",
      retryable: true,
    };
  return null;
}
export async function customApiRoute(
  request: IncomingMessage,
  response: ServerResponse,
  composition: BffServerComposition,
  context: AdmittedUserRequestContext,
  requestId: string,
  path: string[],
): Promise<void> {
  const operation = customApiOperation(path, request.method ?? "GET")!;
  const mutation =
    operation === "create" || operation === "update" || operation === "remove";
  const url = new URL(request.url ?? "", "http://bff.invalid");
  const allowed = operation === "list" ? ["limit", "cursor"] : [];
  if (
    url.pathname !== `/browser/v1/${path.map(encodeURIComponent).join("/")}` ||
    url.hash ||
    [...url.searchParams.keys()].some(
      (key) =>
        !allowed.includes(key) || url.searchParams.getAll(key).length !== 1,
    ) ||
    (path.length === 3 && !profileId.safeParse(path[2]).success) ||
    (!mutation &&
      [
        "content-length",
        "content-type",
        "transfer-encoding",
        "idempotency-key",
      ].some((key) => request.headers[key] !== undefined)) ||
    (mutation &&
      (request.headers["transfer-encoding"] !== undefined ||
        !contentType.test(String(request.headers["content-type"] ?? "")) ||
        commandId(request) === null))
  ) {
    failure(response, 400, "invalid_custom_api_request");
    return;
  }
  if (
    operation === "list" &&
    ((url.searchParams.has("limit") &&
      !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(url.searchParams.get("limit")!)) ||
      (url.searchParams.has("cursor") &&
        !/^[A-Za-z0-9_-]{1,2048}$/u.test(url.searchParams.get("cursor")!)))
  ) {
    failure(response, 400, "invalid_custom_api_request");
    return;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once("aborted", abort);
  response.once("close", abort);
  const deadlineAt = performance.now() + 10_000;
  const timer = setTimeout(abort, 10_000);
  try {
    const input: CustomApiInput = {
      requestId,
      tenant: context.identity.namespace,
      subject: context.identity.userId,
      ...(path.length === 3 ? { profileId: path[2]! } : {}),
      ...(url.searchParams.has("limit")
        ? { limit: Number(url.searchParams.get("limit")) }
        : {}),
      ...(url.searchParams.has("cursor")
        ? { cursor: url.searchParams.get("cursor")! }
        : {}),
    };
    if (mutation) {
      const length = request.headers["content-length"];
      if (
        typeof length !== "string" ||
        !/^(?:0|[1-9][0-9]*)$/u.test(length) ||
        Number(length) > 128 * 1024
      )
        throw new Error("invalid_custom_api_request");
      const raw = await body(request, controller.signal);
      Object.assign(input, { commandId: commandId(request)! });
      if (operation === "create") {
        const parsed = createInput.parse(raw);
        Object.assign(input, {
          name: parsed.name,
          ...(parsed.instructions === undefined
            ? {}
            : { instructions: parsed.instructions }),
          environment: parsed.environment,
        });
      } else if (operation === "update") {
        const parsed = updateInput.parse(raw);
        Object.assign(input, {
          expectedStateVersion: parsed.expected_state_version,
          ...(parsed.name === undefined ? {} : { name: parsed.name }),
          ...(parsed.instructions === undefined
            ? {}
            : { instructions: parsed.instructions }),
          ...(parsed.clear_instructions === undefined
            ? {}
            : { clearInstructions: parsed.clear_instructions }),
          environmentUpserts: parsed.environment_upserts ?? [],
          environmentRemovals: parsed.environment_removals ?? [],
        });
      } else {
        const parsed = removeInput.parse(raw);
        Object.assign(input, {
          expectedStateVersion: parsed.expected_state_version,
        });
      }
    }
    const client = composition.customApiClient;
    if (client === null) {
      failure(response, 503, "custom_api_dependency_unavailable", true);
      return;
    }
    const result = await client.execute(
      operation,
      input,
      controller.signal,
      deadlineAt,
    );
    controller.signal.throwIfAborted();
    send(response, operation === "create" ? 201 : 200, { data: result });
  } catch (error) {
    const mapped = ownerFault(error, operation);
    const code =
      error instanceof Error
        ? error.message
        : "custom_api_dependency_unavailable";
    if (mapped) failure(response, mapped.status, mapped.code, mapped.retryable);
    else
      failure(
        response,
        code === "custom_api_body_too_large"
          ? 413
          : code === "invalid_custom_api_request" ||
              error instanceof z.ZodError ||
              error instanceof SyntaxError
            ? 400
            : 503,
        code === "custom_api_body_too_large"
          ? code
          : code === "invalid_custom_api_request" ||
              error instanceof z.ZodError ||
              error instanceof SyntaxError
            ? "invalid_custom_api_request"
            : "custom_api_dependency_unavailable",
        !(
          error instanceof z.ZodError ||
          error instanceof SyntaxError ||
          code === "invalid_custom_api_request" ||
          code === "custom_api_body_too_large"
        ),
      );
  } finally {
    clearTimeout(timer);
    request.removeListener("aborted", abort);
    response.removeListener("close", abort);
  }
}
