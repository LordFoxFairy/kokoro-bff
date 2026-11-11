import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { after } from "node:test"

const directory = await mkdtemp(path.join(tmpdir(), "bff-iam-fixture-"))
after(async () => {
  await rm(directory, { recursive: true, force: true })
})
export const TEST_IAM_USER_CONTEXT_SECRET = "fixture-bff-user-context-service-credential"
export const TEST_IAM_ACCOUNT_SESSIONS_SECRET = "fixture-bff-account-sessions-service-credential"
/** Each explicit tenant gets its own receiver credential file; no production defaults. */
export async function fixtureIamCredentials(tenant: string) {
  const userContextFile = path.join(directory, `${encodeURIComponent(tenant)}-user.json`)
  const accountSessionsFile = path.join(directory, `${encodeURIComponent(tenant)}-account.json`)
  for (const [file, surface, secret] of [
    [userContextFile, "bff_user_context", TEST_IAM_USER_CONTEXT_SECRET],
    [accountSessionsFile, "account_sessions", TEST_IAM_ACCOUNT_SESSIONS_SECRET],
  ]) {
    await writeFile(file!, JSON.stringify({ version: 1, entries: [{ credential_id: "fixture", caller: "kokoro-bff", surface, tenant_id: tenant, secret }] }), {
      mode: 0o600,
    })
  }
  return { iamUserContextServiceCredentialFile: userContextFile, iamAccountSessionsServiceCredentialFile: accountSessionsFile }
}
