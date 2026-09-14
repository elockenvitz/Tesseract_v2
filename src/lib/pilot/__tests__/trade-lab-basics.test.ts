/**
 * Trade Lab basics step 1 — the simulation gained the tutorial idea.
 *
 * Observed 2026-09-14 in Symbol Cap: the tutorial idea was LLY (ac064e29).
 * The pilot added the seeded AAPL recommendation — proposal f52760f7 on
 * trade_queue_item ca5d93c8, created before LLY existed — and its written
 * simulation_trades row carried ca5d93c8. Not the tutorial idea, so the step
 * rightly stayed open; the hint had said "find the idea you captured" without
 * naming it or saying a seeded recommendation would not count.
 *
 * The rule runs on the rows the add mutation returned, so these walk it with
 * the rows shaped as `simulation_trades` comes back, and then pin that it is
 * called from the add mutations' success handlers and nowhere else.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, MutationObserver } from '@tanstack/react-query'
import {
  TRADE_LAB_STEP1_EVENT, addedTutorialIdea, reportTradeLabStep1, tradeLabStep1Hint,
} from '../trade-lab-basics'

const TUTORIAL = 'ac064e29-6b16-49f8-aea7-38f05a4a31cf'   // LLY, the captured idea
const SEEDED = 'ca5d93c8-5322-452a-990f-516c8e5a23e0'     // AAPL, the seeded recommendation's idea

/** A written simulation_trades row, as the upsert's `.select()` returns it. */
const row = (trade_queue_item_id: string | null) => ({ id: 'st-1', simulation_id: 'sim-1', asset_id: 'a-1', trade_queue_item_id })

const target = () => {
  const events: Event[] = []
  const dispatchEvent = vi.fn((event: Event) => { events.push(event); return true })
  return { dispatchEvent, fired: () => events.map(e => e.type) }
}

describe('what completes step 1', () => {
  it('completes when the tutorial idea itself is added', () => {
    const t = target()
    expect(reportTradeLabStep1([row(TUTORIAL)], TUTORIAL, t)).toBe(true)
    expect(t.fired()).toEqual([TRADE_LAB_STEP1_EVENT])
  })

  /** A recommendation raised on the tutorial idea writes that idea as its source. */
  it('completes when a recommendation derived from the tutorial idea is added', () => {
    const recommendationOnTutorial = { ...row(TUTORIAL), id: 'st-2', asset_id: 'lly' }
    const t = target()
    expect(reportTradeLabStep1([recommendationOnTutorial], TUTORIAL, t)).toBe(true)
  })

  it('completes when the tutorial idea is one of several legs written', () => {
    expect(addedTutorialIdea([row('leg-a'), row(TUTORIAL)], TUTORIAL)).toBe(true)
  })

  it('does not complete for an unrelated seeded recommendation', () => {
    const t = target()
    expect(reportTradeLabStep1([row(SEEDED)], TUTORIAL, t)).toBe(false)
    expect(t.dispatchEvent).not.toHaveBeenCalled()
  })

  it('does not complete for a manual position, which names no idea', () => {
    expect(addedTutorialIdea([row(null)], TUTORIAL)).toBe(false)
  })

  it('does not complete for a reader with no tutorial idea', () => {
    expect(addedTutorialIdea([row(TUTORIAL)], null)).toBe(false)
  })

  /** Inspecting writes nothing, so there are no rows to report. */
  it('does not complete when nothing was written', () => {
    const t = target()
    expect(reportTradeLabStep1([], TUTORIAL, t)).toBe(false)
    expect(reportTradeLabStep1(null, TUTORIAL, t)).toBe(false)
    expect(t.dispatchEvent).not.toHaveBeenCalled()
  })
})

/*
 * Failed adds. The report lives in `onSuccess`, and a mutation whose write
 * rejects never calls it. Driven through a real react-query MutationObserver
 * with the page's shape — upsert in mutationFn, report in onSuccess — so the
 * claim is about the lifecycle the page relies on, not a mock of it.
 */
describe('only after the add mutation succeeds', () => {
  const run = async (write: () => Promise<{ trade_queue_item_id: string | null }>) => {
    const t = target()
    const observer = new MutationObserver(new QueryClient(), {
      mutationFn: write,
      onSuccess: (data: { trade_queue_item_id: string | null }) => { reportTradeLabStep1([data], TUTORIAL, t) },
    })
    await observer.mutate().catch(() => undefined)
    return t
  }

  it('reports a successful add of the tutorial idea', async () => {
    const t = await run(async () => row(TUTORIAL))
    expect(t.fired()).toEqual([TRADE_LAB_STEP1_EVENT])
  })

  it('does not report a failed add, even of the tutorial idea', async () => {
    const t = await run(async () => { throw new Error('insert or update on table "simulation_trades" violates foreign key constraint') })
    expect(t.dispatchEvent).not.toHaveBeenCalled()
  })
})

describe('the page reports from the writes, and from nothing else', () => {
  const page = readFileSync(path.join(process.cwd(), 'src/pages/SimulationPage.tsx'), 'utf8')
  const block = (start: string, end: string) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start)))

  it('reports a single add from importTradeMutation.onSuccess, after a toggle-off is undone', () => {
    const importTrade = block('const importTradeMutation = useMutation({', 'const importPairTradeMutation = useMutation({')
    const onSuccess = importTrade.slice(importTrade.indexOf('onSuccess:'), importTrade.indexOf('onError:'))
    const onError = importTrade.slice(importTrade.indexOf('onError:'))
    const toggledOffReturn = onSuccess.indexOf('return\n')
    const report = onSuccess.indexOf('reportTradeLabStep1([data], tutorialIdeaId)')
    expect(report).toBeGreaterThan(-1)
    expect(report).toBeGreaterThan(toggledOffReturn)
    expect(onError).not.toContain('reportTradeLabStep1')
    // Not from the client-side object: `data` is what the upsert returned.
    expect(importTrade.slice(0, importTrade.indexOf('onSuccess:'))).not.toContain('reportTradeLabStep1')
  })

  it('reports a pair add from importPairTradeMutation.onSuccess, skipping legs toggled off', () => {
    const importPair = block('const importPairTradeMutation = useMutation({', 'onError: (_err, pairTradeLegs)')
    const onSuccess = importPair.slice(importPair.indexOf('onSuccess:'))
    expect(onSuccess).toContain('reportTradeLabStep1(')
    expect(onSuccess).toContain('.filter(trade => checkboxOverridesRef.current.get(trade.asset_id) !== false)')
    expect(importPair.slice(0, importPair.indexOf('onSuccess:'))).not.toContain('reportTradeLabStep1')
  })

  it('has no other route to the step: no direct dispatch, no report on remove or inspect', () => {
    expect(page.match(/reportTradeLabStep1\(/g)).toHaveLength(2)
    expect(page).not.toContain("new CustomEvent('pilot-tradelab:rec-reviewed')")
    for (const fn of ['const handleRemoveAsset = useCallback', 'const handleAddAsset = useCallback', 'const toggleProposalInSimulation = useCallback']) {
      expect(block(fn, '}, [')).not.toContain('reportTradeLabStep1')
    }
  })

  /** The recommendation keeps its source idea into the write rather than a random id. */
  it('carries a recommendation s source trade_queue_item_id into the add', () => {
    expect(page).toContain('tradeQueueItemId: tradeItem?.id ?? proposal.trade_queue_item_id ?? undefined,')
  })
})

describe('the wording says what counts', () => {
  it('names the idea, the control, and what does not count', () => {
    expect(tradeLabStep1Hint('LLY')).toBe(
      "In Ideas & recommendations, tap Add to simulation on LLY — the idea itself, or a recommendation made on it. Other recommendations don't count.",
    )
  })

  it('still reads before the idea has loaded', () => {
    expect(tradeLabStep1Hint(null)).toContain('the idea you captured')
  })

  it('is what the banner shows, with the tutorial symbol from the page', () => {
    const banner = readFileSync(path.join(process.cwd(), 'src/components/pilot/PilotTradeLabIntroBanner.tsx'), 'utf8')
    expect(banner).toContain('hint: tradeLabStep1Hint(tutorialSymbol),')
    expect(banner).toContain('window.addEventListener(TRADE_LAB_STEP1_EVENT, onStep1)')
    const page = readFileSync(path.join(process.cwd(), 'src/pages/SimulationPage.tsx'), 'utf8')
    expect(page).toContain('tutorialSymbol={tradeIdeas?.find(i => i.id === tutorialIdeaId)?.assets?.symbol ?? null}')
  })
})
