import { useState } from 'react'
import { clsx } from 'clsx'

import { PriceContext, type PricePoint } from './PriceContext'
import { commitExploration, isDirty, propose, resetExploration, upsidePct, beginExploration, type Exploration } from '../../lib/mobile/exploration'

/**
 * Set a case by dragging it on the tape.
 *
 * ── What this replaces, and why ───────────────────────────────────────────
 *
 * A slider, a row of three labelled figures, a row of presets and a commit
 * row: roughly 150px of furniture wrapped around one number, on a card that
 * has one screen. It was rebuilt four times — bounds that clipped, a track
 * that jumped on first touch, buttons that fell under the action bar — and
 * each fix bought back a few pixels without changing what the control was.
 *
 * The objection that settled it was not about layout. Presets like "Half" or
 * "+20%" are arbitrary numbers wearing labels; they do not mean anything more
 * than dragging to them does. And a bare track gives the reader nothing to
 * assess the number against — you set $243 and then have to look elsewhere to
 * learn whether the stock has ever been near it.
 *
 * The chart already answers that, and it is already on the card. Dragging the
 * case line across the price history sets the number and shows its context in
 * the same gesture, so "is this reachable" is answered by looking rather than
 * by arithmetic. The furniture goes; the evidence stays.
 *
 * ── What it does not do ───────────────────────────────────────────────────
 *
 * It does not replace exact entry. A drag on a 300px-tall plot cannot express
 * "two hundred and ten exactly", so the value stays tappable and typing still
 * works — the same escape the slider had, for the same reason.
 *
 * And it needs a chart. On a name with no cached history there is nothing to
 * drag against, and the caller falls back to the numeric control rather than
 * offering a gesture over an empty box.
 */

export interface EditableCase {
  id: string
  /** "Bear", "Base", "Bull", or whatever the analyst named it. */
  name: string
  price: number | null
}

interface CaseChartEditorProps {
  symbol: string
  series: PricePoint[]
  cases: EditableCase[]
  /** Last close, drawn as the tape's own right edge and used for upside. */
  currentPrice: number | null
  onSave: (caseId: string, price: number) => void
  saving?: boolean
}

const money = (v: number) => (v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)

export function CaseChartEditor({
  symbol, series, cases, currentPrice, onSave, saving,
}: CaseChartEditorProps) {
  const [selectedId, setSelectedId] = useState(() => cases[0]?.id ?? '')
  /**
   * One exploration per case, so switching between them keeps unsaved work.
   *
   * Comparing cases is the entire point of having three, so flipping has to be
   * free — a prompt on every switch would make the comparison the expensive
   * operation.
   */
  const [drafts, setDrafts] = useState<Record<string, Exploration>>(() =>
    Object.fromEntries(cases.map(c => [c.id, beginExploration(c.price, currentPrice)])))
  const [typing, setTyping] = useState<string | null>(null)

  const selected = cases.find(c => c.id === selectedId) ?? cases[0]
  if (!selected) return null

  const state = drafts[selected.id] ?? beginExploration(selected.price, currentPrice)
  const shown = state.proposed ?? state.recorded
  const dirty = isDirty(state)
  const update = (next: Exploration) => setDrafts(d => ({ ...d, [selected.id]: next }))

  const upside = shown != null ? upsidePct(shown, currentPrice) : null

  /**
   * Every case on the chart, with the live one marked.
   *
   * The others stay visible while one is dragged — that is most of the value.
   * A bull case is only assessable beside the base and the bear, and a control
   * that hid its siblings while you moved one would be the bare track again.
   */
  const bands = cases
    .map(c => {
      const d = drafts[c.id]
      const price = (c.id === selected.id ? shown : (d?.proposed ?? d?.recorded ?? c.price))
      return price != null ? { label: c.name, price, kind: 'case' as const } : null
    })
    .filter(Boolean) as { label: string; price: number; kind: 'case' }[]

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="case-chart-editor">
      <div className="flex shrink-0 items-center gap-1" data-slot="case-selector">
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
                // Unsaved work on a tab you are not looking at is invisible
                // otherwise.
                <span aria-label="unsaved" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </button>
          )
        })}

        {/* The value, tappable. A drag cannot express an exact figure, and on a
            phone it never will. */}
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
            <span data-slot="case-upside" className="text-[11px] font-semibold tabular-nums text-gray-500">
              {upside >= 0 ? '+' : ''}{upside.toFixed(0)}%
            </span>
          )}
        </span>
      </div>

      {/* The chart IS the control. Drag the highlighted line. */}
      <div className="mt-1 min-h-0 flex-1">
        <PriceContext
          symbol={symbol}
          series={series}
          bands={bands}
          editable={{
            label: selected.name,
            onChange: price => update(propose(state, price)),
          }}
        />
      </div>

      {/* Only once something has moved — their presence is how the reader
          knows nothing has been written yet. */}
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
