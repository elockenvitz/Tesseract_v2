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
import type { AssetFocus } from '../desktop-asset'

/** Every source kind the final event can carry. Mirrors `AiSourceKind`. */
export type AiResearchSourceKind =
  | 'asset' | 'note' | 'contribution' | 'price_target' | 'portfolio' | 'theme'
  | 'recommendation' | 'decision_request' | 'accepted_trade'
  | 'decision_review' | 'outcome' | 'workflow' | 'checklist_item'

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
  })

/** The focus for a kind, falling back to the asset's own overview. */
export function focusForSourceKind(kind: string): AssetFocus {
  return (FOCUS_BY_SOURCE_KIND as Record<string, AssetFocus>)[kind] ?? 'overview'
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
