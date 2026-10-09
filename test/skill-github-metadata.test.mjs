import assert from "node:assert/strict"
import test from "node:test"
const parse = async (value) => (await import("../src/infrastructure/clients/github-skill-metadata.ts")).githubSkillMetadata(Buffer.from(value))
test("GitHub metadata comes from actual multiline quoted Unicode frontmatter without guessed examples/categories", async () => {
  assert.deepEqual(
    await parse(
      '---\nname: "技能: One"\ndescription: |\n  First line\n  Second line\ntags: [research]\nexample_prompts:\n  - "Prompt one"\n  - "Prompt one"\n---\n# Actual body',
    ),
    { display_name: "技能: One", summary: "First line\nSecond line\n", tags: ["research"], example_prompts: ["Prompt one", "Prompt one"] },
  )
  const value = await parse('---\nname: One\ndescription: "actual"\n---\n')
  assert.deepEqual(value, { display_name: "One", summary: "actual", tags: [] })
  assert.equal(Object.hasOwn(value, "example_prompts"), false)
  assert.equal(Object.hasOwn(value, "category_keys"), false)
})
test("GitHub metadata rejects duplicates, unsafe YAML tags, cycles, deep, oversized and malformed UTF8", async () => {
  const { githubSkillMetadata } = await import("../src/infrastructure/clients/github-skill-metadata.ts")
  for (const value of [
    "# No frontmatter",
    "---\nname: One\n---\n",
    "---\nname: One\nname: Two\ndescription: test\n---\n",
    "---\nname: !custom One\ndescription: test\n---\n",
    "---\nname: One\ndescription: test\nextra: &a [*a]\n---\n",
    "---\nname: One\ndescription: test\nextra: " + "[".repeat(40) + "x" + "]".repeat(40) + "\n---\n",
    "---\nname: One\ndescription: " + "x".repeat(65537) + "\n---\n",
    "---\nname: One\ndescription: test\nexample_prompts: null\n---\n",
  ])
    assert.throws(() => githubSkillMetadata(Buffer.from(value)))
  assert.throws(() => githubSkillMetadata(Buffer.from([0xff, 0xfe])))
})

test("GitHub preview rejects provider identity bounds before resolving any URL", async () => {
  const { parseSkillProductInput } = await import("../src/http/skill-product-input.ts")
  for (const repository_url of [`https://github.com/${"a".repeat(40)}/repo`, `https://github.com/owner/${"r".repeat(101)}`, "https://github.com/owner/.."])
    assert.throws(() => parseSkillProductInput("github", Buffer.from(JSON.stringify({ repository_url }))))
})
