/**
 * No live application code may write a legacy `trade_stage` value.
 *
 * ── Why this is a source scan and not a behaviour test ────────────────────
 *
 * A stage literal in an `.insert({ ... })` payload is a plain string. Nothing
 * type-checks it, so narrowing `IdeaStage` to four values told TypeScript
 * nothing about a dozen creation paths that were still writing `'idea'`,
 * `'aware'`, `'discussing'`, `'deep_research'` and `'ready_for_decision'`.
 * They were found by grep, and grep is therefore what keeps them gone.
 *
 * The stakes: every one of these throws the moment the contract migration
 * removes the legacy labels from the enum. Before then they are silently
 * accepted, so nothing surfaces the problem until the irreversible step.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 *
 * PERSISTED writes only. These are deliberately NOT failures:
 *
 *   * `status:` — `trade_queue_status` is a different enum that still has
 *     `idea`, `discussing`, `simulating` and `deciding` as valid labels. The
 *     two share four spellings, which is exactly how these got missed.
 *   * view models in the decision engine (`proposalAwaiting`,
 *     `executionNotConfirmed`) and `useDecisionAccountability`, which build
 *     card objects, never rows — one of them uses `stage: 'approved'`, which
 *     was never a `trade_stage` value at all.
 *   * React Query cache objects.
 *   * legacy values inside `LEGACY_STAGE_MAP` and the migration, which exist
 *     precisely to read the old vocabulary.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { INITIAL_STAGE, FINAL_STAGE, IDEA_STAGES, LEGACY_STAGE_MAP } from '../stage-model'

const SRC = join(process.cwd(), 'src')

const LEGACY = Object.keys(LEGACY_STAGE_MAP)

/**
 * Files allowed to contain a legacy stage literal, with the reason.
 * Anything not listed here must be clean.
 */
const ALLOWED: Record<string, string> = {
  'lib/ideas/stage-model.ts': 'defines LEGACY_STAGE_MAP — it IS the legacy vocabulary',
  'lib/trade-status-semantics.ts': 're-exports the deprecated aliases',
  'engine/decisionEngine/evaluators/proposalAwaiting.ts': 'card view model, not a row',
  'engine/decisionEngine/evaluators/executionNotConfirmed.ts': 'card view model, not a row',
  'hooks/useDecisionAccountability.ts': 'in-memory ledger row, stage is not persisted',
  'lib/dashboard/dashboardIntelligence.ts': 'a display union, not a column',
  'pages/SimulationPage.tsx': 'React Query cache object + explanatory comments',
  'hooks/useDesktopIdeas.ts': 'comment describing historical behaviour',
  'lib/services/trade-lab-service.ts': 'comment describing the removed write',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Matches a `stage:` property assigned a quoted literal. Deliberately narrow:
 * it will not match `status:`, which is the sibling enum that legitimately
 * keeps these spellings.
 */
const STAGE_ASSIGNMENT = /(?<!_)\bstage:\s*['"`]([a-z_]+)['"`]/g

describe('no live writer emits a legacy trade_stage value', () => {
  const files = walk(SRC)

  it('scans a meaningful number of files', () => {
    // Guards the guard: a broken walk would make every assertion below pass
    // by examining nothing.
    expect(files.length).toBeGreaterThan(500)
  })

  it('finds no legacy stage literal outside the allowed list', () => {
    const offenders: string[] = []

    for (const file of files) {
      const rel = relative(SRC, file).replace(/\\/g, '/')
      if (ALLOWED[rel]) continue

      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(STAGE_ASSIGNMENT)) {
        if (LEGACY.includes(m[1])) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${rel}:${line} -> stage: '${m[1]}'`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('every allowed file is still present, so the list cannot rot', () => {
    // An entry naming a file that no longer exists is a stale exemption, and
    // a stale exemption is how a real writer sneaks back in under its name.
    for (const rel of Object.keys(ALLOWED)) {
      expect(() => statSync(join(SRC, rel))).not.toThrow()
    }
  })
})

describe('the constants the writers use', () => {
  it('starts new ideas at the front of the pipeline', () => {
    expect(INITIAL_STAGE).toBe('exploring')
    expect(IDEA_STAGES[0]).toBe(INITIAL_STAGE)
  })

  it('puts Trade Lab ad-hoc ideas at the end', () => {
    // An idea created straight from Execute is mature by construction — it
    // exists because somebody is executing it.
    expect(FINAL_STAGE).toBe('ready_to_recommend')
    expect(IDEA_STAGES[IDEA_STAGES.length - 1]).toBe(FINAL_STAGE)
  })

  it('neither constant is a legacy value', () => {
    expect(LEGACY).not.toContain(INITIAL_STAGE)
    expect(LEGACY).not.toContain(FINAL_STAGE)
  })
})

describe('onboarding seeds a board with more than one maturity', () => {
  it('uses canonical stages and at least two distinct ones', () => {
    // The point of the sample ideas is to show a pipeline in use. All three
    // landing in one column would make the seeded board look broken — and
    // mapping them by rote (discussing -> developing, deep_research ->
    // developing) collapses two of them, so this checks the result rather
    // than the mapping.
    const src = readFileSync(join(SRC, 'components/onboarding/ClientOnboardingWizard.tsx'), 'utf8')
    const block = src.slice(src.indexOf('const sampleIdeas'), src.indexOf('for (const idea of sampleIdeas)'))

    const stages = [...block.matchAll(/stage:\s*'([a-z_]+)'/g)].map((m) => m[1])
    expect(stages.length).toBeGreaterThanOrEqual(3)
    for (const s of stages) expect(IDEA_STAGES as readonly string[]).toContain(s)
    expect(new Set(stages).size).toBeGreaterThanOrEqual(2)
  })
})
