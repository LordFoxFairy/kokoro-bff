// This file is generated from the fixed kokoro-agent ChatTodo and ChatActivity schemas. Do not edit.
export const AGENT_PROCESS_CONSTRAINTS = {
  todo: {
    jsonByteLimit: 65536,
    maxItems: 100,
    content: {
      minScalars: 1,
      maxScalars: 1024,
      pattern: "^[^\\uD800-\\uDFFF]*(?![\\s\\S])",
    },
  },
  activityId: {
    minLength: 68,
    maxLength: 68,
    pattern: "^act_[0-9a-f]{64}(?![\\s\\S])",
  },
  segmentId: {
    minLength: 68,
    maxLength: 68,
    pattern: "^seg_[0-9a-f]{64}(?![\\s\\S])",
  },
  skill: {
    preflightId: {
      minLength: 68,
      maxLength: 68,
      pattern: "^spf_[0-9a-f]{64}(?![\\s\\S])",
    },
    sourceRefs: {
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      jsonByteLimit: 4096,
      minLength: 7,
      maxLength: 197,
      pattern: "^skill:(?!skill:)[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])",
    },
    failedPhase: "failed",
    errorCodes: ["skill_resolve_failed", "skill_load_failed"],
  },
} as const
