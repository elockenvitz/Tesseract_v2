import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tileRequirementFor } from '../../../lib/mobile/tile-requirement'
import { resolveTile, TILE_COST } from '../../../lib/signals/tile-geometry'
import { insightPanePlan } from '../../../lib/signals/pane-plan'

/**
 * Tile -> Context -> Workspace, as a contract rather than a habit.
 *
 * ── What this suite is for ────────────────────────────────────────────────
 *
 * Every geometry defect reported this cycle had the same shape: variable
 * content competing for a card that cannot grow. The GOOGL chart running
 * through its tray, the note field cut off, the description under the tray,
 * the band jumping when the reader reached the response — four symptoms of one
 * cause, each fixed with a pixel, and the fifth would have been the same.
 *
 * The correction is not another pixel. It is that a tile only has to hold what
 * a reader needs to JUDGE: supporting interpretation lives one depth down,
 * behind one affordance, and an active workflow does not carry passive prose
 * at all. This suite states that contract so the next family inherits it
 * rather than rediscovering it.
 *
 * Source-text assertions where the rule IS the source — a state rule written
 * per family is exactly the failure being prevented, and only reading the file
 * can prove it was not.
 */

const src = readFileSync(resolve(__dirname, '../SignalCardView.tsx'), 'utf8')

const FEED = { width: 400, height: 590 }

const insight = (framing: string) => ({
  kind: 'insight',
  insight: {
    headline: 'APA has no investment thesis',
    body: 'None of investment thesis, where we differ, risks to thesis has been written.',
    portfolioCount: 1,
    prompt: 'What is the view?',
    issue: { framing, evidence: [] },
  },
})

describe('the tile carries judgment; the drawer carries interpretation', () => {
  it('states the state rule once, not per family', () => {
    /**
     * The whole point. `if (CASE_VS_PRICE) hide paragraph` is the thing this
     * contract replaces, so a per-family branch on the suppression rule is a
     * regression even if every card happens to look right.
     */
    expect(src).toContain('const suppressSupporting = respondActive')
    for (const family of ['scenario_gap', 'target_hit', 'target_expired',
                          'no_target', 'crowding', 'conviction_oversized']) {
      expect(
        src.includes(`suppressSupporting && card.type === '${family}'`),
        `${family} has its own suppression branch`,
      ).toBe(false)
    }
  })

  it('offers exactly one label for contextual depth', () => {
    expect(src).toContain('Why this matters')
    // The bare `more` is gone from the card face as an entry point of its own:
    // it described the quantity behind it rather than the kind, and appeared
    // only when the prose happened to overflow.
    expect(src).toContain('data-slot="context-open"')
    for (const wrong of ['>Details<', '>Explanation<', '>Learn more<', '>Why?<']) {
      expect(src.includes(wrong), `found a competing label: ${wrong}`).toBe(false)
    }
  })

  it('does not offer the affordance when nothing is behind it', () => {
    // A control that opens an empty sheet is worse than no control.
    expect(src).toContain('const hasContextDepth =')
    expect(src).toContain('{hasContextDepth && (')
  })

  it('keeps inspection out of the action tray', () => {
    /**
     * `Why this matters` inspects the finding; it does not act on it. In the
     * tray it would be a third control competing with the primary work, which
     * is the interaction hierarchy this product already separates.
     */
    const tray = src.slice(src.indexOf('data-slot="actions"'))
    expect(tray.includes('context-open'), 'the affordance leaked into the tray').toBe(false)
  })
})

describe('the requirement budgets the state that is actually rendered', () => {
  it('drops the passive prose from an active card, and charges the row instead', () => {
    const passive = tileRequirementFor(insight('long_silence'))!
    const active = tileRequirementFor(insight('long_silence'), { workflow: 'active' })!

    expect(passive.bodyLines, 'passive should carry its prose').toBeGreaterThan(0)
    expect(active.bodyLines, 'active should not budget prose it does not render').toBe(0)
    // Both offer the way back to it.
    /**
     * Only the ACTIVE card pays for the affordance as a region. On a passive
     * card it renders at the end of the paragraph, inside the box the clamp
     * already reserves, so charging for it would double-count.
     */
    expect(passive.hasContextAffordance).toBeFalsy()
    expect(active.hasContextAffordance).toBe(true)
  })

  it('makes the active card cheaper than the passive one, not dearer', () => {
    /**
     * The direction that matters. Moving a paragraph out of the tile has to
     * FREE room for the controls that replace it — if the affordance cost more
     * than the two lines it stands in for, the contract would be paying for
     * itself out of the same budget it was meant to relieve.
     */
    const passiveBody = 2 * TILE_COST.bodyLine
    expect(TILE_COST.contextAffordance).toBeLessThan(passiveBody)
  })

  it('never makes a card dearer by entering its workflow', () => {
    /**
     * The direction, which is the contract; the absolute budget belongs to
     * `responsive.spec`, which measures the DOM.
     *
     * Asserting `requested <= 590` here looked right and was not: the research
     * families sit at 595 passive and have since before this stage, so the
     * assertion would have failed for a reason this contract does not own,
     * and passing it would have meant tuning an unrelated constant. What this
     * pass is responsible for is that ANSWERING costs less than browsing —
     * because that is the state where the controls need the room.
     */
    for (const framing of ['no_case', 'long_silence', 'price_move']) {
      const passive = tileRequirementFor(insight(framing))
      const active = tileRequirementFor(insight(framing), { workflow: 'active' })
      if (!passive || !active) continue
      const p = resolveTile(passive, FEED).requested
      const a = resolveTile(active, FEED).requested
      expect(a, `${framing}: active asks ${a}, passive ${p}`).toBeLessThanOrEqual(p)
    }
  })
})

describe('the missing-thesis card is about the missing work', () => {
  it('leads with the case, not with the tape', () => {
    /**
     * A card whose finding is "nobody wrote this up" opening on a six-month
     * price chart is answering a question the reader did not ask. The tape
     * still exists — it is the second pane — because "what has it done while
     * nobody wrote it up" is the next question, not the first.
     */
    const plan = insightPanePlan({ framing: 'no_case', hasCapital: false, evidenceCount: 0 })
    expect(plan.order[0]).toBe('case')
    expect(plan.order).toContain('price')
    expect(plan.caseLeads).toBe(true)
  })

  it('still leads with the tape where something actually happened', () => {
    const moved = insightPanePlan({ framing: 'price_move', hasCapital: false, evidenceCount: 0 })
    expect(moved.order[0]).toBe('price')
  })
})
