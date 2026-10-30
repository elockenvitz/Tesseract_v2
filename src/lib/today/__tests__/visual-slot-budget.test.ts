import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { VISUAL_SLOT, VISUAL_CHROME, visualPlotHeight } from '../types'

/**
 * The plot must fit the slot it is drawn into, note included.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `VISUAL_SLOT` is a fixed box: caption, plot, and — where the window does
 * not reach its anchor — a note saying so. The plot's height was two
 * constants worked out by hand, against a budget that subtracted padding,
 * the caption and the read-out line but never the note. So on exactly the
 * tiles that carry a note, the plot plus its read-out ran past the space it
 * had and painted on top of the words below it.
 *
 * Measured on the live feed at 1920 wide, before: 5 of 13 tiles overlapping,
 * the percentage change sitting 50px across and the full 14px height of the
 * note — the one number the chart exists to state, laid over the sentence
 * explaining why it is not the number you asked for. After: 0 of 13.
 *
 * These cases assert the budget rather than the two numbers, so a future
 * change to the slot, the caption or the note cannot quietly re-open it.
 */
describe('visualPlotHeight fits inside the slot', () => {
  for (const compact of [true, false]) {
    const key = compact ? 'compact' : 'featured'

    describe(key, () => {
      it('leaves room for every fixed row when a note is present', () => {
        const used = visualPlotHeight({ compact, hasNote: true })
          + VISUAL_CHROME.padding[key]
          + VISUAL_CHROME.caption
          + VISUAL_CHROME.readout
          + VISUAL_CHROME.note
        expect(used).toBeLessThanOrEqual(VISUAL_SLOT[key])
      })

      it('leaves room for every fixed row when there is no note', () => {
        const used = visualPlotHeight({ compact, hasNote: false })
          + VISUAL_CHROME.padding[key]
          + VISUAL_CHROME.caption
          + VISUAL_CHROME.readout
        expect(used).toBeLessThanOrEqual(VISUAL_SLOT[key])
      })

      it('gives the note its room back, rather than drawing over it', () => {
        // The whole defect in one line: the noted plot must be SHORTER.
        const withNote = visualPlotHeight({ compact, hasNote: true })
        const without = visualPlotHeight({ compact, hasNote: false })
        expect(without - withNote).toBe(VISUAL_CHROME.note)
      })

      it('is still a chart, not a sparkline', () => {
        // The slot was grown deliberately because a 72px band of price reads
        // as decoration. Shrinking for the note must not undo that.
        expect(visualPlotHeight({ compact, hasNote: true })).toBeGreaterThan(90)
      })
    })
  }

  it('a featured plot is taller than a compact one', () => {
    expect(visualPlotHeight({ compact: false, hasNote: true }))
      .toBeGreaterThan(visualPlotHeight({ compact: true, hasNote: true }))
  })
})

describe('the drawing code takes its height from the budget', () => {
  const SRC = readFileSync(
    resolve(__dirname, '../../../components/today/TodayVisual.tsx'),
    'utf8',
  ).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  it('ReviewWindow calls visualPlotHeight and passes the note through', () => {
    expect(SRC).toMatch(/visualPlotHeight\(\{\s*compact,\s*hasNote:\s*!!v\.note\s*\}\)/)
  })

  it('holds no hand-derived plot height beside it', () => {
    // `const h = compact ? 118 : 166` is the shape that went stale.
    expect(SRC).not.toMatch(/const h = compact \? \d+ : \d+/)
  })

  it('still renders the note it is now budgeting for', () => {
    expect(SRC).toMatch(/visual\.note &&/)
  })
})

describe('the visual column sits on the foot of the tile', () => {
  const TILE = readFileSync(
    resolve(__dirname, '../../../components/today/TodayTile.tsx'),
    'utf8',
  ).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  /*
   * `justify-center` floated the chart and its "SEE THE FULL CHART" row in
   * the middle of a tile whose height is set by the OTHER column. Measured at
   * 1920: 85-160px dead above, 13-41px below, and the portal a different
   * distance from the edge on every tile — 13, 19, 25, 35 and 41px.
   *
   * `mt-auto` makes the column reach the foot of its parent (the stacked
   * layout's column did not), and `justify-end` puts the portal on that foot.
   * After: 13 or 19px on every tile, which is the tile's own bottom padding.
   */
  it('anchors the column rather than centring it', () => {
    const cls = TILE.match(/className="([^"]*flex min-w-0 flex-col[^"]*)"/)?.[1]
    expect(cls).toBeDefined()
    expect(cls).toContain('mt-auto')
    expect(cls).toContain('justify-end')
    expect(cls).not.toContain('justify-center')
  })
})
