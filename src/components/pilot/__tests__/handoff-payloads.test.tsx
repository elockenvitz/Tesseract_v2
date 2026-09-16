/**
 * What a pilot hand-off carries, and what the destination does with it.
 *
 * Three of these hops sent `data: null` while their destination had a fully
 * built mechanism waiting for a payload, and one sent nothing at all where
 * "nothing" does not mean "clear it".
 *
 *   Trade Book -> Outcomes   `focusDecisionId` clears the portfolio, type,
 *   Mission    -> Outcomes   ticker and date filters so an older decision is
 *                            reachable, then consumes the id so it does not
 *                            reopen on every later visit. Nothing supplied it,
 *                            so step 1 of "Finish the loop" -- "open your
 *                            decision" -- was a search through default filters.
 *
 *   Mission -> Trade Book    `handleSearchResult` only merges a TRUTHY `data`,
 *                            so `data: null` left the tab holding whichever
 *                            batch the Decision Recorded modal had put there.
 *                            Revisiting re-opened that stale commit.
 *
 * These read the navigation payloads the two mission surfaces produce, rather
 * than mounting the whole Dashboard: the payload IS the bug.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const { REVIEW_IDEA, TUTORIAL } = vi.hoisted(() => ({
  REVIEW_IDEA: 'idea-under-review',
  TUTORIAL: 'idea-tutorial',
}))

const mission = vi.hoisted(() => ({
  isLoading: false,
  complete: false,
  steps: [] as Array<Record<string, unknown>>,
  completedCount: 0,
  total: 5,
  currentStepId: 'outcome_reviewed' as string | null,
  tutorialIdeaId: TUTORIAL,
  reviewIdeaId: REVIEW_IDEA,
  decisionIdeaIds: [REVIEW_IDEA],
  setTutorialIdea: vi.fn(),
  markOutcomeReviewed: vi.fn(),
}))

vi.mock('../../../hooks/usePilotMission', () => ({
  usePilotMission: () => mission,
  logMissionStep: vi.fn(),
}))
vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'org-1' }),
}))

import { PilotWelcomeBanner } from '../../dashboard/PilotWelcomeBanner'
import { PilotMissionStrip } from '../../mobile/PilotMissionStrip'

type Nav = { id: string; type: string; data: Record<string, unknown> | null }

/** One step, the one whose CTA we want to press. */
function step(id: string, cta: string) {
  return { id, label: id, hint: '', cta, done: false, available: true, blockedBy: null }
}

function navFor(
  Surface: typeof PilotWelcomeBanner | typeof PilotMissionStrip,
  stepId: string,
  cta: string,
): Nav {
  mission.currentStepId = stepId
  mission.steps = [step(stepId, cta)]
  const seen: Nav[] = []
  render(<Surface onNavigate={(r: Nav) => { seen.push(r) }} />)
  // The desktop banner keeps its checklist behind a disclosure; open it only
  // if the CTA is not already on screen.
  if (!screen.queryByText(cta)) {
    const toggle = screen.queryByText('Getting Started')
    if (toggle) fireEvent.click(toggle)
  }
  fireEvent.click(screen.getByText(cta))
  expect(seen).toHaveLength(1)
  return seen[0]
}

beforeEach(() => {
  mission.isLoading = false
  mission.complete = false
  mission.reviewIdeaId = REVIEW_IDEA
  mission.tutorialIdeaId = TUTORIAL
})
afterEach(cleanup)

describe.each([
  ['desktop banner', PilotWelcomeBanner],
  ['phone strip', PilotMissionStrip],
] as const)('%s', (_name, Surface) => {
  /*
   * Outcomes is opened as a page, on purpose, and this pins it.
   *
   * `focusDecisionId` would open the decision directly and widen the filters
   * to reach it — but the reader's own click on their row is what ticks step 1
   * of "Finish the loop": `selectTrade` dispatches
   * `pilot-outcomes:result-inspected` and the focus path does not. Deep-linking
   * would put an open decision under a banner still asking them to open it.
   * Changing this means deciding what then ticks step 1.
   */
  it('opens the Outcomes page, not a decision on it', () => {
    const nav = navFor(Surface, 'outcome_reviewed', 'Review outcome')
    expect(nav.type).toBe('outcomes')
    expect(nav.data).toBeNull()
  })

  /* `data: null` is not "no highlight" — the tab merge ignores a falsy data
     and the old ids survive. An explicit null is what clears them. */
  it('clears the Trade Book highlight rather than leaving the old one', () => {
    const nav = navFor(Surface, 'decision_submitted', 'Open Trade Book')
    expect(nav.type).toBe('trade-book')
    expect(nav.data).toEqual({ highlightTradeIds: null, highlightBatchId: null })
  })

  it('carries the idea to Trade Lab', () => {
    const nav = navFor(Surface, 'simulation_completed', 'Open Trade Lab')
    expect(nav.type).toBe('trade-lab')
    expect(nav.data).toEqual({ tradeQueueItemId: TUTORIAL })
  })
})

describe('the destinations consume what they are given, once', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

  it('Trade Book opens Outcomes as a page too, for the same reason', () => {
    const page = src('pages/TradeBookPage.tsx')
    const nav = page.slice(page.indexOf('const navigateToOutcomes'))
    expect(nav.slice(0, nav.indexOf('}\n'))).toContain('data: null')
  })

  it('Trade Book reports its highlight spent, and the Dashboard drops it', () => {
    expect(src('pages/TradeBookPage.tsx')).toContain('onHighlightConsumed?.()')
    const dash = src('pages/DashboardPage.tsx')
    expect(dash).toContain('onHighlightConsumed={')
    expect(dash).toContain('delete data.highlightBatchId')
  })

  /* The scroll-and-flash is set up 80ms after the rows arrive, and dropping
     the ids re-runs that effect. Consuming any earlier cancels it. */
  it('does not report it spent before the flash has been applied', () => {
    const page = src('pages/TradeBookPage.tsx')
    const effect = page.slice(page.indexOf('const highlightedAppliedRef'))
    const flash = effect.indexOf("el.classList.add('decision-recorded-flash')")
    const consumed = effect.indexOf('onHighlightConsumed?.()')
    expect(flash).toBeGreaterThan(-1)
    expect(consumed).toBeGreaterThan(flash)
  })

  it('Trade Lab falls back to the pilot own portfolio when no scenario names one', () => {
    const page = src('pages/SimulationPage.tsx')
    const marker = "The pilot's own portfolio, when the scenario did not name one"
    expect(page).toContain(marker)
    const effect = page.slice(page.indexOf(marker))
    expect(effect).toContain('if (pilotScenario?.portfolio_id) return')
    // Exactly one, so this can never pick a portfolio at random.
    expect(effect).toContain('if (portfolios?.length !== 1) return')
  })
})
