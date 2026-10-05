/**
 * The one-open-trade-per-name invariant, written down.
 *
 * Production enforces:
 *
 *   CREATE UNIQUE INDEX idx_accepted_trades_unique_open
 *     ON public.accepted_trades (portfolio_id, asset_id)
 *     WHERE (is_active = true AND execution_status <> 'complete')
 *
 * At most one ACTIVE, NON-COMPLETE accepted trade per portfolio+asset. It
 * is a correct invariant and this release does not weaken it.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The index is in no migration — it was created outside the ledger, so
 * there is no SQL in the repository to review or to pin. Nothing in `src/`
 * referenced it either. The first real Approve & Execute in production hit
 * it and the PM was shown `duplicate key value violates unique constraint
 * "idx_accepted_trades_unique_open"`.
 *
 * This records the predicate as the code understands it, so the two
 * release-together conditions are explicit:
 *
 *   `complete`   releases the slot (the WHERE excludes it)
 *   `is_active = false` releases the slot
 *
 * and so the lifecycle code that depends on those — completion, cancel,
 * revert — is checked against a written contract rather than against
 * somebody's memory of a production index.
 *
 * This is deliberately NOT generalised schema-drift cleanup. Writing the
 * index into a migration is the right follow-up and is left as one.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OPEN_TRADE_INDEX, isOpenTradeConflict, openTradeConflictMessage } from '../approve-errors'

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const SERVICE = codeOf(readFileSync(resolve(SRC, 'lib/services/accepted-trade-service.ts'), 'utf8'))

/**
 * The live predicate, verified against production on 2026-10-05 via
 * `pg_indexes`. Expressed as a predicate function so the release conditions
 * are executable rather than prose.
 */
const occupiesOpenSlot = (t: { is_active: boolean; execution_status: string }) =>
  t.is_active === true && t.execution_status !== 'complete'

describe('what occupies the open-trade slot', () => {
  it('an active, not-started trade does', () => {
    // Exactly the stranded production row that blocked SHOP.
    expect(occupiesOpenSlot({ is_active: true, execution_status: 'not_started' })).toBe(true)
  })

  it('an active, in-progress trade does', () => {
    expect(occupiesOpenSlot({ is_active: true, execution_status: 'in_progress' })).toBe(true)
  })

  it('a COMPLETE trade does not — completion releases the name', () => {
    // Why a successfully executed prior recommendation can never block a
    // later one: the pilot flow reaches `complete` in the same call.
    expect(occupiesOpenSlot({ is_active: true, execution_status: 'complete' })).toBe(false)
  })

  it('an INACTIVE trade does not — revert and cancel release the name', () => {
    expect(occupiesOpenSlot({ is_active: false, execution_status: 'not_started' })).toBe(false)
    expect(occupiesOpenSlot({ is_active: false, execution_status: 'cancelled' })).toBe(false)
  })

  it('a cancelled trade left ACTIVE would still occupy it', () => {
    // The gap this release closes: 'cancelled' <> 'complete', so relabelling
    // without deactivating frees nothing.
    expect(occupiesOpenSlot({ is_active: true, execution_status: 'cancelled' })).toBe(true)
  })
})

describe('the lifecycle code honours those release conditions', () => {
  it('cancelling deactivates', () => {
    expect(SERVICE).toMatch(/status === 'cancelled'[\s\S]{0,400}updates\.is_active = false/)
  })

  it('reverting deactivates', () => {
    expect(SERVICE).toMatch(/is_active: false,\s*reverted_at:/)
  })

  it('a proven execution completes, which is the other release', () => {
    expect(SERVICE).toContain("execution_status: 'complete'")
  })
})

describe('the conflict never reaches the PM as Postgres output', () => {
  const PG_ERROR = {
    code: '23505',
    message: `duplicate key value violates unique constraint "${OPEN_TRADE_INDEX}"`,
  }

  it('recognises the real error shape', () => {
    expect(isOpenTradeConflict(PG_ERROR)).toBe(true)
  })

  it('does not claim an unrelated unique violation is an open-trade conflict', () => {
    // Mislabelling would send the PM to the Trade Book to clear a trade
    // that has nothing to do with the failure.
    expect(isOpenTradeConflict({
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_decision_requests_active_per_requester"',
    })).toBe(false)
  })

  it('does not treat a non-unique error as a conflict', () => {
    expect(isOpenTradeConflict({ code: '23503', message: 'foreign key violation' })).toBe(false)
    expect(isOpenTradeConflict(null)).toBe(false)
  })

  it('the message names the asset, the book and the way out', () => {
    const m = openTradeConflictMessage('SHOP', 'Tech & Consumer Growth')
    expect(m).toContain('SHOP')
    expect(m).toContain('Tech & Consumer Growth')
    expect(m).toMatch(/Complete, cancel or revert/)
  })

  it('the message carries no Postgres vocabulary', () => {
    const m = openTradeConflictMessage('SHOP', 'Tech & Consumer Growth')
    expect(m).not.toMatch(/23505|duplicate key|unique constraint|idx_|null value|violates/)
  })

  it('reads sensibly when the symbol is unknown', () => {
    expect(openTradeConflictMessage(null, null)).toMatch(/^This asset already has an open trade\./)
  })
})
