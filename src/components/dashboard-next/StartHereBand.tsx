import { useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AttentionEntry } from '../../hooks/useDesktopAttentionFeed'

/**
 * Start here — the top of the feed, written as instructions.
 *
 * ── Why this is not a second query ────────────────────────────────────────
 *
 * The reader asked to be told what to work on next. The product's answer to
 * that question already exists: it is the first few cards of the ranked feed.
 * So this band is a PROJECTION of `entries`, handed down from the feed that
 * drew them, and it runs no query, applies no threshold and holds no order of
 * its own. Change the ranking and this band changes with it, which is the only
 * way the two can never disagree.
 *
 * A separate "today" screen is what the alternative looks like, and the
 * product has one: it ranks the same material with its own evaluators and then
 * labels AMZN `THESIS MAY BE STALE` while Research labels the same row
 * `REVIEW DUE`. Two surfaces, one finding, two names for it. This band exists
 * so the direct instruction and the feed cannot drift apart like that, because
 * there is only one list.
 *
 * ── Every word is read off the card ───────────────────────────────────────
 *
 * The verb is `actions.primary.label`, the subject is `entity.ticker`, and the
 * reason is `headline` — the card's own sentence for what is true. Nothing is
 * composed here beyond punctuation. Writing an instruction of our own would
 * mean a second voice describing the same finding, which is the exact defect
 * above in miniature.
 *
 * Opening a row goes through the shell's `onOpen`, the same function a card
 * click calls, so the band lands in the asset workspace on the same tab the
 * card would have opened.
 */

/** How many instructions. Three, because a list of next actions longer than
 *  that is a backlog, and the feed below is already the backlog. */
const SHOWN = 3

/** `headline` is a sentence without a full stop; the band reads as prose. */
function asReason(headline: string): string {
  const t = headline.trim()
  return /[.!?]$/.test(t) ? t : `${t}.`
}

export function StartHereBand({ entries, onOpen }: {
  /** The ranked feed, in the order the feed is drawing it. */
  entries: AttentionEntry[]
  /** The shell's workspace opener: the same one a card click calls. */
  onOpen: (entry: AttentionEntry) => void
}) {
  const [open, setOpen] = useState(true)
  const next = entries.slice(0, SHOWN)
  if (next.length === 0) return null

  return (
    <section
      aria-label="Start here"
      className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 pb-1 pt-3 dark:border-gray-700 dark:bg-gray-800/50"
    >
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline gap-2.5 text-left"
      >
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Start here
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          The top of this feed, as next actions
        </span>
        {open
          ? <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-400" />
          : <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-400" />}
      </button>

      {open && (
        <ol className="mt-1 pb-2">
          {next.map((entry, i) => {
            const card = entry.card
            const ticker = card.entity?.ticker ?? null
            return (
              <li
                key={entry.key}
                className={clsx(
                  'flex items-baseline gap-3.5 py-2.5',
                  i > 0 && 'border-t border-gray-200 dark:border-gray-700',
                )}
              >
                <span className="w-4 shrink-0 font-mono text-xs font-bold text-gray-400 tabular-nums dark:text-gray-500">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-gray-900 dark:text-white">
                    {card.actions.primary.label}
                    {ticker && (
                      <span className="font-mono font-bold text-gray-500 dark:text-gray-400">
                        {' · '}{ticker}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-gray-600 dark:text-gray-300">
                    Because {asReason(card.headline)}
                  </span>
                </span>
                <button
                  onClick={() => onOpen(entry)}
                  className="shrink-0 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-primary-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-primary-400 dark:hover:bg-gray-800"
                >
                  Open
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
