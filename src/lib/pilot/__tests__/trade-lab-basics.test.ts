/**
 * Trade Lab basics step 1 — the LOCAL banner step.
 *
 * It completes when a trade from Ideas & recommendations is actually written
 * into the simulation: any idea or recommendation. It never completes from
 * inspecting, from a removal, from a manual position, or from an add that
 * failed. And adding is not executing: the global mission moves on an
 * executed trade, not on this step.
 *
 * The rule runs on the rows the add mutation returned, so these walk it with
 * rows shaped as `simulation_trades` comes back, then pin that it is called
 * from the add mutations' success handlers and nowhere else.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, MutationObserver } from '@tanstack/react-query'
import {
  TRADE_LAB_STEP1_EVENT, completesTradeLabStep1, reportTradeLabStep1, tradeLabStep1Hint,
} from '../trade-lab-basics'
import { missionState } from '../mission'

const TUTORIAL = 'ac064e29-6b16-49f8-aea7-38f05a4a31cf'   // LLY, the captured idea
const SEEDED = 'ca5d93c8-5322-452a-990f-516c8e5a23e0'     // AAPL, the seeded recommendation's idea

const row = (trade_queue_item_id: string | null) => ({ id: 'st-1', simulation_id: 'sim-1', asset_id: 'a-1', trade_queue_item_id })

const target = () => {
  const events: Event[] = []
  const dispatchEvent = vi.fn((event: Event) => { events.push(event); return true })
  return { dispatchEvent, fired: () => events.map(e => e.type) }
}

describe('what completes the local step', () => {
  it('completes for a recommendation add that was written — even a seeded one', () => {
    const t = target()
    expect(reportTradeLabStep1([row(SEEDED)], t)).toBe(true)
    expect(t.fired()).toEqual([TRADE_LAB_STEP1_EVENT])
  })

  it('completes for the tutorial idea', () => {
    expect(completesTradeLabStep1([row(TUTORIAL)])).toBe(true)
  })

  it('completes for any other idea too — pilots may use any idea', () => {
    expect(completesTradeLabStep1([row(SEEDED)])).toBe(true)
  })

  it('does not complete for a manual position, which names no idea', () => {
    expect(completesTradeLabStep1([row(null)])).toBe(false)
  })

  /** Inspecting or opening writes nothing, so there are no rows to report. */
  it('does not complete when nothing was written', () => {
    const t = target()
    expect(reportTradeLabStep1([], t)).toBe(false)
    expect(reportTradeLabStep1(null, t)).toBe(false)
    expect(t.dispatchEvent).not.toHaveBeenCalled()
  })
})

/*
 * The local step does not reach the mission. Adding the seeded recommendation
 * teaches the banner step; the mission's "Test the trade" moves on a simulation
 * row for the tutorial idea or on an executed trade, and an add is neither.
 */
describe('adding is not executing', () => {
  it('leaves the mission on its simulation step after an unrelated add completes the local step', () => {
    expect(completesTradeLabStep1([row(SEEDED)])).toBe(true)
    const m = missionState({
      tutorialIdeaId: TUTORIAL,
      ideaExists: true,
      ideaStage: 'investigate',
      pipelineBasics: { moved: true, inboxOpened: true, tradeLabOpened: true },
      // What usePilotMission reads for the tutorial idea: no row of its own.
      hasSimulationTrade: false,
      hasDecision: false,
      outcomeReviewedAt: null,
    })
    expect(m.currentStepId).toBe('simulation_completed')
  })

  it('does not listen to the local step event', () => {
    const mission = readFileSync(path.join(process.cwd(), 'src/hooks/usePilotMission.ts'), 'utf8')
    expect(mission).not.toContain('pilot-tradelab:rec-reviewed')
    expect(mission).toContain(".eq('trade_queue_item_id', id)")
  })
})

/*
 * Failed adds, through a real react-query MutationObserver shaped like the
 * page's add: upsert in mutationFn, report in onSuccess.
 */
describe('only after the add mutation succeeds', () => {
  const run = async (write: () => Promise<{ trade_queue_item_id: string | null }>) => {
    const t = target()
    const observer = new MutationObserver(new QueryClient(), {
      mutationFn: write,
      onSuccess: (data: { trade_queue_item_id: string | null }) => {
        reportTradeLabStep1([data], t)
      },
    })
    await observer.mutate().catch(() => undefined)
    return t
  }

  it('reports a recommendation add that succeeded', async () => {
    const t = await run(async () => row(SEEDED))
    expect(t.fired()).toEqual([TRADE_LAB_STEP1_EVENT])
  })

  it('does not report a recommendation add that failed', async () => {
    const t = await run(async () => { throw new Error('insert on simulation_trades failed') })
    expect(t.dispatchEvent).not.toHaveBeenCalled()
  })
})

describe('the page reports from the writes, and from nothing else', () => {
  const page = readFileSync(path.join(process.cwd(), 'src/pages/SimulationPage.tsx'), 'utf8')
  const block = (start: string, end: string) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start)))

  it('reports a single add from importTradeMutation.onSuccess, after a toggle-off is undone', () => {
    const importTrade = block('const importTradeMutation = useMutation({', 'const importPairTradeMutation = useMutation({')
    const onSuccess = importTrade.slice(importTrade.indexOf('onSuccess:'), importTrade.indexOf('onError:'))
    const report = onSuccess.indexOf('reportTradeLabStep1([data])')
    expect(report).toBeGreaterThan(onSuccess.indexOf('return\n'))
    expect(importTrade.slice(importTrade.indexOf('onError:'))).not.toContain('reportTradeLabStep1')
    expect(importTrade.slice(0, importTrade.indexOf('onSuccess:'))).not.toContain('reportTradeLabStep1')
  })

  it('tags every recommendation add path with its proposal', () => {
    // toggleProposalInSimulation (desktop checkbox and phone drawer) …
    expect(page).toContain('_proposalId: proposal.id, // Provenance: which recommendation this came from')
    // … and the desktop pair-recommendation leg row.
    expect(page).toContain('_proposalId: proposal.id, // Provenance: the recommendation this leg came from')
  })

  it('reports a pair add from importPairTradeMutation.onSuccess, skipping legs toggled off', () => {
    const importPair = block('const importPairTradeMutation = useMutation({', 'onError: (_err, pairTradeLegs)')
    const onSuccess = importPair.slice(importPair.indexOf('onSuccess:'))
    expect(onSuccess).toContain('.filter(trade => checkboxOverridesRef.current.get(trade.asset_id) !== false)')
  })

  it('has no other route to the step', () => {
    expect(page.match(/reportTradeLabStep1\(/g)).toHaveLength(2)
    expect(page).not.toContain("new CustomEvent('pilot-tradelab:rec-reviewed')")
    for (const fn of ['const handleRemoveAsset = useCallback', 'const handleAddAsset = useCallback', 'const toggleProposalInSimulation = useCallback']) {
      expect(block(fn, '}, [')).not.toContain('reportTradeLabStep1')
    }
  })
})

describe('the wording says what counts', () => {
  it('names the action, says any idea works, and offers the tutorial idea as an example', () => {
    expect(tradeLabStep1Hint('LLY')).toBe('In Ideas & recommendations, tap Add to simulation on any idea or recommendation, like LLY.')
    expect(tradeLabStep1Hint(null)).toBe('In Ideas & recommendations, tap Add to simulation on any idea or recommendation.')
  })

  it('is what the banner shows', () => {
    const banner = readFileSync(path.join(process.cwd(), 'src/components/pilot/PilotTradeLabIntroBanner.tsx'), 'utf8')
    expect(banner).toContain("title: 'Add a trade to the simulation',")
    expect(banner).toContain('hint: tradeLabStep1Hint(tutorialSymbol),')
  })
})
