import { suppress, type CardResult, type SuppressionReason } from './contract'

/**
 * The gate every card passes through before it can render.
 *
 * Suppression is a *display* decision. Nothing here deletes or edits data —
 * a card hidden by a quality gate stays in the database, per
 * docs/adr/0001-decision-record-is-append-only.md. What the gate produces is a
 * reason, and the reasons are the point: the log below is a data-quality
 * feed, not debug output.
 */

/**
 * How stale a quote may be before a claim resting on it stops being
 * checkable. Fifteen minutes is a compromise: long enough to survive a
 * provider hiccup, short enough that "target hit" means hit today.
 */
export const QUOTE_MAX_AGE_MS = 15 * 60 * 1000

/**
 * Below this many rows in a source table, absence means nothing.
 *
 * `analyst_ratings` holds 10 rows across 911 assets. A card reading "no
 * rating" off that fires on almost every name and communicates the sparsity
 * of the table rather than anything about the position. Any card whose claim
 * is *absence* needs a coverage floor or it is noise wearing a finding's
 * clothes.
 */
export const MIN_COVERAGE = 25

/** Placeholder and keyboard-mash patterns seen in the live feed. */
const PLACEHOLDER = [
  /^test$/i,
  /^testing$/i,
  /^asdf/i,
  /^qwer/i,
  /^general project$/i,
  /^untitled/i,
  /^n\/?a$/i,
  /^tbd$/i,
  /^xxx+$/i,
  /^\.+$/,
]

/**
 * Keyboard mash: long, all one case, and essentially vowel-free.
 *
 * `NDDFKJSDNFKJ` and `ksadjfnskdjn` both reached production. Tuned to need all
 * three conditions — plenty of legitimate content is short, and plenty is
 * capitalised, but real words carry vowels.
 */
function looksLikeMash(text: string): boolean {
  const t = text.trim()
  if (/\s/.test(t)) return false
  const letters = t.replace(/[^a-z]/gi, '')
  // Ten, not eight. At eight this rejected "strengths" — nine letters, one
  // vowel, 11% — and eating a real word to catch a fake one is the wrong
  // trade on a surface where the cost of a false positive is a card the user
  // needed and never saw. Single English words of ten-plus letters with under
  // 15% vowels are vanishingly rare; both observed mashes are twelve.
  if (letters.length < 10) return false
  const vowels = (letters.match(/[aeiou]/gi) ?? []).length
  return vowels / letters.length < 0.15
}

/** Is this string fit to render on a card face? */
export function isQualityContent(text: string | null | undefined): boolean {
  const t = (text ?? '').trim()
  if (t.length < 3) return false
  if (PLACEHOLDER.some(re => re.test(t))) return false
  if (looksLikeMash(t)) return false
  return true
}

/**
 * A number fit to display.
 *
 * Zero is rejected by default because the codebase's own placeholder quote
 * returned `price: 0, changePercent: 0` as a "won't break the UI" fallback —
 * so a zero on this surface has historically meant "we do not know" far more
 * often than it has meant zero. Callers where zero is genuinely meaningful
 * pass `allowZero`.
 */
export function isDisplayableNumber(
  n: number | null | undefined,
  opts?: { allowZero?: boolean },
): n is number {
  if (n == null || !Number.isFinite(n)) return false
  if (n === 0 && !opts?.allowZero) return false
  return true
}

/** Is a quote fresh enough for a claim to rest on it? */
export function isQuoteFresh(asOf: string | null | undefined): boolean {
  if (!asOf) return false
  const t = new Date(asOf).getTime()
  if (!Number.isFinite(t)) return false
  return Date.now() - t <= QUOTE_MAX_AGE_MS
}

export interface SuppressionEvent {
  reason: SuppressionReason
  entity: string
  type: string
  detail?: string
  at: string
}

const LOG_KEY = 'tesseract:signal-suppressions'
const LOG_CAP = 200

/**
 * Record why a card did not render.
 *
 * Kept because the reasons are a data-quality signal that exists nowhere
 * else: "17 cards suppressed for missing_number on 4 entities" is a bug
 * report nobody had to write. Client-side and capped for now, in the same
 * shape a server-side table should take, so moving it later is a port rather
 * than a redesign.
 */
export function logSuppression(event: Omit<SuppressionEvent, 'at'>): void {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(LOG_KEY)
    const log: SuppressionEvent[] = raw ? JSON.parse(raw) : []
    log.push({ ...event, at: new Date().toISOString() })
    // Newest wins: a full log must not stop recording today's problems.
    while (log.length > LOG_CAP) log.shift()
    localStorage.setItem(LOG_KEY, JSON.stringify(log))
  } catch {
    /* logging must never break the feed */
  }
}

export function readSuppressionLog(): SuppressionEvent[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]')
  } catch {
    return []
  }
}

/** Counts by reason, for the ops view. */
export function suppressionSummary(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of readSuppressionLog()) out[e.reason] = (out[e.reason] ?? 0) + 1
  return out
}

/**
 * Run a builder and log whatever it suppresses.
 *
 * Every builder goes through this rather than calling logSuppression itself —
 * a builder that forgets is a silently vanishing card, which is the failure
 * mode this whole gate exists to make impossible.
 */
export function gate(type: string, build: () => CardResult): CardResult {
  const result = build()
  if (!result.ok) {
    logSuppression({
      reason: result.reason,
      entity: result.entity,
      type,
      detail: result.detail,
    })
  }
  return result
}

/** Convenience for the commonest guard. */
export function requireQuality(
  text: string | null | undefined,
  entity: string,
  field: string,
): CardResult | null {
  return isQualityContent(text)
    ? null
    : suppress('content_quality', entity, `${field}: ${JSON.stringify(text ?? null)}`)
}
