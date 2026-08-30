import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const repoRoot = path.join(__dirname, "../..")
const read = (p: string) => readFileSync(path.join(repoRoot, p), "utf8")
const crossModelKeys = [
  "cross_model_review_mode",
  "cross_model_peer",
  "cross_model_model",
  "cross_model_effort",
]

function crossModelConfigSection(content: string): string {
  const start = content.indexOf("**Cross-model review config has one user-global fallback.")
  const end = content.indexOf("**Cross-model egress policy", start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return content.slice(start, end)
}

// `cross_model_review_mode: off` is a resolved-config egress gate for the review
// skills' automatic cross-model pass. It must be evaluated before peer
// resolution or any dispatch, in both consumers, and be documented wherever
// ordinary CE config keys are documented.
describe("cross_model_review_mode egress gate", () => {
  const references = [
    "skills/ce-code-review/references/cross-model-review.md",
    "skills/ce-doc-review/references/cross-model-review.md",
  ]

  for (const ref of references) {
    test(`${ref} gates the automatic pass on cross_model_review_mode before peer resolution`, () => {
      const content = read(ref)
      const gate = content.indexOf("**Cross-model egress policy")
      const resolution = content.indexOf("Resolve the preference in this order")
      expect(gate).toBeGreaterThan(-1)
      expect(resolution).toBeGreaterThan(-1)
      expect(gate).toBeLessThan(resolution)
      // Only these two values are valid; the default keeps today's behavior.
      expect(content).toMatch(/`auto` \(default\)/)
      // The skip is a distinct, named reason -- not folded into "unavailable" --
      // both at the gate and where the fold-in step writes Coverage.
      expect(content).toContain("disabled by config")
      expect(content).toContain('"cross-model pass: disabled by config"')
      // A live conversation opt-in still overrides the resolved config value.
      expect(content).toMatch(/explicitly ask(s|ed) for a cross-model peer/)
    })

    test(`${ref} falls through available repo config to user-global values for every cross-model key`, () => {
      const section = crossModelConfigSection(read(ref))
      expect(section).toContain(
        "For `cross_model_review_mode`, `cross_model_peer`, `cross_model_model`, and `cross_model_effort` only",
      )

      const local = section.indexOf("config.local.yaml")
      const global = section.indexOf("$HOME/.compound-engineering/config.yaml")
      expect(local, "repo-local config must be considered first").toBeGreaterThanOrEqual(0)
      expect(global, "user-global config must be considered before defaults").toBeGreaterThan(local)
      expect(section.slice(local, global), "tracked config must follow the local override").toContain("config.yaml")
      expect(section).toContain("When a repository root resolves")
      expect(section).toContain("otherwise skip both repo layers")
      expect(section).toContain("only when the user's home directory resolves; otherwise skip that layer")
      expect(section).toMatch(/first active valid scalar/i)
      expect(section).toContain("Missing files and empty, commented, or invalid values continue")
      expect(section).toContain("next available layer, then the skill default")
      expect(section).toContain("This exception does not apply to other ordinary keys or to `docs_root`.")
    })
  }

  test("both consumers carry the same cross-model config contract", () => {
    expect(crossModelConfigSection(read(references[0]))).toBe(crossModelConfigSection(read(references[1])))
  })

  test("both SKILL.md files wire the gate into their cross-model step", () => {
    for (const p of ["skills/ce-code-review/SKILL.md", "skills/ce-doc-review/SKILL.md"]) {
      expect(read(p)).toContain("cross_model_review_mode")
    }
  })

  test("ce-code-review body treats missing peer keys as the default auto route", () => {
    const body = read("skills/ce-code-review/SKILL.md")
    expect(body).toContain("skip and target-selection keys")
    expect(body).toContain("default auto route")
    expect(body).toContain("Another skill's engine preference is not this gate")
    expect(body).toContain("Model and effort overrides stay with the bound target")
  })

  test("config surfaces document the user-global fallback as four-key cross-model-only", () => {
    const template = "skills/ce-setup/references/config-template.yaml"
    const example = ".compound-engineering/config.example.yaml"
    const configSurfaces = [
      template,
      example,
      "docs/guides/configuration.md",
      "docs/guides/ce-code-review.md",
      "docs/guides/ce-doc-review.md",
    ]
    for (const p of configSurfaces) {
      const content = read(p)
      expect(content, `${p} must name the user-global fallback`).toContain("$HOME/.compound-engineering/config.yaml")
      for (const key of crossModelKeys) {
        expect(content, `${p} must scope the fallback to ${key}`).toContain(key)
      }
      expect(content, `${p} must exclude other CE keys from the user-global fallback`).toMatch(
        /no other CE key|all other keys are repo-scoped/i,
      )
    }
    expect(read(example)).toBe(read(template))

    expect(read(template)).toMatch(
      /# cross_model_review_mode: off\s+# auto \| off \(default: auto\)/,
    )
  })
})
