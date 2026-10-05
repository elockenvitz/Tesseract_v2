/**
 * Why an Approve & Execute could not proceed, in words a PM can act on.
 *
 * Both of these stop the operation BEFORE any write, which is the point.
 * Under the pilot contract "Approve & Execute" is a single promise — the
 * decision is recorded AND the book moves. When the second half cannot
 * happen, recording the first half alone would claim a commitment that
 * does not exist: a decision request marked accepted, pointing at no
 * trade, on an idea that could then conclude as `executed`.
 *
 * So the approval fails intact. The recommendation stays pending, the PM
 * is told exactly what blocked it, and they can act again once it is
 * resolved. Nothing to unwind, because nothing was written.
 */

/** Discriminator so callers can branch without string-matching messages. */
export const APPROVE_ERROR = 'ApproveExecuteError' as const

export type ApproveFailureKind =
  /** The approved sizing could not be converted into shares. */
  | 'unsizable'
  /** Another open trade already holds this portfolio+asset slot. */
  | 'open_trade_exists'

export class ApproveExecuteError extends Error {
  readonly name = APPROVE_ERROR
  constructor(
    readonly kind: ApproveFailureKind,
    message: string,
  ) {
    super(message)
  }
}

export const isApproveExecuteError = (e: unknown): e is ApproveExecuteError =>
  e instanceof Error && e.name === APPROVE_ERROR

/**
 * Postgres unique-violation on the one-open-trade-per-name index.
 *
 * `idx_accepted_trades_unique_open` enforces at most one active,
 * non-complete accepted trade per (portfolio_id, asset_id). It is a correct
 * invariant and stays — but a PM must never be shown
 * `duplicate key value violates unique constraint "..."`, which is what
 * production did.
 *
 * Matched on the index name rather than the bare code, so an unrelated
 * unique violation keeps its own error instead of being mislabelled as an
 * open-trade conflict.
 */
export const OPEN_TRADE_INDEX = 'idx_accepted_trades_unique_open'

export function isOpenTradeConflict(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  if (!e) return false
  const text = `${e.message ?? ''}`
  return e.code === '23505' && text.includes(OPEN_TRADE_INDEX)
}

export function openTradeConflictMessage(symbol: string | null, portfolioName: string | null): string {
  const name = symbol ?? 'This asset'
  const where = portfolioName ? ` in ${portfolioName}` : ''
  return (
    `${name} already has an open trade${where}. A name can carry only one trade `
    + 'that has not finished executing. Complete, cancel or revert the existing '
    + 'trade in the Trade Book, then approve this recommendation again.'
  )
}
