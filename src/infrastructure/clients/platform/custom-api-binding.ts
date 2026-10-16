import { sha256Jcs } from "./jcs.js";

export type CustomApiOperation =
  "create" | "get" | "list" | "update" | "remove";
export type CustomApiEnvironmentWrite = Readonly<{
  name: string;
  value: string;
}>;
export type CustomApiInput = Readonly<{
  requestId: string;
  tenant: string;
  subject: string;
  profileId?: string;
  commandId?: string;
  expectedStateVersion?: string;
  name?: string;
  instructions?: string;
  clearInstructions?: boolean;
  environment?: readonly CustomApiEnvironmentWrite[];
  environmentUpserts?: readonly CustomApiEnvironmentWrite[];
  environmentRemovals?: readonly string[];
  limit?: number;
  cursor?: string;
}>;
const method = {
  create: "CreatePersonalCustomApi",
  get: "GetPersonalCustomApi",
  list: "ListPersonalCustomApis",
  update: "UpdatePersonalCustomApi",
  remove: "DeletePersonalCustomApi",
} as const;
export function bindCustomApiCommand(
  operation: Extract<CustomApiOperation, "create" | "update" | "remove">,
  input: CustomApiInput,
) {
  const fields =
    operation === "create"
      ? {
          name: input.name!,
          instructions: input.instructions ?? null,
          environment: (input.environment ?? [])
            .map(({ name }) => name)
            .sort((a, b) => a.localeCompare(b)),
        }
      : operation === "update"
        ? {
            profile_id: input.profileId!,
            expected_state_version: input.expectedStateVersion!,
            name: input.name ?? null,
            instructions: input.instructions ?? null,
            clear_instructions: input.clearInstructions ?? false,
            environment_upserts: (input.environmentUpserts ?? [])
            .map(({ name }) => name)
            .sort((a, b) => a.localeCompare(b)),
            environment_removals: [...(input.environmentRemovals ?? [])].sort(),
          }
        : {
            profile_id: input.profileId!,
            expected_state_version: input.expectedStateVersion!,
          };
  return {
    commandId: input.commandId!,
    requestDigest: sha256Jcs({
      method: `kokoro.platform.v1.ProductCustomApiService/${method[operation]}`,
      tenant_id: input.tenant,
      subject_id: input.subject,
      input: fields,
    }).sha256,
  };
}
