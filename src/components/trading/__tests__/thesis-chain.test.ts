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
