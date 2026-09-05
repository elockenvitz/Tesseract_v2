/**
 * What a card's primary button actually does.
 *
 * ── The rule this module exists to enforce ────────────────────────────────
 *
 * A button labelled "Review cases" that opens a blank capture sheet is worse
 * than a button labelled "Capture" that opens a capture sheet. The first lies
 * about the product; the second is merely generic. So a contextual label may
 * only be declared where `resolveFeedAction` returns a real destination, and
 * `feedActionIsRoutable` is what a builder (or a test) asks before promising
 * anything.
 *
 * ── One vocabulary, shared with `nextAction` ──────────────────────────────
 *
 * Phase 3 put unrendered `nextAction` ids on judgment options — `set_target`,
 * `open_cases`, `open_coverage`, `update_thesis`. Those are the same keys used
 * here, deliberately: when progressive disclosure eventually renders a
 * follow-on control after a judgment, it routes through this resolver rather
 * than through a second, subtly different mapping. Two vocabularies for the
 * same destinations is how "Review cases" ends up meaning different things in
 * two places.
 */

/**
 * Every action a feed card can offer.
 *
 * `capture`, `open_asset` and `open_item` are handled by the card surface
 * itself and are not navigations this module resolves — they are listed so the
 * union is the complete vocabulary and a typo cannot silently become a
 * contextual action that nothing handles.
 */
export type FeedActionKey =
  // Handled by SignalCardSection's own action grammar.
  | 'capture'
  | 'open_asset'
  | 'open_item'
  | 'resolve'
  // Contextual destinations resolved here.
  | 'open_cases'
  | 'review_target'
  | 'set_target'
  | 'update_thesis'
  | 'add_rationale'
  | 'open_coverage'
  /**
   * Open the research item a New Research card is about.
   *
   * ── The lie this replaces ─────────────────────────────────────────────────
   *
   * That card's primary said "Review the evidence" and opened the THESIS
   * EDITOR. The trigger is that a note arrived; the destination was a blank
   * authoring surface for a different object entirely. A reader following the
   * button to read what landed was put in front of a text field instead.
   *
   * Reviewing the arrival and revising the thesis are two steps and the second
   * only follows from a judgment — see the `view_needs_update` option's own
   * `nextAction`, which is where thesis editing legitimately begins.
   */
  | 'open_research'

/**
 * Which part of the asset page a deep link should land on.
 *
 * Threaded through the existing tab-data channel rather than a new router:
 * `handleSearchResult` merges `result.data` into `tab.data`, and the mobile
 * asset page reads its props from exactly that. No new navigation state, no
 * duplicated routing.
 */
export type AssetFocus = 'cases' | 'target' | 'thesis'

export interface FeedActionContext {
  assetId?: string | null
  symbol?: string | null
  name?: string | null
  /**
   * The research item that arrived, for `open_research`.
   *
   * A note has a full mobile surface (`mobile-surfaces.ts` registers `note` as
   * `support: 'full'`), so it can be opened and read. A quick thought has no
   * detail surface of its own — it lives in the feed — so the card's Research
   * pane is already the review surface and the action falls through to the
   * asset rather than promising a page that does not exist.
   */
  research?: { id?: string | null; kind?: 'note' | 'thought' | null; title?: string | null } | null
}

/** The shape `handleSearchResult` expects. */
export interface FeedNavTarget {
  id: string
  title: string
  type: string
  data: Record<string, unknown>
}

/**
 * Where each contextual action goes, or null when it goes nowhere.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * `review_position` is absent. The mobile asset page carries a case view, a
 * decisions list and lists membership — there is no position or sizing view on
 * a phone, so an active-risk card cannot honestly offer "Review position". It
 * keeps Capture, which does what it says.
 *
 * `update_status` is absent. `project` is registered `read-only` in
 * `mobile-surfaces.ts`, so an overdue workflow card cannot offer to update
 * anything; it keeps "Open item".
 *
 * Both are recorded as gaps rather than routed somewhere approximate.
 */
export function resolveFeedAction(
  key: FeedActionKey,
  ctx: FeedActionContext,
): FeedNavTarget | null {
  const assetTarget = (focus: AssetFocus): FeedNavTarget | null => {
    if (!ctx.assetId) return null
    return {
      id: ctx.assetId,
      title: ctx.symbol ?? ctx.name ?? 'Asset',
      type: 'asset',
      // `focus` is always present, including on plain opens, so a stale value
      // cannot survive from a previous navigation into this tab — tab data is
      // merged, not replaced.
      data: { id: ctx.assetId, symbol: ctx.symbol ?? undefined, focus },
    }
  }

  switch (key) {
    /**
     * Not a navigation. See `researchReaderTarget`.
     *
     * This used to return a tab of `type: 'note'`, which `DashboardPage`
     * renders as `NoteEditor` — the full authoring surface. "Read the
     * research" put a cursor in a text field, which is the same class of lie
     * the key was introduced to remove: the trigger is that somebody wrote
     * something, and the destination was a form for writing something.
     *
     * The reader is an overlay owned by the feed, so it is resolved by the
     * card surface rather than routed to a tab — which is also what lets Back
     * return to the arrivals list instead of to whatever tab preceded it.
     */
    case 'open_research':
      return null

    // The scenario ladder and the price targets are ONE editor on mobile:
    // `MobileCaseTargets` renders Bull / Base / Bear, each with a price and a
    // horizon, all editable. The two keys differ because the CARD's subject
    // differs — a case-vs-price card is about the spread, a target card is
    // about one number — and landing them on the same surface is honest rather
    // than lazy.
    case 'open_cases':
      return assetTarget('cases')
    case 'review_target':
    case 'set_target':
      return assetTarget('target')

    // `MobileCaseSection`, the rich-text field editor. The focus also switches
    // the case view out of its default aggregated (read-only) filter, or the
    // reader would arrive at a page that cannot be written to — see
    // `MobileAssetPage`.
    case 'update_thesis':
    case 'add_rationale':
      return assetTarget('thesis')

    case 'open_coverage':
      // Registered `read-only` on mobile, which is enough for "who owns this".
      return { id: 'coverage', title: 'Coverage', type: 'coverage', data: {} }

    // Handled by the card surface, not routed here.
    case 'capture':
    case 'open_asset':
    case 'open_item':
    case 'resolve':
      return null

    default:
      /**
       * An unrecognised key routes nowhere.
       *
       * The switch is exhaustive over `FeedActionKey`, so this is unreachable
       * with a well-typed caller — and `feedActionIsRoutable` takes a `string`,
       * because the thing it is checking is a builder's declaration, which is
       * exactly where a typo or an invented action would appear. Without this
       * the function returned `undefined` for an unknown key, and `undefined
       * !== null` passed the routability check: the guard against dead-end
       * buttons would itself have waved through any action name at all.
       */
      return null
  }
}

/**
 * The research item a reader is being sent to READ.
 *
 * ── Why this is separate from `resolveFeedAction` ─────────────────────────
 *
 * Everything that resolver returns is a tab, and every research tab in this
 * app is an editor. Reading and authoring are different acts on the same
 * object, and the product only had the second one — so the read destination
 * is a different kind of thing, and saying so in the type is what stops it
 * being routed back into the editor by the next person who adds a case here.
 *
 * Both kinds are readable. A quick thought has no detail page and used to
 * fall through to the asset, which answered a question the reader had not
 * asked; it is three lines of text and an author, and the reader can render
 * exactly that.
 */
export interface ResearchReaderTarget {
  id: string
  kind: 'note' | 'thought'
  /** Notes carry one; thoughts do not. Shown while the body loads. */
  title?: string | null
}

export function researchReaderTarget(ctx: FeedActionContext): ResearchReaderTarget | null {
  const r = ctx.research
  // No id, nothing to read — and the builder's routability check is what turns
  // that into a fallback rather than a dead button.
  if (!r?.id) return null
  if (r.kind !== 'note' && r.kind !== 'thought') return null
  return { id: r.id, kind: r.kind, title: r.title ?? null }
}

/** Actions the card surface handles itself, rather than by navigating. */
const SURFACE_HANDLED = new Set<string>(['capture', 'open_asset', 'open_item', 'resolve', 'snooze', 'dismiss', 'why'])

/**
 * Whether a builder may legitimately declare this action.
 *
 * The guard behind the truthfulness rule: an action is offerable when the card
 * surface handles it, or when it resolves to a real destination given this
 * card's context. A contextual key with no asset id resolves to null and must
 * fall back rather than render a button that does nothing.
 */
export function feedActionIsRoutable(key: string, ctx: FeedActionContext): boolean {
  if (SURFACE_HANDLED.has(key)) return true
  /**
   * Surface-handled, but only when there is an item behind it.
   *
   * It cannot go in `SURFACE_HANDLED`, which is an unconditional yes: a card
   * with no readable arrival would then declare "Read the research" and open
   * nothing. The condition IS the truthfulness guard for this key.
   */
  if (key === 'open_research') return researchReaderTarget(ctx) !== null
  return resolveFeedAction(key as FeedActionKey, ctx) !== null
}
