/**
 * A plan, projected onto the card contract the phone already renders.
 *
 * ── Why a projection and not a component ──────────────────────────────────
 *
 * The stage says: render the plan through `SignalCardView` and the shared
 * primitives, and do not add a component per situation. `SignalCardView` takes
 * a `SignalCard`. So the shortest honest path from a plan to pixels is a pure
 * function into that contract — no JSX, no new file under `components/`, and
 * nothing for a seventh situation to fork.
 *
 * ── Why it starts from the production card ────────────────────────────────
 *
 * Because a `SignalCard` carries two kinds of field and only one of them is
 * presentation:
 *
 *   identity and feed contract   id, type, surface, severity, entity,
 *                                dedupeKey, expiry, provenance, capital
 *   presentation                 headline, metric, body, prompt, context,
 *                                evidence kind, action placement
 *
 * The first set is what ranking, dedupe, filtering, dispositions, dwell
 * tracking and pane state are all keyed by. Regenerating any of it would be a
 * change to the feed contract wearing a rendering change's clothes — a new
 * `dedupeKey` alone would resurface a card the reader had already dealt with.
 *
 * So the projection REPLACES the second set and PRESERVES the first, and the
 * preserved half is the mechanical guarantee that the feed contract is
 * untouched no matter what the resolver decides.
 *
 * ── What the plan is actually allowed to change ───────────────────────────
 *
 * The card face and only the card face. That is a real adoption — the reader
 * sees the resolver's hierarchy, its context budget, its action placement and
 * its choice of picture — and it is bounded, which is what makes it safe to
 * run beside the shipping path.
 *
 * Pure. No React.
 */

import type {
  CardAction, CardActions, CardContextChip, CardEvidence, EvidenceKind,
  SignalCard, Surface,
} from '../../signals/contract'
import type { FeedActionKey } from '../../signals/feed-actions'
import type { ReaderQuestion } from '../../signals/reader-question'
import type { ActionIntent } from '../finding'
import type { PresentationPlan, VisualPrimitive } from '../presentation'
import type { Situation } from '../situation'
import type { DisplayCopy } from './display-copy'

/**
 * The accent rail, from the question rather than from the card family.
 *
 * `Surface` is the four-or-five word vocabulary the rail already speaks, and a
 * question maps onto it cleanly because both are answers to "what kind of
 * claim is this". Deriving it means a new situation gets a rail without anyone
 * choosing a colour, which is the sort of decision that otherwise gets made
 * once per family and inconsistently.
 */
const SURFACE_FOR_QUESTION: Record<ReaderQuestion, Surface> = {
  target: 'research',
  framework: 'research',
  thesis: 'research',
  research: 'research',
  sizing: 'risk',
  workflow: 'workflow',
  market: 'market',
  idea: 'desk',
}

/**
 * Which evidence slot a primitive occupies in the card contract.
 *
 * `EvidenceKind` is the contract's own small vocabulary and it is coarser than
 * the plan's: several primitives legitimately land on `sparkline`, because
 * from the CARD's point of view they are all "a series with something marked
 * on it". The mapping is many-to-one on purpose — a finer evidence kind would
 * be a second visual vocabulary, and the plan already owns that one.
 *
 * `SignalCardView` reads this field only as a gate (`kind !== 'none'`); the
 * node itself is supplied by the caller. So this decides whether the band
 * exists, and the plan's own `visuals` decide what goes in it.
 */
const EVIDENCE_FOR_PRIMITIVE: Record<VisualPrimitive, EvidenceKind> = {
  scenario_range: 'scenario_ladder',
  target_compare: 'sparkline',
  timeline: 'timeline',
  exposure: 'peer_bar',
  comparison: 'peer_bar',
  last_look: 'sparkline',
  workflow: 'timeline',
  quote: 'none',
  price_trend: 'sparkline',
  none: 'none',
}

/**
 * The destination behind each intent.
 *
 * `FeedActionKey` is the complete vocabulary of what the card surface can
 * actually do, and it exists precisely so a label cannot promise a place
 * nothing routes to. Mapping intents onto it rather than inventing ids is what
 * keeps the engine from declaring an action the phone cannot perform.
 *
 * `resize_position` has no key: nothing in the feed resizes a position inline
 * today, and minting one here would be a button that type-checks and does
 * nothing. It falls through to inspection, which is honest.
 */
const ACTION_FOR_INTENT: Record<ActionIntent, { key: FeedActionKey; label: string } | null> = {
  revise_price_objective: { key: 'review_target', label: 'Review target' },
  reaffirm_case: { key: 'open_cases', label: 'Review cases' },
  record_judgment: { key: 'capture', label: 'Capture' },
  /**
   * `add_rationale`, which is where the shipping card sends this reader.
   *
   * `buildInsightCard` routes `no_research` to `add_rationale` and everything
   * else in the family to `update_thesis`, and the two are different
   * destinations rather than two labels for one. The parity harness caught the
   * engine sending a reader with no written case to the editor for revising one.
   */
  write_thesis: { key: 'add_rationale', label: 'Write the thesis' },
  revise_thesis: { key: 'update_thesis', label: 'Update the thesis' },
  review_evidence: { key: 'open_research', label: 'Review the evidence' },
  assign_coverage: { key: 'open_coverage', label: 'Assign coverage' },
  close_loop: { key: 'resolve', label: 'Close the loop' },
  inspect_subject: { key: 'open_asset', label: 'Open' },
  resize_position: null,
}

/** Always last in the menu, exactly as `builders/shared` places it. */
const WHY: CardAction = { id: 'why', label: 'Why am I seeing this', inline: true }

/**
 * Snooze and dismiss, preserved from the card being projected.
 *
 * Read off the original rather than restated so triage cannot go missing from
 * one path and not the other — a card you cannot get rid of is a card that
 * trains people to scroll past the surface, and having that be true only under
 * a flag would be worse than having it be true everywhere.
 */
function triageFrom(original: SignalCard): CardAction[] {
  return original.actions.menu.filter(a => a.id === 'snooze' || a.id === 'dismiss')
}

function toCardAction(intent: ActionIntent, inline: boolean): CardAction | null {
  const mapped = ACTION_FOR_INTENT[intent]
  if (!mapped) return null
  return { id: mapped.key, label: mapped.label, inline }
}

/**
 * The plan's actions, in the contract's three slots.
 *
 * `inline` on the plan becomes `quick`; `on_engage` and `menu` both become
 * `menu`, because the card contract has two resting places and the plan has
 * three. Collapsing rather than adding a slot: `on_engage` is a statement
 * about WHEN a control appears, which `JudgmentPresentation` already owns for
 * this surface, and expressing it twice would let the two disagree.
 */
function projectActions(plan: PresentationPlan, original: SignalCard): CardActions {
  const primary =
    toCardAction(plan.actions.primary.intent, true)
    ?? { id: 'open_asset' as FeedActionKey, label: 'Open', inline: true }

  const quick: CardAction[] = []
  const menu: CardAction[] = []
  for (const a of plan.actions.secondary) {
    const mapped = toCardAction(a.intent, a.placement === 'inline')
    if (!mapped) continue
    // Two quick actions at most. Four buttons on a 390px row gave triage the
    // same weight as the decision — the rule `CardActions` already records.
    if (a.placement === 'inline' && quick.length < 2) quick.push(mapped)
    else menu.push(mapped)
  }

  return {
    primary,
    quick,
    menu: [...menu, ...triageFrom(original), WHY],
    /** The navigation is the original's: it already resolves to a real tab. */
    open: original.actions.open,
  }
}

/**
 * The context row, from the plan's budget and the original's chips.
 *
 * ── Why the chips are not regenerated ─────────────────────────────────────
 *
 * A chip carrying `portfolios` is a DISCLOSURE — `SignalCardView` turns it
 * into an in-card sheet listing the books, with routing behind each row. That
 * payload is real data the producer fetched, and a chip rebuilt from the plan's
 * label-and-value pair would be the same words with the disclosure silently
 * removed. The reader would tap it and nothing would happen.
 *
 * So the plan decides HOW MANY context rows survive and the original supplies
 * WHAT IS IN THEM. The plan's own items are provenance and stakes, which the
 * card states in its eyebrow and metric already.
 */
function projectContext(plan: PresentationPlan, original: SignalCard): CardContextChip[] {
  if (!plan.hierarchy.order.includes('context')) return []
  const budget = plan.space.requirement.contextRows ?? 0
  if (budget <= 0) return []
  /**
   * The corroboration chip is the engine's own, and it goes first.
   *
   * Everything else on this row is the producer's — a chip carrying
   * `portfolios` is a live disclosure and rebuilding it from a label would
   * quietly remove the sheet behind it. But "2 findings" exists only because
   * the engine merged something, so no producer can supply it, and it is the
   * one line telling the reader a second card was folded in rather than lost.
   *
   * First because it is the reason this tile looks different from the two the
   * reader would have seen yesterday.
   */
  const corroboration = plan.context.filter(c => c.role === 'corroboration')
  const mine: CardContextChip[] = corroboration.map(c => ({ label: c.label }))

  // One chip per row: the rows are the budget the geometry was resolved
  // against, so spending two chips on one row would size the card against a
  // layout it is not being given.
  return [...mine, ...original.context].slice(0, budget)
}

function projectEvidence(plan: PresentationPlan, original: SignalCard): CardEvidence | undefined {
  /**
   * A producer that supplied no evidence keeps none.
   *
   * The plan names a SHAPE and the producer owns the numbers that fill it. The
   * Research family sets no `evidence` at all — its pictures are panes the feed
   * composes — so stamping a `sparkline` onto it would be the card asserting a
   * picture with `data: null` behind it, which is the guess `explore-visual`
   * refuses to draw. The plan still records the primitive; the card contract
   * just does not claim one that has nothing in it.
   */
  if (!original.evidence) return undefined

  const lead = plan.visuals.find(v => v.role === 'lead')
  if (!lead) return { kind: 'none', data: null }
  const kind = EVIDENCE_FOR_PRIMITIVE[lead.primitive]
  if (kind === 'none') return { kind: 'none', data: null }
  /**
   * The DATA stays the producer's.
   *
   * The plan names a shape and the producer owns the numbers that fill it.
   * Rebuilding `data` here would put a second assembler of ladder geometry in
   * the codebase, which is the defect `deriveScenarioState` exists to have
   * ended.
   */
  return {
    kind,
    data: original.evidence?.data ?? null,
    ...(original.evidence?.annotations ? { annotations: original.evidence.annotations } : {}),
  }
}

/**
 * The card a plan renders as.
 *
 * Identity and feed-contract fields come from `original` untouched; everything
 * the reader sees comes from the plan and its copy.
 */
export function projectPlanOntoCard(
  original: SignalCard,
  situation: Situation,
  plan: PresentationPlan,
  copy: DisplayCopy,
): SignalCard {
  return {
    // ── Preserved: identity and feed contract ────────────────────────────
    id: original.id,
    type: original.type,
    severity: original.severity,
    entity: original.entity,
    provenance: original.provenance,
    expiry: original.expiry,
    dedupeKey: original.dedupeKey,
    ...(original.capital ? { capital: original.capital } : {}),
    ...(original.kindLabel ? { kindLabel: original.kindLabel } : {}),

    // ── Replaced: presentation ───────────────────────────────────────────
    surface: SURFACE_FOR_QUESTION[situation.question],
    headline: copy.headline,
    metric: copy.metric
      ? {
          value: copy.metric.value,
          label: copy.metric.label,
          /**
           * Provenance from the original's own metric.
           *
           * The vintage rules are per-number and were argued out once — a
           * computed figure inherits the provenance of its stalest input. The
           * copy layer restates the VALUE; it has no business restating where
           * the value came from.
           */
          direction: original.metric?.direction,
          source: original.metric?.source ?? 'computed',
          asOf: original.metric?.asOf ?? original.provenance.occurredAt,
          ...(original.metric?.vintage ? { vintage: original.metric.vintage } : {}),
        }
      : null,
    body: copy.body,
    ...(copy.prompt ? { prompt: copy.prompt } : {}),
    context: projectContext(plan, original),
    evidence: projectEvidence(plan, original),
    actions: projectActions(plan, original),
  }
}
