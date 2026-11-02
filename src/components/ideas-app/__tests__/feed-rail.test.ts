import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The analytical object renders beside the claim, or not at all.
 *
 * ── What this is about ────────────────────────────────────────────────────
 *
 * With a workspace open the feed is a 640px rail beside it. Measured there,
 * every tile carrying a chart, ladder or distribution was between 361px and
 * 540px tall, because below 46rem the object STACKED underneath the narrative
 * -- and the 613px rail then held a little over one card. The reader's job in
 * that column is to pick the next name, which a claim and a metric answer and
 * a 281px chart does not.
 *
 * So the object is drawn only at the width where it sits in its own column.
 * That is a REVERSAL: stacking was the deliberate earlier fallback, on the
 * reasoning that a stacked object beats a squeezed one. It beats a squeezed
 * one and loses to the reader seeing four findings instead of one.
 *
 * ── Why this reads CSS instead of a rendered tile ─────────────────────────
 *
 * The rule is a container query, and jsdom implements none of the Container
 * Queries spec -- `@container` blocks are parsed and then never evaluated, so
 * a rendered assertion would report `display: block` at every width and pass
 * no matter what this file says. A test that cannot observe the thing it
 * names is worse than no test, so this one asserts the stylesheet and the
 * BEHAVIOUR is measured in the running app instead (recorded in the commit:
 * 540/435/399/361px tiles became 259/245/282/171px in the rail, and every
 * preview still renders beside the narrative at 1488px).
 *
 * ── What would break without each case ────────────────────────────────────
 *
 * Drop the default and the rail goes back to stacking 280px charts.
 * Drop the re-show and the object disappears from the full-width feed too,
 * which is the opposite defect and a much worse one: the whole analytical
 * half of the card, gone at every width, with nothing on screen to say so.
 */

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')

/** The body of the first `@container (<cond>)` block, by brace matching. */
function containerBlock(cond: string): string {
  const start = css.indexOf(`@container (${cond})`)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  return ''
}

/** Every `.feed-tile-aside { ... }` declaration block in a chunk of CSS. */
function asideRules(chunk: string): string[] {
  return [...chunk.matchAll(/\.feed-tile-aside\s*\{([^}]*)\}/g)].map(m => m[1])
}

const SIDE_BY_SIDE = 'min-width: 46rem'

describe('the feed tile draws its analytical object beside the claim or not at all', () => {
  const beside = containerBlock(SIDE_BY_SIDE)

  it('has the side-by-side container query it keys everything on', () => {
    /* Guards the two cases below from going vacuous together: if the query is
       renamed or its threshold changes, `beside` silently becomes '' and
       every assertion made against it would pass on an empty string. */
    expect(beside, `no @container (${SIDE_BY_SIDE}) block in src/index.css`).not.toBe('')
    expect(asideRules(beside).length).toBeGreaterThan(0)
  })

  it('hides the object by default, so it never stacks under the narrative', () => {
    /* Outside the query: everything the query does not cover, which is every
       width below the threshold -- the rail, and a genuinely narrow window. */
    const outside = css.replace(beside, '')
    const hides = asideRules(outside).some(r => /display:\s*none/.test(r))
    expect(hides, '.feed-tile-aside must default to display:none').toBe(true)
  })

  it('shows it again at the width where it gets its own column', () => {
    const shows = asideRules(beside).some(r => /display:\s*(block|grid|flex)/.test(r))
    expect(shows, `.feed-tile-aside must be re-shown inside @container (${SIDE_BY_SIDE})`).toBe(true)
  })

  it('states the threshold once, so the two halves cannot drift apart', () => {
    /* The hidden state and the shown state are one decision. Two thresholds
       would mean a band of widths where the object is hidden and the grid has
       already made a second column for it -- an empty strip beside the claim,
       which is the exact defect the `align-items: start` comment above these
       rules was written for. */
    const thresholds = [...css.matchAll(/@container \(min-width: ([\d.]+rem)\)/g)].map(m => m[1])
    expect(thresholds.filter(t => t === '46rem')).toHaveLength(1)
  })
})
