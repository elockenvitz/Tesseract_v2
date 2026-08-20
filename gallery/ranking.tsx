import {
  LEAD_TIER, explainPriority, priorityFor, rankFeed,
  type PriorityInput,
} from '../src/lib/signals/feed-priority'
import { DAY_MS } from '../src/lib/signals/thresholds'

/**
 * The ranking, laid out so it can be argued with.
 *
 * A ranking model is a product opinion wearing arithmetic, and the only way to
 * tell whether the opinion is right is to see a realistic mixed feed in the
 * order it produces and ask whether that is the order a PM would want. The unit
 * tests prove the model does what it says; they cannot tell anyone whether what
 * it says is sensible.
 *
 * So this renders the whole score: tier, total, and every component. That is
 * developer tooling and stays here — the production card shows none of it. A
 * reader shown "Priority score: 82" starts arguing with the number instead of
 * the investment, which is the opposite of what the feed is for.
 *
 * Imports the same pure module the app calls. No fixture ranking, no second
 * implementation to drift.
 */

/** Fixed, so the page is identical on every load and in every screenshot. */
const NOW = new Date('2026-08-19T12:00:00.000Z').getTime()
const days = (n: number) => NOW - n * DAY_MS

interface Row {
  label: string
  /** What a reviewer should be checking on this row. */
  note: string
  input: PriorityInput
}

/**
 * A realistic desk on a realistic morning.
 *
 * Deliberately includes the awkward pairs rather than a clean gradient: a huge
 * position attached to a news story, a two-day-late project, a card the reader
 * confirmed last week, and one they acknowledged but did not fix. Those are the
 * comparisons where a ranking model is either right or embarrassing.
 */
const ROWS: Row[] = [
  {
    label: 'CEG below bear case',
    note: 'Major framework deviation on a large position. Should lead.',
    input: {
      id: 'ceg-gap', type: 'scenario_gap', severity: 'critical',
      weightPct: 12.4, held: true, deviationPct: 22, occurredAt: days(3),
    },
  },
  {
    label: 'NVDA through target',
    note: 'A decision event, but on a name with no weight recorded.',
    input: {
      id: 'nvda-hit', type: 'target_hit', severity: 'critical',
      weightPct: null, held: true, deviationPct: 31, occurredAt: days(1),
    },
  },
  {
    label: 'MSFT target expired',
    note: 'The view lapsed 8 months ago. Nothing broke; the horizon ran out.',
    input: {
      id: 'msft-expired', type: 'target_expired', severity: 'critical',
      weightPct: null, held: true, deviationPct: 40, occurredAt: days(240),
    },
  },
  {
    label: 'AAPL no target · 25% position',
    note: 'Case 2. Must lead the 1% version of exactly the same gap.',
    input: {
      id: 'aapl-notarget', type: 'no_target', severity: 'critical',
      weightPct: 25, held: true, occurredAt: days(30),
    },
  },
  {
    label: 'ROKU no target · 1% position',
    note: 'Case 2, the other half. Same signal, immaterial position.',
    input: {
      id: 'roku-notarget', type: 'no_target', severity: 'attention',
      weightPct: 1, held: true, occurredAt: days(30),
    },
  },
  {
    label: 'TSLA unreviewed change',
    note: 'Phase 7 signal. Real, but nobody is waiting on it.',
    input: {
      id: 'tsla-stale', type: 'research_stale', severity: 'attention',
      weightPct: 6.2, held: true, deviationPct: 18, occurredAt: days(48),
    },
  },
  {
    label: 'Q3 review deliverable · 2 days late',
    note: 'Case 4. Must NOT outrank anything above it.',
    input: {
      id: 'proj-late', type: 'project_overdue', severity: 'attention',
      overdueDays: 2, occurredAt: days(2),
    },
  },
  {
    label: 'Sector model · 26 days late',
    note: 'Severely overdue. Promoted out of the workflow tier, but no further.',
    input: {
      id: 'proj-verylate', type: 'project_overdue', severity: 'critical',
      overdueDays: 26, occurredAt: days(26),
    },
  },
  {
    label: 'AMZN news · 30% position · minutes old',
    note: 'Case 3. Freshest and largest thing here, and must still rank last.',
    input: {
      id: 'amzn-news', type: 'news', severity: 'informational',
      weightPct: 30, held: true, occurredAt: NOW,
    },
  },
  {
    label: "Colleague's trade idea",
    note: 'Interesting, not a decision the reader is being asked to make.',
    input: {
      id: 'post-idea', type: 'trade_idea', severity: 'informational',
      occurredAt: days(1),
    },
  },
  {
    label: 'GOOGL gap · acknowledged, not fixed',
    note: 'Answered "Cases outdated" 12 days ago. Back, and ranked below unseen work.',
    input: {
      id: 'googl-ack', type: 'scenario_gap', severity: 'attention',
      weightPct: 7, held: true, deviationPct: 17, occurredAt: days(20),
      judgment: { key: 'scenario_cases_outdated', at: days(12) },
    },
  },
  {
    label: 'META gap · confirmed current',
    note: 'Answered "Thesis intact" 4 days ago. Suppressed, and shown here greyed.',
    input: {
      id: 'meta-confirmed', type: 'scenario_gap', severity: 'critical',
      weightPct: 9, held: true, deviationPct: 25, occurredAt: days(6),
      judgment: { key: 'scenario_thesis_intact', at: days(4) },
    },
  },
]

const ranked = rankFeed(ROWS, r => r.input, NOW)
/** Suppressed rows never reach `rankFeed`'s output, so collect them separately. */
const suppressed = ROWS
  .map(r => ({ row: r, priority: priorityFor(r.input, NOW) }))
  .filter(x => x.priority.suppressed)

const pct = (n: number) => n.toFixed(3)

function Components({ p }: { p: ReturnType<typeof priorityFor> }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-gray-500 dark:text-gray-400">
      {Object.entries(p.components)
        .filter(([, v]) => v !== 0)
        .map(([k, v]) => (
          <span key={k} className={v < 0 ? 'text-rose-600 dark:text-rose-400' : undefined}>
            {k} {v >= 0 ? '+' : ''}{pct(v)}
          </span>
        ))}
    </div>
  )
}

const TIER_TONE: Record<number, string> = {
  0: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  1: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  2: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  3: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  4: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

export function RankingDebug() {
  return (
    <div data-testid="ranking-debug" className="mx-auto max-w-[720px] px-4 py-6 text-gray-900 dark:text-gray-100">
      <h1 className="text-[18px] font-bold">Feed ranking · mixed fixture</h1>
      <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
        The order a PM would meet these in. Tier is a hard partition; the score
        only ever orders within one. Clock fixed at {new Date(NOW).toISOString().slice(0, 10)}.
      </p>

      <ol className="mt-4 space-y-1.5">
        {ranked.map((r, i) => (
          <li
            key={r.input.id}
            data-rank-row={r.input.id}
            data-tier={r.priority.tier}
            className={`rounded-lg border p-2.5 ${
              r.priority.tier <= LEAD_TIER
                ? 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900'
                : 'border-dashed border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'
            }`}
          >
            <div className="flex items-baseline gap-2">
              <span className="w-5 shrink-0 text-right font-mono text-[11px] text-gray-400">{i + 1}</span>
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${TIER_TONE[r.priority.tier]}`}>
                {r.priority.tierName}
              </span>
              <span className="flex-1 text-[13px] font-semibold">{r.item.label}</span>
              <span className="font-mono text-[11px] tabular-nums text-gray-500">{pct(r.priority.total)}</span>
            </div>
            <p className="ml-7 mt-0.5 text-[11px] text-gray-600 dark:text-gray-400">{r.item.note}</p>
            <div className="ml-7"><Components p={r.priority} /></div>
          </li>
        ))}
      </ol>

      {/* Suppressed rows are shown rather than omitted. A card that vanished is
          indistinguishable from a card that was never generated, and the
          difference is the entire acknowledgment policy. */}
      <h2 className="mt-6 text-[13px] font-bold uppercase tracking-wide text-gray-500">
        Suppressed — answered, quiet not yet expired
      </h2>
      <ul className="mt-2 space-y-1.5">
        {suppressed.map(({ row, priority }) => (
          <li key={row.input.id} data-suppressed-row={row.input.id}
              className="rounded-lg border border-dashed border-gray-300 bg-gray-100 p-2.5 opacity-70 dark:border-gray-700 dark:bg-gray-800/40">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 text-[13px] font-semibold line-through decoration-gray-400">{row.label}</span>
              <span className="font-mono text-[10px] text-gray-500">
                {priority.acknowledgment.category}
                {priority.acknowledgment.quietUntil
                  ? ` · back ${new Date(priority.acknowledgment.quietUntil).toISOString().slice(0, 10)}`
                  : ''}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-400">{row.note}</p>
            <p className="mt-0.5 font-mono text-[10px] text-gray-500">{explainPriority(priority)}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
