/**
 * The "Since then" detail — each change with where it came from.
 *
 * ── Why the chips are not enough ─────────────────────────────────────────
 *
 * The card's context row says "+8.4% price". True, and incomplete: a
 * percentage over a stale cache is a confident lie, which is why
 * `fetchChangeFacts` classes the price move SAFE_WITH_ATTRIBUTION and
 * carries "close 2026-09-05 → 2026-09-30" alongside it. A chip has no room
 * for that, so the chip alone drops the half that makes the number safe to
 * believe.
 *
 * CLAUDE.md states it plainly: any figure surfaced to a user must be
 * traceable to its source. This is where the trace lives.
 *
 * ── Not padding ──────────────────────────────────────────────────────────
 *
 * This region exists because there is real information to show, not because
 * a card needed filling. When there are no facts it renders a single honest
 * line — "nothing moved" is an answer to "what did I miss", and a useful
 * one — rather than inventing activity.
 */
import type { ChangeFact } from '../../lib/memory/what-changed'

const SOURCE_LABEL: Record<string, string> = {
  price_history_cache: 'Daily closes',
  object_links: 'Linked research',
  trade_queue_items: 'The idea itself',
  trade_proposal_versions: 'The submitted recommendation',
  accepted_trades: 'Trade Book',
  decision_requests: 'Decision Inbox',
}

export function SinceYouParkedIt({
  facts,
  parkedAt,
}: {
  facts: ChangeFact[]
  /** When the comparison window opens. Shown once rather than per row. */
  parkedAt: string
}) {
  const since = parkedAt.slice(0, 10)

  if (facts.length === 0) {
    return (
      <div data-slot="since-parked" className="text-[13px] text-gray-600 dark:text-gray-400">
        Nothing recorded against this idea since {since}. No price history, no
        research, no decisions.
      </div>
    )
  }

  return (
    <div data-slot="since-parked" className="flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Since {since}
      </p>
      <ul className="flex flex-col gap-2.5">
        {facts.map((f, i) => (
          <li
            key={`${f.kind}-${i}`}
            data-slot="since-parked-fact"
            className="border-l-2 border-gray-200 dark:border-gray-700 pl-2.5"
          >
            <p className="text-[13px] leading-snug text-gray-900 dark:text-gray-100">
              {f.label}
            </p>
            {/*
              The attribution, where one exists. Rendered for every fact that
              carries it rather than only for price, so the rule stays
              "attributed facts show their attribution" and does not become a
              special case somebody later forgets to extend.
            */}
            <p className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
              {SOURCE_LABEL[f.sourceType] ?? f.sourceType}
              {f.attribution ? ` · ${f.attribution}` : ''}
            </p>
          </li>
        ))}
      </ul>
      {/*
        Says what this list is and is not. The card shows deterministic
        changes only — no news, no earnings, no model summary — and a reader
        who assumes otherwise would wrongly read an empty list as "nothing
        happened in the world".
      */}
      <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">
        Recorded changes only. Tesseract does not track news or earnings for
        this idea.
      </p>
    </div>
  )
}
