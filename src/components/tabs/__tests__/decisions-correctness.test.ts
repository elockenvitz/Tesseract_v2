/**
 * Four corrections found by looking at the running Asset Page, not the source.
 *
 * Each had the same shape: the code was self-consistent and wrong, so reading
 * it proved nothing. Three of the four are pinned here against source, because
 * AssetTab needs a live Supabase client, auth and organization context to
 * mount; the fourth is pure and tested directly.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IDEA_STAGES, IDEA_STAGE_CONFIG, toIdeaStage, LEGACY_STAGE_MAP } from '../../../lib/ideas/stage-model'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const TAB      = strip(read('src/components/tabs/AssetTab.tsx'))
const TIMELINE = strip(read('src/components/asset/DecisionTimeline.tsx'))
const INVEST   = strip(read('src/components/ui/InvestmentTimeline.tsx'))

// ───────────────────────────────────────────────── 1. Open Items filters

describe('the idea stage filter uses the canonical pipeline', () => {
  /*
   * The filter moved out of the Open Items header and into the Work
   * navigator when that section was removed. Same options, same model, same
   * normalization boundary — only the place it is rendered changed.
   */
  it('offers All plus the four canonical stages, built from the model', () => {
    expect(TAB).toMatch(/\{ key: 'all', label: 'All' \}/)
    expect(TAB).toMatch(/IDEA_STAGES\.map\(s => \(\{ key: s, label: IDEA_STAGE_CONFIG\[s\]\.label \}\)\)/)
  })

  it('no longer hard-codes the retired v1 vocabulary', () => {
    // These four pills matched nothing a current writer produces.
    for (const dead of ["label: 'Working On'", "label: 'Modeling'", "label: 'Deciding'", "key: 'idea'"]) {
      expect(TAB).not.toContain(dead)
    }
  })

  it('filters through the canonical normalization boundary', () => {
    // Normalizing the ROW is what makes a canonical pill match legacy
    // records: a row stored as 'thesis_forming' answers 'developing'.
    expect(TAB).toMatch(/workIdeas\.filter\(i => toIdeaStage\(i\.stage\) === openItemsFilter\)/)
  })

  it('removes the local two-value normalizer it replaces', () => {
    expect(TAB).not.toMatch(/const normalizeStage/)
    expect(TAB).not.toMatch(/'simulating' \? 'modeling'/)
  })

  it('types the filter state as the canonical stage union', () => {
    expect(TAB).toMatch(/useState<'all' \| IdeaStage>\('all'\)/)
  })
})

describe('every stored stage answers exactly one filter', () => {
  /*
   * The property that makes the pills work for legacy rows: normalizing the
   * ROW maps all ten historical values onto the four pills. Without it a row
   * stored as 'thesis_forming' answered no filter but All — which is what the
   * page did before this change.
   */
  const everyStoredValue = [...IDEA_STAGES, ...Object.keys(LEGACY_STAGE_MAP), 'some_future_stage']

  it.each(everyStoredValue)('%s matches exactly one canonical pill', (stored) => {
    const matches = IDEA_STAGES.filter(pill => toIdeaStage(stored) === pill)
    expect(matches).toHaveLength(1)
  })

  it('maps the legacy values onto the pills a reader would expect', () => {
    expect(toIdeaStage('ready_for_decision')).toBe('ready_to_recommend')
    expect(toIdeaStage('thesis_forming')).toBe('developing')
    expect(toIdeaStage('aware')).toBe('exploring')
    expect(toIdeaStage('simulating')).toBe('developing')
  })

  it('labels each pill from the model, so pill and chip cannot disagree', () => {
    expect(IDEA_STAGES.map(s => IDEA_STAGE_CONFIG[s].label))
      .toEqual(['Exploring', 'Researching', 'Developing', 'Ready to Recommend'])
  })

  it('keeps an empty filtered result distinguishable from an empty asset', () => {
    /*
     * "No ideas at this stage" vs "No active work on this asset" — a filter
     * that silently reads as an empty asset is how a reader concludes there
     * is no work when there is. The statement moved to the navigator with
     * the filter itself.
     */
    /*
     * Rewritten because it was guarding a file the product does not run, and
     * the thing it guarded had in fact broken.
     *
     * This read `WorkNavigator.tsx` for `stageFilter && !items.some(...)`,
     * "No ideas at this stage." and "No active work on this asset.". The
     * navigator stopped being rendered when Work became one navigator, so
     * those three strings proved only that a dead file still contained them.
     *
     * Meanwhile the live surface had the defect in a worse form: the Ideas
     * section was gated on `ideas.length > 0 || investigations.length > 0`,
     * so a stage filter matching nothing hid the section AND the filter
     * chips — the reader could not tell an empty filter from an empty asset,
     * and could not clear the filter, because the control was gone with the
     * rows.
     *
     * The rule is the same rule; it is now asserted about what renders.
     */
    const OVERVIEW = readFileSync(
      join(process.cwd(), 'src/components/asset/work/AssetWorkOverview.tsx'), 'utf8',
    )
    // The section survives an empty filtered result...
    expect(OVERVIEW).toMatch(
      /ideas\.length > 0 \|\| investigations\.length > 0 \|\| ideasFiltered/,
    )
    // ...and says which kind of empty it is.
    expect(OVERVIEW).toMatch(/No ideas at this stage\./)
    expect(OVERVIEW).toContain('work-overview-ideas-filtered-empty')
    // And the filter's owner tells it when a filter is narrowing the list.
    const TAB_SRC = readFileSync(
      join(process.cwd(), 'src/components/tabs/AssetTab.tsx'), 'utf8',
    )
    expect(TAB_SRC).toMatch(/ideasFiltered=\{openItemsFilter !== 'all'\}/)
  })
})

// ───────────────────────────────────────────── 2. Timeline singular/plural

describe('the timeline expand label agrees with its count', () => {
  it('says event when one remains and events otherwise', () => {
    expect(TIMELINE).toMatch(/=== 1 \? 'event' : 'events'/)
  })

  it('no longer hard-codes the plural', () => {
    expect(TIMELINE).not.toMatch(/more events`?\s*\n?\s*<\/button>/)
  })

  it('still expands in place rather than scrolling or paginating', () => {
    // The interaction was reviewed and judged correct; this keeps a later
    // "fix" from turning it into a scroll container.
    expect(TIMELINE).toMatch(/setVisibleCount/)
    expect(TIMELINE).toMatch(/const hasMore = events\.length > visibleCount/)
  })
})

// ─────────────────────────────────────────────── 3. The mislabelled chip

describe('the priority chip says what it sets', () => {
  /*
   * It rendered "Process: None" directly beneath the workflow selector, so
   * the page looked like it carried two process controls. It is the only way
   * to set workflow priority — the duplication was in the label, and removing
   * the control would have removed the capability.
   */
  it('is labelled Priority', () => {
    expect(INVEST).toMatch(/<span>Priority: \{current\.label\}<\/span>/)
  })

  it('no longer claims to be a process control', () => {
    expect(INVEST).not.toMatch(/<span>Process: \{current\.label\}<\/span>/)
  })

  it('still drives the priority handler, so the capability survives', () => {
    const at = INVEST.indexOf('Priority: {current.label}')
    expect(at).toBeGreaterThan(-1)
    expect(INVEST.slice(at, at + 2500)).toMatch(/handleWorkflowPriorityChange/)
  })

  it('leaves process switching alone', () => {
    /*
     * The point of this assertion is that relabelling the priority
     * control did not take process switching with it. It used to name
     * `AssetWorkflowSelectorEnhanced`'s `selectedWorkflowId` prop; that
     * selector is gone and `ProcessSwitcher` carries the capability now,
     * so the assertion names the seam rather than the old component.
     */
    expect(TAB).toMatch(/<ProcessSwitcher/)
    expect(TAB).toMatch(/onSelect=\{handleWorkflowChange\}/)
  })
})

// ──────────────────────────────────────────────────── 4. Last Action

describe('Last Action reports a real execution or nothing', () => {
  it('reads the newest event in the execution phase', () => {
    expect(TAB).toMatch(/decisionTimelineEvents\.find\(e => e\.phase === 'execution'\) \?\? null/)
  })

  it('reuses the timeline query rather than adding one', () => {
    // Same hook, same assetId and portfolioId as the DecisionTimeline render,
    // so it shares the cache key and inherits that query's authorization.
    const at = TAB.indexOf('useAssetDecisionTimeline({')
    expect(at).toBeGreaterThan(-1)
    const call = TAB.slice(at, at + 220)
    expect(call).toMatch(/assetId: asset\.id/)
    expect(call).toMatch(/portfolioId: decisionBookId/)
  })

  it('does not widen the query to find something to show', () => {
    const at = TAB.indexOf('useAssetDecisionTimeline({')
    const call = TAB.slice(at, at + 220)
    expect(call).not.toMatch(/portfolioId: null/)
    expect(call).not.toMatch(/filter: 'all'/)
  })

  it('falls back to an em-dash, never to a different kind of event', () => {
    const at = TAB.indexOf("label: 'Last Action'")
    expect(at).toBeGreaterThan(-1)
    const tile = TAB.slice(at, at + 420)
    expect(tile).toMatch(/lastExecution\s*\?\s*lastExecution\.title\s*:\s*'\\u2014'/)
    expect(tile).toMatch(/active: !!lastExecution/)
    // A recommendation or an idea would answer a different question.
    expect(tile).not.toMatch(/'recommendation'|'exploratory'|'formal'/)
  })

  it('is gated to the History mode, which is where the timeline renders', () => {
    const at = TAB.indexOf('useAssetDecisionTimeline({')
    expect(TAB.slice(at, at + 260)).toMatch(/enabled: activeMode === 'history'/)
  })

  it('is called unconditionally at component level, not inside the JSX IIFE', () => {
    // The block is an IIFE inside JSX; a hook there is a conditional hook,
    // which this repo has a guard for.
    const hookAt = TAB.indexOf('useAssetDecisionTimeline({')
    const blockAt = TAB.indexOf("(activeMode === 'work' || activeMode === 'history') && (() =>")
    expect(hookAt).toBeGreaterThan(-1)
    expect(blockAt).toBeGreaterThan(-1)
    expect(hookAt).toBeLessThan(blockAt)
  })
})
