import { clsx } from 'clsx'
import { ArrowUpRight, Users } from 'lucide-react'

import { CATEGORY_DOT } from '../../lib/mobile/feed-categories'
import { exploreAge, explorePreview } from '../../lib/mobile/explore-preview'
import { exploreVisualFor, visualRestatesContext, visualRestatesMetric } from '../../lib/mobile/explore-visual'
import type { ExploreItem } from '../../lib/mobile/explore-item'
import { ExploreVisualBlock } from './ExploreVisual'

/**
 * What a tile becomes when it opens.
 *
 * ── Why this is not the tile at a larger size ─────────────────────────────
 *
 * The brief's rule: "Expanded state must add information. It cannot simply be
 * the collapsed tile scaled up." A sheet that shows the same four lines in a
 * bigger font has spent a full-screen transition to say nothing new, and the
 * reader learns not to tap.
 *
 * ── Why every field here already exists ───────────────────────────────────
 *
 * Nothing is fetched and nothing is invented. `ExploreItem` already carries
 * far more than a 178px tile can show — the modelled ladder, the horizon
 * dates, the benchmark weight, the review date, the proposal's stage, the
 * portfolio and its weight, the author, the company name — and the tile drops
 * almost all of it for want of room. The sheet is where that material finally
 * has somewhere to go. Every clause below is guarded, so a sparse item renders
 * a shorter sheet rather than a padded one.
 *
 * ── Shared elements ───────────────────────────────────────────────────────
 *
 * The header repeats the tile's own eyebrow, ticker, claim and metric in the
 * same order and the same relative weights. That repetition is the point: the
 * shell is what animates, and the reader's eye should land on the same three
 * things it was looking at a quarter of a second ago. The material BELOW the
 * fold is what is new.
 */

const TONE: Record<string, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-gray-900 dark:text-white',
}

/** One labelled fact. Rendered only when the item actually carries it. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 truncate text-[15px] font-semibold text-gray-900 dark:text-white">{value}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-gray-100 px-5 py-4 dark:border-gray-800">
      <h2 className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null
}

/**
 * Why this item is on the page at all.
 *
 * ── Why the sentence is assembled and not stored ──────────────────────────
 *
 * No adapter writes a "reason" and inventing a column for one would be a data
 * programme. But the reason is derivable from what the item already declares —
 * its type, its category and whether it is a gap or a development — and the
 * reader's question on opening a discovery card is exactly this. Every branch
 * states only what the item's own fields assert.
 */
function whySurfaced(item: ExploreItem): string {
  const name = item.symbol ?? item.companyName ?? 'this'
  switch (item.subtype) {
    case 'signal':
      return item.positive
        ? `A development on ${name} that moved against the framework you wrote for it.`
        : `${name} has left, or never had, part of the framework you wrote for it.`
    case 'research':
      return item.visual?.lastLookAt
        ? `The written record on ${name} has not kept up with the price.`
        : `A gap in the written record on ${name}.`
    case 'idea':
      return item.source?.label
        ? `${item.source.label} put this in front of the desk.`
        : 'Somebody on the desk put this in front of you.'
    case 'news':
      return item.source?.label
        ? `${item.source.label} published this on a name you follow.`
        : 'Published on a name you follow.'
    case 'workflow':
      return 'Work assigned on the desk, with a date attached.'
    default:
      return 'Surfaced from the material already in your feed.'
  }
}

interface ExploreDetailProps {
  item: ExploreItem
  now?: number
  /** The richer chart, injected — this component never reaches for price data. */
  chart?: React.ReactNode
  onOpenAsset?: (assetId: string, symbol: string) => void
  onReadArticle?: (url: string) => void
}

export function ExploreDetail({
  item, now = Date.now(), chart, onOpenAsset, onReadArticle,
}: ExploreDetailProps) {
  const preview = explorePreview(item, 'feature')
  const visual = exploreVisualFor(item)

  /**
   * The same "nothing is said twice" rule the tile applies.
   *
   * A sheet has more room, which is exactly why the duplication is easier to
   * miss here — `22% BELOW BEAR` at 26px over a band captioned `-22% below
   * your range` is the same stutter with more air around it. The rule belongs
   * to the card system, not to one size of card.
   */
  const metric = preview.metric && visualRestatesMetric(visual, preview.metric.value)
    ? undefined
    : preview.metric
  const secondary = visualRestatesContext(visual, preview.secondary)
    ? undefined
    : preview.secondary
  const when = exploreAge(item.occurredAt, now)
  const v = item.visual ?? {}

  const article = item.destination.kind === 'article' ? item.destination : null
  const assetId = item.assetId ?? null
  const symbol = item.symbol ?? null

  return (
    <div className="flex h-full min-h-0 flex-col" data-explore-detail={item.id}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {/* ── The shared header ────────────────────────────────────────────
            Same eyebrow, same ticker, same claim, same metric, same order as
            the tile. The shell is what moved; these are what the reader's eye
            was already on. */}
        {/* Cleared past the floating back control, which belongs to
            `ExploreExpansion` and sits at the safe-area top. */}
        <header className="px-5 pt-[calc(3.25rem+env(safe-area-inset-top))]">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', CATEGORY_DOT[item.category])} aria-hidden />
            {symbol && (
              <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">
                {symbol}
              </span>
            )}
            <span data-detail-kind className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              {preview.kind}
            </span>
            {when && <span className="ml-auto shrink-0 text-[10px] font-medium tabular-nums text-gray-400">{when}</span>}
          </div>

          <h1
            data-detail-headline
            className="mt-2 text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-gray-900 dark:text-white"
          >
            {preview.headline}
          </h1>

          {metric && (
            <p data-detail-metric className={clsx(
              'mt-2 text-[26px] font-bold tabular-nums leading-none',
              TONE[metric.direction ?? 'neutral'],
            )}>
              {metric.value}
              {metric.label && (
                <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {metric.label}
                </span>
              )}
            </p>
          )}

          {secondary && (
            <p className="mt-2 text-[14px] leading-[1.45] text-gray-500 dark:text-gray-400">{secondary}</p>
          )}
        </header>

        {/* The picture, given room it never had in a grid cell. */}
        <div className="mt-4 px-5" data-detail-visual>
          {chart ?? <ExploreVisualBlock visual={visual} now={now} />}
        </div>

        {/* ── Why it surfaced ─────────────────────────────────────────────
            The question a discovery surface owes an answer to, and the one
            thing a collapsed tile has no room for at all. */}
        <Section title="Why this surfaced">
          <p className="text-[14px] leading-[1.5] text-gray-600 dark:text-gray-300">{whySurfaced(item)}</p>
        </Section>

        {/* ── The facts the tile had to drop ──────────────────────────────
            Each guarded: a sparse item renders a shorter sheet, never a
            padded one with blanks in it. */}
        {(item.portfolio?.weightPct != null || item.portfolio?.name || item.companyName
          || item.portfolio?.heldInCount != null) && (
          <Section title="Position">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {item.companyName && <Fact label="Company" value={item.companyName} />}
              {item.portfolio?.weightPct != null && (
                <Fact label="Weight" value={`${item.portfolio.weightPct.toFixed(1)}%`} />
              )}
              {item.portfolio?.name && <Fact label="Portfolio" value={item.portfolio.name} />}
              {item.portfolio?.heldInCount != null && (
                <Fact label="Held in" value={`${item.portfolio.heldInCount} portfolios`} />
              )}
            </div>
          </Section>
        )}

        {/* SIGNAL: the modelled ladder, the target, the horizon. */}
        {(v.cases?.length || v.target !== undefined || v.currentPrice != null
          || v.benchmarkPct != null || v.statedAt || v.dueAt) && (
          <Section title="The framework">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {v.currentPrice != null && <Fact label="Current" value={`$${v.currentPrice.toFixed(2)}`} />}
              {v.target != null && <Fact label="Target" value={`$${v.target.toFixed(2)}`} />}
              {v.target === null && <Fact label="Target" value="Not set" />}
              {v.benchmarkPct != null && <Fact label="Index weight" value={`${v.benchmarkPct.toFixed(1)}%`} />}
              {fmtDate(v.statedAt) && <Fact label="Stated" value={fmtDate(v.statedAt)!} />}
              {fmtDate(v.dueAt) && <Fact label="Horizon" value={fmtDate(v.dueAt)!} />}
              {fmtDate(v.lastLookAt) && <Fact label="Last look" value={fmtDate(v.lastLookAt)!} />}
            </div>
            {!!v.cases?.length && (
              <ul className="mt-3 space-y-1.5" data-detail-cases>
                {v.cases.map(c => (
                  <li key={`${c.label}:${c.price}`} className="flex items-baseline justify-between gap-3">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{c.label}</span>
                    <span className="text-[15px] font-semibold tabular-nums text-gray-900 dark:text-white">
                      ${c.price.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {/* IDEA: the thesis in full, the stance, where it has got to. */}
        {(v.quote || item.state || v.direction || item.source?.kind === 'person') && (
          <Section title={item.subtype === 'idea' ? 'The case' : 'Context'}>
            {v.direction && (
              <span className={clsx(
                'mb-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                v.direction === 'buy'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
              )}>
                {v.direction}
              </span>
            )}
            {v.quote && (
              <p className="whitespace-pre-line text-[15px] italic leading-[1.55] text-gray-700 dark:text-gray-200">
                {v.quote}
              </p>
            )}
            {item.state && (
              <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {item.state}
              </p>
            )}
            {item.source?.kind === 'person' && (
              <p className="mt-2 flex items-center gap-1.5 text-[13px] text-gray-500 dark:text-gray-400">
                <Users className="h-3.5 w-3.5" /> {item.source.label}
              </p>
            )}
          </Section>
        )}

        {/* NEWS: the publisher and the moment. */}
        {item.subtype === 'news' && (item.source || item.occurredAt) && (
          <Section title="Source">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {item.source && <Fact label="Publisher" value={item.source.label} />}
              {fmtDate(item.occurredAt) && <Fact label="Published" value={fmtDate(item.occurredAt)!} />}
            </div>
          </Section>
        )}
      </div>

      {/* ── Actions, after the sheet has landed ─────────────────────────────
          One row, pinned, clear of the home indicator. Only the routes this
          item genuinely has — no dead-end buttons. */}
      {(article || (assetId && symbol)) && (
        <div className="shrink-0 border-t border-gray-100 px-5 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] dark:border-gray-800">
          <div className="flex gap-2">
            {article && (
              <button
                type="button"
                data-detail-read
                onClick={() => onReadArticle?.(article.url)}
                className="flex h-12 flex-1 items-center justify-center gap-1 rounded-xl bg-gray-900 text-[15px] font-bold text-white dark:bg-white dark:text-gray-900"
              >
                Read the story <ArrowUpRight className="h-4 w-4" />
              </button>
            )}
            {assetId && symbol && (
              <button
                type="button"
                data-detail-open-asset
                onClick={() => onOpenAsset?.(assetId, symbol)}
                className={clsx(
                  'flex h-12 items-center justify-center rounded-xl text-[15px] font-bold',
                  article
                    ? 'flex-1 border border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-200'
                    : 'flex-1 bg-gray-900 text-white dark:bg-white dark:text-gray-900',
                )}
              >
                Open {symbol}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
