import type { EngagementObjectType } from '../engagement/types'

/**
 * What a tile is ASKING, separately from how big it is drawn.
 *
 * ── The coupling this exists to break ─────────────────────────────────────
 *
 * Four surfaces each grew their own answer to "what picture goes here", and
 * three of the four name the WIDGET rather than the question:
 *
 *   `EvidenceKind`      sparkline | peer_bar | timeline | scenario_ladder
 *   `TodayArchetype`    exposure | aging | transition | expected-return | …
 *   `IdeaVisualKind`    range | target | sizing | since | exposure | cases | gap
 *   `ExploreVisual`     scenario_range | target_compare | exposure | quote | …
 *
 * Only the last was written as a question, and even it is phrased in Explore's
 * local vocabulary. The result is that "where does the price sit against the
 * desk's own ladder" is spelled `scenario_ladder` on the Curate card,
 * `scenario` on a Today tile, `range` on an Ideas card and `scenario_range` in
 * the Explore grid — one investment question, four names, and no way for a
 * future composer to know they are the same thing.
 *
 * That is the coupling that has to go before a finding can be presented
 * differently in different places: as long as the name of the picture is local
 * to the surface, moving a finding between surfaces means re-deciding its
 * visual from its producer, which is how a producer kind ends up determining
 * geometry.
 *
 * ── What earns a member here ──────────────────────────────────────────────
 *
 * Two independent implementations in code that ships today. Not two things a
 * future surface might want — two places where somebody has already drawn the
 * answer to this question. The rejected candidates are recorded at the bottom
 * of this file, because the reasons they failed are the useful part.
 *
 * Pure — no React, no Supabase, no data access. The gallery may import it.
 */
export type VisualIntent =
  /**
   * Where the price sits against the cases the desk itself wrote.
   *
   * Four implementations: `scenario_ladder` (EvidenceKind), `scenario`
   * (TodayArchetype), `range` (IdeaVisualKind, via `RangeChart`), and
   * `scenario_range` (ExploreVisual). The richest question in the product and
   * the one drawn four different ways.
   */
  | 'case_vs_price'
  /**
   * Where the price sits against a single stated target — or against the
   * absence of one, which is a first-class state and not a missing value.
   *
   * Three: `expected-return` (Today), `target` (Ideas, via `TargetBar`),
   * `target_compare` (Explore, where `target: null` is the whole finding).
   */
  | 'target_distance'
  /**
   * A clock is the reason the item surfaced.
   *
   * Three: `timeline` (EvidenceKind, via `HorizonTimeline`), `aging` and
   * `review-window` (Today), `timeline` (Explore). Covers both an expiry that
   * has passed and a silence that has gone on too long — the two are the same
   * picture with different endpoints, which is why they are one intent.
   */
  | 'elapsed_time'
  /**
   * How much of a book rides on this. ONE weight, against the whole.
   *
   * Three: `exposure` in Today, in Ideas (`ExposureRank`) and in Explore.
   * Deliberately distinct from `weight_comparison` below: a single bar against
   * a book and a pair of bars against each other are different claims, and the
   * surfaces that drew both kept them apart.
   */
  | 'portfolio_weight'
  /**
   * One weight against ANOTHER weight, both of them real.
   *
   * Three: `peer_bar` (EvidenceKind, via `ActiveWeightPeers` — subject against
   * its cohort), `comparison` (Explore — position against the index, where a
   * benchmark file exists), `sizing` (Ideas, via `SizingBar` — held against
   * proposed).
   *
   * ── Why `position_sizing` is not its own member ─────────────────────────
   *
   * It would have had exactly one implementation. `SizingBar` draws held
   * against proposed; `ActiveWeightPeers` draws the subject against its peers;
   * `comparison` draws the position against the index. All three are two bars
   * and a stated difference, and the reader's question is the same in each —
   * "is this weight right relative to that one". Splitting on WHICH second
   * weight it is would put the producer back in charge of the picture.
   */
  | 'weight_comparison'
  /**
   * The trajectory itself is the evidence.
   *
   * Four: `sparkline` (EvidenceKind), `review-window` (Today, closes over a
   * named window), `since` (Ideas, via `SinceOpen`), and both `price_trend`
   * and `last_look` in Explore. Reachable only where the move IS the claim —
   * `explore-visual` documents at length why a ticker is not a licence to draw
   * one, and that rule belongs to the resolver, not to this vocabulary.
   */
  | 'price_path'
  /**
   * Where an authored thing has got to, along a stated set of stages.
   *
   * Two: `transition` (Today — a discrete from → to) and `workflow` (Explore —
   * a stage rail with an active index). Both answer "how far along is this",
   * and neither is about a price.
   */
  | 'workflow_state'
  /**
   * The finding IS an absence: work that was started and not finished.
   *
   * Two implementations, both in Ideas and deliberately separate primitives:
   * `CasesUnpriced` (cases named, no prices on them) and `ModelGap` (inputs the
   * model wants and does not have). The Curate `no_target` / `no_research`
   * family makes the same claim in words.
   *
   * The weakest member here, and kept because both implementations already
   * exist rather than because a third surface might want it.
   */
  | 'evidence_gap'
  /**
   * Typography carries it. Honest far more often than the surfaces assumed.
   *
   * Four: `none` (EvidenceKind), `metrics` (Today, documented as "no visual;
   * the tile renders none"), `none` (Explore), and Explore's `quote`, whose
   * hero IS its own words rather than a geometry.
   *
   * ── Why `quote` did not become its own intent ───────────────────────────
   *
   * One implementation. Explore draws a thought as its own sentence; the Ideas
   * `thesis` family renders the claim as body prose, not as a visual; Curate's
   * `thought` and `discussion` cards carry no evidence node at all. A member
   * with one implementation is a guess about the second, and the guess here
   * would have been wrong in a specific way: a quote needs the TEXT, which is
   * data the tile already has, not an intent the composer has to route on.
   */
  | 'none'

/**
 * How much room the page has decided this object deserves.
 *
 * ── The five spellings this replaces ──────────────────────────────────────
 *
 *   `ExploreEmphasis`   standard | feature             (mobile Explore, item)
 *   `ExploreCardSize`   feature | compact              (mobile Explore, geometry)
 *   `IdeaDensity`       featured | standard | compact  (desktop Ideas)
 *   `TileSize`          hero | large | medium | compact  (DesktopTile)
 *   `TodayVisual`       compact?: boolean              (desktop Today)
 *
 * Three members, because three is what every one of those five collapses to
 * without losing a distinction anybody draws: something leading, something
 * ordinary, something in the field beneath. `DesktopTile`'s `large` is the one
 * genuine fourth band and it exists in exactly one surface — a member with one
 * implementation is the thing this file refuses.
 *
 * ── Why this is not severity ──────────────────────────────────────────────
 *
 * `DesktopTile` already says it: "How much room an object has earned. Never a
 * severity." Rank and urgency are different axes, and the surfaces that
 * conflated them produced pages where the loudest card was merely the first.
 * Severity lives in the signal contract as `Severity` and is not respelled
 * here — see the rejection note on `TileEmphasis` below.
 */
export type TileRole = 'lead' | 'standard' | 'compact'

/**
 * How much room the VISUAL INSIDE the tile gets.
 *
 * Separate from the role because the two demonstrably come apart. Two current
 * proofs, from opposite surfaces:
 *
 *   • `exploreCardHeight` gives an aggregate the FULL width and the SHORTEST
 *     height — "the two are independent decisions and this is the one case
 *     where they come apart", in its own words. A wide banner over one line.
 *
 *   • `IdeaCard` draws extra numbers under `RangeChart` only at `sm`, because
 *     "a 22px band cannot label itself". The picture gets less room and the
 *     tile compensates, which is only expressible if the picture's room is a
 *     value somebody passes rather than a constant inside the component.
 *
 * `IdeaVisuals` is the surface that already got this right: every primitive
 * takes `size?: VisualSize` and reads its geometry from `BAND` / `PLOT` /
 * `CHIP` / `FIG`. This type is that idea, named for what it means rather than
 * for how tall it is, so the other three surfaces can adopt it without
 * inheriting Ideas' `lg` / `md` / `sm` shorthand.
 */
export type TileDensity = 'spacious' | 'standard' | 'compact'

/**
 * Which surface is doing the presenting.
 *
 * Not a styling hook and not a theme. It exists for one reason: a surface can
 * have a FLOOR that a role alone cannot express.
 *
 * `SignalCardSection` pins every Curate card to `h-full` — "One screen per
 * card" — so the mobile feed has no compact tier at all. A finding ranked
 * twentieth there is still a full viewport, while the same finding in the
 * Explore grid two taps away is a 170px cell. That is a property of the
 * surface, not of the finding, and without it a composer would hand the feed a
 * compact density that the feed has nowhere to put.
 */
export type TileSurface =
  /** Curate: one card per viewport, vertical snap. `SignalCardSection`. */
  | 'mobile_feed'
  /** Explore: a packed mosaic of previews. `packExplore`. */
  | 'mobile_grid'
  /** Today: a ranked desktop grid. `TodayTile` / `DesktopTile`. */
  | 'desktop_today'
  /** Ideas and the other v2 workspaces. `IdeaCard`. */
  | 'desktop_workspace'

/**
 * The object a tile is about.
 *
 * ── Why identity is a pair and never a ticker ─────────────────────────────
 *
 * `explore-match` records the failure directly: type and asset do not identify
 * a post, so several ideas on one name all matched equally and the first
 * always won. A presentation layer keyed on a ticker, a title or a label would
 * reproduce that the moment two findings share a name.
 *
 * ── Why it borrows the engagement seam's type ─────────────────────────────
 *
 * Stage 4C owns interaction identity through `EngagementTarget`, whose subject
 * is exactly `objectType` + `objectId`. Declaring a second object-type union
 * here would fork it, and the two would disagree within a stage. This is a
 * structural subset of that target: anything holding a `TileSubject` can be
 * widened into an `EngagementTarget` by adding a label, and nothing here
 * duplicates what the seam DOES.
 *
 * Null is a real answer. An Explore aggregate stands for several objects and
 * an external news story is not one of ours; both must be presentable without
 * inventing an id. Stage 4C's `engagementAffordances` already treats a null
 * target as "render the controls, disabled", so the two agree on the empty
 * case without this module having to know that function exists.
 */
export interface TileSubject {
  objectType: EngagementObjectType
  objectId: string
}

/** What a surface asks for. Semantics in, presentation out. */
export interface TilePresentationRequest {
  /** The object, or null where the tile genuinely stands for no single one. */
  subject: TileSubject | null
  /** The question the tile is answering. Never the producer that emitted it. */
  intent: VisualIntent
  /** How much room the page decided this deserves. */
  role: TileRole
  /** Where it is being drawn. */
  surface: TileSurface
  /**
   * An explicit density, where the surface knows better than the default.
   *
   * The aggregate-banner case: full width, shortest body. Overrides the role's
   * default and is still raised to the surface's floor, because a floor is a
   * statement about what the surface can physically render.
   */
  density?: TileDensity
}

/** What the surface renders from. Carries no geometry — no pixels, no classes. */
export interface TilePresentation {
  subject: TileSubject | null
  intent: VisualIntent
  role: TileRole
  density: TileDensity
  surface: TileSurface
  /**
   * True where the picture is unreadable narrow.
   *
   * Lifted from `visualNeedsWidth`, which already answers this for Explore and
   * feeds `exploreCardSize` — a card with no other claim to width gets it
   * because its picture needs it. Kept as a property of the INTENT so the
   * other three surfaces can ask the same question.
   */
  needsWidth: boolean
}

/**
 * The density a role implies when the surface has no opinion.
 *
 * One step per band, matching what `IdeaCard` already does — `featured` → `lg`,
 * `standard` → `md`, `compact` → `sm`. Named rather than inlined so the one
 * place that disagrees has something to override.
 */
export function densityForRole(role: TileRole): TileDensity {
  switch (role) {
    case 'lead': return 'spacious'
    case 'standard': return 'standard'
    case 'compact': return 'compact'
  }
}

/**
 * The least dense a surface will draw.
 *
 * Only `mobile_feed` has a non-trivial floor today, and it is not a preference:
 * a Curate card is `h-full` inside a snap scroller, so a compact body would
 * leave a screen of white under it rather than a smaller card. The other three
 * surfaces genuinely have a compact tier and are floored at it.
 */
const SURFACE_FLOOR: Record<TileSurface, TileDensity> = {
  mobile_feed: 'standard',
  mobile_grid: 'compact',
  desktop_today: 'compact',
  desktop_workspace: 'compact',
}

/** Least to most room. Used only to apply a floor, never to rank anything. */
const DENSITY_ORDER: TileDensity[] = ['compact', 'standard', 'spacious']

/**
 * Intents whose picture cannot be read narrow.
 *
 * Exactly the three `visualNeedsWidth` names, translated: a range bar with
 * labelled cases and a marker outside it, a two-span timeline with dates under
 * it, and a pair of bars with a stated difference. `IdeaCard` independently
 * reaches the same conclusion about the first, printing the legs as text when
 * the band drops to 22px.
 *
 * A property of the question, never of the surface: the same picture is
 * illegible at 170px wherever it is drawn.
 */
export function intentNeedsWidth(intent: VisualIntent): boolean {
  return intent === 'case_vs_price'
    || intent === 'elapsed_time'
    || intent === 'weight_comparison'
}

/**
 * Resolve one tile's presentation.
 *
 * Pure, total and deterministic: the same request gives the same answer, and
 * the answer depends on nothing outside the request — not on what else is on
 * the page, not on arrival order, not on the ticker.
 *
 * It does not rank, score, filter, suppress or dedupe. Those decide WHETHER and
 * IN WHAT ORDER a finding appears and are settled before a request reaches
 * here; this decides only how the one that got through is drawn. Keeping the
 * two apart is the whole point — a presentation change must never be able to
 * move a finding up the page.
 */
export function resolveTilePresentation(req: TilePresentationRequest): TilePresentation {
  const wanted = req.density ?? densityForRole(req.role)
  const floor = SURFACE_FLOOR[req.surface]
  const density = DENSITY_ORDER.indexOf(wanted) < DENSITY_ORDER.indexOf(floor) ? floor : wanted

  return {
    subject: req.subject,
    intent: req.intent,
    role: req.role,
    density,
    surface: req.surface,
    needsWidth: intentNeedsWidth(req.intent),
  }
}

/**
 * ── Rejected, and why ─────────────────────────────────────────────────────
 *
 * `TileEmphasis` (neutral | attention | critical | stale | changed)
 *   `Severity` in `lib/signals/contract` is already this, is already consumed
 *   by `SEVERITY_MARK` and `showsTopRule`, and is already carried on every
 *   card. A second spelling in a second module is precisely the divergence
 *   this stage exists to prevent — the four visual vocabularies above are what
 *   happens when a concept gets a local name. If emphasis needs to reach a
 *   tile, it reaches it as `Severity`.
 *
 * `TileCapabilities` (expand | respond | askAI | discuss)
 *   Stage 4C owns this through `engagementAffordances(target)`, which is not
 *   in this branch's base. Declaring booleans for it here would either fork
 *   that logic or predict its shape, and both are worse than waiting. The
 *   compatibility seam that IS needed is object identity, and `TileSubject`
 *   above is it: a tile that holds one can be handed to the affordance
 *   resolver unchanged when the two lanes meet.
 *
 * `expanded` / `supporting` as roles
 *   `expanded` is a different surface, not a bigger tile — `IdeaDetail`,
 *   `AssetWorkspace` and the mobile pane carousel are pages a tap reaches, and
 *   `explore-item` explains at length why a preview and a decision card are
 *   separate contracts rather than two sizes of one. `supporting` would be
 *   `DesktopTile`'s `large`, which exists in one surface.
 *
 * `crowding`, `conviction_tension`, `research_maturity` as intents
 *   The first is a `SignalType`, not a question a picture answers — it draws
 *   `peer_bar`, which is `weight_comparison`. The second cannot be drawn at
 *   all and `explore-visual` says why: conviction is stored as a WORD, there
 *   is no intended-weight number anywhere in the model, and drawing one would
 *   invent the comparison the card is about. The third splits across
 *   `elapsed_time` (how long since anybody looked) and `workflow_state` (how
 *   far along it is), which is what the two surfaces that draw it already do.
 *
 * `news`, `idea` as intents
 *   Producer kinds. Routing a picture from the thing that emitted a row is the
 *   coupling this module was written to remove.
 */
