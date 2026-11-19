/**
 * The instruments this person last charted, offered back when the symbol
 * box is focused and empty.
 *
 * ── Why this one writes to disk when its neighbour does not ───────────────
 *
 * `./workspace-state` holds the chart workspace in memory and says so
 * deliberately: "nothing about a chart selection is worth writing to disk on
 * a shared machine". That judgement still stands for a WORKSPACE, which is
 * rebuilt the moment a symbol is chosen.
 *
 * A recents list is the opposite: it is worthless if a reload empties it,
 * because its entire job is to shorten the second visit. So it is persisted
 * -- and it therefore has to carry the same isolation the in-memory store
 * gets for free.
 *
 * It does, by the same mechanism: the key is `userId:orgId`. A different
 * account or a different organization reads a DIFFERENT key and cannot see
 * the other's list, by construction rather than by remembering to clear.
 * `clearRecentInstruments` is wired into `clearProviderCaches` alongside
 * `clearChartingWorkspaces`, so a principal change empties it as well. The
 * partitioning is what makes it safe; the clear is hygiene.
 *
 * Be aware of what that still means: on a shared machine the list of names
 * someone has been looking at now survives a browser restart. For a buy-side
 * desk a watchlist is itself signal. The scoping prevents another ACCOUNT
 * from reading it; it does not encrypt it, and anyone with the machine and
 * that account can see it.
 *
 * ── Identity is the asset id, not the ticker ──────────────────────────────
 *
 * Two organizations can hold different assets under the same symbol, and a
 * ticker is reassigned between companies over time. Deduplicating on the
 * symbol would therefore collapse two distinct instruments into one entry
 * and hand the reader the wrong one. The id is the stable identity; the
 * symbol is a label.
 *
 * ── What is NOT stored ────────────────────────────────────────────────────
 *
 * Exchange and currency, which this list would be better for having. The
 * `assets` table has neither column -- it carries `symbol`, `company_name`,
 * `sector`, `current_price` and the case fields, and nothing naming a venue
 * or a unit. Rendering a venue here would mean inventing one, and an
 * invented venue on an instrument picker is exactly the sort of untraceable
 * figure this codebase forbids. It is left out until the data exists.
 *
 * RLS posture: unchanged, and not applicable. This module touches no table.
 * It records fields the caller already holds, having already read them
 * through the `assets` policy that governs the symbol search itself.
 */

/** A chart symbol someone picked, in the smallest shape worth keeping. */
export interface RecentInstrument {
  /** The asset's stable id. The identity, and the dedupe key. */
  id: string
  symbol: string
  companyName: string | null
}

/**
 * How many are kept.
 *
 * Ten is the brief's figure, and it is also about the point where a list
 * offered on focus stops being faster to read than typing three letters.
 */
export const RECENTS_LIMIT = 10

const PREFIX = 'tesseract.charting.recents.v1'

/**
 * `userId:orgId`, the same partitioning `chartingWorkspaceKey` uses.
 *
 * A missing principal gets a key that is still distinct and still scoped --
 * never a bare prefix that every signed-out session would share.
 */
export function recentInstrumentsKey(
  userId: string | null | undefined,
  orgId: string | null | undefined,
): string {
  return `${PREFIX}:${userId ?? 'anon'}:${orgId ?? 'no-org'}`
}

/**
 * Every storage call is wrapped.
 *
 * `localStorage` is not merely empty in a private window or with site data
 * blocked -- the ACCESSOR ITSELF throws. An unguarded read here would take
 * the charting page down on a browser setting, which is a far worse outcome
 * than an empty recents list.
 */
function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeWrite(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* Quota, privacy mode, or a blocked origin. A recents list is a
       convenience; failing to record one must never fail the selection that
       the user actually asked for. */
  }
}

/** Anything that is not a usable entry is dropped rather than rendered. */
function coerce(value: unknown): RecentInstrument | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const symbol = typeof row.symbol === 'string' ? row.symbol.trim() : ''
  if (!id || !symbol) return null
  const companyName = typeof row.companyName === 'string' ? row.companyName : null
  return { id, symbol, companyName }
}

/**
 * The list, most recently chosen first.
 *
 * Returns `[]` for anything it cannot read as a list of entries: a missing
 * key, text that is not JSON, JSON that is not an array, an array of the
 * wrong shape. A corrupt entry written by an older build must degrade to an
 * empty picker, never to a thrown render.
 */
export function readRecentInstruments(
  userId: string | null | undefined,
  orgId: string | null | undefined,
): RecentInstrument[] {
  const raw = safeRead(recentInstrumentsKey(userId, orgId))
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: RecentInstrument[] = []
  const seen = new Set<string>()
  for (const entry of parsed) {
    const row = coerce(entry)
    if (!row || seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
    if (out.length >= RECENTS_LIMIT) break
  }
  return out
}

/**
 * Record a selection and return the new list.
 *
 * Re-choosing something already held MOVES it to the front rather than
 * adding a second copy, which is why the dedupe runs before the cap: a list
 * of ten distinct names, not ten entries.
 */
export function recordRecentInstrument(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  instrument: { id: string; symbol: string; companyName?: string | null },
): RecentInstrument[] {
  const row = coerce({
    id: instrument.id,
    symbol: instrument.symbol,
    companyName: instrument.companyName ?? null,
  })
  /* An unusable selection is not recorded, and the existing list is not
     disturbed by it. */
  if (!row) return readRecentInstruments(userId, orgId)

  const rest = readRecentInstruments(userId, orgId).filter(r => r.id !== row.id)
  const next = [row, ...rest].slice(0, RECENTS_LIMIT)
  safeWrite(recentInstrumentsKey(userId, orgId), JSON.stringify(next))
  return next
}

/**
 * Drop every stored list, for every principal.
 *
 * Wired into `clearProviderCaches` beside `clearChartingWorkspaces`. It
 * sweeps by PREFIX rather than clearing the key for the principal signing
 * out, because at the moment of a principal change the identity being left
 * is not reliably still in hand -- and a sweep cannot miss the one that
 * mattered.
 */
export function clearRecentInstruments(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith(PREFIX)) doomed.push(key)
    }
    for (const key of doomed) window.localStorage.removeItem(key)
  } catch {
    /* Same reasoning as safeRead: a browser that will not hand over storage
       has nothing stored to leak. */
  }
}
