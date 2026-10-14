/**
 * What is true about this name that the rest of the page would make you
 * assemble for yourself.
 *
 * ── Why this is not a card, and not a list of cards ──────────────────────
 *
 * Everything on the Asset page is already a card. Another boxed panel would
 * be a sixth thing to scan rather than the thing that tells you where to
 * look, and the brief is explicit that visual sophistication is not more
 * cards and badges.
 *
 * So this is a RULE and a column of sentences. The only ornament is a 2px
 * stop in the left border, one colour per kind, which is enough to group
 * four contradictions apart from two gaps without labelling either. The
 * typography does the ranking: the headline is the only thing at full
 * contrast, and the evidence beneath it sits at 11px in grey.
 *
 * ── What it may say ──────────────────────────────────────────────────────
 *
 * Only what `lib/asset-workspace/context` produced, which is only what the
 * canonical records support. Each line carries the records it came from, and
 * those are rendered — a claim the reader cannot chase is a claim this
 * surface has no business making.
 *
 * It states facts. It never tells anybody what to do about them: a test
 * asserts no headline contains an imperative, because the moment this starts
 * advising from a word match it has exceeded its evidence.
 *
 * ── When it is absent ────────────────────────────────────────────────────
 *
 * Nothing to say means nothing rendered — not an empty state, not a
 * reassuring "all clear". A reader scanning a page for problems should find
 * either a problem or silence, and "no signals" is not a finding this module
 * is entitled to assert on a half-loaded page.
 */

import { clsx } from 'clsx'
import { AlertTriangle, Clock, CircleDashed, FileSearch, Hourglass } from 'lucide-react'
import type { WorkspaceSignal, SignalKind, WorkspaceState } from '../../lib/asset-workspace/context'
import { STATE_EMPHASIS } from '../../lib/asset-workspace/context'
import type { SnapshotSubPage } from './InvestmentSnapshot'

const KIND: Record<SignalKind, { rule: string; icon: typeof AlertTriangle; tone: string }> = {
  pending: { rule: 'bg-blue-500', icon: Hourglass, tone: 'text-blue-700 dark:text-blue-400' },
  contradiction: { rule: 'bg-amber-400', icon: AlertTriangle, tone: 'text-amber-700 dark:text-amber-400' },
  staleness: { rule: 'bg-slate-300 dark:bg-slate-600', icon: Clock, tone: 'text-slate-600 dark:text-slate-400' },
  gap: { rule: 'bg-slate-300 dark:bg-slate-600', icon: CircleDashed, tone: 'text-slate-600 dark:text-slate-400' },
  provenance: { rule: 'bg-slate-300 dark:bg-slate-600', icon: FileSearch, tone: 'text-slate-600 dark:text-slate-400' },
}

export interface AttentionBandProps {
  state: WorkspaceState
  signals: WorkspaceSignal[]
  onOpen: (page: SnapshotSubPage) => void
  className?: string
}

export function AttentionBand({ state, signals, onOpen, className }: AttentionBandProps) {
  if (signals.length === 0) return null

  return (
    <section
      data-testid="attention-band"
      data-workspace-state={state}
      aria-label="What needs attention"
      className={clsx('rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900', className)}
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-gray-100 px-4 py-2 dark:border-gray-800">
        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500">
          Needs attention
        </span>
        {/*
          The situation, named. Not a badge — a reader should be able to tell
          at a glance why this page is emphasising what it is emphasising,
          and that is a sentence, not a colour.
        */}
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {STATE_EMPHASIS[state].label}
        </span>
      </div>

      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {signals.map(s => {
          const k = KIND[s.kind]
          const Icon = k.icon
          return (
            <li key={s.id} className="flex">
              {/* The only ornament: one colour per kind, 2px wide. */}
              <span aria-hidden className={clsx('w-[2px] shrink-0', k.rule)} />
              <button
                type="button"
                onClick={() => onOpen(s.destination)}
                data-testid={`attention-${s.id}`}
                className="group flex-1 px-3.5 py-2 text-left hover:bg-gray-50/70 dark:hover:bg-gray-800/40"
              >
                <span className="flex items-start gap-2">
                  <Icon className={clsx('mt-[2px] h-3.5 w-3.5 shrink-0', k.tone)} />
                  <span className="min-w-0">
                    <span className="block text-[13px] leading-snug text-gray-900 group-hover:underline dark:text-gray-100">
                      {s.headline}
                    </span>
                    {/*
                      The records behind the claim, named. This is what makes
                      the line checkable rather than atmospheric.
                    */}
                    <span className="mt-0.5 block truncate text-[11px] text-gray-500 dark:text-gray-400">
                      {s.evidence.map(e => e.label).join(' · ')}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
