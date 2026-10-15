import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const version = z.string().regex(/^[1-9][0-9]{0,15}$/u);
const date = z.string().datetime({ offset: true });
const environment = z
  .object({
    name: z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/u),
    configured: z.boolean(),
    state_version: version,
    status: z.literal("active"),
  })
  .strict();
const profile = z
  .object({
    profile_id: identifier,
    name: z.string().min(1).max(400),
    instructions: z.string().min(1).max(4000).optional(),
    state_version: version,
    created_at: date,
    updated_at: date,
    environment: z.array(environment).max(128),
  })
  .strict();
const page = z
  .object({
    next_cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,2048}$/u)
      .nullable(),
  })
  .strict();
export const customApiPublic = {
  profile,
  create: z.object({ custom_api: profile, replayed: z.boolean() }).strict(),
  get: z.object({ custom_api: profile }).strict(),
  list: z.object({ items: z.array(profile).max(100), page }).strict(),
  update: z.object({ custom_api: profile, replayed: z.boolean() }).strict(),
  remove: z
    .object({
      profile_id: identifier,
      deleted: z.literal(true),
      replayed: z.boolean(),
    })
    .strict(),
};
function timestamp(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const item = value as { seconds?: unknown; nanos?: unknown };
  if (
    typeof item.seconds !== "bigint" ||
    typeof item.nanos !== "number" ||
    item.nanos < 0 ||
    item.nanos > 999_999_999
  )
    throw new Error("custom_api_response_invalid");
  return new Date(
    Number(item.seconds) * 1000 + Math.floor(item.nanos / 1_000_000),
  ).toISOString();
}
function profileProjection(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null)
    throw new Error("custom_api_response_invalid");
  const value = raw as Record<string, unknown>;
  const profileId = value.profileId as { value?: unknown } | undefined;
  return {
    profile_id: profileId?.value,
    name: value.name,
    ...(value.instructions === undefined
      ? {}
      : { instructions: value.instructions }),
    state_version:
      typeof value.stateVersion === "bigint"
        ? String(value.stateVersion)
        : undefined,
    created_at: timestamp(value.createdAt),
    updated_at: timestamp(value.updatedAt),
    environment: Array.isArray(value.environment)
      ? value.environment.map((entry) => {
          const item = entry as Record<string, unknown>;
          return {
            name: item.name,
            configured: item.configured,
            state_version:
              typeof item.stateVersion === "bigint"
                ? String(item.stateVersion)
                : undefined,
            status: item.status,
          };
        })
      : undefined,
  };
}
export function projectCustomApiResponse(
  operation: import("./custom-api-binding.js").CustomApiOperation,
  raw: unknown,
): unknown {
  if (typeof raw !== "object" || raw === null)
    throw new Error("custom_api_response_invalid");
  const value = raw as Record<string, unknown>;
  if (operation === "list") {
    const result = {
      items: Array.isArray(value.profiles)
        ? value.profiles.map(profileProjection)
        : undefined,
      page: {
        next_cursor:
          (value.page as Record<string, unknown> | undefined)?.nextCursor ??
          null,
      },
    };
    return customApiPublic.list.parse(result);
  }
  if (operation === "remove")
    return customApiPublic.remove.parse({
      profile_id: (value.profileId as { value?: unknown } | undefined)?.value,
      deleted: value.deleted,
      replayed: value.replayed,
    });
  const projected = profileProjection(value.profile);
  return customApiPublic[operation].parse(
    operation === "get"
      ? { custom_api: projected }
      : { custom_api: projected, replayed: value.replayed },
  );
}
