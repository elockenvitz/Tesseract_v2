/**
 * No surface may render a raw stage value.
 *
 * The canonical pipeline is four stages. Production carries ten distinct
 * values across two superseded vocabularies, because the model normalizes on
 * read rather than migrating rows. Presentation therefore has to cope with all
 * of them, and `stageLabel` did not: it returned the RAW string for anything
 * outside the four, and 173 of 241 `trade_queue_items` rows are outside them.
 *
 * The counts below are the production distribution measured on 2026-10-21.
 * They are in the test so the next person can see what this actually covers,
 * not as an assertion about the data — rows change, the vocabulary does not.
 *
 * What this does NOT assert: that a stage means a decision is due. Stage is
 * maturity. Whether something is awaiting action is a different question with
 * a different answer (`isAwaitingDesk`), and conflating them is how a chip
 * starts claiming urgency it cannot know.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  IDEA_STAGES, IDEA_STAGE_CONFIG, LEGACY_STAGE_MAP,
  stageLabel, stageColor, toIdeaStage, isAwaitingDesk,
} from '../stage-model'

/** Every value observed in production, with its row count at the time. */
const PRODUCTION_STAGES: ReadonlyArray<[string, number]> = [
  ['ready_for_decision', 57],
  ['idea', 40],
  ['aware', 27],
  ['investigate', 27],
  ['deep_research', 24],
  ['deciding', 22],
  ['thesis_forming', 22],
  ['ready_to_recommend', 11],
  ['simulating', 6],
  ['exploring', 2],
  ['developing', 2],
  ['researching', 1],
  ['working_on', 6],
  ['modeling', 2],
]

const RAW_SHAPE = /_/   // a label containing an underscore is an enum leak

describe('every stage in production renders a human label', () => {
  it.each(PRODUCTION_STAGES)('%s (%i rows) gets a label, not the raw value', (stage) => {
    const label = stageLabel(stage)
    expect(label).not.toBe(stage)
    expect(label).not.toMatch(RAW_SHAPE)
    expect(label.length).toBeGreaterThan(0)
  })

  it('labels every canonical stage as itself', () => {
    expect(IDEA_STAGES.map(stageLabel)).toEqual([
      'Exploring', 'Researching', 'Developing', 'Ready to Recommend',
    ])
  })

  it('labels every legacy value through its canonical stage', () => {
    for (const [legacy, canonical] of Object.entries(LEGACY_STAGE_MAP)) {
      expect(stageLabel(legacy)).toBe(IDEA_STAGE_CONFIG[canonical].label)
    }
  })
})

describe('unknown and absent values', () => {
  it('never returns the raw value for a stage nobody recognises', () => {
    expect(stageLabel('some_future_stage')).not.toBe('some_future_stage')
    expect(stageLabel('some_future_stage')).not.toMatch(RAW_SHAPE)
  })

  it('treats an unknown stage as the start of the pipeline, matching toIdeaStage', () => {
    // Unknown maturity is honestly represented as the beginning, which is the
    // rule toIdeaStage already set. Presentation must not invent a second one.
    expect(stageLabel('some_future_stage')).toBe(IDEA_STAGE_CONFIG[toIdeaStage('some_future_stage')].label)
  })

  it('handles null and undefined without throwing or printing them', () => {
    for (const v of [null, undefined, '']) {
      const label = stageLabel(v as never)
      expect(label).toBe('Exploring')
      expect(label).not.toMatch(/null|undefined/)
    }
  })
})

describe('colour travels with the label', () => {
  it('gives every production stage a class string', () => {
    for (const [stage] of PRODUCTION_STAGES) {
      expect(stageColor(stage)).toBe(IDEA_STAGE_CONFIG[toIdeaStage(stage)].color)
      expect(stageColor(stage)).toMatch(/bg-/)
    }
  })

  it('never leaves an unknown stage unstyled', () => {
    expect(stageColor('some_future_stage')).toMatch(/bg-/)
  })
})

describe('stage is not decision status', () => {
  it('only the final stage is awaiting the desk', () => {
    expect(isAwaitingDesk('ready_to_recommend')).toBe(true)
    expect(isAwaitingDesk('ready_for_decision')).toBe(true)   // legacy of the same
    expect(isAwaitingDesk('developing')).toBe(false)
    expect(isAwaitingDesk('exploring')).toBe(false)
  })

  it('the label says maturity, never urgency', () => {
    // "Ready to Recommend" describes the work. It must not promise that a
    // decision is due, which depends on a decision_request existing.
    for (const stage of IDEA_STAGES) {
      expect(stageLabel(stage)).not.toMatch(/awaiting|overdue|urgent|action required/i)
    }
  })
})

/*
 * The surfaces. Each of these once carried its own map; a map that drifts is
 * how two screens come to disagree about one idea.
 */
const root = join(__dirname, '..', '..', '..')
const src = (f: string) => readFileSync(join(root, f), 'utf8')

describe('live surfaces use the canonical model', () => {
  const LIVE = [
    'components/tabs/AssetTab.tsx',
    'components/mobile/trade-lab/MobileIdeasDrawer.tsx',
    'hooks/useObjectLinks.ts',
    'components/trading/TradeIdeaDetailModal.tsx',
  ]

  it.each(LIVE)('%s imports the canonical label', file => {
    expect(src(file)).toMatch(/from ['"][^'"]*lib\/ideas\/stage-model['"]/)
  })

  it.each(LIVE)('%s keeps no local stage-label map', file => {
    const body = src(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // The tell: a legacy stage key sitting next to a quoted label.
    expect(body).not.toMatch(/ready_for_decision:\s*['"]/)
    expect(body).not.toMatch(/thesis_forming:\s*['"]/)
    expect(body).not.toMatch(/deep_research:\s*['"]/)
  })

  it('the asset page no longer falls back to the raw stage', () => {
    /*
     * Rewritten, not relaxed: these assertions named a call shape that no
     * longer exists, while the rule they protect still holds.
     *
     * They pinned `stageLabel(item.stage)` and `stageColor(item.stage)` from
     * the Open Items rows. Those rows became `buildWorkItems`, which maps
     * ideas as `i` and carries a `stageLabel` field, so the label assertion
     * was failing on the loop variable's name. The colour went further: the
     * chip the rows drew is gone and `stageColor` now has no production caller
     * at all, so demanding one here would be demanding dead code back.
     *
     * What matters is unchanged — the asset page must take its label from the
     * canonical model and must never read a raw stage out of a local map.
     */
    const body = src('components/tabs/AssetTab.tsx')
    expect(body).not.toMatch(/stageLabels\s*\[/)
    expect(body).toMatch(/stageLabel\(i\.stage\)/)
  })

  it('object links no longer drop an unmapped stage to an empty string', () => {
    const body = src('hooks/useObjectLinks.ts')
    expect(body).not.toMatch(/stageLabels\[i\.stage\]\s*\|\|\s*''/)
    expect(body).toMatch(/stageLabel\(i\.stage\)/)
  })
})

describe('the audit timeline keeps historical vocabulary, deliberately', () => {
  /*
   * EntityTimeline records what happened. An event written when the idea moved
   * to `thesis_forming` must not be relabelled "Developing" years later — that
   * would be rewriting the log to match today's model. It is excluded from the
   * canonical sweep above for that reason, and it is still safe: its fallback
   * humanises rather than printing the enum.
   */
  it('humanises any value it does not know', () => {
    const body = src('components/audit/EntityTimeline.tsx')
    expect(body).toMatch(/replace\(\/_\/g, ' '\)/)
  })
})
