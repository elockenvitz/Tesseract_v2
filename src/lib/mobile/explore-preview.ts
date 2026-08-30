import type { ExploreItem } from './explore-item'

/**
 * What an Explore card SAYS, decided in one place.
 *
 * ── Why the tile does not decide this itself ──────────────────────────────
 *
 * It did, and the tile rendered whatever the adapters happened to put in each
 * field. That is fine while the fields are independent and ruinous when they
 * are not — the conviction adapter writes a metric of `14.2%` labelled
 * "position" and a context of `14.2% in Large Cap Growth`, both true, both
 * useful, and printed one under the other they are the same number twice in two
 * phrasings. Three adapters do this, so the duplication was not a bug in one of
 * them; it was the absence of anywhere to notice.
 *
 * So the card's lines are computed here, from the whole item at once, and the
 * tile renders the result. Presentation only — nothing in this file changes a
 * fact, and the full, untouched original is always what a tap reaches.
 *
 * Pure — no React, no Supabase.
 */

/**
 * Short relative time, one vocabulary.
 *
 * `45m`, `6h`, `12d`, `5mo` — no spaces, no long units, no "just now" for a
 * timestamp that is absent rather than recent. An absent one renders nothing,
 * because a card that cannot say when something happened should not imply it
 * happened now.
 */
export function exploreAge(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const mins = Math.max(0, Math.round((now - t) / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  return `${Math.round(days / 30)}mo`
}

/**
 * Verbose money, said the way a card has room for.
 *
 * ── The narrowest transformation that fixes the reported problem ──────────
 *
 * A publisher's headline reading "Does Louisiana's US$10 Million Talc Verdict
 * Shift the Legal Risk Bull Case For Johnson & Johnso…" loses its subject to a
 * spelled-out number and a currency prefix that says nothing to a desk whose
 * prices are all in dollars. `US$10 Million` costs 14 characters; `$10M` costs
 * four, and the ten characters bought back are the ones that were carrying
 * "Johnson & Johnson".
 *
 * Deliberately only this. It rewrites no words, reorders nothing, and cannot
 * change a magnitude — the number and its scale come through the regex
 * unaltered. Anything more ambitious is a copy-editing layer, and a card that
 * paraphrases a headline is a card that can misquote one.
 *
 * The reader gets the publisher's exact words on tap: `destination.title`
 * carries the original and this never touches it.
 */
export function compactHeadlineNumbers(title: string): string {
  const SCALE: Record<string, string> = {
    thousand: 'K', million: 'M', billion: 'B', trillion: 'T',
  }
  return title
    // "US$10 Million" / "$1.25 billion" / "USD 500 thousand" → "$10M".
    // No leading `\b`: `$` is not a word character, so a boundary before it
    // fails at the start of a string and "$500 thousand fine" went through
    // untouched.
    .replace(
      /(?:US\$|USD\s*\$?|\$)\s*(\d+(?:\.\d+)?)\s*(thousand|million|billion|trillion)\b/gi,
      (_m, n: string, scale: string) => `$${n}${SCALE[scale.toLowerCase()]}`,
    )
    // A bare "US$" with a plain number behind it. Same currency, fewer glyphs.
    .replace(/\bUS\$/g, '$')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * The publisher's name, spelled one way.
 *
 * Trimmed and de-doubled, and nothing else. Re-casing was the obvious next step
 * and it is wrong: title case turns `CNBC` into `Cnbc` and `Simply Wall St.`
 * survives only by luck. Sources arrive already cased by the people who own the
 * name, so the only inconsistency worth removing is whitespace.
 */
export function normalizeSourceLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim()
}

/**
 * Titles whose whole content is the TYPE of the thing.
 *
 * ── Why this list is short and closed ─────────────────────────────────────
 *
 * A human wrote the title and replacing one is a real cost: the author chose
 * those words and Explore is not a copy desk. So this catches only the titles
 * that carry no information at all — the ones that name the category the card
 * is already filed under.
 *
 * "Trade idea" on a tile whose eyebrow reads IDEA, whose rail shows a
 * proposal's stages and whose chip says BUY tells the reader the type four
 * times and the idea zero. Meanwhile the row holds an author, a direction and a
 * ticker — the three facts that distinguish one proposal from the next — and
 * the headline, the most prominent line on the card, said none of them.
 *
 * Anything with a subject in it is not weak. "Trade idea: TGT" survives,
 * because the moment a title names what it is about it is doing its job.
 */
const WEAK_TITLES = new Set([
  'trade idea', 'trade', 'idea', 'new idea', 'proposed trade',
  'note', 'notes', 'quick note', 'research', 'research note',
  'update', 'thesis update', 'quick thought', 'thought', 'post',
  'untitled', 'no title', 'tbd',
])

/**
 * Whether a title says only what KIND of thing this is.
 *
 * Exported so the rule is testable on its own: it is the half of this that can
 * silently over-reach, and a headline replaced by mistake is worse than a weak
 * one kept.
 */
export function isWeakTitle(title: string | null | undefined): boolean {
  const t = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return true
  return WEAK_TITLES.has(t)
}

/**
 * A claim built from the fields the row already carries.
 *
 * No AI, no prose generation, no paraphrase: this assembles an author, a
 * direction and a ticker into the sentence `postTitle` ALREADY writes for a
 * proposal with no title of its own. The two agree by construction, which is
 * the point — a reader should not be able to tell which path produced the
 * headline.
 *
 * Returns null rather than a hedge whenever the row cannot supply the parts, so
 * a weak title with nothing behind it is kept as-is. A bad headline the author
 * wrote beats a worse one this invented.
 */
export function derivedClaim(item: ExploreItem): string | null {
  const who = item.source?.kind === 'person' ? item.source.label : null
  const sym = item.symbol ?? null
  const dir = item.visual?.direction ?? null

  if (dir && sym) {
    const verb = dir === 'buy' ? 'wants to buy' : 'wants to sell'
    return who ? `${who} ${verb} ${sym}` : `Proposed ${dir} in ${sym}`
  }
  if (who && sym) return `${who} on ${sym}`
  if (sym && item.companyName) return `${item.companyName}`
  return null
}

export interface ExplorePreview {
  /**
   * What kind of thing this is, in one word, for the top of the card.
   *
   * ── Why a preview needs to say this at all ──────────────────────────────
   *
   * The header row showed a coloured dot and then the TICKER, and fell back to
   * the category name only when there was no ticker. So on the great majority
   * of the page — every card about a name — the only thing carrying "is this a
   * finding, a colleague's post, or a headline somebody else wrote" was a 6px
   * dot in one of five quiet colours. That is a legend the reader has to learn
   * before the grid means anything, and until they have, a mosaic of mixed
   * families reads as one undifferentiated wall.
   *
   * The dot stays — it is the fast scan once the vocabulary is known — and the
   * word is what makes the vocabulary learnable. Named from the SUBTYPE rather
   * than the category, because subtype is the finer question and the one a
   * reader is actually asking: "Idea" and "News" are different things to do
   * with your afternoon in a way that "Ideas" and "News" as filter chips do not
   * capture on a card that is already filtered.
   */
  kind: string
  /** The headline, at the length the card will actually show. */
  headline: string
  /** The one number, or none. Never invented to fill the slot. */
  metric?: ExploreItem['metric']
  /** One compact state line — an idea's action and status. Absent for most cards. */
  state?: string
  /** At most one supporting clause, with anything the metric already said removed. */
  secondary?: string
  /** Who produced it, normalised. */
  source?: string
  /** How many lines the headline may take, given what else the card is showing. */
  headlineClamp: 2 | 3
  /**
   * True when the headline is a claim assembled from the row rather than the
   * author's own words. Asserted in tests; rendered nowhere.
   */
  derivedHeadline: boolean
}

/**
 * Whether `context` opens by restating `metric`, and what is left if it does.
 *
 * Returns null when the context is about something else, which is the common
 * case and must stay untouched — "Second revision this quarter" beside a
 * metric of `8.1%` is two facts, not one repeated.
 *
 * Matches on the metric's rendered value rather than on a number parsed out of
 * both, because the value is what the reader sees: `14.2%` above and `14.2% in
 * Large Cap Growth` below is a duplicate to them whatever the underlying floats
 * are, and two values that differ in the last decimal are not.
 */
export function restatesMetric(context: string, metricValue: string): boolean {
  const v = metricValue.trim()
  if (!v) return false
  const c = context.trim()
  if (!c.toLowerCase().startsWith(v.toLowerCase())) return false
  /**
   * And the match has to end where the number does.
   *
   * A prefix match alone is wrong for the metrics that carry no unit — the
   * crowding card's value is a bare `3`, and `3` is a prefix of `32% of Core
   * Equity`, so a context about a completely different figure would have had
   * its first digit eaten and rendered as "2% of Core Equity". A wrong number,
   * silently, which is the worst thing this file could produce.
   *
   * The next character must therefore not continue the figure.
   */
  const next = c.charAt(v.length)
  return next === '' || !/[\d.,%]/.test(next)
}

export function stripRestatedMetric(context: string, metricValue: string): string | null {
  const v = metricValue.trim()
  if (!restatesMetric(context, v)) return null
  const c = context.trim()
  const tail = c.slice(v.length)
  // The connector the adapters use between a figure and the portfolio it is in.
  const withoutConnector = tail.replace(/^\s*(?:in|of|across|·|—|-|,)\s*/i, '')
  const rest = withoutConnector.trim()
  if (!rest) return null
  /**
   * Capitalised when the figure was the sentence's subject.
   *
   * "14.2% in Large Cap Growth" strips through a connector to a proper noun
   * that is already capitalised, and touching it would be wrong. "22% under the
   * worst outcome modelled" has no connector to consume — removing the figure
   * leaves a clause mid-sentence, and printing "under the worst outcome
   * modelled" as a card's supporting line reads as a fragment somebody
   * truncated. The number moved to the line above it; the sentence starts here
   * now.
   */
  const consumedConnector = withoutConnector.length !== tail.length
  return consumedConnector ? rest : rest.charAt(0).toUpperCase() + rest.slice(1)
}

/**
 * Everything one card renders, resolved together.
 *
 * The order of the fallbacks is the order of usefulness, and it is the same
 * order §2 asks for: what it is, what happened, the one number, one line of
 * support. A card never gets two lines saying the same thing, and never gets a
 * line invented to fill a slot — an item with no context and no company name
 * renders a headline and stops.
 */
/**
 * The word for each subtype, as a reader would say it.
 *
 * Six words for six subtypes, and deliberately not the category labels: those
 * name the FILTER ("Decisions", "Workflow"), and a filter is a plural of things
 * while a card is one thing. "Signal" is what the product calls a derived
 * finding everywhere else, "Task" is what a workflow row is to the person it is
 * assigned to, and "Summary" is what an aggregate is.
 */
const KIND_WORD: Record<ExploreItem['subtype'], string> = {
  signal: 'Signal',
  research: 'Research',
  idea: 'Idea',
  news: 'News',
  workflow: 'Task',
  aggregate: 'Summary',
}

export function explorePreview(item: ExploreItem, size: 'feature' | 'compact' = 'compact'): ExplorePreview {
  const isNews = item.subtype === 'news'

  /**
   * The headline, and the one case where the card overrides the author.
   *
   * A weak title is replaced only when the row can supply something better —
   * see `isWeakTitle` and `derivedClaim`. The original is NOT kept as a
   * secondary line: its entire content is the type, and the eyebrow above the
   * headline already says the type. Printing it again would be the eyebrow
   * twice, which is the duplication this surface spent a pass removing.
   */
  const claim = isWeakTitle(item.title) ? derivedClaim(item) : null
  const headline = isNews
    ? compactHeadlineNumbers(item.title)
    : claim ?? item.title

  /**
   * The supporting line, after the metric has had its say.
   *
   * Falls back to the company's name, which is the more useful line on exactly
   * the cards that have nothing else: a bare `TSM` headline leaves the reader
   * working out which company that is. Second to a real finding, never instead
   * of one.
   */
  /**
   * The words the quote block is about to draw, if any.
   *
   * A post tile can show three things made of prose — the headline, this
   * clause, and the quote — and they were routinely the same string. The
   * adapter now keeps them apart at the source; this is the backstop, because
   * `explorePreview` is the one place that sees the whole item at once and is
   * the only thing that can notice two fields agreeing.
   */
  const quote = item.visual?.quote?.trim() ?? ''
  const sameText = (a: string, b: string) => {
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const na = norm(a); const nb = norm(b)
    return !!na && !!nb && (na.startsWith(nb) || nb.startsWith(na))
  }

  let secondary: string | undefined
  if (item.context && item.metric) {
    // Null means the context opens with something the metric did not say, so
    // it stands exactly as written. A context that was ONLY the restatement
    // strips to nothing and is dropped rather than printed twice.
    secondary = stripRestatedMetric(item.context, item.metric.value)
      ?? (restatesMetric(item.context, item.metric.value) ? undefined : item.context)
  } else if (item.context) {
    secondary = item.context
  }
  // Never the quote again, however it got here.
  if (secondary && quote && sameText(secondary, quote)) secondary = undefined
  if (!secondary && item.companyName) secondary = item.companyName

  /**
   * How many lines the headline gets.
   *
   * A feature has width instead of lines, so two. Everything else gets three,
   * INCLUDING a story — a publisher writes to no length, and the fourth line
   * this used to allow was not buying comprehension, it was pushing the source
   * down the card until "Simply Wall St." read as an afterthought. Three lines
   * of a normalised headline reaches the verb on the great majority of them,
   * and a preview that needs a fourth has stopped previewing.
   */
  const headlineClamp: 2 | 3 = size === 'feature' || item.subtype === 'aggregate' ? 2 : 3

  /**
   * The attribution, unless the headline already made it.
   *
   * An untitled post's headline is "<Author> on <TICKER>" — the one fact the
   * quote beneath it cannot carry. Printing the same name again in the footer
   * spends the card's last line restating its first.
   */
  const sourceLabel = item.source ? normalizeSourceLabel(item.source.label) : undefined
  const source = sourceLabel && headline.includes(sourceLabel) ? undefined : sourceLabel

  /**
   * The metric, unless the headline has already said that number.
   *
   * "CEG down 6.2% on the session" over a metric line reading "-6.2% TODAY" is
   * the figure twice, eight pixels apart, and the second one adds a word the
   * first already implied. The same rule pass 1 applied between the metric and
   * the supporting clause, one line further up.
   *
   * Compared on digits, so `6.2%` and `-6.2%` count as the same number — the
   * sign is how the metric is formatted, not a second fact. The metric survives
   * whenever its figure is genuinely absent from the claim above it.
   */
  const digits = (x: string) => x.replace(/[^0-9.]/g, '')
  const metricSaidInHeadline = !!item.metric
    && !!digits(item.metric.value)
    && digits(headline).includes(digits(item.metric.value))

  return {
    kind: KIND_WORD[item.subtype],
    headline,
    derivedHeadline: claim != null,
    metric: metricSaidInHeadline ? undefined : item.metric,
    state: item.state || undefined,
    secondary,
    source,
    headlineClamp,
  }
}
