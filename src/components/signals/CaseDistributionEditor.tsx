import { useRef, useState } from 'react'
import { clsx } from 'clsx'

import {
  beginExploration, commitExploration, isDirty, propose, resetExploration,
  upsidePct, type Exploration,
} from '../../lib/mobile/exploration'

/**
 * The ladder as a distribution, with the price standing in it.
 *
 * ── Why not the price chart ───────────────────────────────────────────────
 *
 * Dragging case lines across the tape put the number in context, and the
 * context was the wrong one. A price chart answers "where has this traded",
 * which the reader already has three panes of — so the editor looked like the
 * chart beside it and read as a duplicate rather than as a control.
 *
 * The question a ladder actually poses is different: **given what I think can
 * happen, is the price cheap?** That is a question about the SPREAD of the
 * cases and the weight on each, and where today's price falls inside it.
 * History does not answer it; the distribution does.
 *
 * So the axis is price, the height is conviction, and the two markers that
 * matter are today's price and the probability-weighted expectation. Reading
 * left to right you see the downside, where you are, and the upside; reading
 * the heights you see which of them the analyst actually believes. A case
 * dragged along the axis moves against that whole picture.
 *
 * ── Equal weighting, stated ───────────────────────────────────────────────
 *
 * `ScenarioDistribution` refuses to draw when no case carries a probability,
 * which is right for a component asserting "here is the analyst's conviction".
 * It is wrong here: in production most ladders have no probabilities at all,
 * so refusing would mean the control almost never appears.
 *
 * Equal weighting is the honest default — it is what "three cases and no view
 * on which" means — and the label says so, because an expectation drawn from
 * an assumption must never be mistaken for one the analyst stated.
 */

export interface DistributionCase {
  id: string
  name: string
  price: number | null
  /** Percent, 0-100. Null where the analyst has not committed to one. */
  probability?: number | null
}

interface CaseDistributionEditorProps {
  cases: DistributionCase[]
  /** Last close. Drawn as the marker everything is judged against. */
  currentPrice: number | null
  onSave: (caseId: string, price: number) => void
  saving?: boolean
}

const W = 100
const H = 100
const BASE = 78
const TOP = 14

const money = (v: number) => (v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)

export function CaseDistributionEditor({
  cases, currentPrice, onSave, saving,
}: CaseDistributionEditorProps) {
  const [selectedId, setSelectedId] = useState(() => cases[0]?.id ?? '')
  const [drafts, setDrafts] = useState<Record<string, Exploration>>(() =>
    Object.fromEntries(cases.map(c => [c.id, beginExploration(c.price, currentPrice)])))
  const [typing, setTyping] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const selected = cases.find(c => c.id === selectedId) ?? cases[0]
  if (!selected) return null

  const state = drafts[selected.id] ?? beginExploration(selected.price, currentPrice)
  const shown = state.proposed ?? state.recorded
  const dirty = isDirty(state)
  const update = (next: Exploration) => setDrafts(d => ({ ...d, [selected.id]: next }))

  /** Each case at its live value, with the draft applied. */
  const live = cases
    .map(c => {
      const d = drafts[c.id]
      const price = c.id === selected.id ? shown : (d?.proposed ?? d?.recorded ?? c.price)
      return price != null && Number.isFinite(price) ? { ...c, price } : null
    })
    .filter(Boolean) as (DistributionCase & { price: number })[]

  if (!live.length) return null

  /**
   * Weights, normalised, with equal weighting when nobody has committed.
   *
   * `stated` drives the caveat under the axis. A reader must be able to tell an
   * expectation the analyst asserted from one this component assumed.
   */
  const stated = live.some(c => c.probability != null && c.probability > 0)
  const rawWeights = live.map(c => (stated ? (c.probability ?? 0) : 1))
  const weightSum = rawWeights.reduce((a, b) => a + b, 0) || 1
  const weights = rawWeights.map(w => w / weightSum)

  const expected = live.reduce((sum, c, i) => sum + c.price * weights[i], 0)

  // The axis spans every case and the price, with headroom so nothing sits on
  // the edge where its label would be clipped.
  const points = [...live.map(c => c.price), ...(currentPrice != null ? [currentPrice] : []), expected]
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const pad = (hi - lo) * 0.18 || Math.max(hi * 0.05, 1)
  const min = lo - pad
  const max = hi + pad
  const x = (v: number) => ((v - min) / (max - min)) * W

  const maxWeight = Math.max(...weights)
  const barTop = (w: number) => BASE - (w / maxWeight) * (BASE - TOP)

  const priceAt = (clientX: number): number | null => {
    const el = svgRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width <= 0) return null
    const frac = Math.min(Math.max((clientX - r.left) / r.width, 0), 1)
    return Math.max(0.01, min + frac * (max - min))
  }

  const upside = shown != null ? upsidePct(shown, currentPrice) : null
  const expectedUpside = upsidePct(expected, currentPrice)

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="case-distribution">
      <div className="flex shrink-0 items-center gap-1">
        {cases.map(c => {
          const d = drafts[c.id]
          return (
            <button
              key={c.id}
              type="button"
              data-slot="case-tab"
              data-case-id={c.id}
              aria-pressed={c.id === selected.id}
              onClick={() => setSelectedId(c.id)}
              className={clsx(
                'relative rounded-full px-2.5 py-1 text-[12px] font-bold transition-colors',
                c.id === selected.id
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
              )}
            >
              {c.name}
              {d && isDirty(d) && (
                <span aria-label="unsaved" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </button>
          )
        })}

        <span className="ml-auto flex items-center gap-1.5">
          {typing === null ? (
            <button
              type="button"
              data-slot="value-tap"
              onClick={() => setTyping(shown != null ? String(Number(shown.toFixed(2))) : '')}
              className="text-[15px] font-bold tabular-nums text-primary-600 dark:text-primary-400"
            >
              {shown != null ? money(shown) : 'Not set'}
            </button>
          ) : (
            <input
              autoFocus
              data-slot="value-input"
              inputMode="decimal"
              value={typing}
              onChange={e => setTyping(e.target.value)}
              onBlur={() => {
                const n = Number(typing.replace(/[$,\s]/g, ''))
                if (Number.isFinite(n) && n > 0) update(propose(state, n))
                setTyping(null)
              }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="w-20 rounded border border-primary-500 px-1 py-0.5 text-[14px] font-bold tabular-nums"
            />
          )}
          {upside != null && (
            <span className="text-[11px] font-semibold tabular-nums text-gray-500">
              {upside >= 0 ? '+' : ''}{upside.toFixed(0)}%
            </span>
          )}
        </span>
      </div>

      <div className="relative mt-1 min-h-0 flex-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          data-testid="case-distribution-plot"
          style={{ touchAction: 'none' }}
        >
          {/* The axis the cases stand on. */}
          <line x1={0} x2={W} y1={BASE} y2={BASE} strokeWidth={1} vectorEffect="non-scaling-stroke" className="stroke-gray-300 dark:stroke-gray-600" />

          {live.map((c, i) => {
            const isSel = c.id === selected.id
            return (
              <g key={c.id}>
                {/* Conviction as height, price as position. A wide bar rather
                    than a spike: it is a scenario, not a point estimate, and a
                    1px line would also be untouchable. */}
                <rect
                  x={x(c.price) - 6} y={barTop(weights[i])}
                  width={12} height={BASE - barTop(weights[i])}
                  rx={1.5}
                  className={isSel
                    ? 'fill-primary-500'
                    : 'fill-gray-300 dark:fill-gray-600'}
                />
              </g>
            )
          })}

          {/* Today's price. The line everything is judged against, so it is the
              only solid vertical rule on the plot. */}
          {currentPrice != null && (
            <line
              x1={x(currentPrice)} x2={x(currentPrice)} y1={TOP - 8} y2={BASE + 4}
              strokeWidth={1.5} vectorEffect="non-scaling-stroke"
              data-testid="distribution-price"
              className="stroke-gray-900 dark:stroke-white"
            />
          )}

          {/* The probability-weighted expectation. Dashed, because it is
              derived rather than stated — and doubly so when the weights are
              assumed. */}
          <line
            x1={x(expected)} x2={x(expected)} y1={TOP - 8} y2={BASE + 4}
            strokeDasharray="3 3" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
            data-testid="distribution-expected"
            className="stroke-emerald-600 dark:stroke-emerald-400"
          />

          {/* The drag surface for the selected case. Full height so the whole
              column is grabbable, not just the bar. */}
          <rect
            x={0} y={0} width={W} height={BASE + 6}
            fill="transparent"
            data-slot="distribution-drag"
            className="cursor-ew-resize"
            onPointerDown={e => {
              try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* unsupported */ }
              const v = priceAt(e.clientX)
              if (v != null) update(propose(state, v))
            }}
            onPointerMove={e => {
              if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return
              const v = priceAt(e.clientX)
              if (v != null) update(propose(state, v))
            }}
            onPointerUp={e => { try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* gone */ } }}
          />
        </svg>

        {/* Labels outside the stretched viewBox: `preserveAspectRatio="none"`
            scales x and y independently, which is right for the bars and
            ruinous for glyphs. */}
        <div className="pointer-events-none absolute inset-0">
          {live.map(c => (
            <span
              key={c.id}
              className={clsx(
                'absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-bold uppercase tracking-wide',
                c.id === selected.id ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400',
              )}
              style={{ left: `${Math.min(Math.max(x(c.price), 8), 92)}%`, top: '82%' }}
            >
              {c.name}
            </span>
          ))}
          {currentPrice != null && (
            <span
              className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-bold text-gray-900 dark:text-white"
              style={{ left: `${Math.min(Math.max(x(currentPrice), 8), 92)}%`, top: '0%' }}
            >
              Now {money(currentPrice)}
            </span>
          )}
        </div>
      </div>

      {/* What the distribution says, in one line. This is the answer the whole
          control exists to give: weighted across the cases, is the price
          cheap? */}
      <p className="mt-0.5 shrink-0 text-[11px] leading-tight text-gray-500 dark:text-gray-400" data-slot="distribution-summary">
        <span className="font-bold text-emerald-600 dark:text-emerald-400">
          Expected {money(expected)}
          {expectedUpside != null && ` (${expectedUpside >= 0 ? '+' : ''}${expectedUpside.toFixed(0)}%)`}
        </span>
        {stated ? ' · analyst weights' : ' · equal weights assumed'}
      </p>

      {dirty && (
        <div className="mt-1 flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-slot="save"
            disabled={saving}
            onClick={() => {
              const done = commitExploration(state)
              if (!done) return
              onSave(selected.id, done.saved)
              update(done.next)
            }}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-[13px] font-bold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : `Save ${selected.name}`}
          </button>
          <button
            type="button"
            data-slot="cancel"
            onClick={() => update(resetExploration(state))}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-semibold text-gray-600 dark:border-gray-600 dark:text-gray-300"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
