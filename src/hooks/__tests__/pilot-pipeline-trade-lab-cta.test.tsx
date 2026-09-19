/**
 * Pipeline → Trade Lab at step 3.
 *
 * On a 390px board the only way from an idea to Trade Lab was a link inside a
 * recommendation card inside the Decision Inbox drawer. Two entry points now
 * take the same hand-off — the `openTradeLab` event with a portfolio and the
 * idea, navigated by DashboardPage:
 *
 *  - the portfolio on a phone Pipeline card, and
 *  - step 3 of Pipeline basics, "Test the trade", whose CTA records the step
 *    only once that navigation is confirmed.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, render, fireEvent } from '@testing-library/react'
import {
  OPEN_TRADE_LAB_EVENT, PIPELINE_BASICS_CTA_SOURCE, isPipelineBasicsCtaEvent, requestOpenTradeLab,
} from '../../lib/trade-lab/open-trade-lab'

const mark = vi.fn()
let progress: Record<string, unknown>
let pilot = true
type Req = { status: string; portfolio_id: string; portfolio?: { name: string }; trade_queue_item?: { assets?: { symbol: string } } }
let requests: Req[] | undefined
let idea: Record<string, unknown> | null | undefined
const requestedFor: Array<string | undefined> = []
const ideaQueryEnabled: boolean[] = []

vi.mock('../usePilotMode', () => ({ usePilotMode: () => ({ effectiveIsPilot: pilot }) }))
vi.mock('../usePilotProgress', () => ({ usePilotProgress: () => ({ ...progress, mark }) }))
vi.mock('../useDecisionRequests', () => ({
  useDecisionRequestsForIdea: (id: string | undefined) => {
    requestedFor.push(id)
    return { data: id ? requests : undefined }
  },
}))
// The tutorial idea read. Answered synchronously when enabled, as a warm cache would.
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { enabled?: boolean }) => {
    ideaQueryEnabled.push(!!opts.enabled)
    return { data: opts.enabled ? idea : undefined }
  },
}))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import { usePilotPipelineBanner, testTheTradeHint } from '../usePilotPipelineBanner'
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
  idea = { id: TUTORIAL, portfolio_id: 'p-idea', assets: { symbol: 'NVDA' }, portfolios: { id: 'p-idea', name: 'Growth Fund' } }
  requests = [
    { status: 'accepted', portfolio_id: 'p-old', portfolio: { name: 'Old' } },
    { status: 'pending', portfolio_id: 'p-card', portfolio: { name: 'Card Fund' }, trade_queue_item: { assets: { symbol: 'AAPL' } } },
  ]
  requestedFor.length = 0
  ideaQueryEnabled.length = 0
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

  it('leaves a non-cancelable dispatch exactly as it was', () => {
    nav = installNavigator(true)
    const inboxStyle = new CustomEvent(OPEN_TRADE_LAB_EVENT, { detail: { portfolioId: 'p' } })
    expect(window.dispatchEvent(inboxStyle)).toBe(true)
    expect(inboxStyle.defaultPrevented).toBe(false)
    expect(isPipelineBasicsCtaEvent(inboxStyle)).toBe(false)
  })
})

describe('step 3 — Test the trade', () => {
  it('is titled and explained by what it is for', () => {
    const s = step3()
    expect(s.title).toBe('Test the trade')
    expect(s.hint).toBe('See how NVDA would change Growth Fund before making a decision.')
  })

  it('reads the hint safely before the idea has loaded', () => {
    expect(testTheTradeHint(undefined, undefined)).toBe('See how this trade would change the portfolio before making a decision.')
  })

  it('offers Open Trade Lab once the reader is on it', () => {
    expect(step3().action?.label).toBe('Open Trade Lab')
  })

  it('uses the tutorial idea s own portfolio', () => {
    const nav = installNavigator(true)
    step3().action!.onClick()
    expect(nav.seen[0].detail.portfolioId).toBe('p-idea')
    nav.remove()
  })

  it('falls back to the waiting decision request s portfolio for an idea captured without one', () => {
    idea = { id: TUTORIAL, portfolio_id: null, assets: { symbol: 'NVDA' }, portfolios: null }
    const s = step3()
    expect(s.hint).toBe('See how NVDA would change Card Fund before making a decision.')
    const nav = installNavigator(true)
    s.action!.onClick()
    expect(nav.seen[0].detail.portfolioId).toBe('p-card')
    nav.remove()
  })

  it('is not offered, and reads nothing, before step 3', () => {
    progress = { ...onStep3(), hasCompletedPipelineStepInbox: false }
    expect(step3().action).toBeUndefined()
    expect(requestedFor.every(id => id === undefined)).toBe(true)
    expect(ideaQueryEnabled.every(e => !e)).toBe(true)
  })

  it('is not offered once step 3 is done', () => {
    progress = { ...onStep3(), hasCompletedPipelineStepTradeLab: true }
    expect(step3().action).toBeUndefined()
  })

  it('is not offered without a tutorial idea', () => {
    progress = { ...onStep3(), tutorialIdeaId: null }
    expect(step3().action).toBeUndefined()
  })

  it('is not offered until a portfolio is known', () => {
    idea = { id: TUTORIAL, portfolio_id: null, assets: { symbol: 'NVDA' }, portfolios: null }
    requests = []
    expect(step3().action).toBeUndefined()
  })

  it('is not offered to a reader who is not a pilot', () => {
    pilot = false
    expect(step3().action).toBeUndefined()
  })
})

describe('the step 3 CTA', () => {
  let nav: ReturnType<typeof installNavigator> | null = null
  afterEach(() => { nav?.remove(); nav = null })

  it('launches the tutorial idea into Trade Lab for its portfolio', () => {
    nav = installNavigator(true)
    step3().action!.onClick()
    expect(nav.seen).toHaveLength(1)
    expect(nav.seen[0].type).toBe('openTradeLab')
    expect(nav.seen[0].detail).toEqual({
      portfolioId: 'p-idea',
      tradeQueueItemId: TUTORIAL,
      source: PIPELINE_BASICS_CTA_SOURCE,
    })
  })

  it('completes step 3 when Trade Lab navigation succeeds', () => {
    nav = installNavigator(true)
    step3().action!.onClick()
    expect(mark.mock.calls).toEqual([['pipeline_step_tradelab']])
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
})

describe('the banner on a phone', () => {
  const steps = (over: Partial<PilotStep> = {}): PilotStep[] => [
    { n: 1, title: 'Move', hint: 'h1', done: true },
    { n: 2, title: 'Inbox', hint: 'h2', done: true },
    {
      n: 3, title: 'Test the trade', hint: 'See how NVDA would change Growth Fund before making a decision.',
      done: false, action: { label: 'Open Trade Lab', onClick: vi.fn() }, ...over,
    },
  ]
  const phone = (c: HTMLElement) => c.querySelector('.sm\\:hidden') as HTMLElement

  it('shows the title, keeps the hint, and gives the CTA its own row', () => {
    const s = steps()
    const { container } = render(<PilotStepsBanner steps={s} label="Pipeline basics" variant="inset" />)
    const p = phone(container)
    expect(p.textContent).toContain('Test the trade')
    expect(p.textContent).toContain('See how NVDA would change Growth Fund before making a decision.')
    const btn = p.querySelector('[data-slot="pilot-steps-action"]') as HTMLButtonElement
    expect(btn.textContent).toContain('Open Trade Lab')
    expect(btn.className).toContain('w-full')
    fireEvent.click(btn)
    expect(s[2].action!.onClick).toHaveBeenCalledTimes(1)
  })

  it('still drops the hint for a step with no action once a step is done', () => {
    const { container } = render(<PilotStepsBanner steps={steps({ action: undefined })} />)
    expect(phone(container).textContent).not.toContain('See how NVDA')
  })

  it('does not show the CTA while an earlier step is current, or once it is done', () => {
    const early = steps()
    early[1] = { ...early[1], done: false }
    expect(render(<PilotStepsBanner steps={early} />).container.querySelector('[data-slot="pilot-steps-action"]')).toBeNull()
    expect(render(<PilotStepsBanner steps={steps({ done: true })} />).container.querySelector('[data-slot="pilot-steps-action"]')).toBeNull()
  })

  it('leaves the desktop row without an action control', () => {
    const { container } = render(<PilotStepsBanner steps={steps()} />)
    expect((container.querySelector('.sm\\:flex') as HTMLElement).querySelector('[data-slot="pilot-steps-action"]')).toBeNull()
  })
})

describe('one route for every entry point', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
  const mobile = src('components/mobile/MobilePipeline.tsx')

  it('is navigated by the existing DashboardPage listener, which confirms it and carries the idea', () => {
    const page = src('pages/DashboardPage.tsx')
    const handler = page.slice(page.indexOf('const handleOpenTradeLab'), page.indexOf("window.addEventListener('openTradeLab'"))
    expect(handler).toContain("type: 'trade-lab'")
    expect(handler).toContain('...(tradeQueueItemId ? { tradeQueueItemId } : {})')
    expect(handler.indexOf('navigateRef.current(')).toBeLessThan(handler.indexOf('event.preventDefault()'))
  })

  it('keeps the Decision Inbox Trade Lab action as it was', () => {
    const inbox = src('components/trading/DecisionInbox.tsx')
    expect(inbox).toContain("window.dispatchEvent(new CustomEvent('openTradeLab', {")
    expect(inbox).toContain('detail: { portfolioId: request.portfolio_id },')
  })

  it('makes the phone card portfolio open Trade Lab for this idea and this portfolio', () => {
    const card = mobile.slice(mobile.indexOf('function PipelineCard'), mobile.indexOf('function Fact'))
    expect(card).toContain('requestOpenTradeLab({ portfolioId, tradeQueueItemId: subject.id })')
    expect(card).toContain('e.stopPropagation()')
    // A control of its own, so the card can no longer be a <button> around it.
    expect(card).toContain('role="button"')
    expect(card).not.toMatch(/return \(\s*<button/)
  })

  it('keeps the analyst name out of the link', () => {
    const card = mobile.slice(mobile.indexOf('function PipelineCard'), mobile.indexOf('function Fact'))
    const link = card.slice(card.indexOf('data-slot="pipeline-card-portfolio"'), card.indexOf('</button>', card.indexOf('data-slot="pipeline-card-portfolio"')))
    expect(link).toContain('{portfolioName}')
    expect(link).not.toContain('users')
    expect(card.indexOf('subject?.users')).toBeGreaterThan(card.indexOf('data-slot="pipeline-card-portfolio"'))
  })

  it('has the board listeners leave CTA events to the CTA', () => {
    for (const f of ['pages/TradeQueuePage.tsx', 'components/mobile/MobilePipeline.tsx']) {
      const s = src(f)
      const at = s.indexOf('if (isPipelineBasicsCtaEvent(e)) return')
      expect(at).toBeGreaterThan(-1)
      expect(s.indexOf("window.addEventListener('openTradeLab', handler)", at)).toBeGreaterThan(at)
    }
  })

  it('adds no route of its own in the banner', () => {
    const hook = src('hooks/usePilotPipelineBanner.ts')
    expect(hook).toContain('requestOpenTradeLab(')
    expect(hook).not.toMatch(/navigate\(|useNavigate|history\.push|type: 'trade-lab'/)
  })
})
