/**
 * The PresentationPlan: what to show, in what order, at what size — and no JSX.
 *
 * ── What a plan is, and what it refuses to be ─────────────────────────────
 *
 * A plan is the answer to:
 *
 *     situation + surface + reader + space + state  →  PresentationPlan
 *
 * It names semantic REGIONS and shared PRIMITIVES. It does not name a React
 * component, does not carry markup, and cannot express a layout that does not
 * already exist in the product. That last constraint is deliberate and is the
 * difference between this and a layout DSL: a DSL lets a card describe a new
 * arrangement, which means every new finding can invent one, which is how the
 * product got seven card components in the first place. Here the vocabulary is
 * closed. A finding may choose among the arrangements that exist; it may not
 * add one.
 *
 * ── Why the visual vocabulary is imported, not declared ───────────────────
 *
 * `VisualPrimitive` is `ExploreVisual['kind']` — the same union Explore
 * already resolves and already has components for. Declaring a parallel list
 * here would have been one line of convenience and a permanent source of
 * drift: the moment the two disagree, a plan can ask for a picture nothing can
 * draw. Aliasing makes that unrepresentable, and it is also the mechanical
 * enforcement of "reuse existing visual primitives" — there is no way to
 * express a bespoke one.
 *
 * ── Why space is a `TileRequirement` and not a number ─────────────────────
 *
 * `lib/signals/tile-geometry` already owns the arithmetic from content to
 * pixels, including the lesson that a card's width routes into its height
 * through claim wrapping and that the feed separator belongs to the feed. The
 * plan therefore declares WHAT IT CONTAINS in that module's vocabulary and
 * lets it do the sums. A plan carrying a height would be a fixed height in
 * disguise, which is the failure that file was written to end.
 */

import type { ExploreVisual } from '../mobile/explore-visual'
import type {
  ResolvedTile, TileRequirement, VisualRequirement,
} from '../signals/tile-geometry'
import type { ReaderQuestion } from '../signals/reader-question'
import type { ActionIntent } from './finding'

/**
 * The shared visual vocabulary. Closed by construction.
 *
 * Aliased from Explore's union so a plan can never ask for a primitive the
 * product cannot draw. Adding one is a change to that union and to the
 * components behind it — which is exactly the friction a bespoke-component
 * habit needs.
 */
export type VisualPrimitive = ExploreVisual['kind']

/**
 * Where each primitive is already implemented.
 *
 * Documentation with a test behind it: `primitives.test.ts` asserts every path
 * exists on disk, so a rename cannot quietly leave the plan pointing at
 * nothing. Not imported at runtime — the engine is pure and must not pull a
 * React module into a scorer's dependency graph.
 */
export const PRIMITIVE_COMPONENTS: Record<VisualPrimitive, string | null> = {
  scenario_range: 'src/components/signals/ScenarioLadder.tsx',
  target_compare: 'src/components/signals/LadderPane.tsx',
  timeline: 'src/components/signals/HorizonTimeline.tsx',
  exposure: 'src/components/signals/WeightBars.tsx',
  comparison: 'src/components/signals/ActiveWeightPeers.tsx',
  last_look: 'src/components/signals/Sparkline.tsx',
  workflow: 'src/components/signals/VerdictBar.tsx',
  quote: 'src/components/signals/CasePane.tsx',
  price_trend: 'src/components/signals/Sparkline.tsx',
  /** Typography carries it. The honest answer more often than it is used. */
  none: null,
}

/**
 * The semantic regions a plan can order.
 *
 * Not components and not panes — the words a reader would use for the parts of
 * an argument. `claim` is what is true, `metric` is the number it turns on,
 * `evidence` is the picture, `prompt` is the question being asked, `context`
 * is what else the reader needs to weigh it, `corroboration` is the other
 * findings, `actions` is what they can do.
 */
export type PlanRegion =
  | 'claim'
  | 'metric'
  | 'evidence'
  | 'prompt'
  | 'body'
  | 'context'
  | 'corroboration'
  | 'actions'

/**
 * The information hierarchy: regions in reading order, with one lead.
 *
 * `order` is what the surface mounts. `lead` is what the reader's eye should
 * land on first and is not always `order[0]` — Explore leads with the picture
 * while still rendering the claim above it, because a browsing reader is
 * scanning for something interesting rather than reading a briefing.
 */
export interface PlanHierarchy {
  order: PlanRegion[]
  lead: PlanRegion
}

export interface PlanVisual {
  primitive: VisualPrimitive
  /**
   * The primitive's own legibility floor, from `tile-geometry`.
   *
   * Declared by the primitive rather than by the finding, so a ladder is never
   * squeezed to a sliver because one family thought it could spare the room.
   */
  requirement: VisualRequirement
  /** `lead` is the argument; `support` decorates and may be dropped first. */
  role: 'lead' | 'support'
}

export interface PlanContextItem {
  /** What the reader is being told, as a short label the surface renders. */
  label: string
  /** The value, preformatted by the producer that owns its units. */
  value?: string
  /**
   * Why this is here: `provenance` explains the number's vintage, `stakes`
   * explains the consequence, `corroboration` names the other findings.
   */
  role: 'provenance' | 'stakes' | 'corroboration'
}

/**
 * How an intent is offered on this surface.
 *
 * `inline` is a button on the resting card; `on_engage` appears once the
 * reader opens the object; `menu` is overflow. The same intent legitimately
 * lands in all three depending on surface and role, which is why the finding
 * carries the intent and the plan carries the placement.
 */
export type ActionPlacement = 'inline' | 'on_engage' | 'menu'

export interface PlannedAction {
  intent: ActionIntent
  placement: ActionPlacement
  /**
   * Why this placement, in one clause.
   *
   * Kept because "the button moved" is the single most common report against
   * an adaptive surface, and an answer that is derivable but not recorded gets
   * re-derived wrongly.
   */
  because: string
}

export interface PlanActions {
  /** Exactly one, and it is always an intent the situation actually carries. */
  primary: PlannedAction
  /** Ordered. May be empty on a surface that is not for deciding. */
  secondary: PlannedAction[]
  /** Always navigates to the subject. Every surface offers it. */
  inspect: { intent: 'inspect_subject'; placement: ActionPlacement }
}

export type PlanDensity = 'compact' | 'standard' | 'expanded'

export interface PlanSpace {
  density: PlanDensity
  /** What the plan contains, in `tile-geometry`'s vocabulary. */
  requirement: TileRequirement
  /**
   * The geometry module's answer for this container.
   *
   * Null when the caller did not supply a container — a workbench pane that
   * scrolls has no ceiling to resolve against, and inventing one would make
   * the plan claim a height it does not have.
   */
  resolved: ResolvedTile | null
  /**
   * Regions the resolver removed because the space could not hold them.
   *
   * Recorded rather than silently applied. A card that quietly drops its
   * evidence looks like a card that never had any, and the difference is the
   * whole of "why does this look different on my phone".
   */
  degraded: PlanRegion[]
}

export interface PresentationPlan {
  situationId: string
  /** The semantic question, and the words this surface asks it in. */
  question: { id: ReaderQuestion; prompt: string }
  hierarchy: PlanHierarchy
  visuals: PlanVisual[]
  context: PlanContextItem[]
  actions: PlanActions
  space: PlanSpace
  /**
   * The resolver's decisions, in order, one line each.
   *
   * For tests, the gallery and bug reports. Never rendered: a reader shown
   * "density: compact because surface is mobile_brief" learns nothing they can
   * act on, which is the same rule `explainPriority` follows.
   */
  rationale: string[]
}
