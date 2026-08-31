/**
 * Desktop Research — the canonical evidence object.
 *
 * ── The object is the asset's investment case, not a document ─────────────
 *
 * The durable model settles this rather than taste. Production holds:
 *
 *   asset_contributions  32 rows / 10 assets — the THESIS, one row per
 *                        (asset, section): thesis, business_model,
 *                        where_different, risks_to_thesis, key_catalysts
 *   asset_notes          22 rows / 13 assets — evidence, keyed on asset_id
 *
 * Neither table describes a document with an independent life. A note has no
 * standing apart from the asset it is attached to; a contribution is a section
 * of one asset's case. There is no source/citation entity to centre a library
 * on, and the review anchor that `thesisStale` already uses is a contribution's
 * `updated_at`.
 *
 * So the subject is the asset's case: the thesis, what has arrived since it was
 * last written, and whether the two still agree. A document-centred surface
 * would have to invent the object it lists.
 *
 * ── Three timestamps that must not be confused ────────────────────────────
 *
 *   thesisUpdatedAt   when the case was last written — the REVIEW ANCHOR
 *   newestEvidenceAt  when evidence last arrived
 *   priceWindow       what the price did between the two
 *
 * "Evidence arrived after the case was last written" is the whole product.
 */

import type { EngagementTarget } from '../engagement'

/** The thesis sections that constitute a reviewable case. */
export const CORE_SECTIONS = ['thesis', 'where_different', 'risks_to_thesis'] as const
export const ALL_SECTIONS = [
  'thesis', 'business_model', 'where_different', 'risks_to_thesis', 'key_catalysts',
] as const

export const SECTION_LABEL: Record<string, string> = {
  thesis: 'Thesis',
  business_model: 'Business model',
  where_different: 'Where we differ',
  risks_to_thesis: 'Risks to thesis',
  key_catalysts: 'Key catalysts',
}

export interface ThesisSection {
  section: string
  content: string | null
  supportingDetail: string | null
  updatedAt: string
  authorName: string | null
}

export interface EvidenceItem {
  id: string
  title: string | null
  content: string | null
  createdAt: string
  authorName: string | null
  isShared: boolean
  /**
   * Whether this arrived AFTER the case was last written.
   *
   * Derived from two real timestamps and nothing else. It is not a claim that
   * the evidence supports or challenges the thesis — no such classification is
   * stored, and inventing one would be the fabrication the brief forbids.
   */
  isNewSinceReview: boolean
}

/** The scan row — deliberately light. */
export interface ResearchSubject {
  assetId: string
  symbol: string | null
  companyName: string | null
  /** Newest updated_at across the CORE sections. Null when no case is written. */
  thesisUpdatedAt: string | null
  daysSinceReview: number | null
  sectionCount: number
  /**
   * Sections among CORE only.
   *
   * Held separately so the copy can distinguish "nothing written" from
   * "supporting sections written, core case not" -- the NVDA shape, where a
   * business_model paragraph exists and calling it "no research" would be
   * false.
   */
  coreSectionCount: number
  evidenceCount: number
  newestEvidenceAt: string | null
  /** Evidence created after `thesisUpdatedAt`. */
  newSinceReview: number
  weightPct?: number
}

/**
 * Why this subject needs attention.
 *
 * Ordered by what an investor would act on first: a case contradicted by new
 * work, then a case nobody has revisited, then a name with evidence but no
 * case at all. Age alone is the weakest reason and comes last.
 */
export type ResearchState =
  | 'evidence-since-review'   // new material arrived after the case was written
  | 'no-thesis'               // evidence exists, no case has been written
  | 'stale'                   // nothing new, but the case is old
  | 'thin'                    // a case with almost no evidence behind it
  | 'current'                 // reviewed recently, nothing outstanding

const STALE_DAYS = 90

export function stateOf(s: ResearchSubject): ResearchState {
  if (!s.thesisUpdatedAt) return s.evidenceCount > 0 ? 'no-thesis' : 'thin'
  if (s.newSinceReview > 0) return 'evidence-since-review'
  if ((s.daysSinceReview ?? 0) >= STALE_DAYS) return 'stale'
  if (s.evidenceCount === 0) return 'thin'
  return 'current'
}

export const STATE_LABEL: Record<ResearchState, string> = {
  'evidence-since-review': 'New evidence since review',
  // Not "no research": peripheral sections and evidence may well exist. What
  // is missing is the core investment case the review anchor is derived from.
  'no-thesis': 'Core thesis not written',
  stale: 'Not reviewed',
  thin: 'Thin evidence',
  current: 'Current',
}

/**
 * The one-line investment reason, never a bare age.
 *
 * Each branch is built from real counts and real dates. Where a price move is
 * known the caller passes it in; it is never assumed.
 */
export function whyItMatters(s: ResearchSubject, movePct?: number | null): string {
  const t = s.symbol ?? 'this name'
  switch (stateOf(s)) {
    case 'evidence-since-review':
      return `${s.newSinceReview} research item${s.newSinceReview === 1 ? '' : 's'} arrived after the case was last written`
        + (movePct != null ? `, and the stock moved ${fmtPct(movePct)} over that period.` : '.')
    case 'no-thesis': {
      // Name what IS on record first, so the sentence never reads as "we hold
      // nothing on this name".
      const held: string[] = []
      if (s.evidenceCount) held.push(`${s.evidenceCount} research item${s.evidenceCount === 1 ? '' : 's'}`)
      const peripheral = s.sectionCount - s.coreSectionCount
      if (peripheral > 0) held.push(`${peripheral} supporting section${peripheral === 1 ? '' : 's'}`)
      const have = held.length ? held.join(' and ') : 'material'
      return `${t} has ${have} on record, but the core thesis has not been written, so there is no view to review against.`
    }
    case 'stale':
      return `The case has not been revisited in ${s.daysSinceReview} days`
        + (movePct != null ? `, over which the stock moved ${fmtPct(movePct)}.` : '.')
    case 'thin':
      return `The case for ${t} rests on almost no recorded evidence.`
    case 'current':
      return `Reviewed ${s.daysSinceReview} days ago with nothing outstanding since.`
  }
}

const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

/**
 * Which visual explains this subject.
 *
 * `since-review` needs BOTH a real anchor and history that reaches it — the
 * window rule carried from mobile and Today. Everything else degrades to
 * counts or to typography, and nothing is drawn from a single number.
 */
export type ResearchFamily = 'since-review' | 'arrival' | 'coverage' | 'typographic'

export function familyFor(
  s: ResearchSubject,
  opts: { hasAnchoredHistory?: boolean } = {},
): ResearchFamily {
  if (opts.hasAnchoredHistory && s.thesisUpdatedAt) return 'since-review'
  if (s.newSinceReview > 0) return 'arrival'
  if (!s.thesisUpdatedAt && s.evidenceCount > 0) return 'coverage'
  return 'typographic'
}

/** The verb, specific to what the subject actually needs. */
export function primaryActionFor(s: ResearchSubject): string {
  switch (stateOf(s)) {
    case 'evidence-since-review': return 'Review new evidence'
    case 'no-thesis': return 'Write the case'
    case 'stale': return 'Review thesis'
    case 'thin': return 'Add evidence'
    case 'current': return 'Read the case'
  }
}

/* -------------------------------------------------------------------------- */

export function issueFor(s: ResearchSubject): string {
  return STATE_LABEL[stateOf(s)]
}

export function seedPromptFor(s: ResearchSubject): string {
  const t = s.symbol ?? 'this name'
  switch (stateOf(s)) {
    case 'evidence-since-review':
      return `${s.newSinceReview} research items arrived on ${t} after our case was last written. Summarise them against the existing view and say which most challenges it.`
    case 'no-thesis':
      return `We hold research on ${t} but no written case. From the evidence on record, what would a defensible thesis claim, and what would it hinge on?`
    case 'stale':
      return `Our case for ${t} has not been revisited in ${s.daysSinceReview} days. Which of its claims are most likely to be stale, and what would you check first?`
    case 'thin':
      return `The case for ${t} rests on very little recorded evidence. What would you want to see before relying on it?`
    case 'current':
      return `What would have to change for our current view on ${t} to be wrong?`
  }
}

export function targetFor(s: ResearchSubject): EngagementTarget | null {
  if (!s.assetId) return null
  const chips: { label: string; value: string }[] = []
  if (s.daysSinceReview != null) chips.push({ label: 'Last review', value: `${s.daysSinceReview}d` })
  if (s.sectionCount) chips.push({ label: 'Case sections', value: String(s.sectionCount) })
  if (s.evidenceCount) chips.push({ label: 'Research', value: `${s.evidenceCount} item${s.evidenceCount === 1 ? '' : 's'}` })
  if (s.newSinceReview) chips.push({ label: 'New since review', value: String(s.newSinceReview) })
  if (s.weightPct != null) chips.push({ label: 'Weight', value: `${s.weightPct.toFixed(1)}%` })

  return {
    // `asset` is in DISCUSSABLE_OBJECT_TYPES, so Team works without widening
    // any constraint.
    objectType: 'asset',
    objectId: s.assetId,
    label: s.companyName ? `${s.symbol} — ${s.companyName}` : (s.symbol ?? 'Asset'),
    symbol: s.symbol ?? undefined,
    assetId: s.assetId,
    origin: { itemId: s.assetId, surface: 'research' },
    issue: {
      title: issueFor(s),
      detail: whyItMatters(s),
      reason: `research:${stateOf(s)}`,
      detectedAt: s.newestEvidenceAt ?? s.thesisUpdatedAt ?? undefined,
    },
    seedPrompt: seedPromptFor(s),
    contextChips: chips,
  }
}

/* ----------------------------------------------------------------- ranking */

/**
 * Tier-first, matching the discipline used by Today and Ideas.
 *
 * 0 the case is contradicted by newer work
 * 1 evidence with no case at all
 * 2 nobody has revisited it
 * 3 thin or current
 */
export function tierOf(s: ResearchSubject): 0 | 1 | 2 | 3 {
  switch (stateOf(s)) {
    case 'evidence-since-review': return 0
    case 'no-thesis': return 1
    case 'stale': return 2
    default: return 3
  }
}

export function scoreOf(s: ResearchSubject): number {
  let score = s.newSinceReview * 0.15
  score += Math.min(1, (s.daysSinceReview ?? 0) / 365) * 0.3
  // Materiality: a stale case on a real position matters more than on a
  // watchlist name. Same banding shape used elsewhere.
  const w = s.weightPct ?? 0
  score += (w >= 10 ? 1 : w >= 5 ? 0.8 : w >= 3 ? 0.6 : w >= 1 ? 0.45 : 0.2) * 0.3
  return score
}

export function compareSubjects(a: ResearchSubject, b: ResearchSubject): number {
  const ta = tierOf(a), tb = tierOf(b)
  if (ta !== tb) return ta - tb
  const sa = scoreOf(a), sb = scoreOf(b)
  if (sb !== sa) return sb - sa
  return a.assetId.localeCompare(b.assetId)
}
