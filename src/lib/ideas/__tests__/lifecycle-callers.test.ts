/**
 * The surfaces agree, and keep agreeing.
 *
 * The lifecycle rules being right is only half of it. Two ways to get the old
 * behaviour back without touching `lifecycle.ts` at all:
 *
 *   1. A query judges rows without embedding the evidence. `hasGenuineUserWork`
 *      then reads every idea as unworked — silently, looking exactly like a
 *      correct empty result. This is the failure mode of the bug that was
 *      fixed, reintroduced from a different file.
 *
 *   2. A badge counts a population nobody filtered. Trade Lab's did: it summed
 *      ideas and proposals, over a list that deliberately keeps committed rows
 *      so a partly-committed pair can render all its legs.
 *
 * Neither is visible in a render, so these read source.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const pipeline = src('hooks/usePipelineItems.ts')
const lab = src('pages/SimulationPage.tsx')
const capture = src('components/thoughts/QuickTradeIdeaCapture.tsx')
const thoughts = src('components/communication/ThoughtsSection.tsx')
const seedVisibility = src('lib/pilot/seed-visibility.ts')
const lifecycle = src('lib/ideas/lifecycle.ts')

describe('every surface that judges rows also fetches the evidence', () => {
  /**
   * The interpolation, not the import.
   *
   * Asserting the bare identifier passes on the `import` line alone, so it
   * survived deleting the embed from the query — which is the entire failure
   * this is meant to catch. Only `${IDEA_EVIDENCE_SELECT}` inside a template
   * means the columns are actually requested.
   */
  const EMBEDDED = /\$\{IDEA_EVIDENCE_SELECT\}/

  it('the Idea Pipeline embeds it', () => {
    expect(pipeline).toContain('judgeIdeaRow')
    expect(pipeline).toMatch(EMBEDDED)
  })

  it('Trade Lab embeds it', () => {
    expect(lab).toContain('judgeIdeaRow')
    expect(lab).toMatch(EMBEDDED)
  })

  /**
   * Stated as a rule rather than a list: any file calling `judgeIdeaRow` is
   * judging rows, so it must have asked for what the judgement reads. A file
   * that judges without the evidence reads every idea as unworked, silently.
   */
  /**
   * The right-hand pane's "in the pipeline" count. It was a `head: true`
   * count with its own status list — missing `archived` and `cancelled`, no
   * drawer filter, no pilot rule — and it read 5 for a graduated reader whose
   * pipeline held one idea, because it counted four untouched tour seeds.
   */
  it('the capture pane count embeds it', () => {
    expect(thoughts).toContain('judgeIdeaRow')
    expect(thoughts).toMatch(EMBEDDED)
    expect(thoughts).toContain('operationalAfterPilot')
    // Not a head count any more: the evidence has to come back as rows.
    expect(thoughts).not.toContain("{ count: 'exact', head: true }")
    // And not its own vocabulary.
    expect(thoughts).not.toContain('"approved","rejected","executed","deleted"')
  })

  it('and nothing judges without it', () => {
    const judges = [
      'hooks/usePipelineItems.ts',
      'pages/SimulationPage.tsx',
      'components/communication/ThoughtsSection.tsx',
    ]
    for (const f of judges) {
      const text = src(f)
      if (!text.includes('judgeIdeaRow(')) continue
      expect(text, `${f} judges rows without embedding evidence`).toMatch(EMBEDDED)
    }
  })
})

describe('the seed rule reads artifacts, not mirror columns', () => {
  it('delegates to hasGenuineUserWork', () => {
    const fn = seedVisibility.slice(seedVisibility.indexOf('export function judgeIdeaRow'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain('hasGenuineUserWork(row)')
    // The three columns that are NULL on every production row must not be the
    // rule any more.
    expect(body).not.toContain('row.decided_at')
    expect(body).not.toContain('row.decision_outcome')
    expect(body).not.toContain('row.outcome')
  })
})

describe('the lifecycle module does not fork the vocabulary', () => {
  /**
   * There were already seven hand-written copies of the terminal-status list
   * when this was written. An eighth is the disease, not the cure — so the
   * liveness rules are re-exported from `trade-status-semantics`, never
   * restated.
   */
  it('re-exports liveness rather than redefining it', () => {
    expect(lifecycle).toContain("from '../trade-status-semantics'")
    expect(lifecycle).not.toMatch(/export const TERMINAL_IDEA_STATUSES/)
    expect(lifecycle).not.toMatch(/export function isLiveIdea\s*\(/)
    expect(lifecycle).not.toMatch(/export function isTerminalIdea\s*\(/)
  })

  it('and reuses the decision vocabulary too', () => {
    expect(lifecycle).toContain("from '../decisions/outcome-eligibility'")
    expect(lifecycle).toContain('hasRecordedDecision')
  })
})

describe('the Trade Lab badge counts live ideas, and only ideas', () => {
  it('no longer sums two object types under one number', () => {
    expect(lab).not.toContain('filteredItems.proposals.length + filteredItems.ideas.length')
  })

  it('counts the live subset, not the render list', () => {
    expect(lab).toContain('filteredItems.liveIdeas.length')
    // `ideas` keeps committed rows on purpose, for pair-leg rendering.
    expect(lab).toContain('const liveIdeas = filteredIdeas.filter')
    expect(lab).toContain('isLiveIdea(item.idea as any)')
  })

  it('surfaces recommendations as their own count', () => {
    expect(lab).toMatch(/rec\{filteredItems\.proposals\.length === 1 \? '' : 's'\}/)
  })
})

describe('capture separates a live duplicate from history', () => {
  /*
   * These two assertions used to pin `isLiveIdea` here verbatim. That was the
   * right fix at the time and is now the wrong one: liveness is ONE clause of
   * the active-work question, and pinning it would forbid the stronger
   * predicate that replaced it. See `active-work.test.ts` — the split now
   * also retires pilot seeds and parked ideas, which `isLiveIdea` calls live.
   */
  it('splits the asset query rather than warning about everything active', () => {
    expect(capture).toMatch(/live: rows\.filter\(isActive\)/)
    expect(capture).toMatch(/historical: rows\.filter\(r => !isActive\(r\)\)/)
    expect(capture).toContain('isActiveIdeaWork')
  })

  /** Shown only when nothing live exists, so there is never a double panel. */
  it('shows history only in the absence of a live idea', () => {
    expect(capture).toContain('existingIdeasForAsset.length === 0 && historicalIdeasForAsset.length > 0')
    expect(capture).toContain('Prior ')
  })

  it('still lets the reader open the old idea, and still lets them proceed', () => {
    const panel = capture.slice(capture.indexOf('Prior {selectedAsset.symbol} activity'))
    expect(panel.slice(0, 1600)).toContain('openExistingIdea(idea.id)')
    // Nothing in the historical branch disables submission.
    expect(panel.slice(0, 1600)).not.toContain('disabled')
  })

  /**
   * The dropdown badge had the same fault, twice over.
   *
   * First it read `visibility_tier` alone; liveness fixed that. Then liveness
   * alone turned out to be the same shape of error one clause further on — it
   * badged four retired pilot seeds the Ideas Pipeline does not show. The
   * three byte-identical copies this used to count are now one shared
   * fetcher, which is why the assertion is about the fetcher, not a count:
   * three copies of a filter is what let them drift in the first place.
   */
  it('badges from the canonical active-work predicate, through one fetcher', () => {
    expect([...capture.matchAll(/filter\(r => isLiveIdea\(r as never\)\)/g)]).toHaveLength(0)
    expect(capture).toContain('async function fetchActiveAssetIds')
    expect(capture).toContain('activeIdeaWork(data as unknown as ActiveWorkRow[], { hasGraduated })')
    // All three dropdowns reach it: single name, pair long, pair short.
    expect([...capture.matchAll(/fetchActiveAssetIds\(/g)].length).toBeGreaterThanOrEqual(4)
  })
})
