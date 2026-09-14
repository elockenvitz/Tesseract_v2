/**
 * The post-execution handoff, and Trade Book on a phone.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * Two scroll containers were live at once in the Decision Recorded modal: the
 * fixed layer scrolled, and the body inside the card scrolled within its own
 * max-h-viewport-60. The card was taller than a phone screen, so the footer —
 * sticky only within the card — went off the bottom with it, and the only way
 * to find "View in Trade Book" was to scroll past every captured-context block.
 *
 * In Trade Book, the batch's trades were a 720px table with a frozen ticker
 * column, so reading one trade on a 390px screen meant dragging sideways with
 * only the symbol anchored. And once a batch had a rationale, its Edit button
 * was revealed on hover — which a phone does not have — so the field could not
 * be changed there at all.
 *
 * These read source. The claims are about which element scrolls, which
 * container a control renders into, and which write path an event follows;
 * none of that is legible in a render of a 1,700-line batch view.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const modal = src('components/trading/DecisionConfirmationModal.tsx')
const batchView = src('components/trading/BatchListView.tsx')
const tutorial = src('components/pilot/PilotTradeBookGetStarted.tsx')
const page = src('pages/SimulationPage.tsx')
const tradeBook = src('pages/TradeBookPage.tsx')
const executeService = src('lib/services/execute-sim-variants-service.ts')
const acceptedTable = src('components/trading/AcceptedTradesTable.tsx')

describe('the decision handoff scrolls once', () => {
  it('does not leave two scroll containers live on a phone', () => {
    const shell = modal.slice(modal.indexOf("'fixed inset-0 z-[100]'"))
    expect(shell.slice(0, 300)).toContain("isMobile ? 'overflow-hidden' : 'overflow-y-auto'")

    // The body is the one scroller, and it is bounded by flex rather than by
    // a viewport fraction that can exceed what is left on screen.
    const body = modal.slice(modal.indexOf("'overflow-y-auto overscroll-contain'"))
    expect(body.slice(0, 300)).toContain("isMobile ? 'flex-1 min-h-0 px-4 py-3 space-y-3'")
    expect(body.slice(0, 300)).toContain('max-h-viewport-60')
  })

  /**
   * `sticky bottom-0` pins a child within its own parent. When the parent is
   * taller than the screen and an ancestor scrolls, that is not the screen —
   * which is why the primary action could leave the viewport.
   */
  it('keeps the primary action on screen by construction, not by sticky', () => {
    const footer = modal.slice(modal.indexOf('{/* ─── Footer CTAs'))
    const head = footer.slice(0, 600)
    expect(head).toContain("isMobile ? 'px-4 pt-3 pb-safe' : 'px-6 pt-4 pb-5 sticky bottom-0'")
    expect(head).toContain('shrink-0')
    expect(footer).toContain('data-slot="decision-view-trade-book"')
    // Stay in Trade Lab stays, and stays secondary.
    expect(footer).toContain('Stay in Trade Lab')
    expect(footer.indexOf('data-slot="decision-view-trade-book"'))
      .toBeLessThan(footer.indexOf('Stay in Trade Lab'))
  })

  /** Context is preserved and one tap away, rather than in front of the exit. */
  it('collapses per-trade context on a phone', () => {
    expect(modal).toContain('data-slot="decision-captured-toggle"')
    expect(modal).toContain('const [capturedOpen, setCapturedOpen] = useState(false)')
    expect(modal).toContain('{(!isMobile || capturedOpen) && (')
    // Nothing was deleted — the same blocks render once opened.
    expect(modal).toContain('<CapturedBlock key={d.tradeId} decision={d} isMulti={isMulti} />')
  })

  /** The executed summary is above the collapsed context, not below it. */
  it('keeps what was executed prominent', () => {
    expect(modal.indexOf('What was executed'))
      .toBeLessThan(modal.indexOf('data-slot="decision-captured-toggle"'))
  })

  /**
   * Lands on the batch, not a generic list. The id is carried from the
   * execute result through the record, the CTA, the navigate event and the
   * destination page's one-shot selection effect.
   */
  it('carries the new batch all the way to the destination', () => {
    expect(modal).toContain('onViewTradeBook({ tradeIds: ids, batchId: record?.batchId ?? null })')
    const handler = page.slice(page.indexOf('onViewTradeBook={({ tradeIds, batchId }) => {'))
    expect(handler.slice(0, 1400)).toContain('highlightBatchId: batchId ?? undefined')
    expect(tradeBook).toContain('highlightBatchId ?? persisted.selectedBatchId ?? null')
    expect(tradeBook).toContain('setSelectedBatchId(highlightBatchId)')
  })
})

/*
 * ── Rationale is one model, not three ──────────────────────────────────────
 *
 * trade_batches.description is the decision-level explanation.
 * accepted_trades.acceptance_note is per-trade and INHERITS that description
 * at commit when no per-trade reason was given. Nothing here should introduce
 * a second place to store either.
 */
describe('the rationale model', () => {
  it('inherits the batch rationale onto trades at commit', () => {
    const build = executeService.slice(executeService.indexOf('acceptance_note:'))
    const precedence = build.slice(0, 220)
    // Per-trade reason, then batch description, then variant notes, then null.
    expect(precedence).toContain('(reason && reason.trim())')
    expect(precedence).toContain('|| (batchDescription && batchDescription.trim())')
    expect(precedence).toContain('|| v.notes')
  })

  it('shows an inherited note as inherited rather than asking again', () => {
    expect(acceptedTable).toContain('const isInherited = initial.length > 0 && initial === batchDesc')
  })

  /** One write target for the decision rationale: trade_batches.description. */
  it('keeps the decision rationale in the column it already has', () => {
    const editor = batchView.slice(batchView.indexOf('function BatchRationaleEditor'))
    expect(editor).toContain('description: saved || null')
    // Named as the batch's one question, apart from per-trade notes.
    expect(batchView).toContain('Why this decision?')
    expect(acceptedTable).toContain('Trade-specific notes')
  })
})

/*
 * ── One writer for baseline_holdings ───────────────────────────────────────
 *
 * Two background tasks wrote the same JSONB column after a bulk execute and
 * neither waited for the other: the service's pro-forma fold (existing
 * baseline + this trade's deltas) and SimulationPage's re-snapshot (replace
 * wholesale from portfolio_holdings). Whichever landed second won. Re-snapshot
 * second was correct; fold second read a baseline that already contained the
 * trade and added its deltas again, so the executed position showed at double
 * size — and the fold's own gate means it runs on exactly the paper /
 * manual_eod portfolios the re-snapshot also runs on, so they always collide.
 */
describe('the post-execute simulation baseline', () => {
  it('hands the background work back instead of dropping it', () => {
    expect(executeService).toContain('settled: Promise<void>')
    expect(executeService).toContain('const settled = (async () => {')
    expect(executeService).toContain('return { batch, trades, failures, settled }')
    // The all-failed early return still satisfies the contract.
    expect(executeService).toContain('settled: Promise.resolve()')
  })

  /** The fold is still not awaited before the modal — only before the write. */
  it('does not delay the Decision Recorded moment', () => {
    const tail = executeService.slice(executeService.indexOf('const settled = (async () => {'))
    expect(tail.slice(0, 1200)).not.toContain('await settled')
  })

  it('orders the re-snapshot after the fold', () => {
    const resnap = page.slice(page.indexOf('if (committed > 0 && selectedSimulationId && selectedPortfolioId) {'))
    const body = resnap.slice(0, 2000)
    expect(body).toContain('await result.settled')
    // And it waits before reading, not after writing.
    expect(body.indexOf('await result.settled'))
      .toBeLessThan(body.indexOf("from('portfolio_holdings')"))
  })
})

describe('Trade Book on a phone', () => {
  it('calls its tutorial what it teaches', () => {
    expect(tutorial).toContain('label="Trade Book basics"')
  })

  /**
   * Every step has to name something a phone can actually do. Step 1 said
   * "click any trade row" of a table that scrolls sideways; step 2 named only
   * the per-trade note and not the batch rationale, which is the primary
   * field and the one the trades inherit.
   */
  it('names actions that exist on a phone, with the page’s own labels', () => {
    expect(tutorial).toContain('TRADE_BOOK_STEPS.map(')
    const steps = src('lib/pilot/trade-book-steps.ts')
    const hints = [...steps.matchAll(/hint: '([^']*)'/g)].map(m => m[1])
    expect(hints[0]).toBe('Open a trade in this batch to check its price, size and notes.')
    expect(hints.join(' ')).not.toMatch(/\bclick\b/i)
    expect(hints[1]).toContain('“Why this decision?”')
    expect(hints[1]).toContain('trade-specific note')
  })

  /** Step 1 fires from opening a real committed trade's audit, both surfaces. */
  it('ticks step one from the same act on either surface', () => {
    const dispatches = [...batchView.matchAll(/dispatchEvent\(new CustomEvent\('pilot-tradebook:trade-reviewed'\)\)/g)]
    // Desktop row, phone card tap, and the phone card opened by "Review the trade".
    expect(dispatches.length).toBe(3)
    const card = batchView.slice(batchView.indexOf('function MobileTradeCard'))
    expect(card.slice(0, 2600)).toContain('pilot-tradebook:trade-reviewed')
  })

  /**
   * Step 2 is a write, not a view: the batch rationale save fires it only for
   * a non-empty value, and a per-trade note fires it on submit.
   */
  it('ticks step two only from a real write', () => {
    const save = batchView.slice(batchView.indexOf('if (saved && saved.length > 0) {'))
    expect(save.slice(0, 300)).toContain('pilot-tradebook:rationale-added')
    expect(acceptedTable).toContain("pilot-tradebook:rationale-added")
  })

  it('replaces the sideways table with stacked cards', () => {
    expect(batchView).toContain('data-slot="tradebook-mobile-trade"')
    expect(batchView).toContain('<div className="md:hidden space-y-3">')
    expect(batchView).toContain('<div className="hidden md:block rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">')
    // The fields that were behind the drag.
    for (const label of ['Tgt Wt', 'Δ Wt', 'Notional']) {
      expect(batchView.slice(batchView.indexOf('function MobileTradeCard'))).toContain(label)
    }
  })

  /** Tapping a card opens the same rationale surface the table row opens. */
  it('opens the same trade detail the desktop row does', () => {
    const card = batchView.slice(batchView.indexOf('function MobileTradeCard'))
    expect(card).toContain('<TradeRationaleLog')
    expect(card).toContain('acceptanceNote={trade.acceptance_note}')
    expect(card).toContain('batchDescription={batchDescription}')
  })

  /**
   * A phone has no hover, so a hover-revealed Edit meant a batch that already
   * had a rationale could not have it changed there.
   */
  it('lets a filled rationale be edited without a hover', () => {
    expect(batchView).toContain('data-slot="batch-rationale-edit"')
    const edit = batchView.slice(batchView.indexOf('data-slot="batch-rationale-edit"'))
    expect(edit.slice(0, 400)).toContain('opacity-100 md:opacity-0 md:group-hover:opacity-100')
  })
})
