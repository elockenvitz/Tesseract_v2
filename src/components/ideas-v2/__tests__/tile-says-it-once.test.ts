/**
 * A tile does not print the same thing twice.
 *
 * ── The defect, measured ──────────────────────────────────────────────────
 *
 * Ideas at 1920x889, over all 90 tiles: 38 of them rendered some string twice
 * — 26 a whole sentence, 13 a figure. Three causes:
 *
 *   AMZN   "+38%" in the eyebrow, over a scenario bar captioned
 *          "+38% above your range".
 *   AAPL   "+29%" in the eyebrow, over a last-look bar reading "+29% today".
 *   LLY    "LLY's investment thesis is incomplete" as the reason, and again
 *          on the shelf — because `context` fell back to `item.title`, which
 *          is the string `TileReason` prints two lines above it.
 *
 * ── Why the cases are shaped like this ────────────────────────────────────
 *
 * The first two are behavioural: `visualRestatesMetric` is a pure function and
 * the duplication is entirely decided by it, so the measured numbers are fed
 * in directly and the answer is asserted. These are the real AMZN and AAPL
 * rows, not invented ones — a gate built on an invented row proves the
 * predicate compiles, not that it catches what was on screen.
 *
 * The third is structural: `item.context || item.title` is a fallback, and a
 * fallback is only visible when the first operand is absent. Rendering the
 * tile to prove it would mean standing up react-query, `useTileCloses` and
 * `targetForOpportunity` to assert the absence of a string, so the grid's
 * source is read instead and the case says which expression it is watching.
 *
 * Each case is proven to fail: see the commit that introduced this file.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  visualRestatesMetric, visualRestatesContext,
} from '../../../lib/mobile/explore-visual'

const GRID = readFileSync(
  join(process.cwd(), 'src/components/ideas-v2/OpportunityGrid.tsx'), 'utf8',
)

/* Comments stripped: the note on the fix quotes the broken expression so the
   next reader knows what not to reintroduce, and a raw search would read that
   explanation as the defect. */
const CODE = GRID
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('the eyebrow figure yields to a picture that already states it', () => {
  /* AMZN as it stood: bull case $180, last $249, so the band prints
     "+38% above your range" and the metric line said "+38%". */
  it('catches the scenario bar that was captioned with the metric', () => {
    expect(visualRestatesMetric(
      { kind: 'scenario_range', low: 120, high: 180, current: 249, cases: [] },
      '+38%',
    )).toBe(true)
  })

  /* AAPL: a last look captioned "+29% today" under a metric line of "+29%". */
  it('catches the last-look bar that was captioned with the metric', () => {
    expect(visualRestatesMetric(
      { kind: 'last_look', movePct: 29.1, lastLookAt: '2026-10-20' },
      '+29%',
    )).toBe(true)
  })

  /* The other half of the rule, or suppression would eat real second facts:
     a picture that prints dates, not the finding's number, keeps the metric. */
  it('leaves the metric alone when the picture says something else', () => {
    expect(visualRestatesMetric(
      { kind: 'timeline', statedAt: '2026-01-01', dueAt: '2026-03-01' },
      '+29%',
    )).toBe(false)
    expect(visualRestatesMetric({ kind: 'none' }, '+38%')).toBe(false)
  })

  /* And a genuinely different number survives beside a picture of its own. */
  it('leaves a metric that is not the number on the bar', () => {
    expect(visualRestatesMetric(
      { kind: 'exposure', weightPct: 8.1, portfolioName: 'Core Equity' },
      '+38%',
    )).toBe(false)
  })
})

describe('the shelf yields to a picture that is that sentence', () => {
  it('catches the exposure bar whose caption is the clause verbatim', () => {
    expect(visualRestatesContext(
      { kind: 'exposure', weightPct: 1.1, portfolioName: 'Growth' },
      '1.1% of Growth',
    )).toBe(true)
  })

  it('keeps a clause that adds a word the picture does not have', () => {
    expect(visualRestatesContext(
      { kind: 'exposure', weightPct: 1.1, portfolioName: 'Growth' },
      '1.1% of Growth, up from 0.4%',
    )).toBe(false)
  })
})

describe('the Ideas grid routes both lines through those tests', () => {
  it('no longer falls the shelf back to the reason it sits under', () => {
    expect(CODE).not.toMatch(/item\.context\s*\|\|\s*item\.title/)
  })

  it('asks whether the picture already states the metric', () => {
    expect(CODE).toMatch(/visualRestatesMetric\(visual,\s*item\.metric\.value\)/)
  })

  it('asks whether the picture already states the clause', () => {
    expect(CODE).toMatch(/visualRestatesContext\(visual,\s*item\.context\)/)
  })
})
