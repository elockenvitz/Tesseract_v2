/**
 * Learns what a user actually cares about from how they use the feed.
 *
 * Stored client-side, per user, in localStorage. That is a deliberate first
 * step rather than a limitation:
 *   - it works today without a schema change to a production database
 *   - it costs no round-trip on open, so ranking is never blocked on network
 *   - losing it degrades ranking to the neutral baseline, nothing worse
 * A server-side table is the right eventual home — it survives device changes
 * and can be analysed — but the shape below is what that table should record,
 * so migrating later is a port rather than a redesign.
 *
 * The model is intentionally a transparent weighted tally, not a learned one.
 * On a research surface the user must be able to be told *why* something
 * ranked highly, and "the model decided" is not an acceptable answer when a
 * missed item has money attached.
 */

const KEY_PREFIX = 'tesseract:feed-interest:'
const MAX_TRACKED_KEYS = 400
/** Interest decays so last quarter's focus does not outrank this week's. */
const HALF_LIFE_DAYS = 21
/** Below this, a card was scrolled past rather than read. */
const MIN_MEANINGFUL_DWELL_MS = 1200
/** Above this, the phone was probably in a pocket. Cap rather than discard. */
const MAX_CREDITED_DWELL_MS = 45_000

/** Weight per interaction, in "seconds of attention" equivalents. */
const SIGNAL_WEIGHTS = {
  /** Explicit and costly — the strongest statement of interest. */
  readthrough: 30,
  reaction: 20,
  share: 20,
  open: 12,
  /** Implicit; dwell adds its own duration-scaled weight on top. */
  dwell: 1,
} as const

export type InterestSignal = keyof typeof SIGNAL_WEIGHTS

export interface InterestVector {
  /** assetId -> accumulated weight */
  assets: Record<string, number>
  /** authorId -> accumulated weight */
  authors: Record<string, number>
  /**
   * Feed kind -> accumulated weight.
   *
   * Assets and authors answer "what is this about"; kinds answer "is this
   * *sort* of thing worth my time". They are different questions and only the
   * second can tell you a whole tile type is being scrolled past — someone can
   * care intensely about NVDA and never once stop on a crowding tile.
   *
   * Kept separate from the other two rather than folded in, because the
   * remedy differs: a cold asset should rank lower, a cold *kind* should
   * appear less often or be cut.
   */
  kinds: Record<string, number>
  /** Last decay application, ISO. */
  decayedAt: string
}

/**
 * A factory, not a shared constant. Returning one module-level object by
 * reference meant every user without stored data received the *same* object,
 * and recordInterest mutates what it is given — so one user's interest leaked
 * into another's on the same device. Also seeded to "now": an epoch timestamp
 * made the first decay pass treat the data as ~55 years old and erase it.
 */
function emptyVector(): InterestVector {
  return { assets: {}, authors: {}, kinds: {}, decayedAt: new Date().toISOString() }
}

function key(userId: string) {
  return `${KEY_PREFIX}${userId}`
}

export function loadInterest(userId: string): InterestVector {
  if (typeof localStorage === 'undefined' || !userId) return emptyVector()
  try {
    const raw = localStorage.getItem(key(userId))
    if (!raw) return emptyVector()
    const parsed = JSON.parse(raw) as InterestVector
    return decay(parsed)
  } catch {
    return emptyVector()
  }
}

/**
 * Exponential decay applied on read. Doing it here rather than on a timer
 * means the vector is correct whenever it is used, with no background work.
 */
function decay(vector: InterestVector): InterestVector {
  const last = new Date(vector.decayedAt || 0).getTime()
  const days = (Date.now() - last) / 86_400_000
  if (!Number.isFinite(days) || days < 1) return vector

  const factor = Math.pow(0.5, days / HALF_LIFE_DAYS)
  const scale = (rec: Record<string, number>) => {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(rec)) {
      const next = v * factor
      // Drop what has decayed into irrelevance so the map stays small.
      if (next > 0.5) out[k] = next
    }
    return out
  }

  return {
    assets: scale(vector.assets),
    authors: scale(vector.authors),
    kinds: scale(vector.kinds ?? {}),
    decayedAt: new Date().toISOString(),
  }
}

export interface RecordInterestInput {
  userId: string
  signal: InterestSignal
  assetId?: string | null
  authorId?: string | null
  /** Required for `dwell`; ignored otherwise. */
  dwellMs?: number
  /** The tile kind this signal came from — 'news', 'lens', 'attention'. */
  kind?: string | null
}

export function recordInterest({ userId, signal, assetId, authorId, dwellMs, kind }: RecordInterestInput): void {
  if (typeof localStorage === 'undefined' || !userId) return
  // A kind alone is enough to record. Tiles that are about no particular asset
  // — a macro release, an unattributed story — used to contribute nothing at
  // all, which meant the kinds most likely to be filler were also the ones the
  // feed could never learn to stop showing.
  if (!assetId && !authorId && !kind) return

  let weight = SIGNAL_WEIGHTS[signal]
  if (signal === 'dwell') {
    const ms = dwellMs ?? 0
    // A glance is not interest; a pocket is not either.
    if (ms < MIN_MEANINGFUL_DWELL_MS) return
    weight = Math.min(ms, MAX_CREDITED_DWELL_MS) / 1000
  }

  try {
    const vector = loadInterest(userId)
    if (assetId) vector.assets[assetId] = (vector.assets[assetId] ?? 0) + weight
    if (authorId) vector.authors[authorId] = (vector.authors[authorId] ?? 0) + weight
    if (kind) {
      vector.kinds ??= {}
      vector.kinds[kind] = (vector.kinds[kind] ?? 0) + weight
    }

    trim(vector.assets)
    trim(vector.authors)
    // Values are current as of now — loadInterest already decayed them — so
    // stamp now unconditionally. Preserving the old timestamp made every
    // subsequent read decay from the original date and erase the vector.
    vector.decayedAt = new Date().toISOString()

    localStorage.setItem(key(userId), JSON.stringify(vector))
  } catch {
    /* storage unavailable — ranking falls back to the neutral baseline */
  }
}

function trim(rec: Record<string, number>) {
  const entries = Object.entries(rec)
  if (entries.length <= MAX_TRACKED_KEYS) return
  const keep = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_TRACKED_KEYS)
  for (const k of Object.keys(rec)) delete rec[k]
  for (const [k, v] of keep) rec[k] = v
}

/**
 * Interest score for one item, normalised to roughly 0..1 against the user's
 * own strongest interest. Relative rather than absolute so a light user and a
 * heavy user get comparably-shaped boosts.
 */
export function interestScore(
  vector: InterestVector,
  { assetId, authorId, kind }: { assetId?: string | null; authorId?: string | null; kind?: string | null }
): number {
  const maxAsset = Math.max(1, ...Object.values(vector.assets))
  const maxAuthor = Math.max(1, ...Object.values(vector.authors))

  const asset = assetId ? (vector.assets[assetId] ?? 0) / maxAsset : 0
  const author = authorId ? (vector.authors[authorId] ?? 0) / maxAuthor : 0

  // Asset interest dominates: on a research feed, *what* it is about matters
  // more than who wrote it. Kind is a smaller, separate term — it should nudge
  // ordering, not let one ignored tile type disappear a name the user follows
  // closely.
  const base = asset * 0.7 + author * 0.3

  // Centred on neutral, not added to it. Returning 0.5 for an unknown kind and
  // adding it gave every item a constant floor, so a score could never be zero
  // and "no interest at all" stopped being expressible. As a signed delta, a
  // kind with no history contributes nothing, a cold one pushes down and a hot
  // one pushes up.
  const affinity = kindAffinity(vector, kind)
  return affinity == null ? base : base + (affinity - 0.5) * 0.25
}

/**
 * How much this user engages with a kind, relative to the kind they engage
 * with most: 0 is ignored, 1 is their favourite, 0.5 is neutral.
 *
 * Returns null — not 0.5 — when there is nothing to say: no kind given, no
 * history at all, or this kind never seen. Callers must distinguish "no
 * information" from "average", because a newly added tile type has no history
 * and must not be buried before anyone has had the chance to skip it.
 */
export function kindAffinity(vector: InterestVector, kind?: string | null): number | null {
  if (!kind) return null
  const kinds = vector.kinds ?? {}
  const values = Object.values(kinds)
  if (!values.length) return null
  const seen = kinds[kind]
  if (seen == null) return null
  return seen / Math.max(1, ...values)
}

/**
 * Kinds this user reliably scrolls past.
 *
 * Only meaningful once there is enough history to compare against — below
 * that, a kind that simply has not come up yet is indistinguishable from one
 * being ignored, and acting on the difference would suppress tiles nobody has
 * had the chance to skip.
 */
export function coldKinds(vector: InterestVector, opts?: { threshold?: number }): string[] {
  const kinds = vector.kinds ?? {}
  const entries = Object.entries(kinds)
  if (entries.length < 3) return []
  const max = Math.max(...entries.map(([, v]) => v))
  if (max <= 0) return []
  const threshold = opts?.threshold ?? 0.12
  return entries.filter(([, v]) => v / max < threshold).map(([k]) => k)
}

/** Human-readable reason, for showing why an item ranked where it did. */
export function interestReason(
  vector: InterestVector,
  { assetId, authorId }: { assetId?: string | null; authorId?: string | null }
): string | null {
  const asset = assetId ? vector.assets[assetId] ?? 0 : 0
  const author = authorId ? vector.authors[authorId] ?? 0 : 0
  if (asset <= 0 && author <= 0) return null
  if (asset >= author) return 'You spend time on this name'
  return "You follow this author's posts"
}
