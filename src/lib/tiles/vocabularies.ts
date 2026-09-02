import type { EvidenceKind } from '../signals/contract'
import type { ExploreVisual } from '../mobile/explore-visual'
import type { TodayArchetype } from '../today/types'
import type { TileDensity, TileRole, VisualIntent } from './presentation'

/**
 * Translating the four surface dialects into one question.
 *
 * ── Why adapters rather than a rewrite ────────────────────────────────────
 *
 * `VisualIntent` is only worth anything if the vocabularies already in the
 * repo actually collapse onto it. Asserting that in a design note proves
 * nothing; a total function from each existing union, checked exhaustively by
 * the compiler, proves it — and breaks loudly the day somebody adds a member
 * to one of them without deciding what question it answers.
 *
 * These are also how the four surfaces will eventually adopt the contract
 * without a flag day. A surface keeps emitting its own kind, calls the adapter
 * at the edge, and gets an intent it can compose on. Nothing here modifies,
 * imports or depends on the components that own those unions — every import
 * below is `import type` against a pure module in `src/lib`.
 *
 * ── The one union that is not imported ────────────────────────────────────
 *
 * `IdeaVisualKind` lives in `components/ideas-v2/IdeaCard.tsx`, an active
 * frontend file this lane must not touch and a module whose import graph
 * reaches React. `scripts/gallery-purity.mjs` walks that graph and fails on
 * anything that reaches Supabase through it, so pulling a type across that
 * boundary trades a compile-time check for a build-time risk. It is restated
 * below instead and pinned by a test that reads the real declaration, which is
 * the idiom `IdeasWorkspace.test.tsx` already uses to hold `PLOT` in place.
 *
 * Pure — no React, no Supabase. The gallery may import it.
 */

/**
 * Explore's archetypes.
 *
 * The only one of the four written as a question rather than as a widget name,
 * which is why it maps almost one-to-one. The two collapses are deliberate:
 * `last_look` and `price_trend` are both a line over a named window (one
 * anchored to a review, one not), and `quote` is typography rather than a
 * geometry — see the rejection note on `authored_claim`.
 */
export function intentFromExploreVisual(kind: ExploreVisual['kind']): VisualIntent {
  switch (kind) {
    case 'scenario_range': return 'case_vs_price'
    case 'target_compare': return 'target_distance'
    case 'timeline': return 'elapsed_time'
    case 'exposure': return 'portfolio_weight'
    case 'comparison': return 'weight_comparison'
    case 'last_look': return 'price_path'
    case 'price_trend': return 'price_path'
    case 'workflow': return 'workflow_state'
    case 'quote': return 'none'
    case 'none': return 'none'
  }
}

/**
 * The signal contract's evidence kinds.
 *
 * Four widget names and a null. `peer_bar` is the clearest case of the problem
 * this module exists for: the name says "a bar chart of peers", the question
 * is "is this weight right relative to that one", and `ActiveWeightPeers` is
 * only one of three ways the product currently answers it.
 */
export function intentFromEvidenceKind(kind: EvidenceKind): VisualIntent {
  switch (kind) {
    case 'scenario_ladder': return 'case_vs_price'
    case 'timeline': return 'elapsed_time'
    case 'peer_bar': return 'weight_comparison'
    case 'sparkline': return 'price_path'
    case 'none': return 'none'
  }
}

/**
 * Today's archetypes.
 *
 * `aging` and `review-window` split where Explore's `timeline` does not:
 * `aging` is how long something has been unresolved, `review-window` is what
 * the price did over a named window. Despite the adjacent names they answer
 * different questions, and mapping `review-window` to `elapsed_time` on the
 * strength of the word "window" would put a price path under a clock.
 */
export function intentFromTodayArchetype(archetype: TodayArchetype): VisualIntent {
  switch (archetype) {
    case 'scenario': return 'case_vs_price'
    case 'expected-return': return 'target_distance'
    case 'aging': return 'elapsed_time'
    case 'exposure': return 'portfolio_weight'
    case 'review-window': return 'price_path'
    case 'transition': return 'workflow_state'
    case 'metrics': return 'none'
  }
}

/**
 * Ideas' visual kinds, restated rather than imported — see the header.
 *
 * Kept as a separate declaration so a drift between this list and
 * `IdeaCard.tsx` is a test failure with a name, not a silent gap in a switch.
 */
export type IdeaVisualKindLike =
  | 'range' | 'target' | 'sizing' | 'since' | 'exposure' | 'cases' | 'gap'

/**
 * Ideas' visual kinds.
 *
 * `cases` and `gap` both land on `evidence_gap`: one is cases named without
 * prices, the other is inputs the model wanted and did not get, and both are
 * the same claim — somebody started this and stopped.
 */
export function intentFromIdeaVisualKind(kind: IdeaVisualKindLike): VisualIntent {
  switch (kind) {
    case 'range': return 'case_vs_price'
    case 'target': return 'target_distance'
    case 'sizing': return 'weight_comparison'
    case 'since': return 'price_path'
    case 'exposure': return 'portfolio_weight'
    case 'cases': return 'evidence_gap'
    case 'gap': return 'evidence_gap'
  }
}

/**
 * Explore's two-value size, as a role.
 *
 * Explore has no middle band: `exploreCardSize` returns `feature` or
 * `compact`, and the packer's demotions move a card between exactly those two.
 * So `compact` here means Explore's compact, and `standard` is a value Explore
 * simply never produces — which is honest, and is why the round trip below
 * only goes one way.
 */
export function roleFromExploreCardSize(size: 'feature' | 'compact'): TileRole {
  return size === 'feature' ? 'lead' : 'compact'
}

/** Ideas' three bands, which already line up one for one. */
export function roleFromIdeaDensity(density: 'featured' | 'standard' | 'compact'): TileRole {
  switch (density) {
    case 'featured': return 'lead'
    case 'standard': return 'standard'
    case 'compact': return 'compact'
  }
}

/**
 * `DesktopTile`'s four bands, collapsed to three.
 *
 * `large` is the member with one implementation. It maps to `standard` rather
 * than to `lead` because its own comment says what it is for — "`large` gives
 * second place visible second place" — and second place is not the lead. The
 * distinction survives in `DesktopTile`'s own grid spans, which this contract
 * does not touch; what is lost is only the ability to ask for it by name from
 * outside that surface.
 */
export function roleFromDesktopTileSize(
  size: 'hero' | 'large' | 'medium' | 'compact',
): TileRole {
  switch (size) {
    case 'hero': return 'lead'
    case 'large': return 'standard'
    case 'medium': return 'standard'
    case 'compact': return 'compact'
  }
}

/**
 * Back into Ideas' primitive scale, so the shared density can drive the one
 * surface whose primitives already accept it.
 *
 * This is the direction that matters for integration. `RangeChart`,
 * `TargetBar`, `SizingBar`, `SinceOpen`, `ExposureRank`, `CasesUnpriced` and
 * `ModelGap` all take `size?: VisualSize` today, so they become the first
 * primitives a composer can drive without any of them changing.
 */
export function visualSizeForDensity(density: TileDensity): 'lg' | 'md' | 'sm' {
  switch (density) {
    case 'spacious': return 'lg'
    case 'standard': return 'md'
    case 'compact': return 'sm'
  }
}
