import { useMemo } from 'react'
import { buildIdeaCard, type IdeaInput } from '../lib/signals/builders/ideas'
import {
  buildStaleTargetCard, buildTargetHitCard, buildConvictionCard, buildCrowdingCard,
} from '../lib/signals/builders'
import { feedItemToIdeaInput, type FeedItemLike } from '../lib/signals/feed-item-input'
import { rankFeed, type PriorityInput } from '../lib/signals/feed-priority'
import { matchesFeedFacets } from '../lib/signals/facet-match'
import { lensSpec, type IdeaLens } from '../lib/desktop-ideas/lens'
import { useDesktopCandidates } from './useDesktopCandidates'
import { EMPTY_FILTER, useFeedFacets, type FeedFacets, type FeedFilter } from './mobile/useFeedFacets'
import type { SignalCard } from '../lib/signals/contract'
import type { ScoredFeedItem } from './ideas/types'

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
  family: 'post' | 'stale_target' | 'target_hit' | 'conviction' | 'crowding' | 'scenario_gap'
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
function rankInputFor(card: SignalCard): PriorityInput {
  const capital = (card as unknown as { capital?: { weightPct?: number | null; held?: boolean } }).capital
  return {
    id: card.id,
    type: card.type,
    severity: card.severity,
    // `occurredAt` lives on provenance: when the underlying thing happened.
    occurredAt: card.provenance?.occurredAt ?? null,
    weightPct: capital?.weightPct ?? null,
    held: capital?.held ?? false,
  }
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
function inLens(entry: AttentionEntry, lens: IdeaLens): boolean {
  if (lens === 'all') return true
  if (entry.family !== 'post' || !entry.item) return false
  const item = entry.item
  if (lens === 'prompts') return item.type === 'quick_thought' && isPrompt(item)
  if (lens === 'thoughts') return (item.type === 'quick_thought' && !isPrompt(item)) || item.type === 'note'
  const types = lensSpec(lens).types
  return !types || types.includes(item.type)
}

export function useDesktopAttentionFeed(
  lens: IdeaLens,
  opts: { facets?: FeedFilter } = {},
) {
  const pool = useDesktopCandidates()
  const facets = opts.facets ?? EMPTY_FILTER

  const needsIndex = facets.sectors.length > 0 || facets.countries.length > 0 || facets.exchanges.length > 0
  const { data: facetIndex } = useFeedFacets({ enabled: needsIndex })
  const bySymbol = facetIndex?.bySymbol

  /** Every family, built by its own builder, before any filtering. */
  const built = useMemo(() => {
    const out: AttentionEntry[] = []

    for (const item of pool.feedItems) {
      const input = feedItemToIdeaInput(item as unknown as FeedItemLike)
      const r = buildIdeaCard(input)
      if (r.ok) out.push({ key: r.card.id, card: r.card, item, input, family: 'post' })
    }

    const lenses = pool.lenses as {
      stale?: unknown[]; breaches?: unknown[]; conviction?: unknown[]; crowded?: unknown[]
    } | undefined

    const add = (r: { ok: boolean; card?: SignalCard }, family: AttentionEntry['family']) => {
      if (r.ok && r.card) out.push({ key: r.card.id, card: r.card, item: null, input: null, family })
    }

    for (const s of lenses?.stale ?? []) add(buildStaleTargetCard(s as never), 'stale_target')
    for (const b of lenses?.breaches ?? []) add(buildTargetHitCard(b as never), 'target_hit')
    for (const c of lenses?.conviction ?? []) add(buildConvictionCard(c as never), 'conviction')
    for (const c of lenses?.crowded ?? []) add(buildCrowdingCard(c as never), 'crowding')

    /*
     * Scenario cards arrive already BUILT — `useScenarioCards` runs
     * `buildScenarioGapCard` itself — so they are taken as they are rather than
     * rebuilt. Rebuilding would mean a second call site deciding whether a
     * scenario gap fires.
     */
    for (const c of pool.scenarioCards as { ok?: boolean; card?: SignalCard }[]) {
      if (c?.ok && c.card) out.push({ key: c.card.id, card: c.card, item: null, input: null, family: 'scenario_gap' })
      else if ((c as unknown as SignalCard)?.id) {
        const card = c as unknown as SignalCard
        out.push({ key: card.id, card, item: null, input: null, family: 'scenario_gap' })
      }
    }

    return out
  }, [pool.feedItems, pool.lenses, pool.scenarioCards])

  const entries = useMemo(() => {
    const now = Date.now()
    const eligible = built
      .filter(e => inLens(e, lens))
      .filter(e => matchesFeedFacets(factsFor(e.card, bySymbol), facets))
    // Tier first, then weighted score, suppressions dropped. Mobile's ranker.
    return rankFeed(eligible, e => rankInputFor(e.card), now).map(r => r.item)
  }, [built, lens, facets, bySymbol])

  return {
    entries,
    isLoading: pool.isLoading,
    hasNextPage: pool.hasNextPage,
    isFetchingNextPage: pool.isFetchingNextPage,
    fetchNextPage: pool.fetchNextPage,
  }
}
