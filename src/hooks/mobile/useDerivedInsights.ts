import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { isPriceable } from '../../lib/signals/instruments'
import { loadDispositions } from '../../lib/signals/dispositions'
import { BASELINE_TOLERANCE_DAYS, DAY_MS, judgmentTouches } from '../../lib/signals/stale-signal'
import {
  RESEARCH_CASE_SIGNAL_TYPES, completesResearchReview, isCompletedResearchReview,
} from '../../lib/signals/judgment-policy'
import {
  CORE_SECTIONS,
  caseCoverageFrom,
  researchBaseFor,
  reviewClocks,
  researchCopy,
  researchIssueFor,
  researchSignalTypeFor,
  type CoreContributionRow,
  type EvidenceArrival,
  type ResearchIssue,
  type ReviewSource,
} from '../../lib/research/case-state'
import {
  UNHELD,
  exposureByAsset,
  latestSnapshotIds,
  type Exposure,
  type PositionRow,
  type SnapshotRef,
} from '../../lib/research/holdings-context'

/**
 * Re-exported so the feed keeps one import site for the research family, while
 * the rules themselves stay reachable without Supabase. See `case-state.ts`.
 */
export { judgmentTouches } from '../../lib/signals/stale-signal'
export type {
  CaseCoverage, CoreSection, EvidenceArrival, ResearchFraming, ResearchIssue,
  ReviewClocks, ReviewSource,
} from '../../lib/research/case-state'
export {
  CORE_SECTIONS, CORE_SECTION_LABEL, RESEARCH_FRAMING_BASE,
  anchorVerb, caseCoverageFrom, framingWantsPrice, researchBaseFor,
  researchCopy, researchIssueFor, researchReason, researchSignalTypeFor,
  reviewClocks,
} from '../../lib/research/case-state'

/**
 * The kinds the feed still speaks.
 *
 * Two, not five. The five FRAMINGS live on `issue.framing`; these are the
 * card-type buckets the dedupe rule, the Explore adapter and the ranking
 * adapter already switch on, and collapsing the framings into them here keeps
 * every one of those call sites unchanged. `large_unreviewed` and
 * `concentration` are gone: the first was silence-with-a-big-position, which
 * `RESEARCH_STALE_DAYS` subsumed, and the second never had a producer.
 */
export type DerivedInsightKind = 'stale_research' | 'no_thesis'

export interface DerivedInsight {
  id: string
  kind: DerivedInsightKind
  /** What the user should notice, as a statement of fact. */
  headline: string
  /** The evidence. Always concrete and checkable. */
  body: string
  /** The question the judgment pane asks. Framing-specific. */
  prompt: string
  assetId: string
  symbol: string
  companyName?: string | null
  portfolioName?: string | null
  /** The book's id, so the card's chip can navigate rather than just name it. */
  portfolioId?: string | null
  /** Current-snapshot weight, or null. NEVER rendered as 0.0%. */
  weightPct?: number | null
  /** Whether the name is in the current book at all. Unheld is now normal. */
  held: boolean
  /** How many current books hold it, so a chip never implies a single one. */
  portfolioCount: number
  /** Live trade-queue items on this name. Context only — never rank or tier. */
  liveIdeas: { id: string; action: string | null }[]
  /**
   * Who covers this name, resolved to display names where possible.
   *
   * Empty is a real and common answer, and means "nobody has declared coverage"
   * — not "nobody is working on it". The pane says the former or says nothing.
   */
  coverageOwners: string[]
  /** Evidence filed against this name in total, whenever it arrived. */
  evidenceCount: number
  /**
   * Which research condition fired, and the facts behind it.
   *
   * Always present — an insight without an issue did not qualify and should not
   * have been built. Replaces the old optional `context`, which was absent on
   * two of the three kinds and so could not be relied on by anything.
   */
  issue: ResearchIssue
  /**
   * ISO of the last save across non-empty core sections. An EDIT, always.
   *
   * Null for a case that has never been written. This is the only timestamp
   * entitled to the words "case last written", and nothing but a contribution
   * can move it.
   */
  caseWrittenAt: string | null
  /**
   * ISO of the last COMPLETED Research review that produced no edit, or null.
   *
   * "Reviewed, unchanged". Only a `confirmed` judgment on a Research card
   * qualifies — an explicit "Need to review properly" is the opposite of one.
   */
  researchReviewAt: string | null
  /**
   * The later of the two. What the conditions measure from.
   *
   * Evidence is unanswered after this, staleness counts from this, and the
   * price move is measured from this. Null when the case has never been
   * written, whatever was tapped.
   */
  reviewAnchor: string | null
  /** Which clock `reviewAnchor` is. Drives every "written" / "reviewed" word. */
  anchoredOn: ReviewSource | null
  /** Days since `reviewAnchor`. Read `anchoredOn` before labelling it. */
  daysSinceReview: number | null
  /** Days since the case itself was written. Never moved by a judgment. */
  daysSinceWritten: number | null
  /** Higher sorts earlier WITHIN the tier. Framing strength, then size. */
  score: number
}

/** Paging limits. `PRICE_PAGE` is the project's PostgREST `max_rows`. */
const MAX_PRICE_SYMBOLS = 40
const PRICE_PAGE = 1000
const MAX_PRICE_PAGES = 8

/**
 * How many assets the scan will classify.
 *
 * The universe is coverage plus the current book plus anything with a written
 * case, which for the largest production organisation is about 110 names. The
 * cap exists so a future organisation with a thousand covered names cannot turn
 * the opening query into a page walk.
 */
const MAX_CANDIDATES = 200

/** Quick thoughts have no preview column; this is where their body is cut. */
const PREVIEW_CHARS = 240

/**
 * Observations about the state of the reader's written investment cases.
 *
 * ── What this hook is FOR ─────────────────────────────────────────────────
 *
 * One question: which investment cases deserve attention, and why. The object
 * is always the CASE — never a note, a document, a contribution row or an
 * evidence item. Evidence may explain why a case surfaced; it is never the
 * thing that surfaced. See `lib/research/case-state.ts`, which owns the rule.
 *
 * ── Three things that changed, and why each was wrong before ──────────────
 *
 * **The review anchor.** It used to be the newest of any note, any quick
 * thought and any contribution in ANY section — so a note arriving made a case
 * look freshly reviewed, and "new evidence since review" was not merely
 * unimplemented but inexpressible. It is now the newest save across non-empty
 * CORE sections only.
 *
 * **The universe.** It used to start from `portfolio_holdings_positions`, so an
 * asset the reader covers but does not currently hold produced no card at all.
 * In production that hid thirteen covered names with nothing written — the
 * largest real research gap in the product, invisible because the query began
 * in the wrong place. Coverage now seeds the universe alongside the book.
 * Coverage means "this is legitimately your research work"; it does not mean
 * urgent, held, or decision-ready, and nothing here treats it as though it did.
 *
 * **The exposure.** It used to order every historical position row by weight
 * and dedupe by asset, which returns the largest weight a name ever had rather
 * than its weight now. See `holdings-context.ts`.
 *
 * ── What is deliberately NOT selected ─────────────────────────────────────
 *
 * Note bodies. Production holds a 2 MB note, and a scan that selected `content`
 * would transfer it for every candidate before anything had been ranked. Notes
 * carry `content_preview` (populated on every live row, capped at 150 chars)
 * and that is what the evidence pane shows.
 *
 * Contribution prose. The scan needs to know THAT a section is written, not
 * what it says, so PostgREST filters out null and empty rows server-side and
 * only the section and its timestamp come back. The case pane renders section
 * presence, which is all §13 permits it to claim anyway.
 *
 * Price history, for anything that has not already qualified. The narrowing is
 * load-bearing rather than an optimisation — see the paging note below.
 */
export function useDerivedInsights() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  return useQuery<DerivedInsight[]>({
    queryKey: ['derived-insights', 'research-v2', user?.id, currentOrgId],
    queryFn: async () => {
      // Without an org there is nothing safe to show: these queries would
      // otherwise return positions and research from every organisation the
      // user belongs to and present them as the current book.
      if (!user || !currentOrgId) return []

      // ── Cheap scan, part one: what is even in the universe ───────────────
      //
      // Three parallel requests, none of which reads prose. `coverage` is the
      // new one and is what makes an unheld covered name visible at all.
      const [coverageRes, snapshotRes, positionRes] = await Promise.all([
        supabase.from('coverage')
          // `analyst_name` is a free-text fallback and `user_id` is the real
          // link; the pane prefers the resolved user and falls back only when
          // there is nobody to resolve. Both come from the query that was
          // already needed to build the universe, so this costs no round trip.
          .select('asset_id, user_id, analyst_name')
          .eq('organization_id', currentOrgId)
          .not('asset_id', 'is', null),
        supabase.from('portfolio_holdings_snapshots')
          .select('id, portfolio_id, snapshot_date')
          .eq('organization_id', currentOrgId),
        supabase.from('portfolio_holdings_positions')
          // Ordered newest-first so a cap truncates the OLDEST snapshot rather
          // than the current one — the only truncation that keeps the exposure
          // correct rather than merely bounded.
          .select('snapshot_id, portfolio_id, asset_id, weight_pct, created_at, portfolios(name)')
          .eq('organization_id', currentOrgId)
          .not('asset_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(PRICE_PAGE),
      ])

      const positions = (positionRes.data ?? []) as unknown as PositionRow[]
      const snapshots = (snapshotRes.data ?? []) as unknown as SnapshotRef[]
      const exposure = exposureByAsset(positions, latestSnapshotIds(snapshots, positions))

      const universe = new Set<string>()
      /** asset -> the people who cover it, unresolved. */
      const coverageRaw = new Map<string, { userId: string | null; name: string | null }[]>()
      type CoverageRow = { asset_id: string | null; user_id: string | null; analyst_name: string | null }
      for (const r of (coverageRes.data ?? []) as CoverageRow[]) {
        if (!r.asset_id) continue
        universe.add(r.asset_id)
        const list = coverageRaw.get(r.asset_id) ?? []
        list.push({ userId: r.user_id, name: r.analyst_name })
        coverageRaw.set(r.asset_id, list)
      }
      for (const assetId of exposure.keys()) universe.add(assetId)

      // ── Cheap scan, part two: the research itself ────────────────────────
      //
      // Contributions are queried across the WHOLE org rather than against the
      // universe so far, because a written case is itself a reason to be in the
      // universe: an asset somebody wrote up and then stopped covering still
      // has a case that can go stale.
      const [contribRes, noteRes, thoughtRes] = await Promise.all([
        supabase.from('asset_contributions')
          // No `content`. The two filters below are what establish that the
          // section is written; see the header.
          .select('asset_id, section, updated_at')
          .eq('organization_id', currentOrgId)
          .eq('is_archived', false)
          .in('section', CORE_SECTIONS as unknown as string[])
          .not('content', 'is', null)
          .neq('content', ''),
        supabase.from('asset_notes')
          // `content_preview`, never `content`. See the header.
          .select('id, asset_id, created_at, created_by, title, content_preview')
          .eq('organization_id', currentOrgId)
          .eq('is_deleted', false)
          .not('asset_id', 'is', null),
        supabase.from('quick_thoughts')
          .select('id, asset_id, created_at, created_by, content')
          .eq('organization_id', currentOrgId)
          .not('asset_id', 'is', null),
      ])

      const contribByAsset = new Map<string, CoreContributionRow[]>()
      for (const r of (contribRes.data ?? []) as { asset_id: string; section: string; updated_at: string | null }[]) {
        if (!r.asset_id) continue
        universe.add(r.asset_id)
        const list = contribByAsset.get(r.asset_id) ?? []
        // Every row that survived the query has prose in it by construction.
        list.push({ section: r.section, hasContent: true, updated_at: r.updated_at })
        contribByAsset.set(r.asset_id, list)
      }

      const evidenceByAsset = new Map<string, EvidenceArrival[]>()
      const addEvidence = (assetId: string | null, e: EvidenceArrival) => {
        if (!assetId || !e.at) return
        const list = evidenceByAsset.get(assetId) ?? []
        list.push(e)
        evidenceByAsset.set(assetId, list)
      }

      type NoteRow = {
        id: string; asset_id: string | null; created_at: string | null
        created_by: string | null; title: string | null; content_preview: string | null
      }
      for (const r of (noteRes.data ?? []) as NoteRow[]) {
        addEvidence(r.asset_id, {
          id: r.id,
          // `created_at`, never `updated_at`. 18 of 22 live notes in production
          // share one backfill timestamp from the organization_id migration, so
          // `updated_at` records a data migration rather than a human edit, and
          // reading it would manufacture evidence that never arrived.
          at: r.created_at ?? '',
          authorId: r.created_by,
          title: r.title && r.title !== 'Untitled' ? r.title : null,
          preview: r.content_preview ?? null,
          kind: 'note',
        })
      }

      type ThoughtRow = {
        id: string; asset_id: string | null; created_at: string | null
        created_by: string | null; content: string | null
      }
      for (const r of (thoughtRes.data ?? []) as ThoughtRow[]) {
        addEvidence(r.asset_id, {
          id: r.id,
          at: r.created_at ?? '',
          authorId: r.created_by,
          title: null,
          // `quick_thoughts` has no preview column, so this is the one body the
          // scan reads. Cut on receipt rather than trusted: the composer is a
          // short-form field, but nothing in the schema enforces that.
          preview: r.content ? r.content.slice(0, PREVIEW_CHARS) : null,
          kind: 'thought',
        })
      }

      // ── Review touches that are not section saves ────────────────────────
      //
      // A structured judgment IS a review. Somebody who tapped "View holds" on
      // Tuesday revisited the case; raising the same card at them on Wednesday
      // because no PROSE was written would punish using the feed as designed.
      //
      // Read from BOTH stores, deliberately. `audit_events` is the durable
      // record — it survives a cleared cache, follows the reader to a second
      // device, and is queryable — and it is what `judgment-log` has been
      // writing all along; nothing read it back, so a judgment recorded on a
      // phone did nothing on a laptop. localStorage stays as well, because it
      // covers card kinds the `audit_events` entity constraint cannot take and
      // is available with no round trip.
      const reviewTouch = new Map<string, number>()
      const noteTouch = (assetId: string | null | undefined, at: string | null | undefined) => {
        if (!assetId || !at) return
        const t = new Date(at).getTime()
        if (!Number.isFinite(t)) return
        const prev = reviewTouch.get(assetId)
        if (prev == null || t > prev) reviewTouch.set(assetId, t)
      }

      /**
       * Family AND outcome, through the same policy function the durable path
       * uses.
       *
       * The disposition key is `{signalType}:{entityId}` and the entry carries
       * the judgment key, so both scopes are answerable locally — and they have
       * to be, or the two stores disagree: a reader who tapped "Need to review
       * properly" would have the card silenced on the device that wrote it and
       * not on any other.
       */
      for (const t of judgmentTouches(
        loadDispositions(user.id) as any,
        e => completesResearchReview(e.signalType, e.key),
      )) {
        if (universe.has(t.entityId)) noteTouch(t.entityId, t.at)
      }

      const universeIds = [...universe].slice(0, MAX_CANDIDATES)

      if (universeIds.length) {
        // One indexed request, narrowed four ways and bounded by the candidate
        // list. Not an all-audit-events scan: without every one of these
        // filters this would be the expensive query the brief forbids.
        const { data: durable } = await supabase
          .from('audit_events')
          .select('entity_id, occurred_at, metadata')
          .eq('org_id', currentOrgId)
          .eq('actor_id', user.id)
          .eq('action_type', 'record_judgment')
          .eq('entity_type', 'asset')
          /**
           * The family filter, and the reason this row set is not enough
           * without it.
           *
           * `action_type` + `entity_type` names a WRITER, not a family:
           * `applyVerdict` is the single writer for the whole mobile feed and
           * admits any card whose entity is an asset — 22 of the registered
           * types. Without this line, answering "Is this target still your
           * view?" advanced the review anchor of the CASE.
           *
           * `metadata->>signal_type` is `card.type`. Not `card_surface`, which
           * is the accent rail and reads `research` for target and scenario
           * cards too — see `isResearchCaseJudgment`.
           */
          .in('metadata->>signal_type', RESEARCH_CASE_SIGNAL_TYPES as unknown as string[])
          .in('entity_id', universeIds)
          .order('occurred_at', { ascending: false })

        for (const r of (durable ?? []) as { entity_id: string; occurred_at: string; metadata: Record<string, unknown> | null }[]) {
          /**
           * The same predicate again, in the client.
           *
           * Not belt-and-braces for its own sake. The server filter is a
           * PostgREST jsonb path expression written as a string, so a typo in
           * it does not fail — it silently returns MORE rows, which is the
           * failure direction that matters here. Re-checking in a pure,
           * tested function means the rule is provable without a database, and
           * the widening it guards against cannot happen quietly.
           *
           * It also carries the `feed_quality` exclusion: a tap saying the card
           * was bad is a claim about the CARD, and must not mark the case as
           * looked at.
           */
          if (!isCompletedResearchReview(r.metadata)) continue
          noteTouch(r.entity_id, r.occurred_at)
        }
      }

      // ── Author names, for the evidence pane ──────────────────────────────
      //
      // Bounded by the distinct authors in one organisation, which is a desk
      // rather than a population. Resolved once here rather than per card.
      const authorIds = new Set<string>()
      for (const list of evidenceByAsset.values()) {
        for (const e of list) if (e.authorId) authorIds.add(e.authorId)
      }
      for (const list of coverageRaw.values()) {
        for (const c of list) if (c.userId) authorIds.add(c.userId)
      }
      const authorName = new Map<string, string>()
      if (authorIds.size) {
        const { data: users } = await supabase
          .from('users')
          .select('id, email, first_name, last_name')
          .in('id', [...authorIds])
        for (const u of (users ?? []) as { id: string; email: string | null; first_name: string | null; last_name: string | null }[]) {
          const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
          authorName.set(u.id, name || u.email || 'Someone')
        }
      }

      // ── Resolve the assets, then classify ────────────────────────────────
      const { data: assetRows } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .in('id', universeIds)

      type AssetRow = { id: string; symbol: string; company_name: string | null }
      const assets = new Map<string, AssetRow>()
      for (const a of (assetRows ?? []) as AssetRow[]) assets.set(a.id, a)

      const now = Date.now()

      /**
       * A case's review anchor, taking a durable judgment into account.
       *
       * The judgment can only ever move the anchor FORWARD, and only for a case
       * that has one: tapping "View holds" on a name with nothing written does
       * not create a case, and must not silence the card that says so.
       */
      const clocksOf = (assetId: string) => {
        const coverage = caseCoverageFrom(contribByAsset.get(assetId) ?? [])
        const reviewed = reviewTouch.get(assetId)
        return {
          coverage,
          clocks: reviewClocks(
            coverage,
            reviewed != null ? new Date(reviewed).toISOString() : null,
          ),
        }
      }

      /**
       * The names a price question could possibly be about, decided BEFORE any
       * price is read.
       *
       * A price move only matters where there is an anchor to measure from and
       * no unanswered evidence already explaining the card — so the price query
       * is asked about a handful of names rather than the whole universe. That
       * narrowing is not an optimisation, it is what makes the query answerable
       * at all: see the paging note below.
       */
      const priceCandidates: { symbol: string; anchor: number }[] = []
      const seenSymbol = new Set<string>()
      for (const assetId of universeIds) {
        const asset = assets.get(assetId)
        if (!asset?.symbol || !isPriceable(asset.symbol)) continue
        // The EFFECTIVE anchor: a case reviewed unchanged last week does not
        // need a baseline fetched for a move it has already accounted for.
        const { clocks } = clocksOf(assetId)
        if (!clocks.effectiveAnchor) continue
        const anchor = new Date(clocks.effectiveAnchor).getTime()
        if (!Number.isFinite(anchor)) continue
        // Unanswered evidence outranks a move, so a name that already has some
        // needs no baseline fetched for it.
        const hasNewEvidence = (evidenceByAsset.get(assetId) ?? [])
          .some(e => new Date(e.at).getTime() > anchor)
        if (hasNewEvidence) continue
        const sym = asset.symbol.toUpperCase()
        if (seenSymbol.has(sym)) continue
        seenSymbol.add(sym)
        priceCandidates.push({ symbol: sym, anchor })
        if (priceCandidates.length >= MAX_PRICE_SYMBOLS) break
      }

      /** symbol -> closes, newest first. Empty when nothing qualifies. */
      const priceBySymbol = new Map<string, { t: number; close: number }[]>()

      if (priceCandidates.length) {
        /**
         * Bounded by date and paged, because the obvious query is wrong here.
         *
         * PostgREST caps this project at 1000 rows, so a single
         * `.order('date').limit(1000)` over N symbols returns the most recent
         * ~1000 rows ACROSS ALL OF THEM — about eight trading days at this
         * candidate count. Every baseline lookup is months back by
         * construction, so it would find nothing, the move would be null every
         * time, and the price framing would silently never fire. The signal
         * would look implemented and be dead.
         *
         * So: floor the window at the oldest anchor (minus the baseline
         * tolerance) rather than pulling whole histories, and page the rest
         * with fixed parallel offsets. The secondary sort on `symbol` is
         * load-bearing for the same reason as in `usePriceHistory` — `range()`
         * needs a totally ordered set or the pages overlap and gap.
         */
        const floor = new Date(
          Math.min(...priceCandidates.map(c => c.anchor)) - BASELINE_TOLERANCE_DAYS * DAY_MS,
        ).toISOString().slice(0, 10)
        const symbols = priceCandidates.map(c => c.symbol)

        const { count } = await supabase
          .from('price_history_cache')
          .select('symbol', { count: 'exact', head: true })
          .in('symbol', symbols)
          .gte('date', floor)

        const pages = Math.min(Math.ceil((count ?? 0) / PRICE_PAGE), MAX_PRICE_PAGES)
        const responses = await Promise.all(
          Array.from({ length: pages }, (_, i) =>
            supabase
              .from('price_history_cache')
              .select('symbol, date, close')
              .in('symbol', symbols)
              .gte('date', floor)
              .order('date', { ascending: false })
              .order('symbol', { ascending: true })
              .range(i * PRICE_PAGE, (i + 1) * PRICE_PAGE - 1)),
        )

        for (const res of responses) {
          for (const r of (res.data ?? []) as { symbol: string; date: string; close: number }[]) {
            const c = Number(r.close)
            const t = new Date(r.date).getTime()
            if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(t)) continue
            const sym = String(r.symbol).toUpperCase()
            const list = priceBySymbol.get(sym) ?? []
            list.push({ t, close: c })
            priceBySymbol.set(sym, list)
          }
        }
      }

      /**
       * How far the price has travelled since the anchor, or null.
       *
       * Null when there is no close at or before the anchor, or no recent one.
       * Returning null rather than a best guess is the point: a card claiming
       * "moved 16%" off a fabricated baseline is worse than no card, and COIN
       * and TGT — both anchored, both with zero cached closes — are the real
       * names that would produce one. A capped page read lands here too, as a
       * missing baseline and so as no card.
       */
      const moveSince = (symbol: string, anchor: number): number | null => {
        const list = priceBySymbol.get(symbol.toUpperCase())
        if (!list || list.length < 2) return null
        const latest = list[0]
        // Nearest close at or before the anchor. The list is newest-first.
        const base = list.find(p => p.t <= anchor)
        if (!base || base.close <= 0) return null
        // A baseline from long before the anchor is not a baseline for it.
        if (anchor - base.t > BASELINE_TOLERANCE_DAYS * DAY_MS) return null
        return ((latest.close - base.close) / base.close) * 100
      }

      // Live ideas, for context only. Never rank, never tier, never headline.
      const liveIdeaByAsset = new Map<string, { id: string; action: string | null }[]>()
      if (universeIds.length) {
        const { data: ideas } = await supabase
          .from('trade_queue_items')
          .select('id, asset_id, action, status')
          .eq('organization_id', currentOrgId)
          .in('asset_id', universeIds)
          .in('status', ['idea', 'deciding'])
        for (const r of (ideas ?? []) as { id: string; asset_id: string | null; action: string | null }[]) {
          if (!r.asset_id) continue
          const list = liveIdeaByAsset.get(r.asset_id) ?? []
          list.push({ id: r.id, action: r.action })
          liveIdeaByAsset.set(r.asset_id, list)
        }
      }

      const out: DerivedInsight[] = []

      for (const assetId of universeIds) {
        const asset = assets.get(assetId)
        if (!asset?.symbol) continue
        // "CASH_USD has no written case" is not a research gap, it is a
        // category error. Every framing below is a claim about written work on
        // a security; cash is a book line with no thesis to be missing.
        if (!isPriceable(asset.symbol)) continue

        const { coverage, clocks } = clocksOf(assetId)
        const anchorMs = clocks.effectiveAnchor ? new Date(clocks.effectiveAnchor).getTime() : NaN
        const exp: Exposure = exposure.get(assetId) ?? UNHELD

        const issue = researchIssueFor({
          clocks,
          coverage,
          evidence: evidenceByAsset.get(assetId) ?? [],
          movePct: Number.isFinite(anchorMs) ? moveSince(asset.symbol, anchorMs) : null,
          now,
        })

        // No reason to raise this case. The common and correct answer.
        if (!issue) continue

        const copy = researchCopy({
          symbol: asset.symbol,
          issue,
          portfolioName: exp.portfolioName,
          weightPct: exp.weightPct,
          held: exp.held,
        })

        const kind: DerivedInsightKind =
          researchSignalTypeFor(issue.framing) === 'no_research' ? 'no_thesis' : 'stale_research'

        /**
         * Framing strength first, size second.
         *
         * `feed-priority` owns the tier and the real ranking; this is the
         * within-family order the adapter passes through as `base`. Weight can
         * only ever nudge it, and can never lift a long silence above an
         * unanswered piece of evidence — which is the ordering the brief asks
         * for and the reason materiality is scaled to a tenth of the framing.
         */
        const weightScore = exp.weightPct != null ? Math.min(exp.weightPct / 10, 1) : 0

        out.push({
          id: `research-${issue.framing}-${assetId}`,
          kind,
          headline: copy.headline,
          body: copy.body,
          prompt: copy.prompt,
          assetId,
          symbol: asset.symbol,
          companyName: asset.company_name,
          portfolioName: exp.portfolioName,
          portfolioId: exp.portfolioId,
          weightPct: exp.weightPct,
          held: exp.held,
          portfolioCount: exp.portfolioCount,
          liveIdeas: liveIdeaByAsset.get(assetId) ?? [],
          coverageOwners: [...new Set(
            (coverageRaw.get(assetId) ?? [])
              .map(c => (c.userId ? authorName.get(c.userId) : null) ?? c.name ?? null)
              .filter((n): n is string => !!n && n.trim().length > 0),
          )],
          evidenceCount: (evidenceByAsset.get(assetId) ?? []).length,
          issue: {
            ...issue,
            // Author names attached last, so the classification stays pure and
            // the evidence array the rule produced is the one that renders.
            evidence: issue.evidence?.map(e => ({
              ...e,
              authorName: e.authorId ? authorName.get(e.authorId) ?? null : null,
            })),
          },
          caseWrittenAt: clocks.caseWrittenAt,
          researchReviewAt: clocks.researchReviewAt,
          reviewAnchor: clocks.effectiveAnchor,
          anchoredOn: issue.anchoredOn,
          daysSinceReview: issue.daysSinceReview,
          daysSinceWritten: issue.daysSinceWritten,
          score: researchBaseFor(issue) + weightScore * 0.1,
        })
      }

      return out.sort((a, b) => b.score - a.score)
    },
    enabled: !!user && !!currentOrgId,
    staleTime: 5 * 60 * 1000,
  })
}

export { insightSignalType } from '../../lib/signals/insight-type'
