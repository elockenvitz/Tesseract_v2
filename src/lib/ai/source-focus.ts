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
 * `AssetTab`'s focus effect then ignored for landing. (It no longer ignores
 * it: `framework` lands on research. The table below is total over
 * `AssetFocus` for the first time, so no focus value is a dead link.)
 *
 * So the table lives here, next to the one fact that makes it checkable: the
 * set of focus values `AssetTab` actually honours. A kind pointed at anything
 * outside that set is a dead link, and the test for this module says so.
 */
import { SUBPAGE_MODE, type AssetMode, type AssetSubPage } from '../asset-workspace/modes'
import { openAsset, type AssetFocus, type AssetSectionTarget } from '../desktop-asset'

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
 * lookup table.
 *
 * It is now TOTAL over `AssetFocus` -- every member maps to a sub-page --
 * which is new. `framework` was the hole: it mapped to nothing, and the test
 * for this module exists to catch a source kind routed through it. The hole
 * is closed by giving it a landing rather than by deleting the member,
 * because the member is not dead -- `FOCUS_FOR_FAMILY.scenario_gap` sends it
 * into the dashboard pane, where it is the one focus that puts the ladder
 * above the case. See the note on `ASSET_FOCUSES`.
 *
 * The `Partial` stays. A future sixth focus should fail this module's test,
 * which says in one sentence which kinds are dead links, rather than fail to
 * compile in a table that cannot explain itself.
 */
export const FOCUS_LANDING_SUBPAGE: Readonly<Partial<Record<AssetFocus, AssetSubPage>>> =
  Object.freeze({
    research: 'research',
    /* The ladder is in the research page's Forecasts section, so this is
       where the lens lands. It does not scroll: an arrival that wants the
       anchor carries `section: 'targets'` too. */
    framework: 'research',
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
    /*
     * A price target is read in the research page's Forecasts section, not on
     * the snapshot.
     *
     * It was `overview` because that was the only honest answer available: no
     * focus named the targets, `framework` did not work, and the snapshot at
     * least shows a price. It is wrong now that an arrival can name a
     * SECTION -- `research` + `targets` lands on the ladder the assistant was
     * quoting, and the receiving effect knows the Forecasts section has to be
     * force-expanded before that anchor is in the DOM at all.
     *
     * See `SECTION_BY_SOURCE_KIND` below for the section half.
     */
    price_target: 'research',
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
 * Which PARAGRAPH of that lens, for the kinds that name one.
 *
 * ── Why this is a second table and not a richer first one ───────────────
 *
 * Most kinds have no section, and that is a product decision rather than an
 * omission: a reader who clicks the asset a claim was made about wants the
 * asset, and an arrival that scrolls when nobody asked it to is as
 * disorienting as one that fails to. So the default is absent, and a row
 * here is a deliberate statement that the control named a place.
 *
 * Two rows today:
 *
 *   `price_target`   the ladder, in the Forecasts section. This is the one
 *                    the brief named: an assistant citing "the bull case is
 *                    $260" should land on the row holding $260, not on a
 *                    snapshot that shows today's price and nothing about the
 *                    target.
 *   `contribution`   the case. A contribution IS a section of the written
 *                    case, so the nearest truthful anchor is where the case
 *                    begins. Not the exact section: `AssetSectionTarget` is
 *                    a named set of five anchors the page can actually
 *                    reach, and a contribution can be any of a template's
 *                    sections -- naming one that has no anchor would be a
 *                    scroll that polls for three seconds and gives up.
 *
 * `note` is deliberately absent even though it routes to `research`. A note
 * is not part of the case; it is filed beside it, and landing on the thesis
 * because a note was cited would point at the wrong document.
 */
export const SECTION_BY_SOURCE_KIND:
  Readonly<Partial<Record<AiResearchSourceKind, AssetSectionTarget>>> =
  Object.freeze({
    price_target: 'targets',
    contribution: 'case',
  })

/** The section for a kind, or null when the kind names no paragraph. */
export function sectionForSourceKind(kind: string): AssetSectionTarget | null {
  return (SECTION_BY_SOURCE_KIND as Record<string, AssetSectionTarget | undefined>)[kind] ?? null
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
  const kind = source.kind ?? ''
  openAsset({
    assetId: source.asset_id,
    symbol: source.symbol ?? null,
    focus: focusForSourceKind(kind),
    /* Null for most kinds, which is the point: see `SECTION_BY_SOURCE_KIND`.
       `assetTabFor` writes it either way, so a kind with no section cannot
       inherit the last arrival's paragraph through the tab-data merge. */
    section: sectionForSourceKind(kind),
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
