import { signalTypeForTemplate } from '../signals/builders/legacy-kinds'
import { insightSignalType } from '../signals/insight-type'
import type { ExploreItem } from './explore-item'
import type { FeedCategory } from './feed-categories'

/**
 * Existing feed data, normalised into previews.
 *
 * ── Why the adapters are pure and live here ───────────────────────────────
 *
 * Every source Explore reads is already fetched for Curate: the lenses, the
 * scenario cards, the derived insights, the ideas feed, the market templates,
 * the news, the attention queue. Explore adds no query of its own for content —
 * it is a second arrangement of the same material, which is the whole reason it
 * can exist without a data programme behind it.
 *
 * The normalisation is pure so it can be tested against fixtures and imported
 * by the gallery, which has no Supabase environment. That is the Phase 6B/7/8.1
 * lesson applied up front rather than after 130 layout assertions fail at once
 * with no test naming the cause.
 *
 * ── On honesty ────────────────────────────────────────────────────────────
 *
 * Nothing here invents a fact. Where a source cannot supply a field the field
 * is absent and the tile renders without it — an absent weight is not 0.0%, an
 * absent author is not "Someone", and a source with no timestamp does not get
 * `Date.now()` so it can look fresh.
 */

const upper = (s: unknown) => String(s ?? '').trim().toUpperCase()

/** Portfolio lenses: targets hit and expired, positions with no target, sizing. */
export function lensesToExplore(lenses: {
  breaches?: any[]; stale?: any[]; untargeted?: any[]; conviction?: any[]; crowded?: any[]
} | null | undefined): ExploreItem[] {
  if (!lenses) return []
  const out: ExploreItem[] = []

  for (const b of lenses.breaches ?? []) {
    const pct = Math.abs(Number(b.overshootPct ?? 0) * 100)
    out.push({
      id: `lens-breach-${b.assetId}`,
      // Keyed on the CONDITION, not on the adapter. A target reached is one
      // artifact however many surfaces describe it.
      dedupeKey: `target_hit:${b.assetId}`,
      signalType: 'target_hit',
      category: 'decisions', subtype: 'signal',
      title: `${b.symbol} passed its target`,
      /**
       * The level, not the distance again.
       *
       * This read "Trading 31% through $118" under a metric of "+31% THROUGH
       * TARGET" — the same figure twice on one card, in two phrasings, and the
       * only new fact in the whole line was the $118. §10: one number per card.
       * The strip in `explore-preview` cannot reach this one because the repeat
       * is mid-sentence rather than leading, and rewriting prose is a copy
       * layer this is deliberately not building. Saying the level plainly is
       * the fix at the source.
       */
      context: `Target $${Number(b.target).toFixed(0)}`,
      symbol: b.symbol, assetId: b.assetId, companyName: b.companyName,
      metric: { value: `+${pct.toFixed(0)}%`, label: 'through target', direction: 'good' },
      // Reaching a target is a good outcome, and Explore should say so rather
      // than filing every decision event under things that have gone wrong.
      positive: true,
      portfolio: { heldInCount: b.heldIn?.length, name: b.heldIn?.[0] },
      occurredAt: b.asOf ?? null,
      destination: { kind: 'action', action: 'review_target', assetId: b.assetId, symbol: b.symbol },
      importance: Math.min(pct / 40, 1),
    })
  }

  for (const t of lenses.stale ?? []) {
    out.push({
      id: `lens-stale-${t.assetId}`,
      dedupeKey: `target_expired:${t.assetId}`,
      signalType: 'target_expired',
      category: 'decisions', subtype: 'signal',
      title: `${t.symbol} target has run past its horizon`,
      context: `${t.overdueMonths} month${t.overdueMonths === 1 ? '' : 's'} past a ${t.timeframe ?? 'stated'} view`,
      symbol: t.symbol, assetId: t.assetId, companyName: t.companyName,
      metric: { value: `$${Number(t.target).toFixed(0)}`, label: 'stated target', direction: 'neutral' },
      portfolio: { heldInCount: t.heldIn?.length, name: t.heldIn?.[0] },
      occurredAt: t.expiredAt ?? null,
      // Time is the trigger, so time is the picture. The lens has both dates
      // and the adapter was flattening them into one prose clause.
      visual: { statedAt: t.statedAt ?? null, dueAt: t.expiredAt ?? null },
      destination: { kind: 'action', action: 'review_target', assetId: t.assetId, symbol: t.symbol },
      importance: Math.min((t.overdueMonths ?? 0) / 12, 1),
    })
  }

  for (const u of lenses.untargeted ?? []) {
    out.push({
      id: `lens-untargeted-${u.assetId}`,
      dedupeKey: `no_target:${u.assetId}`,
      signalType: 'no_target',
      category: 'decisions', subtype: 'signal',
      title: `${u.symbol} has no price target on record`,
      context: `${Number(u.weightPct).toFixed(1)}% of ${u.portfolioName}`,
      symbol: u.symbol, assetId: u.assetId, companyName: u.companyName,
      metric: { value: `${Number(u.weightPct).toFixed(1)}%`, label: 'of the portfolio', direction: 'neutral' },
      portfolio: { weightPct: Number(u.weightPct), heldInCount: u.heldIn?.length, name: u.portfolioName },
      occurredAt: u.asOf ?? null,
      // `target: null` is the finding, stated as a value rather than omitted —
      // see `target_compare`, which draws the absence as a dashed empty slot.
      // The mark was already in hand and was being dropped.
      visual: { currentPrice: Number(u.price) || null, target: null },
      destination: { kind: 'action', action: 'set_target', assetId: u.assetId, symbol: u.symbol },
      importance: Math.min(Number(u.weightPct) / 15, 1),
    })
  }

  for (const g of lenses.conviction ?? []) {
    const over = g.direction === 'overweight'
    out.push({
      id: `lens-conviction-${g.assetId}`,
      dedupeKey: `conviction:${g.assetId}`,
      // The ranker splits conviction by direction; the key never did.
      signalType: g.direction === 'overweight' ? 'conviction_oversized' : 'conviction_undersized',
      category: 'decisions', subtype: 'signal',
      title: `${g.symbol} is ${over ? 'larger' : 'smaller'} than its conviction`,
      context: `${Number(g.weightPct).toFixed(1)}% in ${g.portfolioName}${g.conviction ? ` · conviction ${g.conviction}` : ''}`,
      symbol: g.symbol, assetId: g.assetId, companyName: g.companyName,
      metric: { value: `${Number(g.weightPct).toFixed(1)}%`, label: 'position', direction: 'neutral' },
      portfolio: { weightPct: Number(g.weightPct), name: g.portfolioName },
      occurredAt: g.asOf ?? null,
      /**
       * The index weight, where the book has a benchmark file.
       *
       * Deliberately NOT "conviction as a weight": conviction is stored as a
       * word and there is no intended-weight number anywhere in the model, so
       * a Position-vs-Conviction bar pair would be drawing the comparison the
       * card is about out of thin air. Active weight is a real second number.
       * Null where the book has no file, and the card falls back to exposure.
       */
      visual: { benchmarkPct: g.benchmarkPct ?? null },
      destination: { kind: 'action', action: 'open_asset', assetId: g.assetId, symbol: g.symbol },
      importance: Math.min(Math.abs(Number(g.tension ?? 0)), 1),
    })
  }

  for (const c of lenses.crowded ?? []) {
    out.push({
      id: `lens-crowded-${c.assetId}`,
      dedupeKey: `crowding:${c.assetId}`,
      signalType: 'crowding',
      category: 'decisions', subtype: 'signal',
      title: `${c.symbol} is held across ${c.portfolioCount} portfolios`,
      /**
       * No "Largest weight 3.2%" clause.
       *
       * The tile drew the max weight three times: as this clause, as the
       * exposure bar underneath it, and — until `showWeight` caught it — in the
       * footer. One number, one home. The bar is the better one, because it is
       * the only one of the three that shows the size rather than stating it,
       * and it now names the book the weight is IN: `weightsByPortfolio` is
       * sorted heaviest-first, so `portfolioNames[0]`-style guesswork is not
       * needed and the caption reads "3.2% of Vision Fund" rather than the
       * vaguer "of the book".
       */
      symbol: c.symbol, assetId: c.assetId, companyName: c.companyName,
      metric: { value: `${c.portfolioCount}`, label: 'portfolios', direction: 'neutral' },
      portfolio: {
        weightPct: Number(c.maxWeightPct),
        heldInCount: c.portfolioCount,
        name: c.weightsByPortfolio?.[0]?.name ?? undefined,
      },
      occurredAt: c.asOf ?? null,
      destination: { kind: 'action', action: 'open_asset', assetId: c.assetId, symbol: c.symbol },
      importance: 0.4,
    })
  }

  return out
}

/** Scenario cards, which are already built contract cards. */
export function scenarioCardsToExplore(cards: any[]): ExploreItem[] {
  return (cards ?? []).map(c => ({
    id: `scenario-${c.entity?.id ?? c.id}`,
    dedupeKey: `scenario_gap:${c.entity?.id ?? c.id}`,
    signalType: 'scenario_gap',
    category: 'decisions' as FeedCategory,
    subtype: 'signal' as const,
    title: c.headline,
    context: c.metric?.label,
    symbol: c.entity?.ticker ?? null,
    assetId: c.entity?.id ?? null,
    companyName: c.entity?.name ?? null,
    metric: c.metric
      ? { value: String(c.metric.value), label: c.metric.label, direction: c.metric.direction }
      : undefined,
    occurredAt: c.provenance?.occurredAt ?? null,
    /**
     * The ladder itself, which the builder has held all along.
     *
     * `evidence.data` carries `{ price, cases }` and this adapter kept only
     * `metric.label` — so the one card in Explore whose finding is "the price
     * escaped my modelled range" had no range to draw and fell back to a
     * sparkline like everything else.
     */
    visual: {
      currentPrice: Number(c.evidence?.data?.price) || null,
      cases: (c.evidence?.data?.cases ?? [])
        .map((k: any) => ({ label: String(k?.name ?? k?.label ?? 'Case'), price: Number(k?.price) }))
        .filter((k: any) => Number.isFinite(k.price) && k.price > 0),
    },
    destination: {
      kind: 'action' as const, action: 'open_cases',
      assetId: c.entity?.id ?? null, symbol: c.entity?.ticker ?? null,
    },
    // A card the builder called critical is genuinely more interesting than one
    // it called informational, and the builder computed that from the numbers.
    importance: c.severity === 'critical' ? 0.9 : c.severity === 'attention' ? 0.6 : 0.3,
  }))
}

/** Derived insights: documentation gaps and unreviewed changes. */
export function insightsToExplore(insights: any[]): ExploreItem[] {
  return (insights ?? []).map(i => {
    const moved = i.context?.kind === 'price_move'
    return {
      id: `insight-${i.id}`,
      dedupeKey: `${i.kind}:${i.assetId}`,
      // Insight kinds are their own vocabulary; the cards are not. One
      // function, because this disagreed with the ranker about
      // `concentration` and those tiles could never open.
      signalType: insightSignalType(i.kind),
      category: 'research' as FeedCategory,
      subtype: 'research' as const,
      title: i.headline,
      context: i.portfolioName
        ? `${i.weightPct != null ? `${Number(i.weightPct).toFixed(1)}% of ` : ''}${i.portfolioName}`
        : undefined,
      symbol: i.symbol, assetId: i.assetId, companyName: i.companyName,
      metric: moved
        ? {
            value: `${i.context.movePct >= 0 ? '+' : ''}${Math.round(i.context.movePct)}%`,
            label: 'since last look',
            direction: i.context.movePct >= 0 ? ('good' as const) : ('bad' as const),
          }
        : i.weightPct != null
          ? { value: `${Number(i.weightPct).toFixed(1)}%`, label: 'position', direction: 'neutral' as const }
          : undefined,
      portfolio: { weightPct: i.weightPct ?? undefined, name: i.portfolioName ?? undefined },
      /**
       * A move measured FROM the review, with the review as the anchor.
       *
       * `LAST LOOK → +21% → TODAY` is the claim. A year of closes puts the
       * interesting stretch somewhere in the middle of a line with nothing to
       * mark where anybody stopped paying attention.
       *
       * Absent on the documentation gaps, which have no move — those resolve to
       * exposure, because "you own this much without the work" is what they say.
       */
      visual: moved
        ? { movePct: Number(i.context.movePct), lastLookAt: i.lastTouchedAt ?? null }
        : undefined,
      occurredAt: i.lastTouchedAt ?? null,
      destination: {
        kind: 'action' as const,
        action: i.kind === 'no_thesis' ? 'update_thesis' : 'open_asset',
        assetId: i.assetId, symbol: i.symbol,
      },
      importance: Math.min((i.score ?? 0), 1),
    }
  })
}

/**
 * Posts from the ideas feed: trades, thoughts, notes, thesis updates.
 *
 * Reads `item.asset`, matching the corrected Phase 8.1 mapping. The bug that
 * phase fixed — `e.item` where the entry stored `e.idea` — came from exactly
 * this kind of second adapter written against a guessed shape, so this one
 * takes the post itself rather than a feed entry wrapping it.
 */
export function ideasToExplore(posts: any[]): ExploreItem[] {
  return (posts ?? []).map(p => {
    const type = String(p.type ?? p.item_type ?? '')
    const isTrade = type === 'trade' || type === 'trade_idea'
    // A thesis update is research, not a post about research — the artifact is
    // the thesis. Categorising by what it IS keeps Curate and Explore agreeing.
    const isThesis = type === 'thesis_update' || type === 'research_note'
    const author = authorName(p.author)
    /**
     * The post's own words, resolved ONCE.
     *
     * Three fields were reading the same string independently — `title` fell
     * back to the literal word "Thought", `context` took `content`, and
     * `visual.quote` took `content` again — so an untitled thought rendered a
     * generic headline above its body, and then its body again inside the quote
     * block. Resolving the text here is what lets the three lines below be
     * about three different things.
     */
    const words = String(p.content ?? p.body ?? p.rationale ?? '').trim()
    /** Whether the quote archetype will carry those words. See `exploreVisualFor`. */
    const isQuoted = !isTrade && !!words
    return {
      id: `idea-${p.id}`,
      dedupeKey: `post:${p.id}`,
      // The one family where type and asset do not identify the object: a desk
      // posts many ideas about one name. See `ExploreTarget.objectId`.
      objectId: p.id != null ? String(p.id) : null,
      signalType: ideaSignalType(p.type),
      category: (isThesis ? 'research' : 'ideas') as FeedCategory,
      subtype: isThesis ? ('research' as const) : ('idea' as const),
      title: postTitle(p, { isTrade, author, words }),
      /**
       * The argument, from the field the feed actually populates.
       *
       * `summary` and `body` were the only two read here and `useIdeasFeed`
       * emits neither — a trade idea carries `rationale`, mirrored into
       * `content`; a thought and a thesis update carry `content` alone. So
       * every idea tile fell through to the company-name fallback and read
       * "Trade idea / Target Corporation", which is the whole of what the TGT
       * card was reported for. All four names are accepted because two of them
       * are real and two cost nothing to keep.
       */
      context: postContext(p, { words, quoted: isQuoted }),
      /**
       * Where the proposal has got to, in the words the database uses.
       *
       * `action` and `status` are selected on every trade-idea row and nothing
       * rendered them. Not translated: `buy` is shown as "Buy" rather than
       * mapped to "Long", because the two are not synonyms — an add to an
       * existing short is a buy — and a preview that infers direction from an
       * action would be asserting something the row does not say.
       *
       * `idea` is dropped as a status: it is the default state of an open
       * proposal, and printing "Idea" under a headline reading "Trade idea"
       * spends the card's one state line saying nothing.
       */
      state: ideaState(p),
      /**
       * An idea looks like an idea, and a thought looks like a thought.
       *
       * A trade proposal gets its direction and the stage rail the row already
       * reports; a thought gets its own words as the hero. Neither gets a
       * price chart — §H and §I: "do not add a stock chart unless the idea
       * specifically contains market-move context", and a thought's content IS
       * the content.
       *
       * `isThought` is the absence of a trade shape rather than a type check on
       * a string, because the feed emits `thought`, `note` and bare rows and
       * all three are somebody writing something down.
       */
      visual: isTrade
        ? {
            direction: ideaDirection(p),
            stages: [...IDEA_STAGES],
            activeStage: ideaStageIndex(p),
          }
        : isQuoted
          ? { quote: words }
          : undefined,
      symbol: p.asset?.symbol ?? null,
      assetId: p.asset?.id ?? null,
      companyName: p.asset?.company_name ?? null,
      portfolio: p.portfolio?.name ? { name: p.portfolio.name } : undefined,
      source: author ? ({ kind: 'person' as const, label: author }) : undefined,
      occurredAt: p.created_at ?? p.updated_at ?? null,
      destination: p.asset?.id
        ? { kind: 'action' as const, action: isThesis ? 'update_thesis' : 'open_asset',
            assetId: p.asset.id, symbol: p.asset.symbol }
        : { kind: 'filter' as const, category: 'ideas' as FeedCategory },
      // A colleague publishing something is a positive development by default:
      // it is thinking that has happened, not a gap that has been found.
      positive: true,
      importance: 0.4,
    }
  })
}

/**
 * A post's headline, when the post has no title of its own.
 *
 * ── The three lines, and what each is for ─────────────────────────────────
 *
 * A post tile has a headline, a supporting clause and — for a thought — a quote
 * block. They were all reading the same string: the headline fell back to the
 * literal word "Thought", the clause took `content`, and the quote took
 * `content` again. So the most prominent line on the card said nothing, and the
 * body was printed twice underneath it.
 *
 * The split that gives each one a job:
 *
 *   **headline** — WHO is saying it, and about WHAT. A colleague's view is
 *   attributed before it is read; that is the entire reason `desk` is a
 *   separate surface in the contract.
 *   **quote**    — WHAT they said, in their own words, as the hero.
 *   **clause**   — anything left over that is neither.
 *
 * Nothing is invented. Both halves of the attribution come off the row, and a
 * row missing one falls back rather than filling the gap with a placeholder.
 * A post that HAS a title keeps it: the author wrote a headline, and replacing
 * it with a generated one would be the paraphrasing the feed refuses elsewhere.
 */
export function postTitle(
  p: any,
  ctx: { isTrade: boolean; author: string | null; words: string },
): string {
  const own = String(p?.title ?? p?.headline ?? '').trim()
  if (own) return own

  const subject = p?.asset?.symbol ? String(p.asset.symbol) : null

  /**
   * A proposal says what it proposes.
   *
   * "Trade idea" was the old fallback, on a card whose kind pill and stage rail
   * already say it is a trade idea. The direction and the name are the facts
   * that distinguish one proposal from the next, and `ideaDirection` reads them
   * from the one field that states direction.
   */
  if (ctx.isTrade) {
    const dir = ideaDirection(p)
    const verb = dir === 'buy' ? 'wants to buy' : dir === 'sell' ? 'wants to sell' : 'proposed a trade in'
    if (ctx.author && subject) return `${ctx.author} ${verb} ${subject}`
    if (subject) return `Proposed trade in ${subject}`
    return ctx.author ? `${ctx.author} proposed a trade` : 'Proposed trade'
  }

  if (ctx.author && subject) return `${ctx.author} on ${subject}`
  if (ctx.author) return `${ctx.author} wrote this`

  /**
   * No author and no ticker. The words are all there is, so they become the
   * headline — and `exploreVisualFor` then declines the quote rather than
   * drawing the same sentence a second time.
   */
  if (ctx.words) {
    return ctx.words.length > 90
      ? `${ctx.words.slice(0, 87).replace(/\s+\S*$/, '')}…`
      : ctx.words
  }
  return subject ? `A note on ${subject}` : 'A post'
}

/**
 * The supporting clause, once the quote has had the words.
 *
 * Returns nothing when the only thing available IS the text the quote block is
 * about to draw. `explore-preview` already refuses to print a clause that
 * restates the metric; this is the same rule one field earlier, applied at the
 * source because the adapter is the only thing that knows the two came from one
 * column.
 */
export function postContext(
  p: any,
  ctx: { words: string; quoted: boolean },
): string | undefined {
  const summary = String(p?.summary ?? '').trim()
  if (summary && summary !== ctx.words) return summary
  // A trade idea has no quote block, so its rationale is the clause.
  if (!ctx.quoted && ctx.words) return ctx.words
  return undefined
}

/** Market news, where it is about a name the desk follows. */
export function newsToExplore(news: any[]): ExploreItem[] {
  return (news ?? []).map(n => ({
    id: `news-${n.id ?? n.url}`,
    dedupeKey: `news:${n.id ?? n.url}`,
    // A desk follows several stories about one name on any given day, so the
    // story's own id is what tells them apart — same reason as a post's.
    objectId: n.id != null ? String(n.id) : null,
    signalType: 'news',
    category: 'news' as FeedCategory,
    subtype: 'news' as const,
    title: n.headline ?? n.title ?? '',
    context: n.summary ?? undefined,
    symbol: n.primarySymbol ?? null,
    assetId: n.assetId ?? null,
    source: n.source ? { kind: 'market' as const, label: String(n.source) } : undefined,
    occurredAt: n.publishedAt ?? n.published_at ?? null,
    /**
     * The story, where there is one to open.
     *
     * The URL was dropped here and the destination fell back to the ASSET when
     * a ticker had been matched — so tapping a headline left Explore for the
     * asset page, which is a different thing from reading the story. Where
     * there is no URL the old fallbacks stand.
     */
    destination: n.url
      ? {
          kind: 'article' as const,
          url: String(n.url),
          title: n.headline ?? n.title ?? null,
          source: n.source ? String(n.source) : null,
          assetId: n.assetId ?? null,
          symbol: n.primarySymbol ?? null,
        }
      : n.assetId
        ? { kind: 'action' as const, action: 'open_asset', assetId: n.assetId, symbol: n.primarySymbol }
        : { kind: 'filter' as const, category: 'news' as FeedCategory },
    importance: 0.25,
  }))
}

/** Market templates: unusual moves, earnings, corporate actions, releases. */
export function templatesToExplore(cards: any[]): ExploreItem[] {
  return (cards ?? []).map(c => ({
    id: `tpl-${c.id ?? `${c.kind}-${c.symbol}`}`,
    dedupeKey: `${c.kind}:${c.assetId ?? c.symbol ?? c.id}`,
    // `economic` is not `economic_release`, and `active_risk` is not in the map
    // at all — both are exactly why this goes through one function.
    signalType: signalTypeForTemplate(c.kind),
    category: 'news' as FeedCategory,
    subtype: 'news' as const,
    title: c.headline ?? '',
    context: c.body ?? undefined,
    symbol: c.symbol ?? null,
    assetId: c.assetId ?? null,
    metric: c.metric ? { value: String(c.metric), label: c.metricLabel, direction: c.tone === 'negative' ? 'bad' : 'neutral' } : undefined,
    source: { kind: 'market' as const, label: 'Market' },
    occurredAt: c.occurredAt ?? null,
    destination: c.assetId
      ? { kind: 'action' as const, action: 'open_asset', assetId: c.assetId, symbol: c.symbol }
      : { kind: 'filter' as const, category: 'news' as FeedCategory },
    importance: 0.3,
  }))
}

/**
 * The attention queue, split the way Phase 8.1's taxonomy splits it.
 *
 * ── Why these tiles were the thinnest on the page ─────────────────────────
 *
 * A workflow item is a request with a DEADLINE, and this adapter carried no
 * metric, no state and no visual — so the one fact that makes the tile worth a
 * cell, `due_at`, never reached it. Every workflow card in Explore was a
 * headline and a clause, resolving to `kind: 'none'`, while `project_overdue`
 * and `awaiting_review` had been in `TIME_DRIVEN` since the archetypes were
 * written and would have drawn a timeline the moment they were given the dates.
 *
 * Nothing new is invented here and no new archetype is added. The three fields
 * below are the same ones `buildAttentionCard` already computes for the Curate
 * card from the same row — raised date, due date, days either side of it — so
 * the two surfaces now say the same thing about the same item.
 */
export function attentionToExplore(items: any[], now: number = Date.now()): ExploreItem[] {
  return (items ?? []).map(a => {
    const isTrade = a.source_type === 'trade_queue_item'
    const raisedAt = a.created_at ?? a.last_activity_at ?? null
    const dueAt = a.due_at ?? null
    const dueMs = dueAt ? new Date(dueAt).getTime() : NaN
    const dueDays = Number.isFinite(dueMs)
      ? Math.round((dueMs - now) / 86_400_000)
      : null
    return {
      id: `attn-${a.attention_id}`,
      dedupeKey: `attention:${a.attention_id}`,
      signalType: a.source_type === 'trade_queue_item' ? 'recommendation'
        : a.source_type === 'project' || a.source_type === 'project_deliverable' ? 'project_overdue'
        : 'awaiting_review',
      category: (isTrade ? 'decisions' : 'workflow') as FeedCategory,
      subtype: isTrade ? ('signal' as const) : ('workflow' as const),
      title: a.title ?? a.summary ?? 'Awaiting you',
      context: a.summary && a.title ? a.summary : undefined,
      /**
       * The deadline, said the way the Curate card says it.
       *
       * Overdue is `bad`; a deadline still ahead is neutral, because a task
       * with three days left is not a problem and colouring it as one is how a
       * page of amber teaches a reader to ignore amber.
       */
      metric: dueDays != null
        ? {
            value: `${Math.abs(dueDays)}d`,
            label: dueDays < 0 ? 'overdue' : 'until due',
            direction: dueDays < 0 ? ('bad' as const) : ('neutral' as const),
          }
        : undefined,
      /**
       * What the item is waiting for, only where that is a LABEL.
       *
       * `next_action` is free text and routinely a whole sentence. The state
       * line is one short categorical row; a truncated sentence there reads as
       * a rendering fault, which is the same conclusion `legacy-kinds` reached
       * for the Curate card's chip row. The full text stays in `context`.
       */
      state: shortNextAction(a.next_action),
      symbol: a.context?.symbol ?? null,
      assetId: a.context?.asset_id ?? null,
      source: a.owner_name ? { kind: 'person' as const, label: a.owner_name } : undefined,
      occurredAt: raisedAt,
      /**
       * Raised → due → today, through the existing `timeline` archetype.
       *
       * `exploreVisualFor` only draws it for a `TIME_DRIVEN` type with both
       * dates present, so a trade-queue item (which is a `recommendation`, not
       * a clock) and an item with no deadline both fall through exactly as they
       * did before.
       */
      visual: raisedAt && dueAt ? { statedAt: raisedAt, dueAt } : undefined,
      destination: a.context?.asset_id
        ? { kind: 'action' as const, action: 'open_asset', assetId: a.context.asset_id, symbol: a.context?.symbol }
        : { kind: 'filter' as const, category: (isTrade ? 'decisions' : 'workflow') as FeedCategory },
      importance: a.priority === 'high' ? 0.6 : 0.3,
    }
  })
}

/**
 * A `next_action` short enough to be a label rather than a sentence.
 *
 * The same 26-character bar `legacy-kinds` applies to the Curate card's chip
 * row, and for the same reason: "Update thesis, rating, or research for this
 * covered name" is prose, and prose in a categorical slot looks broken.
 */
export function shortNextAction(next: unknown): string | undefined {
  const t = String(next ?? '').trim().replace(/[.!;:,]+$/, '').trim()
  if (!t || t.length > 26) return undefined
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Aggregate tiles, and only where the underlying items genuinely exist.
 *
 * "4 new ideas this week" is worth a tile because it stands for four things the
 * reader can go and read; the same four rendered as four near-identical small
 * tiles is the monotony this surface exists to avoid. It routes to the filtered
 * Explore surface rather than nowhere — an aggregate that is a dead end is
 * worse than no aggregate.
 *
 * Never fabricated: the count is the count of items actually in hand, and the
 * tile is omitted below `MIN_AGGREGATE` because "2 new ideas" is not a
 * discovery, it is two tiles.
 */
const MIN_AGGREGATE = 3
const AGGREGATE_WINDOW_DAYS = 7

export function aggregatesFor(items: ExploreItem[], now: number): ExploreItem[] {
  const recent = items.filter(i => {
    if (!i.occurredAt) return false
    const t = new Date(i.occurredAt).getTime()
    return Number.isFinite(t) && now - t <= AGGREGATE_WINDOW_DAYS * 86_400_000
  })

  const out: ExploreItem[] = []
  const groups: { category: FeedCategory; label: (n: number) => string }[] = [
    { category: 'ideas', label: n => `${n} new ideas this week` },
    { category: 'research', label: n => `${n} research updates this week` },
  ]

  for (const g of groups) {
    const n = recent.filter(i => i.category === g.category).length
    if (n < MIN_AGGREGATE) continue
    out.push({
      id: `agg-${g.category}`,
      dedupeKey: `aggregate:${g.category}`,
      // No single card behind it, by design — see the aggregate behaviour.
      signalType: null,
      category: g.category,
      subtype: 'aggregate',
      title: g.label(n),
      count: n,
      // The newest member's timestamp, so an aggregate of stale things does not
      // present itself as fresh.
      occurredAt: recent
        .filter(i => i.category === g.category)
        .map(i => i.occurredAt!)
        .sort()
        .reverse()[0] ?? null,
      destination: { kind: 'filter', category: g.category },
      importance: 0.5,
      positive: true,
    })
  }
  return out
}

/** Every symbol an Explore page would like a sparkline for, in page order. */
export function exploreSymbols(items: ExploreItem[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const i of items) {
    const s = upper(i.symbol)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/**
 * Whether a post is a trade idea or a thought.
 *
 * One test, exported, because there were two and they disagreed: this file
 * accepted `'trade'` or `'trade_idea'` while the feed's ranker accepted only
 * `'trade'`. A post stored under the longer name therefore ranked as a thought
 * and tiled as a trade idea — the filter offered a "Thought" pill that selected
 * trade-idea tiles, and the Explore matcher could not resolve one back to its
 * feed entry because the two sides had given it different types.
 */
export function ideaSignalType(type: unknown): 'trade_idea' | 'thought' {
  return type === 'trade' || type === 'trade_idea' ? 'trade_idea' : 'thought'
}

/**
 * A person's name, from the shape the feed actually emits.
 *
 * `useIdeasFeed` builds every author as `{ id, email, first_name, last_name }`
 * and this file read `author.name` and `author.full_name` — neither of which
 * exists on that object. So no idea tile ever carried an author, and the source
 * line that distinguishes a colleague's post from a machine-generated one was
 * silently blank on the entire category.
 *
 * Falls through to the email's local part rather than to nothing: a name is
 * better, and `mwebb` still tells the reader a person is behind the post.
 * Returns null rather than inventing a placeholder when even that is missing.
 */
export function authorName(author: any): string | null {
  if (!author) return null
  const given = author.name ?? author.full_name
  if (typeof given === 'string' && given.trim()) return given.trim()
  const parts = [author.first_name, author.last_name].filter(Boolean).map(String)
  if (parts.length) return parts.join(' ').trim()
  const email = typeof author.email === 'string' ? author.email.split('@')[0] : ''
  return email.trim() || null
}

/** Title Case for a single database token: `awaiting_review` → `Awaiting review`. */
const titleize = (s: string) =>
  s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

/**
 * A proposal's state line: what it proposes, and where it has got to.
 *
 * Never invented — both halves are omitted independently when the row does not
 * carry them, so a post with no action and no status renders no state line at
 * all rather than a hedged one.
 */
/**
 * The stages a proposal moves through, as the product names them.
 *
 * Short enough to label a four-segment rail on half a phone width. Taken from
 * the `status` vocabulary the ideas feed already writes rather than invented:
 * an unrecognised status lands at stage 0, which reads as "open" and claims no
 * progress the row does not report.
 */
export const IDEA_STAGES = ['Idea', 'Modeling', 'Deciding', 'Done'] as const

const STAGE_OF: Record<string, number> = {
  idea: 0, open: 0, draft: 0,
  modeling: 1, modelling: 1, research: 1, analysis: 1,
  deciding: 2, review: 2, pending: 2, proposed: 2,
  done: 3, accepted: 3, executed: 3, closed: 3, rejected: 3,
}

export function ideaStageIndex(p: any): number {
  const raw = String(p?.status ?? '').toLowerCase().trim()
  return STAGE_OF[raw] ?? 0
}

/**
 * Buy or sell, only where the row says so.
 *
 * Deliberately not inferred from anything else. `action` is the one field that
 * states direction, and a preview that guessed it from a thesis would be
 * asserting a trade nobody proposed.
 */
export function ideaDirection(p: any): 'buy' | 'sell' | undefined {
  const raw = String(p?.action ?? '').toLowerCase().trim()
  if (raw === 'buy' || raw === 'add' || raw === 'long') return 'buy'
  if (raw === 'sell' || raw === 'trim' || raw === 'short' || raw === 'exit') return 'sell'
  return undefined
}

export function ideaState(p: any): string | undefined {
  const parts: string[] = []
  if (p?.action) parts.push(titleize(String(p.action)))
  // `idea` is the default state of an open proposal and says nothing beside a
  // headline that already reads "Trade idea".
  if (p?.status && String(p.status) !== 'idea') parts.push(titleize(String(p.status)))
  return parts.length ? parts.join(' · ') : undefined
}
