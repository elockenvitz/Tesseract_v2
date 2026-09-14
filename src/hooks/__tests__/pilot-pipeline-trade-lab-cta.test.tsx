/**
 * Pipeline basics step 3 gets a direct "Open Trade Lab" control.
 *
 * On a 390px board the only way to Trade Lab from step 3 was a link inside a
 * recommendation card inside the Decision Inbox drawer, and the banner offered
 * nothing but the instruction. The CTA takes the same hand-off that link does —
 * the `openTradeLab` event with the card's portfolio — carries the tutorial
 * idea, and records the step only if the navigation actually happened.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, render, screen, fireEvent } from '@testing-library/react'
import {
  OPEN_TRADE_LAB_EVENT, PIPELINE_BASICS_CTA_SOURCE, isPipelineBasicsCtaEvent, requestOpenTradeLab,
} from '../../lib/trade-lab/open-trade-lab'

const mark = vi.fn()
let progress: Record<string, unknown>
let pilot = true
let requests: Array<{ status: string; portfolio_id: string }> | undefined
const requestedFor: Array<string | undefined> = []

vi.mock('../usePilotMode', () => ({ usePilotMode: () => ({ effectiveIsPilot: pilot }) }))
vi.mock('../usePilotProgress', () => ({ usePilotProgress: () => ({ ...progress, mark }) }))
vi.mock('../useDecisionRequests', () => ({
  useDecisionRequestsForIdea: (id: string | undefined) => {
    requestedFor.push(id)
    return { data: id ? requests : undefined }
  },
}))

import { usePilotPipelineBanner } from '../usePilotPipelineBanner'
import { PilotStepsBanner, type PilotStep } from '../../components/pilot/PilotStepsBanner'

const TUTORIAL = 'tq-tutorial'
const onStep3 = () => ({
  hasDismissedPipelineBanner: false,
  hasCompletedPipelineStepMoved: true,
  hasCompletedPipelineStepInbox: true,
  hasCompletedPipelineStepTradeLab: false,
  tutorialIdeaId: TUTORIAL,
})

/** Stands in for DashboardPage's listener: navigates, then says so. */
function installNavigator(navigates = true) {
  const seen: CustomEvent[] = []
  const listener = (e: Event) => {
    seen.push(e as CustomEvent)
    if (navigates) e.preventDefault()
  }
  window.addEventListener(OPEN_TRADE_LAB_EVENT, listener)
  return { seen, remove: () => window.removeEventListener(OPEN_TRADE_LAB_EVENT, listener) }
}

const step3 = () => renderHook(() => usePilotPipelineBanner()).result.current.steps[2]

beforeEach(() => {
  mark.mockReset()
  pilot = true
  progress = onStep3()
  requests = [
    { status: 'accepted', portfolio_id: 'p-old' },
    { status: 'pending', portfolio_id: 'p-card' },
  ]
  requestedFor.length = 0
})

describe('the canonical hand-off, and knowing it went', () => {
  let nav: ReturnType<typeof installNavigator> | null = null
  afterEach(() => { nav?.remove(); nav = null })

  it('reports true only when the navigating listener took it', () => {
    nav = installNavigator(true)
    expect(requestOpenTradeLab({ portfolioId: 'p' })).toBe(true)
  })

  it('reports false when nothing navigated', () => {
    expect(requestOpenTradeLab({ portfolioId: 'p' })).toBe(false)
    nav = installNavigator(false)
    expect(requestOpenTradeLab({ portfolioId: 'p' })).toBe(false)
  })

  /** Decision Inbox dispatches a plain event; the listener's preventDefault must not change it. */
  it('leaves a non-cancelable dispatch exactly as it was', () => {
    nav = installNavigator(true)
    const inboxStyle = new CustomEvent(OPEN_TRADE_LAB_EVENT, { detail: { portfolioId: 'p' } })
    expect(window.dispatchEvent(inboxStyle)).toBe(true)
    expect(inboxStyle.defaultPrevented).toBe(false)
    expect(isPipelineBasicsCtaEvent(inboxStyle)).toBe(false)
  })
})

describe('step 3 offers Open Trade Lab once the reader is on it', () => {
  it('is offered on step 3 with the tutorial idea and its card portfolio known', () => {
    const s = step3()
    expect(s.action?.label).toBe('Open Trade Lab')
    expect(requestedFor).toContain(TUTORIAL)
  })

  it('is not offered before step 3', () => {
    progress = { ...onStep3(), hasCompletedPipelineStepInbox: false }
    expect(step3().action).toBeUndefined()
    // and nothing is fetched for it
    expect(requestedFor.every(id => id === undefined)).toBe(true)
  })

  it('is not offered once step 3 is done', () => {
    progress = { ...onStep3(), hasCompletedPipelineStepTradeLab: true }
    expect(step3().action).toBeUndefined()
  })

  it('is not offered without a tutorial idea', () => {
    progress = { ...onStep3(), tutorialIdeaId: null }
    expect(step3().action).toBeUndefined()
  })

  it('is not offered until the card portfolio is known', () => {
    requests = []
    expect(step3().action).toBeUndefined()
  })

  it('is not offered to a reader who is not a pilot', () => {
    pilot = false
    expect(step3().action).toBeUndefined()
  })
})

describe('clicking it', () => {
  let nav: ReturnType<typeof installNavigator> | null = null
  afterEach(() => { nav?.remove(); nav = null })

  it('dispatches the Decision Inbox hand-off with the tutorial idea carried', () => {
    nav = installNavigator(true)
    step3().action!.onClick()
    expect(nav.seen).toHaveLength(1)
    expect(nav.seen[0].type).toBe('openTradeLab')
    expect(nav.seen[0].detail).toEqual({
      // the waiting request's portfolio, as the inbox card shows it
      portfolioId: 'p-card',
      tradeQueueItemId: TUTORIAL,
      source: PIPELINE_BASICS_CTA_SOURCE,
    })
  })

  it('completes step 3 when Trade Lab navigation succeeds', () => {
    nav = installNavigator(true)
    step3().action!.onClick()
    expect(mark).toHaveBeenCalledTimes(1)
    expect(mark).toHaveBeenCalledWith('pipeline_step_tradelab')
  })

  it('does not complete step 3 when nothing navigated', () => {
    step3().action!.onClick()
    expect(mark).not.toHaveBeenCalled()
  })

  it('does not complete step 3 when a listener saw it but did not navigate', () => {
    nav = installNavigator(false)
    step3().action!.onClick()
    expect(mark).not.toHaveBeenCalled()
  })

  it('marks nothing but step 3', () => {
    nav = installNavigator(true)
    step3().action!.onClick()
    expect(mark.mock.calls.flat()).toEqual(['pipeline_step_tradelab'])
  })
})

describe('the banner draws the CTA on a phone, for the current step only', () => {
  const steps = (over: Partial<PilotStep> = {}): PilotStep[] => [
    { n: 1, title: 'Move', hint: 'h', done: true },
    { n: 2, title: 'Inbox', hint: 'h', done: true },
    { n: 3, title: 'Open Trade Lab', hint: 'h', done: false, action: { label: 'Open Trade Lab', onClick: vi.fn() }, ...over },
  ]

  it('shows a named Open Trade Lab control and runs its action', () => {
    const s = steps()
    const { container } = render(<PilotStepsBanner steps={s} label="Pipeline basics" variant="inset" />)
    const btn = container.querySelector('[data-slot="pilot-steps-action"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.textContent).toContain('Open Trade Lab')
    fireEvent.click(btn)
    expect(s[2].action!.onClick).toHaveBeenCalledTimes(1)
  })

  it('does not show it while an earlier step is current', () => {
    const s = steps()
    s[1] = { ...s[1], done: false }
    const { container } = render(<PilotStepsBanner steps={s} />)
    expect(container.querySelector('[data-slot="pilot-steps-action"]')).toBeNull()
  })

  it('does not show it once the step is done', () => {
    const { container } = render(<PilotStepsBanner steps={steps({ done: true })} />)
    expect(container.querySelector('[data-slot="pilot-steps-action"]')).toBeNull()
  })

  it('leaves the desktop row as it was — no action control there', () => {
    const { container } = render(<PilotStepsBanner steps={steps()} />)
    const desktop = container.querySelector('.sm\\:flex') as HTMLElement
    expect(desktop.querySelector('[data-slot="pilot-steps-action"]')).toBeNull()
    expect(screen.getAllByText('Open Trade Lab').length).toBeGreaterThan(0)
  })
})

describe('one route, unchanged for everyone else', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

  it('is navigated by the existing DashboardPage listener, which now confirms it and carries the idea', () => {
    const page = src('pages/DashboardPage.tsx')
    const handler = page.slice(page.indexOf('const handleOpenTradeLab'), page.indexOf("window.addEventListener('openTradeLab'"))
    expect(handler).toContain("type: 'trade-lab'")
    expect(handler).toContain('...(tradeQueueItemId ? { tradeQueueItemId } : {})')
    expect(handler.indexOf('navigateRef.current(')).toBeLessThan(handler.indexOf('event.preventDefault()'))
  })

  it('leaves the Decision Inbox Trade Lab action as the plain event it was', () => {
    const inbox = src('components/trading/DecisionInbox.tsx')
    expect(inbox).toContain("window.dispatchEvent(new CustomEvent('openTradeLab', {")
    expect(inbox).toContain('detail: { portfolioId: request.portfolio_id },')
    expect(inbox).not.toContain('requestOpenTradeLab')
  })

  it('has the board listeners leave CTA events to the CTA, and mark every other hand-off as before', () => {
    for (const f of ['pages/TradeQueuePage.tsx', 'components/mobile/MobilePipeline.tsx']) {
      const s = src(f)
      const at = s.indexOf('if (isPipelineBasicsCtaEvent(e)) return')
      expect(at).toBeGreaterThan(-1)
      expect(s.indexOf("window.addEventListener('openTradeLab', handler)", at)).toBeGreaterThan(at)
    }
  })

  it('adds no mobile-only route', () => {
    const hook = src('hooks/usePilotPipelineBanner.ts')
    expect(hook).toContain('requestOpenTradeLab(')
    expect(hook).not.toMatch(/navigate\(|useNavigate|history\.push|type: 'trade-lab'/)
  })
})
