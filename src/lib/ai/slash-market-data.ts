/**
 * Market-data Slash Commands that return a real figure, and the ones that
 * say why they cannot.
 *
 * ── What was wrong ──────────────────────────────────────────────────────
 *
 * `/price.AAPL` expanded into the sentence "What is the current price of
 * AAPL?" and the reader sent it. That was defended as provenance-safe --
 * the model looks the figure up, so the number carries a source -- and it
 * is the wrong trade. A deterministic command became a non-deterministic
 * one: a model request, with its latency, its cost, and an answer that may
 * come back hedged, rounded, or about a different day.
 *
 * A command that names a stored figure should return the stored figure.
 *
 * ── Which commands can, and which cannot ────────────────────────────────
 *
 * This is not a design choice, it is what the cache holds.
 * `price_history_cache` stores, per symbol per day: open, high, low, close,
 * volume, the source string and when it was fetched. So:
 *
 *   /price      the close. Retrievable.
 *   /volume     the volume. Retrievable.
 *   /change     two closes, differenced. Retrievable.
 *
 *   /marketcap  needs shares outstanding. `assets.market_cap` exists, and
 *               carries no source, no as-of date and no pipeline that
 *               refreshes it -- so surfacing it would be a figure with no
 *               provenance path, which this codebase forbids rather than
 *               discourages.
 *   /pe         needs earnings. Not stored anywhere with provenance.
 *   /dividend   needs a dividend history. Not stored at all.
 *
 * The three that cannot are NOT quietly turned into questions. They name
 * the exact missing input, and offer the model lookup as a clearly
 * labelled second thing the reader can choose -- which is a different act
 * from the command pretending to have worked.
 *
 * ── What this module is ─────────────────────────────────────────────────
 *
 * Pure. The classification, the formatting and the provenance sentence. The
 * read itself is a hook, because it needs Supabase; this is what the hook's
 * result is turned into, so the wording can be tested without a database.
 */

import type { Observed, FreshnessVerdict } from '../market-data'

/** What a data command can be answered from. */
export type SlashDataKind = 'close' | 'volume' | 'change' | 'unsupported'

/**
 * What each data command needs, and whether the cache has it.
 *
 * Keyed by the command id, so adding a command without deciding this is a
 * type error rather than a silent `unsupported`.
 */
export const SLASH_DATA_KIND: Readonly<Record<string, SlashDataKind>> = Object.freeze({
  price: 'close',
  volume: 'volume',
  change: 'change',
  marketcap: 'unsupported',
  pe: 'unsupported',
  dividend: 'unsupported',
})

/**
 * The exact missing input, per command.
 *
 * "Not available" would be the useless version. The reader is told what the
 * figure needs and what the store holds, because that is the difference
 * between a gap they can report and a feature that looks broken.
 */
export const SLASH_DATA_BLOCKER: Readonly<Record<string, string>> = Object.freeze({
  marketcap: 'Market capitalisation needs shares outstanding, which is not stored with a source or an as-of date.',
  pe: 'A P/E ratio needs earnings, which are not stored with a provenance path.',
  dividend: 'Dividend yield needs a dividend history, which is not stored.',
})

export function slashDataKind(id: string): SlashDataKind {
  return SLASH_DATA_KIND[id] ?? 'unsupported'
}

/** Can this command be answered from the store, deterministically? */
export function isRetrievableData(id: string): boolean {
  return slashDataKind(id) !== 'unsupported'
}

export type SlashReadingState = 'loading' | 'ok' | 'empty' | 'error'

export interface SlashReading {
  state: SlashReadingState
  /** The command this answers. */
  id: string
  symbol: string
  /** The figure, with its provenance. Present only when `ok`. */
  observed?: Observed<number> | null
  verdict?: FreshnessVerdict
  /** What to CALL the figure, e.g. "Last close". Produced beside it. */
  label?: string
  /** For `/change`: the earlier close it was differenced against. */
  previous?: { close: number; date: string } | null
  /** For `error`: what failed. Never a guess at why. */
  detail?: string
}

/**
 * The figure, formatted.
 *
 * ── Why the label comes from the reader, not from here ──────────────────
 *
 * `latestClose` returns a `label` next to the number -- "Last close", never
 * "Current price" -- because a holdings mark carrying the second label is a
 * defect this codebase has already had. This function must not invent a
 * label of its own for the same reason.
 */
export function formatReading(reading: SlashReading): string | null {
  if (reading.state !== 'ok' || !reading.observed) return null
  const v = reading.observed.value
  switch (slashDataKind(reading.id)) {
    case 'close':
      return `$${v.toFixed(2)}`
    case 'volume':
      return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
    case 'change': {
      const prev = reading.previous?.close
      if (prev == null || prev <= 0) return null
      const pct = ((v - prev) / prev) * 100
      const sign = pct > 0 ? '+' : ''
      return `${sign}${pct.toFixed(2)}%`
    }
    default:
      return null
  }
}

/**
 * The provenance sentence under the figure.
 *
 * Every part of it is read off the value rather than assumed: the provider,
 * how it reached us, and the date the fact was TRUE -- which for a close is
 * the close date and never "now". A reading with no provider says `unknown`,
 * because the rows predate the nightly job and some were seeded by hand;
 * claiming a vendor for those would be inventing provenance.
 */
export function provenanceLine(reading: SlashReading): string | null {
  if (reading.state !== 'ok' || !reading.observed) return null
  const { source, effectiveAt } = reading.observed
  const day = effectiveAt.slice(0, 10)
  const feed = source.feed ? ` (${source.feed})` : ''
  const via = source.via === 'cache' ? 'stored' : source.via
  return `${source.provider}${feed}, ${via}, as of ${day}`
}

/**
 * The staleness warning, when there is one worth making.
 *
 * A `stale` verdict on a calendar basis means "older than the conservative
 * window", NOT "the exchange has published something newer" -- those are
 * different claims and only one is provable from here, so the wording holds
 * only the provable one.
 */
export function stalenessNote(reading: SlashReading): string | null {
  const verdict = reading.verdict
  if (!verdict || verdict.state !== 'stale') return null
  const days = verdict.ageDays
  if (days == null) return 'This figure may be out of date.'
  return days === 1
    ? 'This is one day old.'
    : `This is ${days} days old.`
}

/**
 * The question to send when the figure cannot be retrieved.
 *
 * Still offered, and clearly a DIFFERENT act: the reader is choosing to ask
 * the model to look something up, having been told the store cannot answer.
 * That is not the command silently becoming a question.
 */
const FALLBACK_QUESTIONS: Readonly<Record<string, string>> = Object.freeze({
  marketcap: 'What is the market capitalisation of {SYMBOL}, and what is your source?',
  pe: 'What is the P/E ratio for {SYMBOL}, and what is your source?',
  dividend: 'What is the dividend yield on {SYMBOL}, and what is your source?',
})

export function fallbackQuestion(id: string, symbol: string): string | null {
  const q = FALLBACK_QUESTIONS[id]
  return q ? q.replace('{SYMBOL}', symbol) : null
}

/**
 * The line a reader can paste into a question, figure and provenance
 * together.
 *
 * One string, deliberately. The provenance travelling separately from the
 * number is how a value ends up in a message with no source attached, which
 * is the same failure the `Observed` wrapper exists to prevent.
 */
export function readingAsText(reading: SlashReading | null | undefined): string | null {
  if (!reading) return null
  const figure = formatReading(reading)
  const prov = provenanceLine(reading)
  if (!figure || !prov) return null
  const label = reading.label ?? 'Value'
  return `${reading.symbol} ${label.toLowerCase()}: ${figure} (${prov})`
}
