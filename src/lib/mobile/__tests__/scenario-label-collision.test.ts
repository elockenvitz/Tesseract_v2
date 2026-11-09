import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { scenarioLabelsCollide, SCENARIO_LABEL_CHAR_PX } from '../explore-visual'

/**
 * The scenario row must not draw two labels in the same place.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Every label in the framework bar is absolutely centred on its own price
 * (`-translate-x-1/2` over `left: pos%`). Nothing compared one label's extent
 * against another's, so a market trading a few dollars from a modelled case
 * put two whole labels on the same pixels.
 *
 * Measured on the Ideas lens at 1920, before: 2 of the 5 visible framework
 * cards. DASH drew "$179" across "BEAR $180" by 21.6px, and another card drew
 * "$403" across "BULL $400" by 19.8px — both across the labels' full 9px
 * height, i.e. the price of the stock written on top of the case it is being
 * compared to. After: 0 of 5.
 *
 * The 52-week row below has always avoided this by living on its own line,
 * and its comment gives the reason in as many words: a year low and a bear
 * case are often within a few dollars. The last price stands in exactly that
 * relationship to a case and was never given the same care.
 *
 * ── Why these cases are arithmetic and source, not a render ──────────────
 *
 * The merge depends on the row's measured pixel width, and `useWidth` no-ops
 * under jsdom (no `ResizeObserver`), so a mounted `ScenarioRange` reports a
 * 0px row and NEVER merges. A render test here would pass whatever the code
 * did — the exact shape of a vacuous gate. So the decision is tested as the
 * pure function that makes it, and the wiring is pinned by reading the source.
 */
describe('scenarioLabelsCollide', () => {
  /*
   * DASH as it renders today: 52-week low $147, bear $180, base $250,
   * bull $300, 52-week high $254, last $179. The bar spans the widest pair,
   * so a dollar between the last price and the bear case is 0.65% of the row.
   */
  const LO = 147
  const HI = 300
  const pct = (p: number) => ((p - LO) / (HI - LO)) * 100

  const bear = { centrePct: pct(180), chars: 'BEAR $180'.length }
  const last = { centrePct: pct(179), chars: '$179'.length }

  it('catches the pair that was actually overlapping on screen', () => {
    expect(scenarioLabelsCollide(bear, last, 740)).toBe(true)
  })

  it('is symmetric — neither label is the privileged one', () => {
    expect(scenarioLabelsCollide(last, bear, 740))
      .toBe(scenarioLabelsCollide(bear, last, 740))
  })

  it('leaves labels that are genuinely apart alone', () => {
    const base = { centrePct: pct(250), chars: 'BASE $250'.length }
    expect(scenarioLabelsCollide(bear, base, 740)).toBe(false)
    expect(scenarioLabelsCollide(last, base, 740)).toBe(false)
  })

  it('depends on the row width, because the collision does', () => {
    // Same two labels, same prices. 3.5% apart is ~26px on a card and ~12px
    // on a phone; the labels are ~50px and ~22px wide.
    const a = { centrePct: 40, chars: 'BULL $400'.length }
    const b = { centrePct: 43.5, chars: '$403'.length }
    expect(scenarioLabelsCollide(a, b, 340)).toBe(true)
    expect(scenarioLabelsCollide(a, b, 1400)).toBe(false)
  })

  it('counts a longer label as taking more room', () => {
    const short = { centrePct: 50, chars: 2 }
    const long = { centrePct: 50, chars: 2 }
    const far = { centrePct: 58, chars: 2 }
    expect(scenarioLabelsCollide(short, far, 400)).toBe(false)
    expect(scenarioLabelsCollide({ ...long, chars: 40 }, far, 400)).toBe(true)
  })

  it('touching exactly is not overlapping', () => {
    // Half-widths that sum to precisely the gap: the labels abut, and an
    // abutting pair that merged would merge forever as the row resized.
    const chars = 10
    const rowPx = 500
    const halfPct = ((chars * SCENARIO_LABEL_CHAR_PX) / 2 / rowPx) * 100
    const gap = halfPct * 2
    expect(scenarioLabelsCollide(
      { centrePct: 20, chars }, { centrePct: 20 + gap, chars }, rowPx,
    )).toBe(false)
  })

  it('reports nothing before the row has been measured', () => {
    // First paint, and under jsdom permanently. Merging on a 0px row would
    // fold every label into one.
    expect(scenarioLabelsCollide(bear, last, 0)).toBe(false)
    expect(scenarioLabelsCollide(bear, last, -1)).toBe(false)
    expect(scenarioLabelsCollide(bear, last, Number.NaN)).toBe(false)
  })

  it('allows for a character wider than the widest one measured', () => {
    // Twenty live labels; the widest was 5.40px a character. Being generous
    // costs one needless merge, being mean costs an overlap.
    expect(SCENARIO_LABEL_CHAR_PX).toBeGreaterThanOrEqual(5.4)
  })
})

describe('the scenario row resolves the collision by merging, not moving', () => {
  const SRC = readFileSync(
    resolve(__dirname, '../../../components/mobile/ExploreVisual.tsx'),
    'utf8',
  ).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  it('measures the row it is drawing into', () => {
    expect(SRC).toMatch(/const \[rowRef, rowPx\] = useWidth</)
    expect(SRC).toMatch(/<div ref=\{rowRef\}/)
  })

  it('asks the shared predicate rather than re-deriving the geometry', () => {
    expect(SRC).toMatch(/scenarioLabelsCollide\(/)
    expect(SRC).toContain('rowPx,')
  })

  it('draws the last price once, inside the case it collided with', () => {
    // Both halves: the standalone label is withheld…
    expect(SRC).toMatch(/if \(m\.current && mergedCase\) return null/)
    // …and reappears on the case's own label.
    expect(SRC).toMatch(/mergedCase\?\.id === m\.id \? currentMark : null/)
    expect(SRC).toMatch(/\{merged && \(/)
  })

  it('picks the nearest case, not the first one that collides', () => {
    // A last price can sit inside two cases' labels at once; it belongs to
    // the one it is next to.
    expect(SRC).toMatch(/\.sort\(\(a, b\) =>\s*Math\.abs\(a\.price - currentMark\.price\)/)
  })

  it('never nudges a label off the price it names', () => {
    /*
     * `ScenarioLadder` records what moving a label along the axis costs:
     * drift of up to 32px detached a label from the end it named. Every
     * placement in this chart must be the price and nothing but the price —
     * no nudge term, no pixel offset bolted onto the percentage.
     */
    const row = SRC.slice(SRC.indexOf('{marks.map(m => {'))
    expect(row).not.toBe('')
    const lefts = row.slice(0, row.indexOf('data-scenario-year')).match(/left: `[^`]*`/g) ?? []
    expect(lefts).toEqual(['left: `${clamp(pos(m.price))}%`'])
  })

  it('keeps the merged price in its own ink', () => {
    // Two facts on one tick, not one longer case name.
    expect(SRC).toMatch(/\{merged && \([\s\S]{0,200}?className="ml-1 text-gray-700/)
  })
})
