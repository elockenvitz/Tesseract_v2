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
 * What Tesseract means by an investment case, in three sets that are NOT one.
 *
 * ── The audit that produced these ─────────────────────────────────────────
 *
 * The Research family treated three sections as "the case" and said so on
 * every card. The product does not agree. `layout-resolver.ts` defines the
 * system-default template as EIGHT fields across three sections, and
 * `research_fields` in production carries exactly those eight, universal and
 * system, one row per organisation:
 *
 *   Thesis & Risks         business_model · thesis · where_different · risks_to_thesis
 *   Catalysts & Events     key_catalysts
 *   Forecasts & Estimates  rating · price_targets · estimates
 *
 * So "MSFT has no written case" was a claim about eight fields made from three,
 * and it was demonstrably false: NVDA has a written business model and no core
 * thesis, and its card said nothing was written at all.
 *
 * The three sets below are separated because they answer three questions, and
 * collapsing any two of them is what produced the false copy.
 */

/**
 * A. THE FULL CASE — what the template says a case contains.
 *
 * The system default. Organisations can and do reconfigure this through
 * `user_asset_page_layouts`, so it is a default rather than a law — which is
 * itself a reason not to build a denominator out of it. A card that says
 * "2 of 8" would be wrong for any desk that customised its template, and the
 * scan has no cheap way to know which template applies to which asset.
 */
export const CASE_SECTIONS = [
  'business_model', 'thesis', 'where_different', 'risks_to_thesis',
  'key_catalysts', 'rating', 'price_targets', 'estimates',
] as const

/**
 * B. THE CORE THESIS — decision-bearing prose. Is there an investment VIEW?
 *
 * These three are the ones that state a position: what we think, why the market
 * disagrees, and what would make us wrong. `business_model` sits beside them in
 * the same template section and is NOT one of them — it describes what the
 * company does, which is true whoever owns the stock and whatever they think of
 * it. `rating`, `price_targets` and `estimates` are numbers with their own
 * surfaces (`no_target`, `target_expired`) and are not prose about a view.
 *
 * This is the set every Research framing is actually about.
 */
export const CORE_THESIS_SECTIONS = ['thesis', 'where_different', 'risks_to_thesis'] as const

/**
 * C. THE REVIEW ANCHOR — which edits mean the view was substantively rewritten.
 *
 * Identical to the core thesis today, and separately named because the reason
 * is different and the sets could legitimately diverge. `caseWrittenAt` is
 * what the copy "last written" rests on, so this set has to be exactly the
 * edits that justify that sentence.
 *
 * `business_model` is the case that decides it. Writing one is real work and
 * belongs to the case, and it says nothing about whether anybody reconsidered
 * the INVESTMENT — so it must not restart a thesis-review clock. A desk that
 * documented a business model in June has not thereby revisited a thesis
 * written in January, and a card claiming otherwise would suppress itself on
 * the strength of unrelated work.
 */
export const REVIEW_ANCHOR_SECTIONS = CORE_THESIS_SECTIONS

/**
 * The rest of the default case. Real work, real content, not a view.
 *
 * Tracked so a card can say "a business model is written" instead of "nothing
 * is written", which is the specific falsehood this audit found on NVDA.
 */
export const SUPPORTING_CASE_SECTIONS = [
  'business_model', 'key_catalysts', 'rating', 'price_targets', 'estimates',
] as const

/**
 * @deprecated Use `CORE_THESIS_SECTIONS`. Kept because `asset-research` still
 * re-exports it as `LEGACY_RESEARCH_SECTIONS` for the org-scoped read path, and
 * renaming it there is churn with no reader benefit. The name is the problem
 * this audit fixed: "core sections" reads as "the core of the case" when it
 * means "the sections that state a view".
 */
export const CORE_SECTIONS = CORE_THESIS_SECTIONS
export type CoreSection = (typeof CORE_THESIS_SECTIONS)[number]
export type SupportingSection = (typeof SUPPORTING_CASE_SECTIONS)[number]

/**
 * What each core-thesis section is called, matching the product's own names.
 *
 * `research_fields` calls them Investment Thesis, Where We Differ and Risks to
 * Thesis, and `layout-resolver` overrides the second to "Where Our Thesis
 * Differs" on the asset page. The phone uses the shorter database names — the
 * same words, at a length a 390px row can hold — rather than inventing a third
 * vocabulary for the same three fields.
 */
export const CORE_SECTION_LABEL: Record<CoreSection, string> = {
  thesis: 'Investment thesis',
  where_different: 'Where we differ',
  risks_to_thesis: 'Risks to thesis',
}

/** The supporting fields, named as the template names them. */
export const SUPPORTING_SECTION_LABEL: Record<string, string> = {
  business_model: 'Business model',
  key_catalysts: 'Key catalysts',
  rating: 'Rating',
  price_targets: 'Price targets',
  estimates: 'Estimates',
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
   * ── Renamed from `reviewAnchor`, and the rename is the point ─────────────
   *
   * This timestamp proves ONE thing: the written case changed. It is the only
   * evidence the product has that somebody put words down, and it is what the
   * copy "case last written" is entitled to say.
   *
   * It used to be called `reviewAnchor` and a judgment was allowed to move it —
   * so after a reader tapped "Case holds", a card could say "case last written
   * 5 days ago" about a case last edited in November. The name invited the
   * conflation: an anchor is a computed thing and can absorb inputs, where a
   * WRITTEN AT is a fact about a row and cannot. Nothing may move this except a
   * contribution.
   *
   * Null is the honest answer for an asset with no case.
   */
  caseWrittenAt: string | null
  /**
   * Supporting case fields that ARE written, in template order.
   *
   * The reason NVDA's card can stop saying nothing exists. A business model is
   * real case content and its absence from this list was what made "no written
   * case" a false statement rather than a blunt one.
   */
  supporting: SupportingSection[]
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
  const supporting = new Set<SupportingSection>()

  for (const row of rows) {
    if (!row.hasContent) continue
    // Supporting fields are recorded but never dated: they are not a view, so
    // they cannot move the review anchor. See `REVIEW_ANCHOR_SECTIONS`.
    if (SUPPORTING_CASE_SECTIONS.includes(row.section as SupportingSection)) {
      supporting.add(row.section as SupportingSection)
      continue
    }
    if (!CORE_THESIS_SECTIONS.includes(row.section as CoreSection)) continue
    const section = row.section as CoreSection
    const stamp = row.updated_at ?? ''
    if (!stamp) continue
    const prev = newest.get(section)
    if (prev == null || stamp > prev) newest.set(section, stamp)
  }

  const present = CORE_THESIS_SECTIONS.filter(s => newest.has(s))
  const missing = CORE_THESIS_SECTIONS.filter(s => !newest.has(s))
  const stamps = [...newest.values()].sort()

  return {
    present: [...present],
    missing: [...missing],
    supporting: SUPPORTING_CASE_SECTIONS.filter(s => supporting.has(s)),
    caseWrittenAt: stamps.length ? stamps[stamps.length - 1] : null,
  }
}

/**
 * Which clock a derived date came from.
 *
 * Carried so the copy and the metric label can name the event that actually
 * happened. Without it the card computes from one timestamp and labels it with
 * the other's word, which is the whole defect this pair exists to prevent.
 */
export type ReviewSource = 'written' | 'reviewed'

export interface ReviewClocks {
  /** The written case changed. Only a contribution moves this. */
  caseWrittenAt: string | null
  /**
   * A completed Research review that produced no edit, or null.
   *
   * "Reviewed, unchanged" — the event the product could never record until the
   * durable judgment read existed. Only a `confirmed` judgment on a Research
   * card qualifies; see `completesResearchReview`.
   */
  researchReviewAt: string | null
  /**
   * The later of the two, and what the CONDITIONS measure from.
   *
   * Evidence is unanswered after this. Staleness counts from this. A price move
   * is measured from this. Null when the case has never been written — a
   * judgment cannot create an anchor, because tapping an answer on a name with
   * nothing recorded does not write a thesis.
   */
  effectiveAnchor: string | null
  /**
   * Which of the two the effective anchor is, or null when there is none.
   *
   * The card reads this and nothing else to decide between "written" and
   * "reviewed" in its copy. Deriving it at each call site is how the two would
   * eventually disagree.
   */
  anchoredOn: ReviewSource | null
}

/**
 * The two clocks, and the one derived from them.
 *
 * ── Why two, and not one anchor that absorbs both ─────────────────────────
 *
 * They are different events and only one of them is an edit:
 *
 *   CASE WRITTEN AT   proves the written case changed.
 *   RESEARCH REVIEW AT proves the reader looked and concluded it stands.
 *
 * A single anchor collapses them, and the collapse is not harmless — it makes
 * the card lie. "Case last written 5 days ago" after a judgment, about a case
 * last edited in November, is a false statement of fact rendered at the loudest
 * size on the tile. The reader would go to the asset expecting recent prose and
 * find none.
 *
 * So both are kept, the CONDITIONS use the later of the two, and the COPY uses
 * whichever one it is naming. Nothing is relabelled into anything else.
 *
 * ── The two rules on the review clock ─────────────────────────────────────
 *
 * FORWARD ONLY. A judgment older than the last save must not drag the anchor
 * backwards and make a freshly written case look stale. `Math.max` gives that
 * for free, which is why the effective anchor is a max rather than a
 * "judgment wins if present".
 *
 * NEVER CREATES ONE. A judgment on a case that has never been written must not
 * produce an anchor. Tapping "Legacy position" on a name with nothing recorded
 * does not write a thesis, and letting it silence the card that says so would
 * be the product accepting an answer to a question it never asked. So
 * `effectiveAnchor` stays null while `caseWrittenAt` is null, no matter what
 * the review clock says — and `researchReviewAt` is still reported, because it
 * happened and a reader may want to know it did.
 */
export function reviewClocks(
  coverage: CaseCoverage,
  researchReviewAt: string | null | undefined,
): ReviewClocks {
  const written = coverage.caseWrittenAt
  const writtenMs = written ? new Date(written).getTime() : NaN

  const reviewMs = researchReviewAt ? new Date(researchReviewAt).getTime() : NaN
  const reviewed = Number.isFinite(reviewMs) ? new Date(reviewMs).toISOString() : null

  // No case, no anchor — whatever was tapped. See the header.
  if (!Number.isFinite(writtenMs)) {
    return { caseWrittenAt: written, researchReviewAt: reviewed, effectiveAnchor: null, anchoredOn: null }
  }

  const reviewIsLater = reviewed != null && reviewMs > writtenMs
  return {
    caseWrittenAt: written,
    researchReviewAt: reviewed,
    effectiveAnchor: reviewIsLater ? reviewed : written,
    anchoredOn: reviewIsLater ? 'reviewed' : 'written',
  }
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
  /**
   * Days since the EFFECTIVE anchor — the later of the two clocks.
   *
   * Read `anchoredOn` before putting a word next to this number: it is days
   * since the case was written, OR days since it was last reviewed, and the
   * copy has to say which.
   */
  daysSinceReview: number | null
  /** Days since the case itself was last written. Never moved by a judgment. */
  daysSinceWritten: number | null
  /** Which clock `daysSinceReview` counts from. Null when there is no anchor. */
  anchoredOn: ReviewSource | null
  /** Signed. Present only on `price_move`, and only from a defensible baseline. */
  movePct?: number
  /** Arrivals strictly after the anchor. Present on `new_evidence` only. */
  evidence?: EvidenceArrival[]
  present: CoreSection[]
  missing: CoreSection[]
  /** Supporting case fields that exist. Never empty-claimed over. */
  supporting: SupportingSection[]
}

export interface ResearchIssueInput {
  /**
   * Both clocks, already resolved.
   *
   * Takes `ReviewClocks` rather than a `CaseCoverage` and a judgment date,
   * because the max and the "no case, no anchor" rule are one decision and
   * must not be re-made here. `coverage` is still needed for the section lists.
   */
  clocks: ReviewClocks
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
  const { clocks, coverage, evidence, movePct, now } = input
  const { present, missing } = coverage

  // The CONDITIONS measure from the effective anchor: a genuine review with no
  // change means the case was reconsidered, so evidence before it is answered
  // and the stale clock restarts. The COPY still names whichever event that was.
  const anchorMs = clocks.effectiveAnchor ? new Date(clocks.effectiveAnchor).getTime() : NaN
  const anchored = Number.isFinite(anchorMs)
  const daysSinceReview = anchored ? Math.floor((now - anchorMs) / DAY_MS) : null

  const writtenMs = clocks.caseWrittenAt ? new Date(clocks.caseWrittenAt).getTime() : NaN
  const daysSinceWritten = Number.isFinite(writtenMs) ? Math.floor((now - writtenMs) / DAY_MS) : null

  const shape = {
    present: [...present], missing: [...missing], supporting: [...coverage.supporting],
    daysSinceReview, daysSinceWritten, anchoredOn: clocks.anchoredOn,
  }

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
  if (missing.length === CORE_THESIS_SECTIONS.length) return { ...shape, framing: 'no_case' }
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

/**
 * What the card's own pill says, per framing.
 *
 * ── Why not the type label ────────────────────────────────────────────────
 *
 * Two types carry five framings, and `KIND_LABEL` was false for one member of
 * each: "Unreviewed change" sat over a card whose whole content is that nothing
 * changed, and "No thesis" sat over a name whose thesis is the one section that
 * IS written. Roughly half the real production population wore a pill that
 * misdescribed it.
 *
 * The fix is not to widen both type labels into vagueness — that would trade a
 * false pill for an uninformative one, on every card, to fix two. The type
 * label stays broad because it is what Curate filters on; the CARD says exactly
 * which of the five it is. See `SignalCard.kindLabel`.
 *
 * "Material move" rather than "Case / price gap": the finding is that the price
 * moved and the written case has not answered it, which is a statement about
 * the MOVE. `scenario_gap` already owns "Case vs price" and means something
 * else — a price through a modelled ladder — and two pills a word apart for two
 * unrelated findings is how a reader stops trusting either.
 */
export const RESEARCH_PILL: Record<ResearchFraming, string> = {
  /**
   * "Research", not "Evidence".
   *
   * Evidence is a word about adjudication — it implies something was weighed
   * and found to bear on the question. Tesseract knows one thing about these
   * arrivals: a research item was filed after the thesis was last written. It
   * does not know whether the item supports, challenges or ignores the view,
   * and it says so on the card. Calling it evidence claims the adjudication in
   * the pill and then disclaims it two lines below.
   */
  new_evidence: 'New research',
  price_move: 'Material move',
  // Names the absence of a revisit, never a change. TSLA is the live case:
  // −5.2% and 163 days, where "Unreviewed change" asserted an event.
  long_silence: 'Case not revisited',
  /**
   * "No core thesis", not "No written case".
   *
   * The case is eight fields; these framings are about three of them. NVDA has
   * a written business model and no thesis, and its card said nothing was
   * written at all — a claim about the whole template made from a third of it.
   * What is actually absent is the decision-bearing view.
   */
  no_case: 'No core thesis',
  incomplete_case: 'Incomplete thesis',
}

/**
 * Curate filters by FRAMING, without a backend type existing for one.
 *
 * ── The problem ───────────────────────────────────────────────────────────
 *
 * Curate's option list is built from `KIND_LABEL`, one entry per `SignalType`.
 * That exposed the two Research types and nothing else, so "New research" and
 * "Material move" — the states a reader actually recognises — were not
 * selectable, while `research_stale`'s category label collided with
 * `awaiting_review`'s and offered two identical "Needs review" rows.
 *
 * ── Why a prefixed pseudo-key rather than a new SignalType ────────────────
 *
 * A `SignalType` is a contract: it carries a tier, a base score, a registry
 * entry, a dedupe key and a durable judgment scope. Five new members would
 * mean five new tiers to place and five new judgment scopes to reason about,
 * all to express a distinction the cards already make in presentation. The
 * framing is not a different KIND of finding; it is why this one exists.
 *
 * So the filter speaks `research:<framing>` and resolves it against the
 * entry's framing. Nothing downstream of the filter sees these keys, and the
 * `SignalType` union is untouched.
 */
export const RESEARCH_FILTER_PREFIX = 'research:'

export function researchFilterKey(framing: ResearchFraming): string {
  return `${RESEARCH_FILTER_PREFIX}${framing}`
}

/** The framing a filter key names, or null when it is not one of ours. */
export function researchFramingFromFilterKey(key: string): ResearchFraming | null {
  if (!key.startsWith(RESEARCH_FILTER_PREFIX)) return null
  const framing = key.slice(RESEARCH_FILTER_PREFIX.length) as ResearchFraming
  return framing in RESEARCH_PILL ? framing : null
}

/**
 * The five Research rows Curate offers, keyed and labelled.
 *
 * Same words as the card pill, deliberately: the reader filters for the thing
 * they just saw. The label and the pill are allowed to diverge — they are
 * different abstractions — but here they describe the same five states, so
 * inventing a second vocabulary would only make the filter harder to use.
 */
export const RESEARCH_FILTER_OPTIONS: { key: string; label: string }[] =
  (['new_evidence', 'price_move', 'long_silence', 'no_case', 'incomplete_case'] as ResearchFraming[])
    .map(f => ({ key: researchFilterKey(f), label: RESEARCH_PILL[f] }))

/**
 * Whether this framing has a coherent judgment to ask for.
 *
 * ── Complexity is earned by the framing, not spread evenly ────────────────
 *
 * The two authoring framings had a Respond pane because every other card did,
 * and the question it asked — "What best describes this position?" with Active
 * thesis / Legacy position / Someone else owns it / Needs review — was four
 * answers on four different axes: an investment state, a portfolio history, a
 * coverage assignment and a work status. No single question was being asked, so
 * no answer meant anything consistent.
 *
 * There is also nothing to judge. A missing thesis is not a claim the reader
 * can agree or disagree with; it is work that has not been done, and the only
 * useful response is to do it. The primary action already says so.
 *
 * The dispositions that WERE useful — "someone else owns it", "legacy position"
 * — are ownership and scope statements rather than investment judgments, and
 * they move to the Actions sheet with their quieting semantics intact. See
 * `OWNERSHIP_DISPOSITIONS`.
 */
export function framingWantsJudgment(framing: ResearchFraming): boolean {
  return framing !== 'no_case' && framing !== 'incomplete_case'
}

/**
 * Ownership and scope answers, which are not judgments about the case.
 *
 * They belong on every Research framing and on none of their judgment axes.
 * Kept as data so the Actions sheet and the tests read the same list, and so
 * their `judgment-policy` keys — and therefore their 180-day quieting — are
 * unchanged by the move.
 */
export const OWNERSHIP_DISPOSITIONS = [
  { key: 'owned_elsewhere', label: 'Someone else owns it' },
  { key: 'legacy_position', label: 'Legacy position' },
  { key: 'no_longer_covered', label: 'No longer covered' },
] as const

/** Whether this framing's card should offer a price pane at all. */
export function framingWantsPrice(framing: ResearchFraming): boolean {
  // A structural absence is not a thing the tape can illustrate. Drawing a
  // chart next to "nobody has written this up" would imply the price is the
  // finding, and the reader would go looking for an event that is not there.
  return framing !== 'no_case' && framing !== 'incomplete_case'
}

/**
 * The word for the event the effective anchor actually represents.
 *
 * ── The rule this enforces, in one function ───────────────────────────────
 *
 * A judgment is not an edit. "Case holds" proves the reader looked and
 * concluded the recorded view stands; it proves nothing was WRITTEN. So a card
 * anchored to a judgment may say "reviewed" and may not say "written",
 * "edited" or "updated" — and a card anchored to a contribution says "written".
 *
 * One function, because the headline, the body, the metric label and the case
 * pane all need the same word and three of them would eventually pick a
 * different one.
 */
export function anchorVerb(anchoredOn: ReviewSource | null): 'written' | 'reviewed' {
  return anchoredOn === 'reviewed' ? 'reviewed' : 'written'
}

/** "163 days", or "1.2 years" past a year. Shared so the two agree. */
function span(days: number): string {
  return days >= 365 ? `${(days / 365).toFixed(1)} years` : `${days} day${days === 1 ? '' : 's'}`
}

/**
 * How the card describes itself.
 *
 * ── "Last written" or "last reviewed", and never the wrong one ────────────
 *
 * Two durable events exist and only one of them is an edit. A section save
 * moves `caseWrittenAt`; a completed Research judgment moves `researchReviewAt`
 * and touches no prose. The conditions measure from the later of the two, so
 * the copy has to name whichever that was — `issue.anchoredOn` says which, and
 * `anchorVerb` turns it into the word.
 *
 * The failure this prevents is not cosmetic. Before the clocks were separated,
 * a reader who tapped "Case holds" got a card reading "case last written 5 days
 * ago" about a case last edited in November: a false statement of fact at the
 * loudest size on the tile, which would send them to the asset expecting recent
 * prose that is not there.
 *
 * Where the two differ, the body carries BOTH — the review is why the card is
 * quiet and the write date is what the reader will find when they open it.
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
  const verb = anchorVerb(issue.anchoredOn)

  /** "the case was last written 192 days ago", naming the real event. */
  const anchored = days == null ? '' : `the thesis was last ${verb} ${span(days)} ago`

  /**
   * The write date, stated alongside a review that superseded it.
   *
   * Empty when the two clocks are the same event, so an ordinary card gains no
   * second clause. Present only where a reader would otherwise be misled about
   * how old the PROSE is.
   */
  const alsoWritten = issue.anchoredOn === 'reviewed' && issue.daysSinceWritten != null
    ? ` The thesis itself was last written ${span(issue.daysSinceWritten)} ago.`
    : ''

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
        headline: `New research on ${symbol} since the thesis was last ${verb}`,
        /**
         * Says what the card knows and stops.
         *
         * It used to end with "Nothing records whether it supports or
         * challenges the thesis — that is the review." That sentence is
         * load-bearing and it is now stated once, in the Evidence pane, beside
         * the thing it is about. Here it was repeated under every pane the
         * reader paged to, so Evidence, Price, Case and Respond each carried
         * the same paragraph and none of them used the space for what was
         * unique to it.
         */
        body: `${n} item${n === 1 ? '' : 's'} arrived after ${anchored || `the case was last ${verb}`}.${alsoWritten}`,
        prompt: 'Does this change the case?',
      }
    }

    case 'price_move': {
      const move = Math.abs(issue.movePct!).toFixed(1)
      const dir = issue.movePct! >= 0 ? 'up' : 'down'
      return {
        // Names the CHANGE. The sign is carried in words and in the number;
        // nothing in the presentation grades the direction as good or bad.
        headline: `${symbol} has moved ${issue.movePct! >= 0 ? '+' : '−'}${move}% since its thesis was last ${verb}`,
        body: `The price is ${dir} ${move}% since ${anchored || `the case was last ${verb}`}${
          exposure ? `, and it is ${exposure}` : ''
        }. The written case has not accounted for the move.${alsoWritten}`,
        // Direct, and about the investment rather than about the card.
        // "Does this change need a look?" asked whether to spend time; this
        // asks the question the answers actually answer.
        prompt: 'Does this move change the case?',
      }
    }

    case 'no_case': {
      /**
       * Says what is missing, and never that nothing exists.
       *
       * The template is eight fields and this framing is about three of them,
       * so "no written case" was false wherever any of the other five was
       * filled in — NVDA being the live proof. Where supporting work exists the
       * body names it, because a reader who opens the asset will find it and
       * would otherwise have been told it was not there.
       */
      const written = issue.supporting.length
        ? `${issue.supporting.map(x => SUPPORTING_SECTION_LABEL[x] ?? x).join(' and ')} ${
            issue.supporting.length === 1 ? 'is' : 'are'
          } written`
        : null
      return {
        headline: `${symbol} has no investment thesis`,
        body: `${written ? `${written}, but none of` : 'None of'} ${CORE_THESIS_SECTIONS
          .map(x => CORE_SECTION_LABEL[x].toLowerCase()).join(', ')} ${written ? 'is' : 'has been written'}${
          written ? '' : ''
        }${exposure ? `. It is ${exposure}` : ''}.`,
        prompt: 'What best describes this position?',
      }
    }

    case 'incomplete_case':
      return {
        headline: `${symbol}'s investment thesis is incomplete`,
        body: `${issue.present.map(s => CORE_SECTION_LABEL[s]).join(' and ')} ${
          issue.present.length === 1 ? 'is' : 'are'
        } written; ${missingNames.join(' and ')} ${missingNames.length === 1 ? 'is' : 'are'} not${
          exposure ? `. It is ${exposure}` : ''
        }.`,
        prompt: 'What best describes this position?',
      }

    default:
      return {
        headline: `${symbol}'s thesis was last ${verb} ${days != null ? span(days) : 'some time'} ago`,
        // Says plainly that nothing happened, so the card is not read as an event.
        body: `The case is complete and nothing has been recorded against it since${
          exposure ? `. It is ${exposure}` : ''
        }. Nothing has happened to it either — it is simply a long time since anybody ${
          verb === 'reviewed' ? 'revisited' : 'revised'
        } it.${alsoWritten}`,
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
      parts.push(`${issue.evidence?.length ?? 0} evidence item(s) filed after the case was last ${anchorVerb(issue.anchoredOn)}`)
      break
    case 'price_move':
      parts.push(`${Math.abs(issue.movePct!).toFixed(1)}% price move since the case was last ${anchorVerb(issue.anchoredOn)}`)
      break
    case 'no_case':
      parts.push(
        issue.supporting.length
          ? `no core-thesis section written (${issue.supporting.join(', ')} is)`
          : 'no core-thesis section written',
      )
      break
    case 'incomplete_case':
      parts.push(`${issue.present.length} of ${CORE_THESIS_SECTIONS.length} core-thesis sections written`)
      break
    default:
      parts.push('complete case, nothing recorded against it')
  }

  if (issue.daysSinceWritten != null) {
    parts.push(`case last written ${issue.daysSinceWritten} days ago`)
    // Named separately, because it is the reason the conditions restarted and
    // the write date alone would not explain a quiet card.
    if (issue.anchoredOn === 'reviewed' && issue.daysSinceReview != null) {
      parts.push(`reviewed unchanged ${issue.daysSinceReview} days ago`)
    }
  } else {
    parts.push(`${symbol} is in the research universe with no case to date from`)
  }

  return parts.join(' · ')
}
