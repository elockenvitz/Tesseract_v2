/**
 * What state an asset's investment case is in, and why it deserves a screen.
 *
 * ── The object is the CASE, never the evidence ────────────────────────────
 *
 * Contributions are stored one row per (user, asset, section), so no single
 * row is "the case" — the case is the aggregate, which is exactly how
 * `MobileCaseView` already renders it. A note is not the object either: at the
 * time of writing every note in production is `source_type = 'platform'`, so
 * there is no document library to be a feed of. Evidence may EXPLAIN why a case
 * surfaced. It is never the thing being surfaced.
 *
 * ── The defect this module exists to close ────────────────────────────────
 *
 * The mobile research signal used to compute one `lastTouch` per asset as the
 * maximum of every note's `created_at`, every quick thought's `created_at`, and
 * every contribution's `updated_at` REGARDLESS OF SECTION. That conflates two
 * different events:
 *
 *   REVIEW    — somebody read the case and wrote the conclusion down.
 *   EVIDENCE  — something new arrived that the case has not answered yet.
 *
 * Under the old rule a note arriving RESET the review clock, which is backwards:
 * the arrival of unanswered evidence made the case look freshly reviewed. It
 * also meant "new evidence since review" was not merely unimplemented, it was
 * inexpressible — the two timestamps were the same number.
 *
 * So the review anchor here is the newest `updated_at` across NON-EMPTY CORE
 * sections only. `business_model` does not advance it, a note does not advance
 * it, and a quick thought does not advance it.
 *
 * ── Why `updated_at` is trusted here and nowhere else ─────────────────────
 *
 * `asset_contributions.updated_at` carries no bulk-update cluster in production:
 * the only repeated value is one editor save writing three core sections at
 * once, which is a real save. `asset_notes.updated_at`, by contrast, has 18 of
 * 22 live rows sharing a single backfill timestamp from the `organization_id`
 * migration. So a contribution's `updated_at` is a review; a note's is a data
 * migration, and evidence arrival must be read from `created_at` alone. See
 * `useDerivedInsights` for the queries that enforce this.
 *
 * ── Pure ──────────────────────────────────────────────────────────────────
 *
 * No React, no Supabase, no clock of its own beyond the `now` passed in. Same
 * reason as `stale-signal` and `feed-priority`: the card gallery is a
 * standalone Vite entry with no Supabase env, where importing `supabase.ts`
 * throws at module load and takes every layout assertion down with it.
 */

import { DAY_MS, MOVE_PCT, RESEARCH_STALE_DAYS } from '../signals/thresholds'

/**
 * The three sections that constitute a case, in the order a reader meets them.
 *
 * ── Why the list lives HERE and not in `asset-research` ───────────────────
 *
 * It was declared there first, as `LEGACY_RESEARCH_SECTIONS`, and importing it
 * from there is what broke the gallery: `asset-research` imports `supabase`,
 * and the gallery is a standalone Vite entry with no Supabase env where that
 * module throws at module load. One import of a three-string array took every
 * card fixture down with "Missing Supabase environment variables".
 *
 * So the direction is reversed: the PURE module owns the vocabulary and the
 * org-scoped read path consumes it. There is still exactly one list — see
 * `asset-research.ts`, which now re-exports this one under its old name so no
 * caller had to change.
 */
export const CORE_SECTIONS = ['thesis', 'where_different', 'risks_to_thesis'] as const
export type CoreSection = (typeof CORE_SECTIONS)[number]

/** What each core section is called on a phone. Short enough for a chip row. */
export const CORE_SECTION_LABEL: Record<CoreSection, string> = {
  thesis: 'Thesis',
  where_different: 'Where different',
  risks_to_thesis: 'Risks',
}

/**
 * The minimum a contribution row has to expose to be classified.
 *
 * `hasContent` rather than `content`, because the candidate scan deliberately
 * does not transfer prose: it asks PostgREST for non-null, non-empty rows and
 * selects only the section and the timestamp. A row that comes back IS a
 * written section, so the hook sets this true and never ships a thesis over the
 * wire to decide whether a thesis exists. `coreRowsFrom` converts for any
 * caller that does hold the prose.
 */
export interface CoreContributionRow {
  section: string
  hasContent: boolean
  updated_at: string | null
}

/** True when a contribution actually says something. A blank row is not a case. */
export function hasProse(content: string | null | undefined): boolean {
  return (content ?? '').trim().length > 0
}

/** Adapt rows that carry prose — the desktop read path, and tests. */
export function coreRowsFrom(
  rows: readonly { section: string; content: string | null; updated_at: string | null }[],
): CoreContributionRow[] {
  return rows.map(r => ({ section: r.section, hasContent: hasProse(r.content), updated_at: r.updated_at }))
}

export interface CaseCoverage {
  /** Core sections with non-empty prose, in canonical order. */
  present: CoreSection[]
  /** Core sections with nothing written, in canonical order. */
  missing: CoreSection[]
  /**
   * Newest `updated_at` across the present sections, or null when none exist.
   *
   * Null is the honest answer for an asset with no case: there is no review to
   * measure from, which is why no framing that depends on an anchor can fire.
   */
  reviewAnchor: string | null
}

/**
 * Collapse many contributions into the case's structure and its review anchor.
 *
 * Many rows may share a section — one per author — and the anchor is the newest
 * across all of them. That is deliberate and worth naming: a colleague's edit
 * advances the review clock for everyone, because the CASE was reviewed even
 * though the reader was not the one who reviewed it. Production has exactly one
 * multi-author case today (TSLA, two authors), so this is a real path.
 */
export function caseCoverageFrom(rows: readonly CoreContributionRow[]): CaseCoverage {
  const newest = new Map<CoreSection, string>()

  for (const row of rows) {
    if (!CORE_SECTIONS.includes(row.section as CoreSection)) continue
    if (!row.hasContent) continue
    const section = row.section as CoreSection
    const stamp = row.updated_at ?? ''
    if (!stamp) continue
    const prev = newest.get(section)
    if (prev == null || stamp > prev) newest.set(section, stamp)
  }

  const present = CORE_SECTIONS.filter(s => newest.has(s))
  const missing = CORE_SECTIONS.filter(s => !newest.has(s))
  const stamps = [...newest.values()].sort()

  return {
    present: [...present],
    missing: [...missing],
    reviewAnchor: stamps.length ? stamps[stamps.length - 1] : null,
  }
}

/**
 * The review anchor, allowing for a review that produced no prose.
 *
 * ── Why a judgment counts, and why it can only move it forward ────────────
 *
 * A structured judgment IS a review. Somebody who tapped "Case holds" on
 * Tuesday revisited the investment, and raising the same card at them on
 * Wednesday because they wrote no PROSE would punish using the feed exactly as
 * designed — recording thinking without writing is the whole point of the
 * judgment layer.
 *
 * It can only ever move the anchor FORWARD, and only for a case that already
 * has one. Both halves matter:
 *
 *   A judgment older than the last section save must not drag the anchor
 *   backwards and make a freshly written case look stale.
 *
 *   A judgment on a case that has never been written must not CREATE an
 *   anchor. Tapping "Legacy position" on a name with nothing recorded does not
 *   write a thesis, and letting it silence the card that says so would be the
 *   product accepting an answer to a question it never asked.
 */
export function anchorWithJudgment(
  coverage: CaseCoverage,
  judgedAtMs: number | null | undefined,
): CaseCoverage {
  if (!coverage.reviewAnchor || judgedAtMs == null || !Number.isFinite(judgedAtMs)) return coverage
  if (judgedAtMs <= new Date(coverage.reviewAnchor).getTime()) return coverage
  return { ...coverage, reviewAnchor: new Date(judgedAtMs).toISOString() }
}

/**
 * The five ways a case can deserve attention.
 *
 * One family, five framings — not five card types. The audit's argument stands:
 * `new_evidence` and `price_move` share an object, an anchor, an action and a
 * pane grammar, and splitting them would put two cards on AMZN and PLTR about
 * one condition. `incomplete_case` and `no_case` share everything with each
 * other except a single sentence of copy.
 */
export type ResearchFraming =
  /** Anchored, and something arrived after the anchor that the case has not answered. */
  | 'new_evidence'
  /** Anchored, no new evidence, and the price has moved materially since. */
  | 'price_move'
  /** Some core sections written, some not. */
  | 'incomplete_case'
  /** No core section written at all. */
  | 'no_case'
  /** Anchored, complete, nothing happened — it has simply been a long time. */
  | 'long_silence'

/** One evidence arrival, carrying only what the candidate scan may cheaply read. */
export interface EvidenceArrival {
  id: string
  /** ISO. `created_at`, never `updated_at` — see the header. */
  at: string
  /** Who filed it. Resolved to a name after classification, not during it. */
  authorId?: string | null
  /** Display name of whoever filed it, where it could be resolved. */
  authorName?: string | null
  /** Notes carry one; quick thoughts do not. */
  title?: string | null
  kind: 'note' | 'thought'
  /**
   * A bounded preview, filled in AFTER the candidate cut.
   *
   * Absent during the scan on purpose: production holds a 2 MB note body, and
   * a scan that selected `content` would pull it for every candidate.
   */
  preview?: string | null
}

export interface ResearchIssue {
  framing: ResearchFraming
  /** Days since the review anchor. Null when there is no anchor to count from. */
  daysSinceReview: number | null
  /** Signed. Present only on `price_move`, and only from a defensible baseline. */
  movePct?: number
  /** Arrivals strictly after the anchor. Present on `new_evidence` only. */
  evidence?: EvidenceArrival[]
  present: CoreSection[]
  missing: CoreSection[]
}

export interface ResearchIssueInput {
  coverage: CaseCoverage
  /** Every evidence arrival known for the asset, in any order. */
  evidence: readonly EvidenceArrival[]
  /**
   * Signed move since the review anchor, or null when it cannot be stated.
   *
   * Null must never be substituted with zero. A card claiming "moved 0%" off a
   * missing baseline is worse than no card, and COIN and TGT — both anchored,
   * both with no cached closes at all — are the real names that would produce
   * one. See `since-review.ts`, which returns null rather than guessing.
   */
  movePct: number | null
  now: number
}

/**
 * Which single issue best explains why this case wants attention now.
 *
 * ── Precedence, not scoring ───────────────────────────────────────────────
 *
 * One case yields at most ONE card. That is not a tuning preference: NKE has a
 * thin case AND a 30.5% move since its anchor, and emitting both would put two
 * tiles about one name in the feed — the exact duplication `feed-dedupe`
 * already exists to prevent for stronger cards. The order below asks "what
 * would make an investor open this now", strongest first:
 *
 *   1. `new_evidence`     something arrived and the case has not answered it
 *   2. `price_move`       the market moved and the case has not answered it
 *   3. `no_case` /        the case is structurally absent or half-written
 *      `incomplete_case`
 *   4. `long_silence`     nothing happened; it has just been a long time
 *
 * The first two are events. The third is a structural gap that will still be
 * true tomorrow. The fourth is the weakest claim in the family and says so.
 *
 * ── Why the absence cases cannot outrank the event cases ──────────────────
 *
 * They cannot even reach them. `new_evidence` and `price_move` both require an
 * anchor, and an anchor requires at least one written core section — so a
 * `no_case` asset is structurally incapable of producing either. An
 * `incomplete_case` asset can, and should: NKE's move is the more useful thing
 * to say about NKE today than the fact that two sections are blank.
 *
 * Returns null when there is nothing worth raising, which is the correct and
 * common answer for a case reviewed last week.
 */
export function researchIssueFor(input: ResearchIssueInput): ResearchIssue | null {
  const { coverage, evidence, movePct, now } = input
  const { present, missing, reviewAnchor } = coverage

  const anchorMs = reviewAnchor ? new Date(reviewAnchor).getTime() : NaN
  const anchored = Number.isFinite(anchorMs)
  const daysSinceReview = anchored ? Math.floor((now - anchorMs) / DAY_MS) : null

  const shape = { present: [...present], missing: [...missing], daysSinceReview }

  if (anchored) {
    // 1. Evidence the case has not answered. Strictly after the anchor: an
    //    arrival at the same instant is the note somebody filed while writing.
    const since = evidence
      .filter(e => {
        const t = new Date(e.at).getTime()
        return Number.isFinite(t) && t > anchorMs
      })
      .sort((a, b) => a.at.localeCompare(b.at))

    if (since.length > 0) {
      return { ...shape, framing: 'new_evidence', evidence: since }
    }

    // 2. The market moved and the written view did not follow. Sign is carried
    //    and never graded — a fall and a rally are the same finding here.
    if (movePct != null && Number.isFinite(movePct) && Math.abs(movePct) >= MOVE_PCT) {
      return { ...shape, framing: 'price_move', movePct }
    }
  }

  // 3. Structural absence. Reachable with or without an anchor.
  if (missing.length === CORE_SECTIONS.length) return { ...shape, framing: 'no_case' }
  if (missing.length > 0) return { ...shape, framing: 'incomplete_case' }

  // 4. Complete, anchored, and nothing has happened to it for a long time.
  //
  //    The threshold is absolute, and deliberately so. Ninety days is a claim
  //    about investment work, not a percentile of whatever this org happens to
  //    have written — and if every case in the book is currently stale, that is
  //    a true statement about the book rather than a reason to rescale until
  //    some of them look fine.
  if (daysSinceReview != null && daysSinceReview >= RESEARCH_STALE_DAYS) {
    return { ...shape, framing: 'long_silence' }
  }

  return null
}

/**
 * The strength of each framing WITHIN its tier.
 *
 * Not a tier and not a severity — `feed-priority` owns both, and Research never
 * crosses a tier boundary on account of its framing. This only orders the
 * family against itself, so a name with unanswered evidence leads a name that
 * has merely been quiet.
 *
 * `price_move` is 0.70, which is exactly the `research_stale` base the ranking
 * table already carried, so the framing that behaved this way before behaves
 * identically now. `no_case` is 0.55 for the same reason. Only the three new
 * framings introduce new numbers.
 */
export const RESEARCH_FRAMING_BASE: Record<ResearchFraming, number> = {
  new_evidence: 0.78,
  price_move: 0.70,
  no_case: 0.55,
  /** Half a case is less of a gap than no case, and ranks just under it. */
  incomplete_case: 0.50,
  long_silence: 0.45,
}

/**
 * How far a `price_move` base may climb on the size of the move.
 *
 * Bounded so `price_move` can never reach `new_evidence`: 0.70 + 0.06 = 0.76,
 * and evidence sits at 0.78. That gap is the whole reason the magnitude lives
 * in the base rather than in `deviationPct` — see `researchBaseFor`.
 */
const MOVE_MAGNITUDE_LIFT = 0.06

/** Where a move stops being large and starts being a different conversation. */
const SEVERE_MOVE_PCT = 30

/**
 * The card's own strength, passed to `feed-priority` as `base`.
 *
 * ── Why the move's magnitude is NOT passed as `deviationPct` ──────────────
 *
 * The obvious wiring is to hand `feed-priority` the move as a deviation, and it
 * is wrong here. `deviationBand` is weighted 0.18, while the entire spread
 * between the framing bases is 0.33 × 0.40 = 0.13 — so a 25% move on a
 * `price_move` card outscored an unanswered piece of evidence by a wide margin,
 * exactly inverting the order the family is specified to have. Caught by a test
 * against the real AMZN and AAPL shapes rather than by reading the weights.
 *
 * The deeper reason it is wrong: for a scenario gap the deviation is a SEPARATE
 * fact from the card's identity — the card exists because a case was breached,
 * and how far through is additional information. For Research the move IS the
 * identity: it is the only reason the framing is `price_move` at all. Passing
 * it again counts it twice.
 *
 * So the magnitude stays, because a 60% move genuinely does deserve to lead a
 * 16% one, and it stays INSIDE the framing's own band where it can order
 * `price_move` against itself and never against anything else.
 *
 * ── What can still outrank what ───────────────────────────────────────────
 *
 * Position size, deliberately. A 22% case nobody has revisited in six months
 * may lead a 0.2% name with a new note, because `materialityBand` is importance
 * and importance is allowed to cross framings within a tier. What size may
 * never do is cross a TIER, or change a severity — see `buildInsightCard`.
 */
export function researchBaseFor(issue: ResearchIssue): number {
  const base = RESEARCH_FRAMING_BASE[issue.framing]
  if (issue.framing !== 'price_move' || issue.movePct == null) return base

  const magnitude = Math.abs(issue.movePct)
  // Linear from the threshold that made this a card at all up to "severe",
  // then flat: past about a third, a bigger number does not change what the
  // reader does about it.
  const span = Math.min(Math.max((magnitude - MOVE_PCT) / (SEVERE_MOVE_PCT - MOVE_PCT), 0), 1)
  return base + span * MOVE_MAGNITUDE_LIFT
}

/**
 * The card type a framing becomes.
 *
 * Two types, five framings. `incomplete_case` deliberately does NOT get a type
 * of its own: the reader's task ("go write the missing part"), the action
 * (`add_rationale`, focused on thesis) and the panes are identical to
 * `no_case`, and a third type for a five-asset population would be the
 * variant-flag component the signal contract exists to prevent.
 */
export function researchSignalTypeFor(framing: ResearchFraming): 'no_research' | 'research_stale' {
  return framing === 'no_case' || framing === 'incomplete_case' ? 'no_research' : 'research_stale'
}

/** Whether this framing's card should offer a price pane at all. */
export function framingWantsPrice(framing: ResearchFraming): boolean {
  // A structural absence is not a thing the tape can illustrate. Drawing a
  // chart next to "nobody has written this up" would imply the price is the
  // finding, and the reader would go looking for an event that is not there.
  return framing !== 'no_case' && framing !== 'incomplete_case'
}

/**
 * How the card describes itself.
 *
 * ── "Last written", never "last looked" ───────────────────────────────────
 *
 * The durable anchor is a section save. Nothing in the product records that
 * somebody READ a case and concluded it still held — the one event that could
 * (`audit_events.record_judgment`) has a single row in all of production. So
 * the copy says what we actually have: the case was last WRITTEN 192 days ago.
 * Internal names may say `reviewAnchor`; the reader is told the truth.
 *
 * ── Why each framing gets its own sentence ────────────────────────────────
 *
 * One sentence with the numbers swapped in would claim an event on the
 * `long_silence` path, where nothing happened. That was already the argument
 * for splitting the old copy in two, and it holds five ways.
 */
export function researchCopy(input: {
  symbol: string
  issue: ResearchIssue
  portfolioName?: string | null
  weightPct?: number | null
  held?: boolean
}): { headline: string; body: string; prompt: string } {
  const { symbol, issue, portfolioName, weightPct, held } = input
  const days = issue.daysSinceReview

  /** "written 192 days ago", or nothing when there is no anchor to date. */
  const written = days == null
    ? ''
    : days >= 365
      ? `the case was last written ${(days / 365).toFixed(1)} years ago`
      : `the case was last written ${days} day${days === 1 ? '' : 's'} ago`

  /** Where it sits, said only when we actually know. Never "0.0%". */
  const exposure = weightPct != null && Number.isFinite(weightPct) && portfolioName
    ? `${weightPct.toFixed(1)}% of ${portfolioName}`
    : held && portfolioName
      ? `held in ${portfolioName}`
      : held
        ? 'held'
        : null

  const missingNames = issue.missing.map(s => CORE_SECTION_LABEL[s].toLowerCase())

  switch (issue.framing) {
    case 'new_evidence': {
      const n = issue.evidence?.length ?? 0
      return {
        headline: `New evidence since ${symbol}'s case was last written`,
        body: `${n} item${n === 1 ? '' : 's'} arrived after the case was written${
          days != null ? `, which was ${days} day${days === 1 ? '' : 's'} ago` : ''
        }. Nothing records whether ${n === 1 ? 'it supports or challenges' : 'they support or challenge'} the thesis — that is the review.`,
        prompt: 'Does this change the case?',
      }
    }

    case 'price_move': {
      const move = Math.abs(issue.movePct!).toFixed(1)
      const dir = issue.movePct! >= 0 ? 'up' : 'down'
      return {
        // Names the CHANGE. The sign is carried in words and in the number;
        // nothing in the presentation grades the direction as good or bad.
        headline: `${symbol} has moved ${issue.movePct! >= 0 ? '+' : '−'}${move}% since its case was last written`,
        body: `The price is ${dir} ${move}% since ${written || 'the case was written'}${
          exposure ? `, and it is ${exposure}` : ''
        }. The written case has not accounted for the move.`,
        prompt: 'Does this change need a look?',
      }
    }

    case 'no_case':
      return {
        headline: `${symbol} has no written case`,
        body: `None of thesis, where different or risks has been written${
          exposure ? `, and it is ${exposure}` : ''
        }. It is part of the research universe with nothing recorded against it.`,
        prompt: 'What best describes this position?',
      }

    case 'incomplete_case':
      return {
        headline: `${symbol}'s case is incomplete`,
        body: `${issue.present.map(s => CORE_SECTION_LABEL[s]).join(' and ')} ${
          issue.present.length === 1 ? 'is' : 'are'
        } written; ${missingNames.join(' and ')} ${missingNames.length === 1 ? 'is' : 'are'} not${
          exposure ? `. It is ${exposure}` : ''
        }.`,
        prompt: 'What best describes this position?',
      }

    default:
      return {
        // "Written", not "revisited" or "looked at". The one event we record is
        // a section save, and a headline implying anything else would be
        // claiming a read that nothing in the product can evidence.
        headline: `${symbol}'s case was last written ${
          days != null && days >= 365 ? `${(days / 365).toFixed(1)} years ago` : `${days} days ago`
        }`,
        // Says plainly that nothing happened, so the card is not read as an event.
        body: `The case is complete and nothing has been written against it since${
          exposure ? `. It is ${exposure}` : ''
        }. Nothing has happened to it either — it is simply a long time since anybody revised it.`,
        prompt: 'Does the case still hold?',
      }
  }
}

/**
 * The facts that produced the card, in the order they were evaluated.
 *
 * Shown under "why this surfaced". A reader meeting a card they did not expect
 * needs the ingredients, not a characterisation of them.
 */
export function researchReason(issue: ResearchIssue, symbol: string): string {
  const parts: string[] = []

  switch (issue.framing) {
    case 'new_evidence':
      parts.push(`${issue.evidence?.length ?? 0} evidence item(s) filed after the case was last written`)
      break
    case 'price_move':
      parts.push(`${Math.abs(issue.movePct!).toFixed(1)}% price move since the case was last written`)
      break
    case 'no_case':
      parts.push('no core section written')
      break
    case 'incomplete_case':
      parts.push(`${issue.present.length} of ${CORE_SECTIONS.length} core sections written`)
      break
    default:
      parts.push('complete case, nothing recorded against it')
  }

  if (issue.daysSinceReview != null) {
    parts.push(`case last written ${issue.daysSinceReview} days ago`)
  } else {
    parts.push(`${symbol} is in the research universe with no case to date from`)
  }

  return parts.join(' · ')
}
