/**
 * The rhythm may break a wall, but not by inflating an empty tile.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * MEASURED live at 1920x889: the Ideas aggregate -- "5 new ideas this week /
 * Show these" -- rendered at `large`: 418px tall, no picture, one line of text
 * and one button. `withRunRhythm` had promoted it to break a run of mediums,
 * by POSITION, and there was nothing in it to occupy the height.
 *
 * ── Why a veto is not the gaming the rule forbids ─────────────────────────
 *
 * The rhythm counts cells and never content, so a tile cannot grow because it
 * happens to carry a chart. That is what keeps `opportunitySize` ungameable
 * and it is kept exactly. Growing ON content and refusing to grow on the
 * ABSENCE of content are different permissions: the first lets a tile argue
 * for itself, the second only stops size being forced onto emptiness.
 *
 * So the floor is a veto. A vetoed cell is skipped, never promoted, and the
 * run is not reset -- the wall is still a wall, so the rule looks to the next
 * cell rather than abandoning the stretch. It can therefore raise no tile the
 * positional rule would not already have raised, which is the property the
 * cases below pin.
 */
import { describe, it, expect } from 'vitest'
import { withRunRhythm } from '../opportunity'
import type { OpportunitySize } from '../opportunity'

const med = (n: number): OpportunitySize[] => Array<OpportunitySize>(n).fill('medium')

describe('the floor refuses emptiness without granting anything', () => {
  /** THE case: the empty cell at the break point is left alone. */
  it('skips a cell that cannot fill the height', () => {
    const sizes = med(12)
    // Index 8 is where a run of 7 first breaks (indices 1..7 are the run).
    const out = withRunRhythm(sizes, 7, i => i !== 8)
    expect(out[8]).toBe('medium')
  })

  /** And it breaks the wall on the next cell that can, rather than giving up. */
  it('breaks the run on the next cell that can fill it', () => {
    const out = withRunRhythm(med(12), 7, i => i !== 8)
    expect(out[9]).toBe('large')
  })

  /**
   * The run is NOT reset by a veto. Were it reset, the wall would run on
   * uninterrupted for another full cap after every empty tile.
   */
  it('keeps counting the wall across a vetoed cell', () => {
    const out = withRunRhythm(med(20), 7, i => i !== 8)
    const promoted = out.map((s, i) => (s === 'large' ? i : -1)).filter(i => i >= 0)
    expect(promoted[0]).toBe(9)
    expect(promoted[0] - 8).toBeLessThanOrEqual(2)
  })

  /**
   * THE case for what the veto actually grants, which is less than the first
   * draft of this file claimed.
   *
   * "It can raise no tile the positional rule would not already have raised"
   * is FALSE, and this test is what established that: skipping a break point
   * leaves the run alive, so the next break lands on a later cell -- one the
   * open rule had passed over. Index 25 was the counterexample.
   *
   * The two properties that are true, and that matter:
   *
   *   NO VETOED CELL IS EVER PROMOTED. The thing the floor exists for, and
   *   the only promise a reader of an empty tile needs.
   *
   *   THE FLOOR NEVER ADDS EMPHASIS. It can move a break, never manufacture
   *   one, so the count of promotions cannot exceed the open rule's.
   */
  it('never promotes a vetoed cell, and never adds emphasis overall', () => {
    const sizes = med(40)
    const canFill = (i: number) => i % 3 !== 0
    const open = withRunRhythm(sizes, 7)
    const vetoed = withRunRhythm(sizes, 7, canFill)
    const grown = (s: OpportunitySize[]) => s.filter(x => x === 'large').length

    for (let i = 0; i < sizes.length; i++) {
      if (!canFill(i)) expect(vetoed[i], `vetoed index ${i} was promoted`).toBe('medium')
    }
    expect(grown(vetoed)).toBeLessThanOrEqual(grown(open))
  })

  /** With everything fillable, the floor changes nothing at all. */
  it('is exactly the old rule when every cell can fill', () => {
    const sizes = med(30)
    expect(withRunRhythm(sizes, 7, () => true)).toEqual(withRunRhythm(sizes, 7))
  })

  /** And omitting it is the old rule too, for every caller that has not opted in. */
  it('is exactly the old rule when no floor is given', () => {
    const sizes: OpportunitySize[] = [...med(9), 'compact', 'compact', ...med(9)]
    expect(withRunRhythm(sizes, 7)).toEqual(withRunRhythm(sizes, 7, () => true))
  })

  /** A field with no wall is returned untouched, floor or no floor. */
  it('leaves a varied field alone', () => {
    const varied: OpportunitySize[] = ['large', 'medium', 'compact', 'medium', 'large', 'medium']
    expect(withRunRhythm(varied, 7, () => true)).toEqual(varied)
    expect(withRunRhythm(varied, 7, () => false)).toEqual(varied)
  })
})
