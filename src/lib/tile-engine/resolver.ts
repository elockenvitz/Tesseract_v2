/**
 * The Presentation Resolver. Deterministic, pure, and closed.
 *
 * ── The question it answers ───────────────────────────────────────────────
 *
 *     situation + surface + reader + space + active/passive → PresentationPlan
 *
 * Every one of those five is a real input and each of them changes the answer.
 * The point of naming them is that they are the ONLY inputs: no clock of its
 * own, no engagement history, no randomness, no model. Two calls with equal
 * arguments return deeply equal plans, and a test asserts it — an adaptive
 * surface nobody can reproduce is a surface nobody can debug, and the reports
 * it generates ("the button moved") are unanswerable.
 *
 * ── Why no AI chooses components ──────────────────────────────────────────
 *
 * Not a performance argument and not a cost one. A layout chosen by a model is
 * a layout that can differ between two renders of identical state, which
 * breaks the one property a briefing surface cannot lose: a PM who opens the
 * feed twice must see the same thing. Everything here is a lookup or a
 * comparison.
 *
 * ── Why the resolver never sees a FindingKind ─────────────────────────────
 *
 * It reads the lead finding's PREDICATE, its claim data and its stakes. It has
 * no switch on kind and must not grow one — the moment it does, a kind is a
 * template again and the seventh situation needs a resolver change to render
 * at all. `coverage_gap` and `no_core_thesis` land on the same treatment here
 * without either being mentioned, which is the check that the rule holds.
 */

import type { CoverageRelevance } from '../signals/coverage-relevance'
import {
  plotVisual, resolveTile, rowsVisual,
  type TileContainer, type TileRequirement, type VisualRequirement,
} from '../signals/tile-geometry'
import type { ActionIntent, FindingPredicate, SemanticFinding } from './finding'
import { vintageOf } from '../signals/contract'
import type {
  ActionPlacement, PlanContextItem, PlanDensity, PlanRegion, PlanVisual,
  PlannedAction, PresentationPlan, VisualPrimitive,
} from './presentation'
import { QUESTION_PROMPT } from './situations'
import { corroborationCount, type Situation } from './situation'

/**
 * The three shells the product has agreed on.
 *
 * Named for what the reader is DOING, not for the device: a phone in someone's
 * hand between meetings is an attention briefing, Explore is discovery on any
 * screen, and the workbench is continuous work. Naming them `mobile` and
 * `desktop` would have made Explore homeless and invited a breakpoint branch.
 */
export type PresentationSurface = 'mobile_brief' | 'explore' | 'desktop_workbench'

export interface ViewerContext {
  /**
   * Whether this reader may commit a decision rather than propose one.
   *
   * A capability, not a role name. The product's rule today is that PMs
   * commit; encoding "PM" here would mean every future capability change is a
   * change to this file rather than to whoever computes the capability.
   */
  canCommit: boolean
  /** What the situation's subject is to this reader. */
  coverage: CoverageRelevance
}

export interface PresentationRequest {
  situation: Situation
  surface: PresentationSurface
  viewer: ViewerContext
  /**
   * The box the plan must fit, or null where there is no ceiling.
   *
   * A workbench pane that scrolls genuinely has none, and handing the resolver
   * a made-up height so the field could be required would make every plan on
   * that surface claim a size it does not have.
   */
  container: TileContainer | null
  /**
   * Passive is a briefing being read. Active is the reader working in the card.
   *
   * The distinction earns height: an active card may carry controls and a
   * detail region that a passive one must not reserve, which is what keeps a
   * resting feed viewport-composed.
   */
  state: 'passive' | 'active'
}

// ─────────────────────────────────────────────────────────────────────────────
// Predicate → picture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What shape of claim wants what shape of picture.
 *
 * The whole "a finding kind is not a template" rule, in one table. A claim
 * that ran out of time wants a clock; a claim about a value outside a band
 * wants that band drawn; a claim that something is missing wants an empty slot
 * where the number would be, which is `target_compare` with a null target —
 * Explore's union already models that as a first-class state.
 *
 * `unowned` is the interesting one. A position with no analyst is structurally
 * the same claim as a position with no thesis, and both resolve here to the
 * same primitive without either domain knowing about the other.
 */
const PREFERRED_PRIMITIVE: Record<FindingPredicate, VisualPrimitive> = {
  expired: 'timeline',
  outside_band: 'scenario_range',
  /**
   * One level and the value that passed it.
   *
   * The same primitive `absent` reaches, with a real target instead of a null
   * one — which is the reuse rule working rather than a coincidence. Explore's
   * union models the empty slot as a first-class state precisely so the two
   * can share a component.
   */
  threshold_passed: 'target_compare',
  unreviewed: 'last_look',
  absent: 'target_compare',
  unowned: 'exposure',
  awaiting: 'workflow',
}

/**
 * Whether the claim actually carries what the preferred primitive needs.
 *
 * A picture drawn from data the finding does not have is a guess, and the
 * product has an explicit rule against drawing one — see `explore-visual`,
 * which degrades to typography rather than inventing a comparison. So the
 * preference is checked against the claim, and an unmet one falls back rather
 * than rendering an axis with nothing on it.
 */
function primitiveFor(lead: SemanticFinding): { primitive: VisualPrimitive; why: string } {
  const preferred = PREFERRED_PRIMITIVE[lead.claim.predicate]
  const { quantity, interval, band } = lead.claim

  switch (preferred) {
    case 'timeline':
      return interval
        ? { primitive: 'timeline', why: 'expired claim carries an interval' }
        : { primitive: 'none', why: 'expired claim has no interval to draw' }
    case 'scenario_range':
      return band
        ? { primitive: 'scenario_range', why: 'band claim carries low/high/current' }
        : { primitive: 'target_compare', why: 'band claim has no band; falling back to the single comparison' }
    case 'last_look':
      /**
       * A measured MOVE earns the marked review; anything else gets the tape.
       *
       * The unit is what decides it. An unreviewed claim can carry a percentage
       * (the price moved) or a count (material arrived), and marking a review
       * date against a count would draw a move that was never measured.
       * Production leads all three of these states with the price — see
       * `framingPriceLeads` — so the fallback is the tape rather than nothing.
       */
      /**
       * Days are a claim ABOUT the elapsed time, so the elapsed time is drawn.
       *
       * The tape is right when something happened to the price and the record
       * did not follow. It is wrong when the finding is that nothing has
       * happened at all: a coverage clock rendered as a price chart shows the
       * reader a series with no bearing on the claim, which is precisely what
       * manual QA reported — "not showing much besides just a price chart".
       *
       * Read off the unit rather than the kind, exactly as the two branches
       * around it are. A percentage is a move, a count is an arrival, and days
       * are a silence.
       */
      if (quantity?.unit === 'days' && interval) {
        return { primitive: 'timeline', why: 'unreviewed claim is measured in elapsed days; the clock carries it' }
      }
      return quantity?.unit === 'pct' && interval
        ? { primitive: 'last_look', why: 'unreviewed claim carries a measured move and a review date' }
        : { primitive: 'price_trend', why: 'unreviewed claim has no measured move; the tape carries it' }
    case 'target_compare':
      /**
       * A level, drawn or left empty.
       *
       * `threshold_passed` supplies the level it crossed; `absent` supplies
       * nothing, and the dashed empty slot IS its finding. Neither can fail to
       * draw, so there is no fallback branch.
       */
      return lead.claim.threshold
        ? { primitive: 'target_compare', why: 'a level was passed; the price sits against it' }
        : { primitive: 'target_compare', why: 'structural absence draws as an empty slot' }
    case 'exposure':
      return lead.stakes.weightPct != null
        ? { primitive: 'exposure', why: 'unowned claim carries the weight at stake' }
        : { primitive: 'none', why: 'unowned claim has no weight; typography carries it' }
    case 'workflow':
      return { primitive: 'workflow', why: 'an open loop draws as the stages it is between' }
    default:
      return { primitive: 'none', why: 'no primitive for this predicate' }
  }
}

/**
 * What a primitive needs vertically, from the geometry module.
 *
 * The floors belong to the primitive, not to the finding — a ladder knows when
 * it stops being readable and the resolver must not learn that per family.
 */
function requirementFor(primitive: VisualPrimitive): VisualRequirement | null {
  switch (primitive) {
    case 'scenario_range': return plotVisual()
    case 'price_trend':
    case 'last_look': return plotVisual()
    case 'target_compare': return rowsVisual(2)
    case 'timeline': return rowsVisual(2)
    case 'exposure': return rowsVisual(1)
    case 'comparison': return rowsVisual(3)
    case 'workflow': return rowsVisual(1)
    case 'quote': return rowsVisual(2)
    case 'none': return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Surface policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What each surface is FOR, as the small number of decisions that follow from it.
 *
 * Written as data rather than as branches so the three accepted product
 * behaviours are legible in one place: a briefing leads with the claim,
 * discovery leads with the picture, a workbench shows everything and asks
 * nothing until asked.
 */
interface SurfacePolicy {
  density: PlanDensity
  /** The region the reader's eye should land on. */
  lead: PlanRegion
  /** Whether this surface ever asks the situation's question unprompted. */
  asksQuestion: boolean
  /** Whether corroborating findings are shown at rest. */
  showsCorroboration: boolean
  /** How many non-primary actions may sit on the resting card. */
  inlineSecondary: number
  /** Ceiling on context rows before degradation. */
  contextRows: number
}

const SURFACE_POLICY: Record<PresentationSurface, SurfacePolicy> = {
  /**
   * An intelligent attention briefing.
   *
   * The claim leads because the reader is being told something, not browsing.
   * One inline secondary, because four buttons on a 390px row gave triage the
   * same weight as the decision — the lesson `CardActions` already records.
   */
  mobile_brief: {
    density: 'standard', lead: 'claim', asksQuestion: true,
    showsCorroboration: false, inlineSecondary: 1, contextRows: 2,
  },
  /**
   * Discovery.
   *
   * The picture leads and the question is not asked: a browsing reader met
   * with a prompt on every tile is filling in a form, which is precisely the
   * complaint that produced `JudgmentPresentation`. Actions collapse to
   * inspection — Explore's job is to make the reader want to open something.
   */
  explore: {
    density: 'compact', lead: 'evidence', asksQuestion: false,
    showsCorroboration: false, inlineSecondary: 0, contextRows: 1,
  },
  /**
   * A continuous investment workbench.
   *
   * Everything the situation knows is on screen, including the other findings
   * behind it, because the reader is working rather than being briefed and the
   * space exists. The question is still not asked at rest — the workbench is
   * where a PM looks things up, and interrupting that with a prompt is the
   * phone's job, not this one's.
   */
  desktop_workbench: {
    density: 'expanded', lead: 'claim', asksQuestion: false,
    showsCorroboration: true, inlineSecondary: 3, contextRows: 3,
  },
}

/**
 * Whether the question is put to the reader on the resting card.
 *
 * Three conditions, and all three are refusals rather than permissions:
 *
 *   · the surface must be one that asks at all;
 *   · an open loop always asks, because "somebody is waiting on you" IS the
 *     content and hiding it behind an engagement hides the point;
 *   · a reader who does not cover the name is never asked to judge it.
 *
 * That last one is the coverage rule doing real work. Asking an analyst to
 * revise a target on a name they have no relationship with produces either a
 * guess or a dismissal, and both are worse than showing them the finding and
 * letting them move on.
 */
function asksPrompt(req: PresentationRequest, policy: SurfacePolicy): { ask: boolean; why: string } {
  if (req.state === 'active') return { ask: true, why: 'active state: the reader is working in the card' }
  if (req.viewer.coverage === 'none') {
    return { ask: false, why: 'reader does not cover the subject; shown, never asked' }
  }
  if (req.situation.lead.claim.predicate === 'awaiting') {
    return { ask: true, why: 'an open loop asks its question at rest' }
  }
  if (!policy.asksQuestion) return { ask: false, why: `${req.surface} does not ask at rest` }
  if (req.situation.severity === 'critical') {
    return { ask: true, why: 'critical claim on a briefing surface' }
  }
  return { ask: false, why: 'browse before judge: the question waits for engagement' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Intents that commit capital or change somebody else's record.
 *
 * Gated by capability, and gated by MOVING rather than by removing: a reader
 * who cannot commit still sees the action, in the menu, because a surface that
 * silently drops controls teaches people the product is inconsistent. Nothing
 * is hidden and nothing redirects anybody away.
 *
 * ── Why revising a price objective is NOT on this list ────────────────────
 *
 * It was, and adopting the real Target Expired producer is what proved it
 * wrong. The shipping card offers `Review target` to every reader, because
 * writing a price target is ordinary analyst work — it is the daily job of the
 * people this product is for, not a capital commitment a PM signs off.
 * Demoting it to the overflow menu for anyone who had not authored the row
 * would have been inventing a role model, and the parity harness caught it as
 * an action-intent divergence on the first real card it was handed.
 *
 * `reaffirm_case` is off the list for the same reason. Row-level write
 * permission on a case IS enforced — `auth.uid() = user_id`, and it fails
 * silently — but it is enforced inside the editor, where the reader's own row
 * is the editable one. That is a control-level concern. Refusing to open the
 * editor at all would hide three cases to protect one.
 *
 * What is left is what the phrase actually means: sizing a position, assigning
 * somebody else's coverage, and closing a decision loop.
 */
const COMMIT_INTENTS: ReadonlySet<ActionIntent> = new Set<ActionIntent>([
  'resize_position', 'assign_coverage', 'close_loop',
])

function planActions(req: PresentationRequest, policy: SurfacePolicy) {
  const { intents } = req.situation
  const canCommit = req.viewer.canCommit

  const place = (intent: ActionIntent, wanted: ActionPlacement): PlannedAction => {
    if (COMMIT_INTENTS.has(intent) && !canCommit) {
      return { intent, placement: 'menu', because: 'reader may propose but not commit' }
    }
    return { intent, placement: wanted, because: `${req.surface} offers this ${wanted}` }
  }

  /**
   * Discovery does not decide.
   *
   * Every intent stays available behind engagement, which is the difference
   * between a browsing surface and a crippled one.
   */
  if (req.surface === 'explore') {
    return {
      primary: {
        intent: 'inspect_subject' as ActionIntent,
        placement: 'inline' as ActionPlacement,
        because: 'discovery: the action is to look closer',
      },
      secondary: intents.map(i => place(i, 'on_engage')),
      inspect: { intent: 'inspect_subject' as const, placement: 'inline' as ActionPlacement },
    }
  }

  /**
   * The primary is the first intent the reader can actually complete here.
   *
   * A primary the reader cannot use is worse than no primary: it is a button
   * that looks like the answer and is not. So a gated intent is skipped for
   * the primary slot and reappears in the menu below.
   */
  const usable = intents.filter(i => canCommit || !COMMIT_INTENTS.has(i))
  const primaryIntent: ActionIntent = usable[0] ?? intents[0] ?? 'inspect_subject'
  const primary = place(primaryIntent, 'inline')

  const rest = intents.filter(i => i !== primaryIntent)
  const secondary = rest.map((i, idx) =>
    place(i, idx < policy.inlineSecondary ? 'inline' : 'on_engage'))

  return {
    primary,
    secondary,
    inspect: { intent: 'inspect_subject' as const, placement: 'menu' as ActionPlacement },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What else the reader needs to weigh the claim.
 *
 * Provenance first, and unconditionally: every number on this surface is a
 * mixture of vintages — a live quote against a target set in March against a
 * weight from a two-week-old snapshot — and one card-level timestamp would
 * have to misrepresent two of the three. `vintageOf` is the product's one
 * answer to that question and is reused rather than re-derived.
 */
function planContext(req: PresentationRequest, policy: SurfacePolicy): PlanContextItem[] {
  const out: PlanContextItem[] = []
  const lead = req.situation.lead

  const oldest = [...lead.facts].sort(
    (a, b) => new Date(a.asOf).getTime() - new Date(b.asOf).getTime())[0]
  if (oldest) {
    out.push({
      label: 'As of',
      value: oldest.asOf,
      role: 'provenance',
    })
  }

  const weight = lead.stakes.weightPct
  if (weight != null) {
    out.push({ label: 'Weight', value: `${weight.toFixed(1)}%`, role: 'stakes' })
  }

  /**
   * Corroboration is a CHIP everywhere and a REGION only on the workbench.
   *
   * The distinction is what makes composition honest on a phone. When two
   * findings merge into one situation the second one stops being a tile, and if
   * the survivor said nothing about it the reader would simply have lost a
   * card. One line — "2 findings" — is the difference between composing and
   * suppressing, and it costs a context row rather than a screen.
   *
   * The workbench additionally renders the supporting findings themselves,
   * which is `policy.showsCorroboration` and stays where it was.
   */
  const n = corroborationCount(req.situation)
  if (n > 1) {
    out.push({ label: `${n} findings`, role: 'corroboration' })
  }

  return out.slice(0, policy.contextRows)
}

// ─────────────────────────────────────────────────────────────────────────────
// Space
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A claim the surface will compose from these nouns.
 *
 * The finding carries no sentence — it is semantic, and a headline is UI — so
 * the length has to be estimated from what the sentence will contain. Same
 * approach and same reasoning as `lib/mobile/tile-requirement`: one shared
 * connective constant, because a per-family number here would be a fixed
 * height in disguise. It only ever feeds `claimLinesAt`, so being a few
 * characters out costs a line at worst.
 */
const CLAIM_PHRASING_CHARS = 42

function claimCharsFor(s: Situation): number {
  return (s.subject.ticker ?? s.subject.name).length + CLAIM_PHRASING_CHARS
}

/**
 * Regions the resolver gives up, in the order it gives them up.
 *
 * Corroboration goes first because it is the least of what the reader came
 * for, and the prompt goes last but one because a card that cannot ask its
 * question has stopped being a decision surface. The claim, the metric and the
 * actions are not on the list at all: a tile without them is not a smaller
 * tile, it is a different and useless one, and a resolver permitted to reach
 * that state would produce it on somebody's phone.
 */
const DEGRADATION_ORDER: PlanRegion[] = ['corroboration', 'context', 'body', 'evidence', 'prompt']

// ─────────────────────────────────────────────────────────────────────────────
// The resolver
// ─────────────────────────────────────────────────────────────────────────────

export function resolvePresentation(req: PresentationRequest): PresentationPlan {
  const policy = SURFACE_POLICY[req.surface]
  const rationale: string[] = [`surface ${req.surface}: lead ${policy.lead}, density ${policy.density}`]

  // ── The picture ──────────────────────────────────────────────────────────
  const chosen = primitiveFor(req.situation.lead)
  rationale.push(`predicate ${req.situation.lead.claim.predicate} → ${chosen.primitive} (${chosen.why})`)

  const visuals: PlanVisual[] = []
  const visualReq = requirementFor(chosen.primitive)
  if (chosen.primitive !== 'none' && visualReq) {
    visuals.push({ primitive: chosen.primitive, requirement: visualReq, role: 'lead' })
  }

  // ── The question ─────────────────────────────────────────────────────────
  const prompt = asksPrompt(req, policy)
  rationale.push(`prompt ${prompt.ask ? 'shown' : 'withheld'}: ${prompt.why}`)

  // ── Supporting context ───────────────────────────────────────────────────
  let context = planContext(req, policy)

  // ── What the reader can do ───────────────────────────────────────────────
  const actions = planActions(req, policy)
  rationale.push(`primary ${actions.primary.intent} ${actions.primary.placement}: ${actions.primary.because}`)

  // ── Information hierarchy ────────────────────────────────────────────────
  /**
   * Whether the claim carries a number worth the hero slot.
   *
   * A quantity obviously is one. An INTERVAL is one too: a span has a length,
   * and for a claim whose whole content is that nothing has happened, that
   * length is the only number there is — the shipping research card leads a
   * long quiet with "210d" for exactly that reason.
   *
   * Stated as a property of the claim rather than per predicate, so a future
   * finding with a span and no quantity is not silently left without a hero.
   */
  const hasMetric =
    req.situation.lead.claim.quantity != null || req.situation.lead.claim.interval != null
  const buildOrder = (): PlanRegion[] => {
    const base: PlanRegion[] = ['claim']
    if (hasMetric) base.push('metric')
    if (policy.lead === 'evidence' && visuals.length) {
      // Discovery: the picture sits directly under the claim and carries it.
      base.splice(1, 0, 'evidence')
    } else if (visuals.length) {
      base.push('evidence')
    }
    if (prompt.ask) base.push('prompt')
    if (req.surface !== 'explore') base.push('body')
    if (context.length) base.push('context')
    if (policy.showsCorroboration && req.situation.supporting.length) base.push('corroboration')
    base.push('actions')
    return base
  }

  let order = buildOrder()
  const degraded: PlanRegion[] = []

  // ── Geometry ─────────────────────────────────────────────────────────────
  const buildRequirement = (): TileRequirement => ({
    claimChars: claimCharsFor(req.situation),
    hasMetric,
    hasPrompt: order.includes('prompt'),
    contextRows: order.includes('context') ? Math.min(context.length, policy.contextRows) : 0,
    bodyLines: order.includes('body') ? (policy.density === 'expanded' ? 3 : 2) : 0,
    /**
     * Controls are earned by working, never reserved by resting.
     *
     * A passive card that budgets for a response band is a passive card with a
     * dead strip in it, which is the "185-271px of dead space" the fixture
     * work chased for most of a stage.
     */
    controlRows: req.state === 'active' ? 1 : 0,
    visual: order.includes('evidence') ? (visuals[0]?.requirement ?? null) : null,
    hasDetailRegion: req.state === 'active',
    hasContextAffordance: req.surface !== 'explore',
    hasActionTray: req.surface !== 'desktop_workbench',
    workflow: req.state,
  })

  let requirement = buildRequirement()
  let resolved = req.container ? resolveTile(requirement, req.container) : null

  /**
   * Shed regions until the tile fits, in the declared order.
   *
   * Bounded by the length of `DEGRADATION_ORDER`, so this terminates whatever
   * the container. A tile still capped after every optional region is gone is
   * left capped and says so through `resolved.capped` — clipping loudly beats
   * removing the claim.
   */
  if (resolved) {
    for (const region of DEGRADATION_ORDER) {
      if (!resolved.capped) break
      if (!order.includes(region)) continue
      order = order.filter(r => r !== region)
      degraded.push(region)
      if (region === 'context') context = []
      if (region === 'evidence') visuals.length = 0
      requirement = buildRequirement()
      resolved = resolveTile(requirement, req.container!)
      rationale.push(`dropped ${region}: container ${req.container!.height}px could not hold it`)
    }
  }

  return {
    situationId: req.situation.id,
    question: { id: req.situation.question, prompt: QUESTION_PROMPT[req.situation.question] },
    hierarchy: { order, lead: order.includes(policy.lead) ? policy.lead : 'claim' },
    visuals,
    context,
    actions,
    space: { density: policy.density, requirement, resolved, degraded },
    rationale,
  }
}

/** Re-exported so a caller reading a plan's provenance need not hunt for it. */
export { vintageOf }
