/**
 * Our View — the firm's position on a name, summarised and attributed.
 *
 * ── What this replaces, and why ──────────────────────────────────────────
 *
 * "Our View" used to render the full research document: every visible rich-text
 * field in the org's template, each one a `ContributionSection` holding every
 * analyst's prose. It was also the DEFAULT, so an analyst opening a name they
 * cover landed on a combined pane rather than their own work, and a reader
 * asking "what does the firm think" got several thousand words instead of an
 * answer.
 *
 * A firm view and an analyst's research document are different artefacts. This
 * is the first: who has written, what they conclude, where they disagree, how
 * fresh it is, and a way into the full text. The full text stays exactly where
 * it was — in each analyst's own view, rendered by the same `ContributionSection`
 * components, with editing unchanged.
 *
 * ── Why it takes its sections as a prop ──────────────────────────────────
 *
 * The asset page is template-driven: an organisation picks which fields appear
 * and in what order (`layout-resolver.ts`), and a field's prose lives in
 * `asset_contributions` under one or more section keys, which several template
 * slugs alias (`contribution-sections.ts`). Hardcoding a section list here
 * would have introduced a second, competing research vocabulary — the one
 * thing this change must not do. So the caller passes the template's own
 * ordered fields, already mapped to their section keys, and this component
 * reports on exactly what that org chose to ask for.
 *
 * ── What it must never do ────────────────────────────────────────────────
 *
 * It does NOT synthesise. No generated prose, no averaged "firm thesis", no
 * model-authored conclusion. Every line is a count, a date, a name, or a
 * verbatim excerpt attributed to the person who wrote it. The AI-generated
 * reading of the same material already exists behind the Summary view mode
 * (`ThesisUnifiedSummary`) and stays there, clearly labelled as generated;
 * this is the factual one.
 *
 * In particular it never reports a consensus that one analyst's opinion cannot
 * support: a single contributor renders as "1 contributor", never as "the
 * firm's view", and where several analysts have written the same section it
 * shows them SEPARATELY and flags it, rather than collapsing them to a
 * majority.
 *
 * Rating and valuation are not re-derived here. The caller composes the
 * existing `PriceTargetsSummary` and `FirmConsensusPanel` above this, which
 * own that logic.
 */

import { clsx } from 'clsx'
import { useMemo } from 'react'
import { ChevronRight, Users, Clock, Info } from 'lucide-react'
import type { Contribution } from '../../hooks/useContributions'

/** One template field, with the contribution sections its prose can live under. */
export interface OurViewField {
  /** Template field slug — stable id for the row. */
  slug: string
  /** The org's own label for the field. Never overridden here. */
  label: string
  /** Every section key this field's prose might be stored under, in order. */
  sectionKeys: string[]
}

/** How many analysts' excerpts to show per field before linking out. */
const EXCERPTS_PER_FIELD = 3

const DAY = 86_400_000

export function ourViewAge(iso: string | null | undefined, now = Date.now()): { text: string; stale: boolean } | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const days = Math.floor((now - t) / DAY)
  if (days <= 0) return { text: 'today', stale: false }
  if (days === 1) return { text: 'yesterday', stale: false }
  if (days < 30) return { text: `${days}d ago`, stale: false }
  if (days < 365) return { text: `${Math.floor(days / 30)}mo ago`, stale: days >= 180 }
  return { text: `${Math.floor(days / 365)}y ago`, stale: true }
}

export function contributorName(c: Pick<Contribution, 'user'>): string {
  const u = c.user
  const joined = [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim()
  return u?.full_name?.trim() || joined || 'Unknown analyst'
}

/**
 * The opening sentence of what someone wrote, or a clipped prefix of it.
 *
 * Verbatim by construction. Paraphrasing here would quietly make this
 * component the author of a conclusion attributed to a named person, which is
 * the specific thing it exists not to do.
 *
 * `content` is rich text, so tags are stripped for the excerpt only — the full
 * markup still renders in the analyst's own view.
 */
export function ourViewPlainText(content: string | null | undefined): string {
  /*
   * HTML *and* Markdown.
   *
   * This stripped tags only, and contributions are MARKDOWN — every other
   * surface renders them through `ReactMarkdown` / `SmartInputRenderer`. So a
   * thesis written as "**Services** mix is mispriced" reached the Snapshot,
   * the conclusion band and the phone as the literal characters `**Services**`,
   * and a `## Heading` or a `[link](url)` leaked whole. Reported from the
   * authenticated app as raw Markdown in the excerpts.
   *
   * Order matters: images before links (both start `[`), and emphasis after
   * code so a backtick span is not half-unwrapped.
   */
  return (content ?? '')
    // HTML first — some contributions carry both.
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Fenced and inline code: keep the code, drop the fence.
    .replace(/```[a-z]*\n?/gi, ' ')
    .replace(/`([^`]*)`/g, '$1')
    // Images drop entirely; links keep their text, not their URL.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Block syntax at the start of a line: headings, quotes, list bullets,
    // ordered markers and horizontal rules.
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+[.)]\s+/gm, '')
    .replace(/^\s{0,3}([-*_]\s*){3,}$/gm, ' ')
    // Emphasis. Longest marker first so `**` is not left as a stray `*`.
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function ourViewExcerpt(content: string | null | undefined, max = 190): string {
  const flat = ourViewPlainText(content)
  if (flat.length === 0) return ''
  if (flat.length <= max) return flat

  /*
   * Whole sentences, up to the budget — not just the first one.
   *
   * The first draft stopped at the opening full stop, and rendering it showed
   * why that was wrong: analysts routinely open with a one-line position and
   * put the actual claim in the next sentence. "Consensus treats the services
   * take-rate as a policy variable." is not the variant view; the sentence
   * after it, with the number in it, is. Clipping to one sentence produced a
   * tidy summary that had dropped the point of every entry.
   *
   * So fill the budget with complete sentences and stop before exceeding it.
   * Always at least one, clipped on a word boundary if even that overruns.
   */
  const boundaries: number[] = []
  const re = /[.!?](?=\s|$)/g
  for (let m = re.exec(flat); m; m = re.exec(flat)) boundaries.push(m.index + 1)

  let end = 0
  for (const b of boundaries) {
    if (b > max) break
    end = b
  }
  // A complete sentence ends on its own full stop; no ellipsis is needed to
  // say there is more, because the row already links to it.
  if (end > 0) return flat.slice(0, end)

  const cut = flat.slice(0, max).replace(/\s+\S*$/, '') || flat.slice(0, max)
  return `${cut.replace(/[,;:\s]+$/, '')}…`
}

/** A contribution counts toward the firm's view only if it has live prose. */
export function hasLiveProse(c: Contribution): boolean {
  if (c.is_archived) return false
  // Markup with no words in it is not a view. `<p></p>` is what an opened and
  // abandoned editor leaves behind, and it would otherwise count as a
  // contributor with a blank excerpt.
  return ourViewPlainText(c.content).length > 0
}

export interface OurViewSummaryProps {
  /** Every contribution on the asset the viewer can see. */
  contributions: Contribution[]
  /** The org's template fields, in template order, already section-mapped. */
  fields: OurViewField[]
  /** Covering analysts, so a covering author is marked as such. */
  coveringAnalystIds?: Set<string>
  /** Opens one analyst's full research document. */
  onOpenAnalyst?: (userId: string) => void
  /** The viewer, so their own row reads "you". */
  currentUserId?: string | null
  symbol?: string | null
  className?: string
  /**
   * How much to show.
   *
   * `full` quotes each contributor's opening claim per section. `roster`
   * shows only who has written, how much, how fresh, and where more than one
   * analyst has written the same section — no prose at all.
   *
   * `roster` exists because of where this now sits. On the Snapshot it is
   * directly below "The case", which already renders one verbatim excerpt per
   * core section from the same contributions. Showing both put the thesis on
   * screen twice, which is the duplication this whole surface was built to
   * remove. The case states the ARGUMENT; this states WHO MADE IT.
   */
  mode?: 'full' | 'roster'
  /** Drop the outer card chrome when the caller already provides a panel. */
  bare?: boolean
}

const CARD_FULL = 'rounded-xl border border-gray-200 bg-white px-4 py-2.5 dark:border-gray-800 dark:bg-gray-900'
const CARD_BARE = 'px-1 py-1.5'

export function OurViewSummary({
  contributions,
  fields,
  coveringAnalystIds,
  onOpenAnalyst,
  currentUserId,
  symbol,
  className,
  mode = 'full',
  bare = false,
}: OurViewSummaryProps) {
  const CARD = bare ? CARD_BARE : CARD_FULL
  const live = useMemo(() => contributions.filter(hasLiveProse), [contributions])

  const rows = useMemo(() => {
    /*
     * Each field collects contributions under ANY of its section keys, because
     * `key-risks` and `risks-to-thesis` are the same field stored two ways and
     * a reader must not see half their firm's risk work.
     */
    const seen = new Set<string>()
    return fields.map(field => {
      const keys = new Set(field.sectionKeys)
      const matches = live
        .filter(c => keys.has(c.section) && !seen.has(c.id))
        .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
      // A field earlier in the template owns a shared section key, so an
      // aliased field below it does not repeat the same prose.
      for (const m of matches) seen.add(m.id)
      return { ...field, matches }
    }).filter(r => r.matches.length > 0)
  }, [fields, live])

  const authors = useMemo(() => {
    const m = new Map<string, { name: string; covering: boolean; latest: string | null; count: number }>()
    for (const c of live) {
      if (!c.created_by) continue
      const prev = m.get(c.created_by)
      m.set(c.created_by, {
        name: contributorName(c),
        covering: coveringAnalystIds?.has(c.created_by) ?? false,
        latest: (c.updated_at ?? '') > (prev?.latest ?? '') ? c.updated_at : (prev?.latest ?? null),
        count: (prev?.count ?? 0) + 1,
      })
    }
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) =>
        Number(b.covering) - Number(a.covering)
        || b.count - a.count
        || a.name.localeCompare(b.name))
  }, [live, coveringAnalystIds])

  const newest = useMemo(
    () => live.reduce<string | null>(
      (acc, c) => ((c.updated_at ?? '') > (acc ?? '') ? c.updated_at : acc), null),
    [live],
  )

  if (rows.length === 0) {
    return (
      <div
        data-testid="our-view-empty"
        className={clsx(
          'rounded-xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-gray-900',
          className,
        )}
      >
        <p className="text-[13px] font-medium text-gray-900 dark:text-gray-100">
          No one has written a view on {symbol || 'this name'} yet.
        </p>
        <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">
          This summary reports what analysts have written. It does not generate one.
        </p>
      </div>
    )
  }

  const age = ourViewAge(newest)

  return (
    <div className={clsx('space-y-2', className)} data-testid="our-view-summary">
      {/* ── Who has a view here, and how fresh the newest one is ────── */}
      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <Users className="h-3.5 w-3.5 text-gray-400" />
            {authors.length} {authors.length === 1 ? 'contributor' : 'contributors'}
            <span className="font-normal normal-case tracking-normal text-gray-400">
              across {rows.length} {rows.length === 1 ? 'section' : 'sections'}
            </span>
          </span>
          {age && (
            <span
              className={clsx(
                'inline-flex items-center gap-1 text-[11px]',
                age.stale ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400',
              )}
              data-testid="our-view-freshness"
            >
              <Clock className="h-3 w-3" />
              newest update {age.text}{age.stale && ' — may be stale'}
            </span>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap gap-1">
          {authors.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={onOpenAnalyst ? () => onOpenAnalyst(a.id) : undefined}
              disabled={!onOpenAnalyst}
              data-testid={`our-view-author-${a.id}`}
              title={onOpenAnalyst ? `Open ${a.name}'s research` : a.name}
              className={clsx(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                a.covering
                  ? 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
                onOpenAnalyst && 'cursor-pointer hover:underline',
              )}
            >
              {a.name}{a.id === currentUserId && ' (you)'}
              {a.covering && <span className="text-[9px] uppercase tracking-wide opacity-80">covering</span>}
              <span className="text-gray-400">{a.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/*
        ── Roster: who wrote where, without re-quoting it ──

        On the Snapshot this sits directly under "The case", which already
        renders one verbatim excerpt per core section from the same
        contributions. Quoting them again put the thesis on screen twice.
        So this mode reports coverage and disagreement only: which sections
        have writing, how many analysts, and where more than one has written.
      */}
      {mode === 'roster' && rows.length > 0 && (
        <div className={CARD} data-testid="our-view-roster">
          <ul className="flex flex-col gap-1">
            {rows.map(row => (
              <li key={row.slug} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="min-w-0 truncate text-gray-700 dark:text-gray-300">{row.label}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  {row.matches.length > 1 && (
                    <span
                      data-testid={`our-view-multiple-${row.slug}`}
                      title="More than one analyst has written here. Open a contributor to read each."
                      className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                    >
                      {row.matches.length} views
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-gray-500">
                    {row.matches.length} {row.matches.length === 1 ? 'entry' : 'entries'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Per template field: who said what, attributed, with a way in ── */}
      {mode === 'full' && rows.map(row => (
        <div
          key={row.slug}
          data-testid={`our-view-section-${row.slug}`}
          className={CARD}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[12px] font-semibold text-gray-900 dark:text-gray-100">{row.label}</h3>
            {row.matches.length > 1 && (
              <span
                data-testid={`our-view-multiple-${row.slug}`}
                title="More than one analyst has written here. Their views are listed separately, not merged into a firm position."
                className="shrink-0 rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              >
                {row.matches.length} views
              </span>
            )}
          </div>

          <ul className="mt-1.5 space-y-1.5">
            {row.matches.slice(0, EXCERPTS_PER_FIELD).map(c => {
              const a = ourViewAge(c.updated_at)
              return (
                <li key={c.id} className="text-[12px]">
                  <button
                    type="button"
                    onClick={onOpenAnalyst && c.created_by ? () => onOpenAnalyst(c.created_by) : undefined}
                    disabled={!onOpenAnalyst || !c.created_by}
                    className={clsx('group w-full text-left', onOpenAnalyst && c.created_by && 'cursor-pointer')}
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span className="shrink-0 font-semibold text-gray-700 dark:text-gray-300">
                        {contributorName(c)}{c.created_by === currentUserId && ' (you)'}
                      </span>
                      {a && (
                        <span className={clsx(
                          'shrink-0 text-[10px]',
                          a.stale ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400',
                        )}>
                          {a.text}
                        </span>
                      )}
                      {onOpenAnalyst && c.created_by && (
                        <ChevronRight className="h-3 w-3 shrink-0 self-center text-gray-300 group-hover:text-primary-500" />
                      )}
                    </span>
                    {/*
                      A verbatim opening, attributed on the line above. Not a
                      summary of their view — the words they wrote, clipped.
                    */}
                    <span className="mt-0.5 block leading-snug text-gray-600 dark:text-gray-400">
                      {ourViewExcerpt(c.content)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {row.matches.length > EXCERPTS_PER_FIELD && (
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              {row.matches.length - EXCERPTS_PER_FIELD} more in the individual views.
            </p>
          )}
        </div>
      ))}

      {mode === 'full' && (
      <p className="flex items-start gap-1 px-1 text-[11px] text-gray-500 dark:text-gray-400">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          Excerpts are verbatim and attributed. Nothing here is a firm-authored
          conclusion — open a contributor to read their full research.
        </span>
      </p>
      )}
    </div>
  )
}
