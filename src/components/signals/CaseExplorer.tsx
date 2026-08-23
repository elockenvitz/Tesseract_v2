import { useState } from 'react'
import { clsx } from 'clsx'

import { ValueExplorer } from './ValueExplorer'
import {
  beginExploration, isDirty, upsidePct, type Exploration,
} from '../../lib/mobile/exploration'

/**
 * Bear / Base / Bull, switchable and editable in place.
 *
 * ── The rule this exists to satisfy ───────────────────────────────────────
 *
 * "Changing Bear / Base / Bull must NOT require pressing Set a target first."
 *
 * Targets and scenarios are different concepts, and the old flow conflated
 * them: reaching the cases meant going through the target control, so an
 * analyst who works in cases was routed through a number they do not use in
 * order to edit the numbers they do. A reader who says "I use cases" belongs
 * in the scenario framework directly.
 *
 * ── Drafts are kept per case ──────────────────────────────────────────────
 *
 * Switching from Bear to Bull with an unsaved Bear value does not discard it.
 * The brief allows either preserving drafts or prompting, and preserving is
 * the simpler coherent behaviour: comparing cases is the entire point of
 * having three, so flipping between them has to be free. A prompt on every
 * switch would make the comparison the expensive operation.
 *
 * Each case keeps its own `Exploration`, so "recorded" stays per case and Save
 * writes exactly the one the reader is looking at.
 */

export interface ExplorableCase {
  id: string
  /** "Bear", "Base", "Bull", or whatever the analyst named it. */
  name: string
  /** The recorded price for this case, or null if unset. */
  price: number | null
}

interface CaseExplorerProps {
  symbol: string
  cases: ExplorableCase[]
  currentPrice: number | null
  onSave: (caseId: string, price: number) => void
  saving?: boolean
  /**
   * Open the caller's "add a case" surface. Omitted when not permitted.
   *
   * Takes no arguments on purpose: a case is a name, a number and usually a
   * reason, and collecting that belongs in a drawer rather than in a chip row
   * on a card with one screen.
   */
  onAddCase?: () => void
  /** So the chart can draw the case being explored. */
  onProposedChange?: (caseId: string, proposed: number | null) => void
}

const money = (v: number) => v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`

export function CaseExplorer({
  symbol, cases, currentPrice, onSave, saving, onAddCase, onProposedChange,
}: CaseExplorerProps) {
  const [selectedId, setSelectedId] = useState(() => cases[0]?.id ?? '')
  /**
   * One exploration per case, created lazily.
   *
   * Keyed by case id rather than index so that a ladder which gains or loses a
   * case does not silently shift somebody's unsaved draft onto a different
   * scenario.
   */
  const [drafts, setDrafts] = useState<Record<string, Exploration>>(() =>
    Object.fromEntries(cases.map(c => [c.id, beginExploration(c.price, currentPrice)])))

  const selected = cases.find(c => c.id === selectedId) ?? cases[0]
  if (!selected) return null

  const state = drafts[selected.id] ?? beginExploration(selected.price, currentPrice)

  const update = (next: Exploration) => {
    setDrafts(d => ({ ...d, [selected.id]: next }))
    onProposedChange?.(selected.id, next.proposed)
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="case-explorer">
      {/* The selector. One tap per case, always visible, so comparing is a
          tap rather than opening and closing three editors. */}
      <div className="flex shrink-0 items-center gap-1" data-slot="case-selector">
        {cases.map(c => {
          const draft = drafts[c.id]
          const dirty = draft ? isDirty(draft) : false
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
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
              )}
            >
              {c.name}
              {/* An unsaved draft on a case you are not looking at is
                  invisible otherwise, and the reader would have no way to know
                  work was waiting on another tab. */}
              {dirty && (
                <span
                  data-slot="case-dirty"
                  aria-label="unsaved"
                  className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500"
                />
              )}
            </button>
          )
        })}
        {/* A case of the reader's own — in a drawer, not in this row.
            An inline field here was cramped and could only capture a NAME,
            when a case is a name and a number and usually a reason. It also
            put a text input inside a chip row on a card with one screen, which
            is where the keyboard then covered everything.
            The caller opens a sheet. This button only says what is wanted. */}
        {onAddCase && (
          <button
            type="button"
            data-slot="case-add"
            aria-label="Add a case"
            onClick={() => onAddCase()}
            className="rounded-full bg-gray-100 px-2.5 py-1 text-[12px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-300"
          >
            + Case
          </button>
        )}
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <ValueExplorer
          // Keyed on the case so the numeric-entry buffer inside cannot carry
          // a half-typed Bear value across to Bull.
          key={selected.id}
          slot="case-value"
          referenceLabel="Current"
          recordedLabel={`${selected.name} recorded`}
          proposedLabel="Proposed"
          state={state}
          onChange={update}
          onSave={v => onSave(selected.id, v)}
          saving={saving}
          format={money}
          secondary={v => {
            const pct = upsidePct(v, currentPrice)
            if (pct == null) return null
            return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs current`
          }}
          // The slider must reach every case on the ladder, or comparing them
          // means dragging to a value the track cannot express.
          reachable={cases.map(c => c.price)}
          aria-label={`${symbol} ${selected.name}`}
        />
      </div>
    </div>
  )
}
