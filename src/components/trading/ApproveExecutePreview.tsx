/**
 * What the PM is about to cause.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Under the pilot execution contract, approving a recommendation moves the
 * modeled book immediately — there is no OMS, no broker confirmation, and
 * no queue in between. A one-click "Accept" that silently sells 2,110
 * shares is too light an action for that consequence.
 *
 * So the strip states the trade in the terms the PM is actually agreeing
 * to: the position now, the change, the position after, and the share
 * count. The share count matters most and was invisible before — the PM
 * approved a WEIGHT and only ever saw a weight, while the thing that moved
 * the book was a quantity nobody showed them.
 *
 * ── Same inputs as the commit ────────────────────────────────────────────
 *
 * The preview is computed from the identical basis and the identical
 * function the service uses. A preview that agreed with the PM's intent but
 * disagreed with the commit would be a subtler form of the defect this
 * change exists to remove.
 */
import { useMemo } from 'react'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { basisFromBook, computeAcceptSizing, isRefusal } from '../../lib/decisions/accept-sizing'
import type { CurrentBook } from '../../lib/holdings/portfolio-context'
import type { TradeAction } from '../../types/trading'

const fmtShares = (n: number) => Math.abs(Math.round(n)).toLocaleString()
const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(2)}%`
/**
 * A share price, with cents.
 *
 * `fmtUsd` abbreviates and drops decimals below $1,000, which is right for
 * a notional and wrong for a price: it rendered $82.40 as "$82" and so
 * misstated the exact basis the trade was sized against. The PM is being
 * asked to accept a share count derived from this number.
 */
const fmtPrice = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `$${n.toFixed(2)}`

const fmtUsd = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(a / 1_000).toFixed(1)}K`
  return `$${a.toFixed(0)}`
}

export function ApproveExecutePreview({
  book, portfolioId, assetId, symbol, sizingInput, action, isModified, analystWeight,
}: {
  book: CurrentBook | undefined
  portfolioId: string | null | undefined
  assetId: string | null | undefined
  symbol: string | null
  sizingInput: string
  action: TradeAction
  isModified: boolean
  analystWeight: number | null
}) {
  const preview = useMemo(() => {
    const basis = basisFromBook(book as never, portfolioId, assetId)
    if (isRefusal(basis)) return { kind: 'unavailable' as const, reason: basis.reason }
    const sized = computeAcceptSizing(basis, sizingInput, action, assetId!)
    if (!sized.ok) return { kind: 'unavailable' as const, reason: sized.reason }
    return { kind: 'ok' as const, computed: sized.computed, basis }
  }, [book, portfolioId, assetId, sizingInput, action])

  if (preview.kind === 'unavailable') {
    return (
      <div className="flex items-start gap-1.5 rounded border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-2 py-1.5 mb-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px text-amber-600 dark:text-amber-400" />
        <div className="text-[11px] leading-snug text-amber-800 dark:text-amber-300">
          <span className="font-semibold">Share quantity not previewable.</span>{' '}
          {preview.reason}{' '}
          {/* Never imply the trade will execute anyway. */}
          Approving records the decision; execution only follows if it can be sized.
        </div>
      </div>
    )
  }

  const { computed, basis } = preview
  const deltaShares = Math.round(computed.delta_shares ?? 0)
  const targetShares = Math.round(computed.target_shares ?? basis.currentShares + deltaShares)
  const verb = deltaShares < 0 ? 'Sell' : 'Buy'

  return (
    <div className="rounded border border-green-200 dark:border-green-900/40 bg-white/70 dark:bg-gray-800/40 px-2 py-1.5 mb-2 space-y-1">
      {/* The concrete trade, stated first — it is the thing being approved. */}
      <div className="text-xs font-semibold text-gray-900 dark:text-white tabular-nums">
        {verb} {fmtShares(deltaShares)} {symbol ?? 'shares'}
        <span className="font-normal text-gray-500 dark:text-gray-400">
          {' '}· {fmtUsd(computed.notional_value)} @ {fmtPrice(basis.price)}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-gray-600 dark:text-gray-300">
        <span>{fmtShares(basis.currentShares)} sh · {fmtPct(basis.currentWeight)}</span>
        <ArrowRight className="h-3 w-3 text-gray-400" />
        <span className="font-semibold text-gray-900 dark:text-white">
          {fmtShares(targetShares)} sh · {fmtPct(computed.target_weight)}
        </span>
        <span className="text-gray-400">({fmtPct(computed.delta_weight)})</span>
      </div>

      {isModified && analystWeight != null && (
        <div className="text-[10px] text-amber-600 dark:text-amber-400">
          Modified from the analyst's {fmtPct(analystWeight)}.
        </div>
      )}

      {/*
        The pilot assumption, stated plainly. The PM is not being told a
        broker will fill this — they are being told Tesseract will act as
        though one did.
      */}
      <div className="text-[10px] leading-snug text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-1">
        Approving updates Tesseract's modeled holdings immediately. The pilot
        assumes execution; there is no broker confirmation.
        {basis.asOf && <> Priced on the book of {basis.asOf}.</>}
      </div>
    </div>
  )
}
