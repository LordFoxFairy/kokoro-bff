import { createHash } from "node:crypto"
const hash = (value) => createHash("sha256").update(value).digest("hex")
const column =
  "  -- MESSAGE-FINAL-ANSWER-COLUMN-BEGIN\n  final_segment_id TEXT CONSTRAINT ck_bff_message_final_answer CHECK (\n    final_segment_id IS NULL OR (\n      length(btrim(final_segment_id)) > 0 AND role='assistant' AND status='completed'\n      AND run_id IS NOT NULL AND ordered_parts IS NOT NULL\n      AND parts_format_version IS NOT NULL AND parts_format_version=1\n      AND parts_public_sequence IS NOT NULL AND parts_public_sequence>0\n    )\n  ),\n  -- MESSAGE-FINAL-ANSWER-COLUMN-END\n"
export function withoutFinalAnswerColumn(table) {
  if (!table.includes("MESSAGE-FINAL-ANSWER-COLUMN-BEGIN")) return table
  if (hash(table) !== "fc2007dd117a46eea4d59869ec9e458ee856ed23c1cab236fbd5553436508b98") throw Error("invalid_schema")
  const prior = table.replace(column, "")
  if (hash(prior) !== "b798b18ac37cbafdfb18538927c51073ac8c7d4ec338e0a752c19be6c1c437ad") throw Error("invalid_schema")
  return prior
}
export function messageFinalAnswerDefinitions(schema) {
  const current = schema.match(/^CREATE TABLE IF NOT EXISTS bff_message \([\s\S]*?^\);/mu)?.[0]
  if (!current || !current.includes("MESSAGE-FINAL-ANSWER-COLUMN-BEGIN")) throw Error("invalid_schema")
  const prior = withoutFinalAnswerColumn(current)
  const declaration = column.split("\n").slice(1, -2).join("\n").trim().replace(/,$/u, "")
  return {
    current,
    prior,
    alter: "ALTER TABLE kokoro_bff.bff_message ADD COLUMN " + declaration,
  }
}

export function restoreFinalAnswerSchema(schema) {
  if (!schema.includes("MESSAGE-FINAL-ANSWER-COLUMN-BEGIN")) return schema
  if (hash(schema) !== "8444edf810bba34c55a10d3ea56a266be605898f269327b16e4f51b713039043") throw Error("Final answer complete SQL child drift")
  const definitions = messageFinalAnswerDefinitions(schema)
  const parent = schema.replace(definitions.current, () => definitions.prior)
  if (hash(parent) !== "ec40849678906cfce9f1c53fc7279ebb705481b78827ce02c463dd7c11dae0bb") throw Error("Final answer complete SQL parent drift")
  return parent
}
