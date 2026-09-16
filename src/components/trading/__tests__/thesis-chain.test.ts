/**
 * A committed trade can say why anybody wanted it.
 *
 * The chain from `accepted_trades` back to the analyst's case was never broken
 * in the schema -- `accepted_trades.trade_queue_item_id` is populated on every
 * row in production -- it was broken in the SELECT. `TRADE_SELECT` embedded
 * `trade_queue_items` for pair structure only (id, pair_id, pair_trade_id,
 * pair_leg_type, action), so Trade Book could show `acceptance_note` and the
 * batch description and nothing else. On an inbox accept `acceptance_note` is
 * frequently null, which left the most consequential record in the product with
 * no stated reason at all.
 *
 * These pin the read path, because that is where it broke and where it would
 * break again: someone trimming the embed for payload size would take the case
 * out with it and nothing else in the suite would notice.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

describe('the canonical trade select', () => {
  const service = src('lib/services/accepted-trade-service.ts')
  const embed = service.slice(service.indexOf('const TRADE_SELECT'), service.indexOf('const COMMENT_SELECT'))

  it('reads the case through the join the row already carries', () => {
    expect(embed).toContain('rationale')
    expect(embed).toContain('thesis_text')
    // Through the existing FK embed, not a second query.
    expect(embed).toContain('accepted_trades_trade_queue_item_id_fkey')
    expect(embed.match(/trade_queue_items!/g)).toHaveLength(1)
  })

  /* A copy would drift from the idea it came from the first time an analyst
     edited their thesis. The point of the join is that it cannot. */
  it('does not copy the text onto the trade', () => {
    expect(service).not.toMatch(/acceptance_note\s*[:=]\s*[^,\n]*rationale/)
    expect(service).not.toContain('thesis_text:')
  })

  it('keeps the pair structure it was already reading', () => {
    for (const field of ['pair_id', 'pair_trade_id', 'pair_leg_type']) {
      expect(embed).toContain(field)
    }
  })
})

/*
 * `lab_variants` are hard-deleted immediately after a commit, so whatever
 * reason was not copied onto the `accepted_trade` at that moment is gone for
 * good. The bulk path collects a per-variant reason and a batch description
 * from the Execute modal; the single-trade path sent neither, so the
 * precedence in `buildAcceptedTradeInput` fell through to `v.notes || null`.
 */
describe('single execute records why', () => {
  const page = src('pages/SimulationPage.tsx')
  const single = page.slice(
    page.indexOf('const executeTradeM = useMutation({'),
    page.indexOf('// ── PM Action: Bulk'),
  )

  it('carries the idea case into the commit', () => {
    expect(single).toContain('reasonsByVariantId: ideaCase ? { [variant.id]: ideaCase } : undefined')
    expect(single).toContain("idea.thesis_text || idea.rationale")
  })

  /* The existing canonical field, by the existing precedence. A second store
     for the same sentence is how two surfaces come to disagree. */
  it('writes nowhere new', () => {
    expect(single).not.toContain('acceptance_note:')
    expect(single).not.toContain('.insert(')
  })

  it('leaves the precedence itself alone', () => {
    const svc = src('lib/services/execute-sim-variants-service.ts')
    const build = svc.slice(svc.indexOf('acceptance_note:'))
    expect(build.slice(0, 200)).toContain('(reason && reason.trim())')
    expect(build.slice(0, 200)).toContain('|| v.notes')
  })
})

/*
 * The Decision Inbox accept had the analyst's words in its own argument and
 * threw them away: `acceptance_note: decisionNote || null`. The PM note is
 * optional on the single accept and passed as `undefined` outright by the
 * pair-leg accept, so the common case wrote NULL -- 15 of 52 committed trades
 * in production carry no note at all.
 */
describe('an inbox accept keeps the reason it was given', () => {
  const svc = src('lib/services/accepted-trade-service.ts')
  const fn = svc.slice(svc.indexOf('export async function acceptFromInboxToAcceptedTrade'))
  const body = fn.slice(0, fn.indexOf('// Update decision request status'))

  it('falls back through the context it already holds', () => {
    expect(body).toContain('decisionRequest.context_note')
    expect(body).toContain('decisionRequest.trade_queue_item?.thesis_text')
    expect(body).toContain('decisionRequest.trade_queue_item?.rationale')
  })

  /* Falls back, never overwrites — an explicit PM note is the best answer. */
  it('still prefers the PM note when there is one', () => {
    const note = body.slice(body.indexOf('acceptance_note:'))
    expect(note.indexOf('decisionNote')).toBeLessThan(note.indexOf('context_note'))
  })

  /* Nothing invented when all of them are empty. */
  it('writes null when there is genuinely nothing', () => {
    expect(body.slice(body.indexOf('acceptance_note:'), body.indexOf('acceptance_note:') + 400))
      .toContain('|| null')
  })

  it('uses the existing canonical field and no other', () => {
    expect(body).not.toContain('rationale:')
    expect(body).not.toContain('thesis_text:')
  })
})

describe('the rationale log shows it, in order', () => {
  const log = src('components/trading/AcceptedTradesTable.tsx')
  const fn = log.slice(log.indexOf('export function TradeRationaleLog'))

  it('takes the case as its own input', () => {
    expect(fn.slice(0, 1200)).toContain('originalCase')
  })

  /* Why anybody wanted the trade comes before why the PM took it. */
  it('renders the case ahead of the commit note', () => {
    const body = fn.slice(0, fn.indexOf('function ') > 0 ? undefined : undefined)
    expect(body.indexOf('trade-rationale-original')).toBeGreaterThan(-1)
    expect(body.indexOf('trade-rationale-original'))
      .toBeLessThan(body.indexOf('trade-rationale-initial'))
  })

  /* One paragraph under two labels reads as two findings. */
  it('suppresses it when it would only repeat what is already shown', () => {
    expect(fn).toContain('original !== initial')
    expect(fn).toContain('original !== batchDesc')
  })

  it('is wired on every surface that renders the log', () => {
    // Desktop drawer, and both phone/desktop paths in the batch view.
    expect(log.match(/originalCase=/g)?.length).toBeGreaterThanOrEqual(1)
    const batch = src('components/trading/BatchListView.tsx')
    expect(batch.match(/originalCase=/g)).toHaveLength(2)
    // Thesis preferred over rationale: the durable case over the timing note.
    expect(batch).toContain('thesis_text || trade.trade_queue_item?.rationale')
  })
})
