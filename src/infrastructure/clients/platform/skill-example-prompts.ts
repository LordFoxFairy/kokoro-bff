const invalid = (): never => {
  throw new Error("skill_example_prompts_invalid")
}

function scalarLength(value: string): number {
  let scalars = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (!(low >= 0xdc00 && low <= 0xdfff)) return invalid()
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return invalid()
    scalars += 1
  }
  return scalars
}

export function parseSkillExamplePrompts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10) return invalid()
  let bytes = 0
  const prompts = Array.from(value, (prompt) => {
    if (typeof prompt !== "string" || prompt.includes("\u0000") || prompt.trim().length === 0) return invalid()
    const scalars = scalarLength(prompt)
    if (scalars < 1 || scalars > 1000) return invalid()
    bytes += Buffer.byteLength(prompt, "utf8")
    if (bytes > 16_384) return invalid()
    return prompt
  })
  return prompts
}
