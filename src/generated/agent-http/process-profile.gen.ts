// This file is generated from the fixed kokoro-agent ChatTodo and ChatActivity schemas. Do not edit.
export const AGENT_PROCESS_CONSTRAINTS = {
  display: {
    skill: {
      type: "object",
      required: ["source_ref", "name", "virtual_path"],
      properties: {
        source_ref: {
          type: "string",
          minLength: 7,
          maxLength: 197,
          pattern: "^skill:(?!skill:)[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])",
        },
        name: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          "x-kokoro-utf8-byte-limit": 480,
          "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",
        },
        virtual_path: {
          type: "string",
          minLength: 1,
          maxLength: 4096,
          "x-kokoro-utf8-byte-limit": 4096,
          "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",
          description: "Validated absolute virtual backend path; never a host path, URL, secret or unproven raw argument.",
        },
        revision: {
          type: "string",
          pattern: "^[1-9][0-9]{0,18}(?![\\s\\S])",
          "x-kokoro-int64-decimal": true,
        },
      },
      additionalProperties: false,
      "x-kokoro-binding":
        "virtual_path must equal /.skills/{base64url(ASCII source_ref suffix)}/SKILL.md; revision only from this Run exact ResolvedSkill, absent if unproven",
    },
    read: {
      type: "object",
      required: ["run_id", "display_skills", "tool_paths", "tool_facts", "activity_details"],
      properties: {
        run_id: {
          type: "string",
          minLength: 1,
        },
        display_skills: {
          type: "array",
          maxItems: 16,
          items: {
            $ref: "#/components/schemas/SkillDisplay",
          },
          "x-kokoro-unique-by": "source_ref",
          "x-kokoro-binding": "unique source_ref subset of original ready source_refs; no current catalog lookup",
        },
        tool_paths: {
          type: "array",
          maxItems: 128,
          "x-kokoro-unique-by": "activity_id",
          items: {
            type: "object",
            required: ["activity_id", "virtual_path"],
            properties: {
              activity_id: {
                type: "string",
                minLength: 68,
                maxLength: 68,
                pattern: "^act_[0-9a-f]{64}(?![\\s\\S])",
              },
              virtual_path: {
                type: "string",
                minLength: 1,
                maxLength: 4096,
                "x-kokoro-utf8-byte-limit": 4096,
                "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",
                description: "Validated absolute virtual backend path; never a host path, URL, secret or unproven raw argument.",
              },
            },
            additionalProperties: false,
          },
        },
        tool_facts: {
          type: "array",
          maxItems: 128,
          "x-kokoro-unique-by": "activity_id",
          items: {
            type: "object",
            required: ["activity_id"],
            properties: {
              activity_id: {
                type: "string",
                minLength: 68,
                maxLength: 68,
                pattern: "^act_[0-9a-f]{64}(?![\\s\\S])",
              },
              display_detail: {
                type: "object",
                required: ["kind", "name"],
                properties: {
                  kind: {
                    type: "string",
                    enum: ["mcp_tool"],
                  },
                  name: {
                    type: "string",
                    minLength: 1,
                    maxLength: 120,
                    "x-kokoro-utf8-byte-limit": 480,
                    "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",
                  },
                },
                additionalProperties: false,
              },
              status: {
                type: "string",
                enum: ["failed"],
              },
            },
            anyOf: [
              {
                required: ["display_detail"],
              },
              {
                required: ["status"],
              },
            ],
            additionalProperties: false,
          },
          description:
            "Read-only exact original MCP activity facts: safe public names witnessed by successful same-Run calls, or independently proved failed journal outcomes. No source event or Run status mutation.",
        },
        activity_details: {
          type: "array",
          maxItems: 128,
          "x-kokoro-unique-by": "activity_id",
          items: {
            type: "object",
            required: ["activity_id", "tool_name"],
            properties: {
              activity_id: {
                type: "string",
                minLength: 68,
                maxLength: 68,
                pattern: "^act_[0-9a-f]{64}(?![\\s\\S])",
              },
              tool_name: {
                type: "string",
                minLength: 1,
                maxLength: 120,
                "x-kokoro-utf8-byte-limit": 480,
                "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",
              },
              target: {
                type: "object",
                required: ["kind", "name"],
                properties: {
                  kind: {
                    type: "string",
                    enum: ["file", "mcp_tool"],
                  },
                  name: {
                    type: "string",
                    minLength: 1,
                    maxLength: 120,
                    "x-kokoro-utf8-byte-limit": 480,
                    "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",
                  },
                  virtual_path: {
                    type: "string",
                    minLength: 1,
                    maxLength: 4096,
                    "x-kokoro-utf8-byte-limit": 4096,
                    "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",
                    description: "Validated absolute virtual backend path; never a host path, URL, secret or unproven raw argument.",
                  },
                },
                additionalProperties: false,
                allOf: [
                  {
                    if: {
                      properties: {
                        kind: {
                          const: "file",
                        },
                      },
                    },
                    then: {
                      properties: {
                        name: {
                          pattern: "^(?!\\.{1,2}$)[^/\\\\:]+$",
                        },
                      },
                    },
                  },
                  {
                    if: {
                      properties: {
                        kind: {
                          const: "mcp_tool",
                        },
                      },
                    },
                    then: {
                      not: {
                        required: ["virtual_path"],
                      },
                    },
                  },
                ],
              },
              input_preview: {
                type: "object",
                required: ["text", "truncated", "redacted"],
                properties: {
                  text: {
                    type: "string",
                    minLength: 1,
                    maxLength: 2048,
                    "x-kokoro-utf8-byte-limit": 2048,
                  },
                  truncated: {
                    type: "boolean",
                  },
                  redacted: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              output_preview: {
                type: "object",
                required: ["text", "truncated", "redacted"],
                properties: {
                  text: {
                    type: "string",
                    minLength: 1,
                    maxLength: 4096,
                    "x-kokoro-utf8-byte-limit": 4096,
                  },
                  truncated: {
                    type: "boolean",
                  },
                  redacted: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
          description:
            "Private same-Run evidence-bound tool details only; missing fields remain unknown. Filtered bounded text is not a universal secret-free guarantee. Never Share, execution authority, HTML, autolinks or instructions.",
        },
      },
      additionalProperties: false,
      description:
        "Recovered safe display facts only. Missing facts remain unknown; source events and execution authority are unchanged. No completeness assertion.",
    },
    activitySkill: {
      type: "array",
      maxItems: 16,
      items: {
        $ref: "#/components/schemas/SkillDisplay",
      },
      "x-kokoro-unique-by": "source_ref",
      "x-kokoro-binding": "unique source_ref subset of original ready source_refs; no current catalog lookup",
    },
    virtualPath: {
      type: "string",
      minLength: 1,
      maxLength: 4096,
      "x-kokoro-utf8-byte-limit": 4096,
      "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",
      description: "Validated absolute virtual backend path; never a host path, URL, secret or unproven raw argument.",
    },
  },
  toolDetail: {
    minScalars: 1,
    maxScalars: 120,
    utf8ByteLimit: 480,
    fileNamePattern: "^(?!\\.{1,2}$)[^/\\\\:]+$",
    normalization: "NFC",
    forbiddenCategories: ["Cc", "Cf", "Cs"],
    codesByKind: {
      file: ["tool.file.read", "tool.file.write", "tool.file.deliver"],
      mcp_tool: ["tool.mcp.describe", "tool.mcp.call"],
    },
  },
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
