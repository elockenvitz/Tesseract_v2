import type { FeedCategory } from './feed-categories'

/**
 * A preview, not a decision card.
 *
 * ── Why this is a separate contract from `SignalCard` ─────────────────────
 *
 * Curate and Explore answer different questions. Curate asks "what deserves my
 * attention", and its card is a complete decision object: a claim, its
 * evidence, the question it raises, a judgment control and an action bar, in
 * exactly one viewport. Explore asks "what might be interesting", and the unit
 * of that is a glance — twenty of them on a screen, none of which is asking the
 * reader to commit to anything.
 *
 * Shrinking a `SignalCard` to fit a mosaic cell would produce neither. It would
 * carry a VerdictBar the reader cannot sensibly answer at that size, an action
 * bar with nowhere to put it, and an interactive chart competing for the same
 * horizontal gesture the grid needs. So the preview is its own shape, and the
 * rich surface is what a tap reaches.
 *
 * ── What it deliberately does NOT have ────────────────────────────────────
 *
 * No actions, no judgment, no evidence node, no expiry, no disposition. A tile
 * that can be answered is a Curate card wearing a smaller font; the whole point
 * of the mode split is that discovery is low-friction and commitment is not.
 */

/** What sort of thing this is, within its category. Drives the tile variant. */
export type ExploreSubtype =
  | 'signal'      // a card-shaped finding about a position
  | 'research'    // a thesis, note or documentation state
  | 'idea'        // something a colleague posted
  | 'news'        // something that happened in the market
  | 'workflow'    // assigned work
  | 'aggregate'   // "4 new ideas this week" — routes to a filtered list

/**
 * How much room the tile gets.
 *
 * Deterministic and earned, never assigned to make the page look varied. See
 * `exploreCardSize` in `explore-layout.ts` for the rules — this field carries
 * that decision through to the DOM, and is not where it is made.
 */
export type ExploreEmphasis = 'standard' | 'feature'

export interface ExploreItem {
  /** Stable across renders. Used as the React key and the tie-breaker. */
  id: string
  /**
   * What this preview is ABOUT, as one string.
   *
   * The dedupe identity, and deliberately not the id: the same thesis update
   * can arrive through the research adapter and the team-activity adapter with
   * two different ids and be the same artifact. See `dedupeExplore`.
   */
  dedupeKey: string
  /**
   * The canonical signal type this preview stands for.
   *
   * ── Why this is not read off `dedupeKey` ────────────────────────────────
   *
   * It was, and it could not work. A dedupe key is a dedupe key: the adapters
   * built theirs from whatever local vocabulary was to hand — `conviction`,
   * `post`, `attention`, `economic`, and each insight's own `kind`. None of
   * those are `SignalType` values, so a matcher comparing the prefix against
   * the ranked type failed for whole families of tile, and tapping them fell
   * through to "this one lives on its own surface" even though a perfectly
   * good Level-2 card existed.
   *
   * Declaring it makes the contract explicit rather than inferred from the
   * shape of a string that was never meant to carry it. Null for aggregates,
   * which genuinely have no single card behind them.
   */
  signalType: string | null

  /** The Phase 8.1 canonical category. One taxonomy, shared with Curate. */
  category: FeedCategory
  subtype: ExploreSubtype

  /** Short and specific. One line at tile width. */
  title: string
  /** One clause of context. Clamped by the tile; never a paragraph. */
  context?: string

  /** The asset, where there is one. Aggregates and macro items have none. */
  symbol?: string | null
  assetId?: string | null
  companyName?: string | null

  /** The one number worth glancing at, already formatted. */
  metric?: { value: string; label?: string; direction?: 'good' | 'bad' | 'neutral' }

  /**
   * Where the underlying object stands, in its own vocabulary.
   *
   * ── Why this is not folded into `context` ────────────────────────────────
   *
   * A trade idea's preview was a headline of "Trade idea" over a company name,
   * because `ideasToExplore` read `p.summary` and `p.body` and the feed emits
   * neither. Meanwhile the same row carried `action` and `status` — the two
   * facts that distinguish one proposal from another — and nothing rendered
   * them. The card was under-informative while holding the information.
   *
   * `context` is a clause about the subject; this is the object's own state,
   * and they answer different questions ("what is this about" against "where
   * has it got to"). Printed as one line they would compete for the same
   * clamp, and the state — which is short, categorical and the reason the
   * reader is scanning — would lose to whatever prose the adapter had.
   *
   * Never invented. Absent whenever the source has no status to report, which
   * is every card that is not a proposal.
   */
  state?: string

  /**
   * Who or what produced this, for the source line and for source diversity.
   *
   * Team activity lives HERE rather than as a category. "Sarah updated the NVDA
   * thesis" is a Research item whose source is Sarah — making Team a sixth
   * top-level category would fork the taxonomy Phase 8.1 spent a phase
   * unifying, for something that is an attribute of an item rather than a kind
   * of item.
   */
  source?: { kind: 'person' | 'portfolio' | 'market' | 'system'; label: string }

  /** Position context, where the item has it. A facet, never a category. */
  portfolio?: { weightPct?: number; heldInCount?: number; name?: string }

  /** ISO. When the underlying thing happened, for bounded freshness. */
  occurredAt?: string | null

  /**
   * Where a tap goes, in the Phase 4 grammar.
   *
   * A key plus its context rather than a resolved target, so `resolveFeedAction`
   * stays the single answer to "where does this go" for both modes. A second
   * route grammar for Explore is exactly the kind of divergence that produced
   * two filter taxonomies.
   */
  destination:
    | { kind: 'action'; action: string; assetId?: string | null; symbol?: string | null; name?: string | null }
    | { kind: 'tab'; target: { id: string; title: string; type: string; data: Record<string, unknown> } }
    /** Aggregates route to the filtered Explore surface rather than nowhere. */
    | { kind: 'filter'; category: FeedCategory }
    /**
     * An external story, opened in the reader the feed already uses.
     *
     * ── Why this destination has to exist ────────────────────────────────
     *
     * A news preview knew its headline, its source and its age, and the
     * normaliser dropped the one identifier that makes it openable — the URL.
     * With nothing to resolve to, the destination fell back to `open_asset`
     * where a ticker had been matched and to a CATEGORY FILTER where one had
     * not, so tapping a story either left the page for the asset or silently
     * re-filtered the grid the reader was already looking at.
     *
     * `ArticleReader` is the surface the Curate news card opens. Explore
     * reuses it rather than gaining a second one.
     */
    | {
        kind: 'article'
        url: string
        title?: string | null
        source?: string | null
        assetId?: string | null
        symbol?: string | null
      }

  /**
   * A bounded nudge from Curate's ranking, 0–1.
   *
   * Explore is not a re-sorted Curate, but a genuine bear-case breach is more
   * interesting than a routine one and the ranking already knows that.
   * Deliberately capped in `scoreExplore` so importance informs discovery
   * without recreating the Curate order.
   */
  importance?: number

  /** True when the item is a positive or neutral development, not a gap. */
  positive?: boolean

  /** For aggregates: how many things it stands for. */
  count?: number
}

/** Everything a tile needs to render, after composition has had its say. */
export interface ComposedExploreItem {
  item: ExploreItem
  emphasis: ExploreEmphasis
  /** The score it was placed with. Development and debugging only. */
  score: number
}
