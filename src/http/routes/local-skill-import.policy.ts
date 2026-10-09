export const LOCAL_SKILL_IMPORT_POLICY = Object.freeze({
  visibility: "browser-private",
  version: 1,
  paths: [
    "POST /browser/v1/skills/local-imports",
    "POST /browser/v1/skills/local-imports/{intent_id}/complete",
    "POST /browser/v1/skills/local-imports/{intent_id}/finalize",
    "GET /browser/v1/skills/local-imports/{intent_id}",
  ],
})
