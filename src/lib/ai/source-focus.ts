/**
 * Where each AI research source opens on the Asset page.
 *
 * ── Why this is a module and not a literal inside AISection ───────────────
 *
 * The research trail renders one row per record the assistant read, and every
 * row is a link. A link that opens the asset but lands nowhere in particular
 * looks identical to a working one: the asset tab opens, and the reader is
 * left on whatever sub-page they last used. That is exactly what happened
 * when the two process kinds pointed at `framework` -- which names the PRICE
 * framework (scenarios and targets), not the process one, and which
 * `AssetTab`'s focus effect ignores for landing.
 *
 * So the table lives here, next to the one fact that makes it checkable: the
 * set of focus values `AssetTab` actually honours. A kind pointed at anything
 * outside that set is a dead link, and the test for this module says so.
 */
import { SUBPAGE_MODE, type AssetMode, type AssetSubPage } from '../asset-workspace/modes'
import { openAsset, type AssetFocus } from '../desktop-asset'

/** Every source kind the final event can carry. Mirrors `AiSourceKind`. */
export type AiResearchSourceKind =
  | 'asset' | 'note' | 'contribution' | 'price_target' | 'portfolio' | 'theme'
  | 'recommendation' | 'decision_request' | 'accepted_trade'
  | 'decision_review' | 'outcome' | 'workflow' | 'checklist_item'
  | 'idea'

/**
 * Which sub-page each focus lands on.
 *
 * This mirrors the focus effect in `AssetTab` (search for `asset.focus`), and
 * it is a mirror rather than the source because that effect also consumes the
 * request id and writes tab state -- behaviour that does not belong in a
 * lookup table. `framework` is absent deliberately: the effect's own comment
 * records that `framework` and anything unrecognised leave the saved page
 * alone, so nothing may route a link through it.
 */
export const FOCUS_LANDING_SUBPAGE: Readonly<Partial<Record<AssetFocus, AssetSubPage>>> =
  Object.freeze({
    research: 'research',
    decisions: 'decisions',
    overview: 'snapshot',
    position: 'snapshot',
  })

/**
 * Where each kind is read. A routing table over surfaces that already exist,
 * not a new surface.
 *
 * The four decision kinds and the two process kinds all go to `decisions`,
 * which is the only focus that reaches the Work surface: `AssetTab` maps it to
 * the `decisions` sub-page, `SUBPAGE_MODE` puts that in `work`, and it is also
 * Work's own landing. A committed trade goes to `position` because the Trade
 * Book row is read against the holding.
 */
export const FOCUS_BY_SOURCE_KIND: Readonly<Record<AiResearchSourceKind, AssetFocus>> =
  Object.freeze({
    asset: 'overview',
    note: 'research',
    contribution: 'research',
    price_target: 'overview',
    portfolio: 'overview',
    theme: 'overview',
    recommendation: 'decisions',
    decision_request: 'decisions',
    decision_review: 'decisions',
    outcome: 'decisions',
    accepted_trade: 'position',
    workflow: 'decisions',
    checklist_item: 'decisions',
    /* An idea is worked on the Work surface, which `decisions` is the only
       focus to reach. Not `overview`: landing a reader on the snapshot when
       they clicked a specific idea is the vaguely-related link this table
       exists to prevent. A deep link to the Idea Pipeline itself would be
       better still and needs a non-asset destination, which this routing
       table cannot express yet. */
    idea: 'decisions',
  })

/** The focus for a kind, falling back to the asset's own overview. */
export function focusForSourceKind(kind: string): AssetFocus {
  return (FOCUS_BY_SOURCE_KIND as Record<string, AssetFocus>)[kind] ?? 'overview'
}

/**
 * Follow one cited source to the page it is read on.
 *
 * ── Why the navigation moved out of the component ─────────────────────────
 *
 * `SourceRef` held this inline as its default, and `AISection` had no way to
 * reach it: the only hook the component offers is `onOpenSource`, which
 * REPLACES the default rather than wrapping it. So a host that wanted to do
 * anything either side of the hop -- in this case, step out of expanded
 * research mode so the reader can actually see where they landed -- had to
 * re-implement the routing, and a second copy of a routing table is how one
 * of them starts sending a `workflow` source to the wrong sub-page.
 *
 * One function, called by the component's default and by the host's wrapper.
 *
 * Returns false for a source with no asset to open, so a caller can tell
 * "nothing happened" from "we navigated" rather than assuming.
 */
export function openSourceRef(
  source: { asset_id?: string | null; symbol?: string | null; kind?: string | null },
  origin = 'ai-research-trail',
): boolean {
  if (!source.asset_id) return false
  /* No focusRequestId here: `assetTabFor` stamps one per call, which is what
     lets the receiver tell a new intent from a remounted tab. */
  openAsset({
    assetId: source.asset_id,
    symbol: source.symbol ?? null,
    focus: focusForSourceKind(source.kind ?? ''),
    origin,
  })
  return true
}

/**
 * The mode a kind's link actually lands in, or null if it lands nowhere.
 *
 * Null is the dead-link case the test asserts never happens: it means the
 * focus has no landing sub-page, so the asset opens and the sub-page is
 * whatever the reader left behind.
 */
export function landingModeForSourceKind(kind: string): AssetMode | null {
  const sub = FOCUS_LANDING_SUBPAGE[focusForSourceKind(kind)]
  return sub ? SUBPAGE_MODE[sub] : null
}
