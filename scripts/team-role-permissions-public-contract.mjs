// Build/test-only exact Public29.2 role-catalog correction; never used by runtime readers.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"

const hash = (source) => createHash("sha256").update(source).digest("hex")
const parentDigest = "4e4ce620887b1a1a431a9346d0d259aa5bed3bd5af06f4428f11e9054173418e"
const currentDigest = "df5a33d4fa33662e4f70967bf5db60033f71f29511bf5975aa2395d61abb3e9c"
const parent =
  "            skill: { type: array, minItems: 1, items: { type: string, enum: [create_draft, create_version, begin_upload, complete_upload, abort_upload, validate_draft, publish, withdraw, set_status, install, set_installation_enabled, remove_installation, update_draft, discard_draft, set_publication_audience] } }\n"
const current = parent.replace("create_version, begin_upload", "create_version, delete_series, begin_upload")

export function restoreTeamRolePermissionsContract(source) {
  source = restorePersonalContextFailureContract(source)
  if (/^  version: 29\.1\.0$/mu.test(source)) {
    assert.equal(hash(source), parentDigest, "complete committed Public29.1 parent bytes")
    return source
  }
  if (!/^  version: 29\.2\.0$/mu.test(source)) {
    assert.ok(!source.includes("operationId: getSessionShareMetadata"), "unknown Team role permissions release")
    return source
  }
  assert.equal(hash(source), currentDigest, "complete Public29.2 Team role permissions artifact drift")
  assert.equal(source.split(current).length, 2, "exact Team role permissions correction")
  source = source.replace(current, parent).replace(/^  version: 29\.2\.0$/mu, "  version: 29.1.0")
  assert.equal(hash(source), parentDigest, "complete committed Public29.1 parent bytes")
  return source
}

// Build/test-only finite 29.3 addition: both existing public Agent failure sites.
export function restorePersonalContextFailureContract(source) {
  if (!/^  version: 29\.3\.0$/mu.test(source)) return source
  assert.equal(hash(source), "4f27adbea9a63c36d8b11e95c9dde342a6e8d662cab77cb42091384f3b17e333", "complete Public29.3 personal context failure artifact drift")
  const addition = "                - context_window_exceeded\n"
  assert.equal(source.split(addition).length, 3, "exact two public context failure sites")
  const parent = source.replaceAll(addition, "").replace(/^  version: 29\.3\.0$/mu, "  version: 29.2.0")
  assert.equal(hash(parent), currentDigest, "complete committed Public29.2 parent bytes")
  return parent
}
