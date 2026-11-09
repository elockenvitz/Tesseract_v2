import { useMemo } from 'react'
import { buildIdeaCard, type IdeaInput } from '../lib/signals/builders/ideas'
import {
  buildStaleTargetCard, buildTargetHitCard, buildConvictionCard, buildCrowdingCard,
} from '../lib/signals/builders'
import { feedItemToIdeaInput, type FeedItemLike } from '../lib/signals/feed-item-input'
import { rankFeed, type PriorityInput } from '../lib/signals/feed-priority'
import { composeFeed } from '../lib/signals/feed-compose'
import { readerQuestionFor } from '../lib/signals/reader-question'
import { briefClassFor } from '../lib/signals/brief-class'
import { matchesFeedFacets } from '../lib/signals/facet-match'
import { lensSpec, type IdeaLens } from '../lib/desktop-ideas/lens'
import { useDesktopCandidates } from './useDesktopCandidates'
import { useAuth } from './useAuth'
import { EMPTY_FILTER, useFeedFacets, type FeedFacets, type FeedFilter } from './mobile/useFeedFacets'
import type { SignalCard } from '../lib/signals/contract'
import type { ScoredFeedItem } from './ideas/types'
import type { PreviewSource } from '../lib/signals/feed-preview'
import { buildReadyToRevisitCard } from '../lib/signals/builders/readyToRevisit'
import { useReadyToRevisit } from './useReadyToRevisit'
import { isEligible, factsForTile, factKeyFor } from '../lib/memory/ready-to-revisit'
import { renderableFacts } from '../lib/memory/what-changed'
import { buildInsightCard } from '../lib/signals/builders'
import type { DerivedInsight } from './mobile/useDerivedInsights'
import { buildRecommendationCard } from '../lib/signals/builders'
import { recommendationInputFrom } from '../lib/signals/decision-recommendation'
import { useDecisionScan } from './useDesktopDecisions'
import { researchBaseFor } from '../lib/research/case-state'
import { unwrittenPositionCapital } from '../lib/signals/portfolio-issues'

/**
 * The Ideas attention feed: every candidate family, ranked by consequence.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * Ideas read the post feed alone, so it was the posts table while Explore
 * owned every machine-derived object. Both modes now draw on
 * `useDesktopCandidates`, and differ in ARRANGEMENT:
 *
 *   Ideas     rankFeed / priorityFor   tier first, then weighted score
 *   Explore   diversifyExplore         scored, then repelled by sort
 *
 * ── Builders are product truth ────────────────────────────────────────────
 *
 * Every family is turned into a card by ITS OWN existing builder — the same
 * ones mobile calls. Nothing here decides what a card says, what it dedupes
 * against, when it expires or whether it should exist at all: a builder that
 * returns a suppression is obeyed. That is the rule the invented-pane mistake
 * broke, and this is where it would be easiest to break again.
 *
 * ── Ordering stays desktop's, for now ─────────────────────────────────────
 *
 * `rankFeed` IS mobile's ranker, and using it here is not a convergence of the
 * two ranking systems — the post half still arrives in `useIdeasFeed`'s order
 * and is ranked alongside the machine families by the one function that can
 * compare them. Unifying mobile and desktop arithmetic remains its own change.
 */

export interface AttentionEntry {
  key: string
  card: SignalCard
  /** Present for posts only; the machine families have no feed row. */
  item: ScoredFeedItem | null
  /** Present for posts only. Needed to build panes. */
  input: IdeaInput | null
  /** Which producer this came from, for the workspace router. */
  family:
    | 'post' | 'stale_target' | 'target_hit' | 'conviction' | 'crowding'
    | 'scenario_gap' | 'ready_to_revisit'
    /**
     * The written record against the market: no case on file, a case nobody
     * has revisited, a case the price has outrun, evidence a colleague filed
     * after the case was written. One family, because they are one object and
     * one builder -- `researchSignalTypeFor` splits them into the two SIGNAL
     * TYPES the feed already declares, and the card's own `kindLabel` says
     * which of the five framings it is. Opt-in; see `include`.
     */
    | 'research'
    /**
     * A proposed trade nobody has answered. Opt-in; see `include`.
     *
     * One entry per DECISION REQUEST, never per idea: the same idea reaching
     * two books is two requests, answered separately.
     */
    | 'recommendation'
  /**
   * This candidate's own strength within its signal type, where the type
   * covers meaningfully different findings.
   *
   * Only the research family sets it, for the reason `PriorityInput.base`
   * records: `research_stale` means a case with unanswered evidence against
   * it, a case that has not accounted for a 30% move, AND a case that has
   * simply been quiet, and those are ordered. Null everywhere else, so every
   * family that existed before this field scores bit-for-bit as it did.
   */
  rankBase?: number | null
  /**
   * The structured row the producer returned, for the preview layer.
   *
   * A card is a claim and drops the numbers behind it — a crowding card says
   * "4 books" while its row is holding the weight in each. Carried for
   * presentation only; nothing routes or ranks on it.
   */
  source: PreviewSource | null
}

/** The facts this shell can state about a card, for Curate. */
function factsFor(card: SignalCard, bySymbol: FeedFacets['bySymbol'] | undefined) {
  const symbol = card.entity?.ticker ? card.entity.ticker.toUpperCase() : null
  const f = symbol ? bySymbol?.get(symbol) : undefined
  return {
    category: card.surface ?? null,
    signalTypes: [card.type],
    symbol,
    sector: f?.sector ?? null,
    country: f?.country ?? null,
    exchange: f?.exchange ?? null,
  }
}

/**
 * A card, as the ranker needs it.
 *
 * Read off the BUILT card rather than re-derived from the producer row: the
 * card already carries type, severity, entity and capital, and re-deriving any
 * of them here would be the second source of truth this file exists to avoid.
 */
function rankInputFor(entry: AttentionEntry): PriorityInput {
  const card = entry.card
  const capital = (card as unknown as { capital?: { weightPct?: number | null; held?: boolean } }).capital
  return {
    id: card.id,
    type: card.type,
    severity: card.severity,
    // `occurredAt` lives on provenance: when the underlying thing happened.
    occurredAt: card.provenance?.occurredAt ?? null,
    weightPct: capital?.weightPct ?? null,
    held: capital?.held ?? false,
    /*
     * The one thing the ranker needs that the built card does not carry.
     *
     * Everything above is read off the card, deliberately, so there is no
     * second source of truth. A research framing's own strength is not on the
     * card -- the card has a `kindLabel`, which is a word -- so the producer
     * attaches it to the ENTRY and it is passed straight through. Clamped by
     * `priorityFor`, and it can only reorder within a tier.
     */
    base: entry.rankBase ?? null,
  }
}

/**
 * Rank, then compose. The feed's whole ordering, as one pure function.
 *
 * ── Why this is exported rather than inlined in the hook ──────────────────
 *
 * It was inlined, and the consequence was that the ordering could only be
 * exercised by mounting the hook: a provider tree, an auth session and four
 * live queries. So nothing tested it — and ordering is the risk this surface
 * actually carries. "No case on file" is the most common research condition in
 * this data, so a feed that admits the research family without the tier
 * partition and the composer holding it down would bury a rarer, more urgent
 * finding under eight cards that all say the same thing.
 *
 * That claim is now checkable against the code that makes it instead of
 * against a copy of that code living in a test.
 *
 * Takes entries already narrowed by lens and facets: those are the reader's
 * question, and this is the product's answer to it.
 *
 * ── Ranking is not composition ────────────────────────────────────────────
 *
 * `rankFeed` says how much each candidate deserves attention. It says nothing
 * about what should come NEXT, which is why five legitimate case-versus-price
 * findings once arrived in a row: each individually earned its place and
 * nothing was looking at the sequence.
 *
 * `composeFeed` is that second pass, and it already existed — pure, shared,
 * the same one mobile runs. Desktop simply never called it.
 *
 * It does not touch a score, an eligibility or a severity. It reorders within
 * a bounded neighbourhood: a candidate is only postponed when an alternative
 * exists inside the score tolerance, so a genuinely dominant finding still
 * leads even if three of its family precede it.
 *
 * The bound is the SCORE, not the tier, and deliberately so — `feed-compose`
 * explains that a hard tier partition "forbade every harmless swap across the
 * line, which is most of the variety a mixed feed has available to it", while
 * the score bound keeps the same guarantee honestly: a weak card loses because
 * it is worse, not because a partition said so. Tier still decides the ranked
 * order this pass reads.
 *
 * Five axes, because repetition is not one thing:
 *
 *   family    the product family, finer than the signal type
 *   subject   the ticker, so one name does not own the opening
 *   category  the canonical bucket
 *   question  what the card asks the reader to think about
 *   brief     which lane of the briefing, coarser than all of them
 *
 * Every accessor derives from the card's own type, so a card cannot be one
 * thing to the ranker and another to the composer.
 *
 * Deterministic: same candidates, same scores, same order. No shuffle.
 */
export function orderAttention(eligible: AttentionEntry[], now: number): AttentionEntry[] {
  // Tier first, then weighted score, suppressions dropped. Mobile's ranker.
  const ranked = rankFeed(eligible, e => rankInputFor(e), now)
  return composeFeed(ranked, {
    familyOf: e => e.card.type ?? null,
    subjectOf: e => e.card.entity?.ticker ?? null,
    categoryOf: e => e.card.surface ?? null,
    questionOf: e => readerQuestionFor(e.card.type),
    briefOf: e => briefClassFor(e.card.type),
  }).order.map(r => r.item)
}

/** `quick_thoughts` rows carry prompts too; the feed returns them as one type. */
function isPrompt(item: ScoredFeedItem): boolean {
  const t = item as unknown as { idea_type?: string | null; tags?: string[] | null }
  if (t.idea_type === 'prompt') return true
  return Array.isArray(t.tags) && t.tags.some(tag => tag.startsWith('assignee:'))
}

/**
 * The type lens, over a feed that is no longer only posts.
 *
 * A machine-derived candidate is not a trade idea, a thought or a prompt, so
 * it appears under All and under none of the three narrow lenses. That is the
 * honest placement — coercing a stale target into one of them to make a lens
 * look fuller is the same error as faking facet metadata.
 */
/**
 * Exported for its test, and only for that.
 *
 * Nothing outside this module calls it. It is exported because the two
 * mistakes it can make are both silent: a lens that admits the wrong
 * candidates looks like a thin feed, and a lens that admits none looks like
 * an honest empty state. The author half of this function shipped reading a
 * column that does not exist at this layer and answered empty for every
 * reader, which is indistinguishable from "nobody has posted" unless
 * something asserts the opposite case directly.
 */
export function inLens(entry: AttentionEntry, lens: IdeaLens, viewerId: string | null): boolean {
  if (lens === 'all') return true
  const spec = lensSpec(lens)

  /*
   * ── The signal band ──────────────────────────────────────────────────────
   *
   * Checked before the post gate below, because these lenses select exactly
   * what that gate drops. A machine-derived candidate used to appear under
   * All and under nothing else, which was honest while every other lens was
   * a post type -- it is not honest now that four of them are findings.
   *
   * Matched on the CARD's own type, not on `entry.family`: the family is the
   * producer, and `research` alone emits two types that answer different
   * questions. The card's type is what its eyebrow prints, so the chip and
   * the pill beneath it cannot disagree.
   */
  if (spec.cardTypes) return spec.cardTypes.includes(entry.card.type)

  /*
   * From the team: every post type, narrowed by author.
   *
   * A null viewer is a reader whose identity has not resolved yet, and the
   * answer then is NOTHING rather than everything. Showing the reader their
   * own posts under a chip that says "from the team" for the half second
   * before auth lands is a wrong answer; an empty lens that fills in is a
   * slow one.
   */
  if (spec.othersOnly) {
    if (entry.family !== 'post' || !entry.item) return false
    /* `author.id`, not a `user_id` column. The feed item is the JOINED shape
       the Ideas hooks return -- `BaseIdeaItem.author` is the profile, and the
       row's own owning column never reaches this layer. Reading `user_id`
       here yields undefined on every post, so the lens answers empty for
       everyone, which is how this was caught: zero rows against a feed with
       posts in it. */
    const author = entry.item.author?.id ?? null
    return !!viewerId && !!author && author !== viewerId
  }

  /*
   * `ready_to_revisit` appears under `all` and under no other lens, and
   * that is a decision rather than a side effect.
   *
   * Every other lens — prompts, thoughts, trade ideas — selects a POST TYPE,
   * and the line below drops anything that is not a post. Parked work has
   * no post behind it (`item` is null; it comes from an obligation), so it
   * was being excluded by accident, through a clause written about
   * something else.
   *
   * Left excluded, deliberately: a reader who has narrowed to "prompts" is
   * asking for a kind of post, and answering with a reminder about an idea
   * would be ignoring the question. `all` is the lens that means "whatever
   * needs me", which is exactly what this family is.
   *
   * Stated here so the next person reads a decision instead of inferring
   * one from a `!== 'post'`.
   */
  if (entry.family !== 'post' || !entry.item) return false
  const item = entry.item
  if (lens === 'prompts') return item.type === 'quick_thought' && isPrompt(item)
  if (lens === 'thoughts') return (item.type === 'quick_thought' && !isPrompt(item)) || item.type === 'note'
  const types = spec.types
  return !types || types.includes(item.type)
}

/**
 * Families this feed can produce that the Ideas tab does not ask for.
 *
 * ── Why this is a parameter and not simply on ─────────────────────────────
 *
 * These four conditions are the ones Today, Research and Decisions each raise
 * on their own screen today, and bringing them in here is what lets those
 * screens retire into the feed. That is a change to the Ideas tab's meaning as
 * well as to the Dashboard's, so it is being tried on the Dashboard first: the
 * Ideas tab passes nothing and its candidate pool, its ranking and its two
 * extra queries are exactly what they were.
 *
 * Both default OFF, and the hooks behind them are held unconditionally with
 * `enabled` false -- React forbids a conditional hook, and `enabled: false`
 * costs no request.
 *
 * When the trial is decided this type and the flags go away and the families
 * are simply produced, the way `crowding` is.
 */
export interface AttentionInclude {
  /**
   * The written record: no case, a stale case, a case the price outran, new
   * evidence.
   *
   * Costs NO query. `useDesktopCandidates` has been fetching
   * `useDerivedInsights` all along and already waits for it in its boot latch
   * -- it exposes the rows as `pool.insights` and this feed simply never built
   * cards from them. So this flag decides composition only, and the research
   * family arrives with the rest of the pool rather than reshuffling a feed
   * the reader is already reading.
   */
  research?: boolean
  /**
   * Proposed trades nobody has answered.
   *
   * Sourced from `decision_requests` through `useDecisionScan`, NOT from
   * `useRecommendationCards` -- that producer filters
   * `trade_queue_items.status` on three values the workflow never writes, so
   * it has returned nothing for every reader since it was written. See
   * `lib/signals/decision-recommendation` for the measurement.
   *
   * This one IS a query: the decision scan is not in the candidate pool. It
   * is gated with `enabled`, and its first result is waited for below so a
   * cold load does not paint and then reorder.
   */
  decisions?: boolean
}

export function useDesktopAttentionFeed(
  lens: IdeaLens,
  opts: { facets?: FeedFilter; include?: AttentionInclude } = {},
) {
  const pool = useDesktopCandidates()
  /*
   * Who is reading, for the one lens that narrows by author.
   *
   * No query: `useAuth` is the session already held by the app shell. Every
   * other lens ignores it, and `inLens` treats an unresolved identity as "not
   * yet" rather than as "everyone" -- see the note there.
   */
  const { user } = useAuth()
  const viewerId = user?.id ?? null
  const facets = opts.facets ?? EMPTY_FILTER
  const include = opts.include
  // One query set for every parked-work card on the page, not one per card.
  const revisit = useReadyToRevisit()

  /*
   * Every book the reader can see, because an unanswered request is work
   * wherever it sits. `useDecisionScan(null)` is the Decisions lens's own
   * "all books" call, so this shares its cache entry rather than opening a
   * second read of the same table under a different key.
   */
  const decisions = useDecisionScan(null, { enabled: !!include?.decisions })


  const needsIndex = facets.sectors.length > 0 || facets.countries.length > 0 || facets.exchanges.length > 0
  const { data: facetIndex } = useFeedFacets({ enabled: needsIndex })
  const bySymbol = facetIndex?.bySymbol

  /** Every family, built by its own builder, before any filtering. */
  const built = useMemo(() => {
    const out: AttentionEntry[] = []

    for (const item of pool.feedItems) {
      const input = feedItemToIdeaInput(item as unknown as FeedItemLike)
      const r = buildIdeaCard(input)
      if (r.ok) out.push({ key: r.card.id, card: r.card, item, input, family: 'post', source: null })
    }

    const lenses = pool.lenses as {
      stale?: unknown[]; breaches?: unknown[]; conviction?: unknown[]; crowded?: unknown[]
    } | undefined

    const add = (
      r: { ok: boolean; card?: SignalCard },
      family: AttentionEntry['family'],
      source: PreviewSource | null = null,
      rankBase: number | null = null,
    ) => {
      if (r.ok && r.card) {
        out.push({ key: r.card.id, card: r.card, item: null, input: null, family, source, rankBase })
      }
    }

    for (const s of lenses?.stale ?? []) add(buildStaleTargetCard(s as never), 'stale_target')
    for (const b of lenses?.breaches ?? []) add(buildTargetHitCard(b as never), 'target_hit')
    for (const c of lenses?.conviction ?? []) add(buildConvictionCard(c as never), 'conviction', c as PreviewSource)
    for (const c of lenses?.crowded ?? []) add(buildCrowdingCard(c as never), 'crowding', c as PreviewSource)

    /*
     * Work the reader parked, back on the date they chose.
     *
     * Unlike every family above it, this one is not derived from a lens
     * scanning the book — it comes from a `memory_obligations` row somebody
     * created on purpose. The producer has already applied eligibility (due,
     * resolved, not terminal, not dismissed), so everything arriving here is
     * meant to be shown.
     */
    for (const c of revisit.candidates) {
      if (!isEligible(c)) continue
      add(
        buildReadyToRevisitCard({
          obligationId: c.obligationId,
          tradeQueueItemId: c.ideaId ?? c.subjectId,
          assetId: c.assetId,
          symbol: c.symbol,
          companyName: c.companyName,
          portfolioId: c.portfolioId,
          portfolioName: c.portfolioName,
          parkedAt: c.parkedAt,
          dueAt: c.dueAt,
          daysOverdue: c.daysOverdue,
          waitingFor: c.waitingFor,
          stage: c.stage,
          conviction: c.conviction,
          facts: factsForTile(revisit.factsBySubject, factKeyFor(c)),
          totalFactCount: renderableFacts(
            revisit.factsBySubject.get(factKeyFor(c)) ?? [],
          ).length,
        }),
        'ready_to_revisit',
      )
    }

    /*
     * Scenario cards arrive already BUILT — `useScenarioCards` runs
     * `buildScenarioGapCard` itself — so they are taken as they are rather than
     * rebuilt. Rebuilding would mean a second call site deciding whether a
     * scenario gap fires.
     */
    for (const c of pool.scenarioCards as { ok?: boolean; card?: SignalCard }[]) {
      if (c?.ok && c.card) out.push({ key: c.card.id, card: c.card, item: null, input: null, family: 'scenario_gap', source: null })
      else if ((c as unknown as SignalCard)?.id) {
        const card = c as unknown as SignalCard
        out.push({ key: card.id, card, item: null, input: null, family: 'scenario_gap', source: null })
      }
    }

    /*
     * The written record, measured against the market. Opt-in.
     *
     * Five framings, two signal types, one family -- `researchSignalTypeFor`
     * owns that split and `buildInsightCard` applies it, so nothing is decided
     * here. The rows are `pool.insights`, which the pool has always fetched.
     *
     * `unwrittenPositionCapital` reframes a no-case card when real capital is
     * behind it, from the book the pool already holds, so no query is added
     * for it. The builder refuses the reframe on every framing but `no_case`.
     *
     * `researchBaseFor(issue)` is the framing's own strength, carried on the
     * entry because the card does not hold it. Without it all five framings
     * would rank on one type-level base and a case that has simply been quiet
     * would sort level with one that has unanswered evidence against it --
     * which is the burying problem, in the family most likely to cause it.
     */
    if (include?.research) {
      for (const row of pool.insights as DerivedInsight[]) {
        if (!row?.issue) continue
        add(
          buildInsightCard(
            row,
            unwrittenPositionCapital(pool.lenses?.book ?? null, row.assetId, row.issue.framing),
          ),
          'research',
          null,
          researchBaseFor(row.issue),
        )
      }
    }

    /*
     * A proposed trade nobody has answered. Opt-in.
     *
     * `recommendationInputFrom` decides BOTH halves of this and neither is
     * decided here: whether the request is still waiting (`workOf`, the same
     * predicate the Decisions lens uses, so a request cannot be open on one
     * surface and settled on the other) and how its row maps onto the card's
     * input. Rows it declines return null; rows the builder then suppresses --
     * no readable rationale, a weight outside 0-100, a buy proposing a cut --
     * are obeyed exactly like every other family's suppressions.
     */
    if (include?.decisions) {
      for (const d of decisions.decisions) {
        const input = recommendationInputFrom(d)
        if (input) add(buildRecommendationCard(input), 'recommendation')
      }
    }

    return out
  }, [
    pool.feedItems, pool.lenses, pool.scenarioCards, pool.insights, revisit,
    include?.research, include?.decisions, decisions.decisions,
  ])

  /* Narrowed by the reader's question, then ordered by the product's answer.
     Both halves pure; see `orderAttention`. */
  const entries = useMemo(
    () => orderAttention(
      built
        .filter(e => inLens(e, lens, viewerId))
        .filter(e => matchesFeedFacets(factsFor(e.card, bySymbol), facets)),
      Date.now(),
    ),
    [built, lens, viewerId, facets, bySymbol],
  )

  return {
    entries,
    /*
     * Unresolved identity is LOADING, not empty.
     *
     * The underlying query is `enabled: !!userId && !!organizationId`, and a
     * disabled React Query reports `isLoading: false` — pending but idle. So
     * on a hard refresh, before auth and the org context hydrate, this feed
     * answered "not loading, no entries", and the view correctly rendered an
     * empty state for a feed that had never been asked for.
     *
     * Client navigation never hit it because both were already resolved,
     * which is exactly why it reproduced only on a cold load.
     */
    /*
     * And, where it was asked for, the one producer that is not in the pool.
     *
     * The pool's own latch already covers the research family -- it waits for
     * `useDerivedInsights` on boot -- but nothing waits for the decision scan,
     * so a cold load would paint the feed and then reorder it when the
     * decisions landed. That is the reshuffle `useDesktopCandidates` documents
     * at length.
     *
     * `isFetched` rather than `!isLoading`: it turns true after the first
     * success OR error and stays true, so a failing scan cannot hold the feed
     * shut and a later refetch cannot put it back into loading. The same
     * property the pool's latch provides, without needing one.
     *
     * Vacuous when `include.decisions` is absent, so the Ideas tab's loading
     * behaviour is untouched.
     */
    isLoading: pool.isLoading || !pool.isContextReady
      || (!!include?.decisions && !decisions.isFetched),
    isError: pool.isError,
    retry: pool.retry,
    hasNextPage: pool.hasNextPage,
    isFetchingNextPage: pool.isFetchingNextPage,
    fetchNextPage: pool.fetchNextPage,
  }
}
