/**
 * The phone's Pipeline has the Decision Inbox the tutorial sends it to.
 *
 * ── Why it was missing ───────────────────────────────────────────────────
 *
 * `DecisionInboxPanel` was mounted in exactly one place: `TradeQueuePage`.
 * A phone renders `MobilePipeline` instead, so step two of the Pipeline
 * tutorial — "Open the Decision Inbox" — told the reader to open a drawer
 * that nothing on their screen drew. The step could not be completed and the
 * banner could not retire.
 *
 * The panel was never desktop-bound. It is `absolute bottom-0` with
 * percentage heights and a single `hidden sm:inline` label, so what it needed
 * was a positioned ancestor and a piece of state — not a second, mobile
 * version of a recommendation surface.
 *
 * These read source: the claim is about which component mounts what, and
 * which stage key each shell writes.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const mobile = src('components/mobile/MobilePipeline.tsx')
const desktop = src('pages/TradeQueuePage.tsx')
const panel = src('components/trading/DecisionInboxPanel.tsx')

describe('both shells mount the same inbox', () => {
  it('is the canonical panel, not a mobile copy of one', () => {
    expect(mobile).toContain("import { DecisionInboxPanel } from '../trading/DecisionInboxPanel'")
    expect(mobile).toContain('<DecisionInboxPanel')
    expect(desktop).toContain('<DecisionInboxPanel')
  })

  /** It draws itself against its container's bottom edge. */
  it('has something to be absolute against', () => {
    expect(panel).toContain('absolute bottom-0')
    expect(mobile).toMatch(/className="relative h-full flex flex-col/)
  })

  /** Committed and archived are read-only here and have no decisions waiting. */
  it('belongs to the board, not to every tab', () => {
    expect(mobile).toMatch(/view === 'pipeline' && \(\s*<DecisionInboxPanel/)
  })
})

describe('opening it means the same thing on both', () => {
  it('writes the same stage key', () => {
    expect(mobile).toContain("markPilotStage('pipeline_step_inbox')")
    expect(desktop).toContain("markPilotStage('pipeline_step_inbox')")
  })

  /** Closing the drawer is not opening it. */
  it('marks on the way open only', () => {
    const toggle = mobile.slice(mobile.indexOf('const toggleInbox ='))
    const body = toggle.slice(0, toggle.indexOf('\n  })'))
    expect(body).toContain('if (prev &&')
    expect(body).toContain('pilotMode.effectiveIsPilot')
    expect(body).toContain('!hasCompletedPipelineStepInbox')
  })
})

describe('the banner describes what exists', () => {
  const hook = src('hooks/usePilotPipelineBanner.ts')

  /** "Click it" named a mouse on a step both shells now have. */
  it('stops naming a mouse', () => {
    expect(hook).toContain('Open the Decision Inbox')
    expect(hook).not.toContain('click it')
  })
})

/*
 * ── The capture tracker's middle step ──────────────────────────────────────
 *
 * It fired on "a thesis AND a portfolio", and the form requires neither: the
 * submit control is enabled by an asset, or by both legs of a pair, and the
 * thesis field is labelled optional in that same form. So the tracker asked
 * for one thing the form calls optional and a second it never asks for, and a
 * reader who followed the form watched the step refuse to tick.
 */
describe('the capture step-two predicate is the submit button s own', () => {
  const capture = src('components/thoughts/QuickTradeIdeaCapture.tsx')
  const step2 = capture.slice(capture.indexOf('const step2FiredRef'))
  const body = step2.slice(0, step2.indexOf('}, ['))

  it('no longer requires an optional thesis or a portfolio', () => {
    expect(body).not.toContain('rationale')
    expect(body).not.toContain('selectedPortfolioIds')
  })

  it('asks exactly what the submit control asks', () => {
    expect(body).toContain("tradeType === 'pair'")
    expect(body).toContain('longAssets.length > 0 && shortAssets.length > 0')
    expect(body).toContain('!!selectedAsset')
  })

  /**
   * The listener, the completion flag and the localStorage key are all keyed
   * on this name. Renaming it would silently reset progress mid-flow.
   */
  it('keeps the event name the stored progress is keyed on', () => {
    expect(body).toContain('pilot-capture:thesis-portfolio-set')
  })
})
