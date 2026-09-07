/**
 * The one call the phone makes. Producer output in, a renderable card out.
 *
 * ── Why the whole pipeline is behind a single function ────────────────────
 *
 * `MobileDashboard` is seven thousand lines and every one of its feed
 * behaviours — ranking, composition, filtering, continuity, dwell, dispositions
 * — is load-bearing. An adoption that threaded five engine calls through five
 * places in it would be an adoption nobody could remove, and the stage is
 * explicit that this must not become a permanent dual architecture.
 *
 * So the integration surface is exactly two call sites and one function. Turn
 * the flag off and the seam is a pass-through; delete the flag and the seam is
 * two lines to remove.
 *
 * ── Passive, and why that is not a placeholder ────────────────────────────
 *
 * The feed's resting state is a briefing being read. The active state belongs
 * to the panes, which are the reader working inside the card, and those are
 * production's own and untouched by this stage. So the plan is resolved
 * passive and the card face is what changes — which is precisely the bounded
 * adoption the stage asks for.
 *
 * Pure. No React, no Supabase; the caller supplies the reader and the box.
 */

import type { SignalCard } from '../../signals/contract'
import type { TileContainer } from '../../signals/tile-geometry'
import type { CoverageRelevance } from '../../signals/coverage-relevance'
import type { StaleTarget, TargetBreach } from '../../../hooks/mobile/usePortfolioLenses'
import type { DerivedInsight } from '../../../hooks/mobile/useDerivedInsights'
import { composeSituations, type Situation } from '../situation'
import { resolvePresentation } from '../resolver'
import type { PresentationPlan } from '../presentation'
import { displayCopyFor, type DisplayCopy } from './display-copy'
import { projectPlanOntoCard } from './project'
import {
  canReviseArtefact, type ArtefactAuthors, type CapabilityDecision,
} from './capability'
import {
  noCoreThesisAuthors, noCoreThesisFinding, scenarioGapAuthors, scenarioGapFinding,
  staleTargetAuthors, staleTargetFinding, targetHitAuthors, targetHitFinding,
  unreviewedMoveFinding,
  type AdapterDecline, type AdapterResult,
} from './producers'
import { composeTargetPair, type TargetPair } from './target-composition'

export interface MobileViewer {
  /** `useAuth().user?.id`. */
  readerId: string | null | undefined
  /** From `coverageRelevanceFor`, the same value `rankInputFor` supplies. */
  coverage: CoverageRelevance
}

export interface MobileAdoption {
  situation: Situation
  plan: PresentationPlan
  copy: DisplayCopy
  capability: CapabilityDecision
  /** What `SignalCardView` should render. */
  card: SignalCard
}

export type MobileAdoptionResult =
  | { ok: true; adoption: MobileAdoption }
  | AdapterDecline

/**
 * Finish the pipeline once a finding exists.
 *
 * Shared by both families, and that sharing is the proof: from here down
 * nothing knows which producer it came from, which is the same claim the
 * resolver makes and the reason a third family costs an adapter rather than a
 * rendering path.
 */
function complete(
  original: SignalCard,
  result: AdapterResult,
  authors: ArtefactAuthors,
  viewer: MobileViewer,
  container: TileContainer | null,
): MobileAdoptionResult {
  if (!result.ok) return result

  const [situation] = composeSituations([result.finding])
  const capability = canReviseArtefact(authors, viewer.readerId)

  const plan = resolvePresentation({
    situation,
    surface: 'mobile_brief',
    viewer: { canCommit: capability.canCommit, coverage: viewer.coverage },
    container,
    state: 'passive',
  })

  const copy = displayCopyFor(situation, plan)
  const card = projectPlanOntoCard(original, situation, plan, copy)

  return { ok: true, adoption: { situation, plan, copy, capability, card } }
}

/** Target Expired: `usePortfolioLenses` → `buildStaleTargetCard` → here. */
export function adoptStaleTarget(
  source: StaleTarget,
  original: SignalCard,
  viewer: MobileViewer,
  container: TileContainer | null,
): MobileAdoptionResult {
  return complete(
    original,
    staleTargetFinding({ source, card: original, coverage: viewer.coverage }),
    staleTargetAuthors(source),
    viewer,
    container,
  )
}

/** Case vs Price: `useScenarioCards` → `buildScenarioGapCard` → here. */
export function adoptScenarioGap(
  original: SignalCard,
  capital: { weightPct?: number | null } | null,
  viewer: MobileViewer,
  container: TileContainer | null,
): MobileAdoptionResult {
  return complete(
    original,
    scenarioGapFinding({ card: original, capital, coverage: viewer.coverage }),
    scenarioGapAuthors(original),
    viewer,
    container,
  )
}

/** Target Hit: `usePortfolioLenses` → `buildTargetHitCard` → here. */
export function adoptTargetHit(
  source: TargetBreach,
  original: SignalCard,
  viewer: MobileViewer,
  container: TileContainer | null,
): MobileAdoptionResult {
  return complete(
    original,
    targetHitFinding({ source, card: original, coverage: viewer.coverage }),
    targetHitAuthors(),
    viewer,
    container,
  )
}

/**
 * Both target findings on one name, as one situation.
 *
 * ── Why this is a separate entry point ────────────────────────────────────
 *
 * `complete` resolves a plan from a single finding, which is right for every
 * family that produces one. This is the first case where the reader's tile
 * stands for two findings, so the situation has to be composed BEFORE the plan
 * is resolved — a plan built from the lead alone would size, prompt and
 * contextualise a card that is about to carry a corroboration chip it never
 * budgeted for.
 *
 * It is still the ordinary composer and the ordinary resolver. What is special
 * is only that two findings arrive together.
 */
export function adoptComposedTarget(
  pair: TargetPair,
  /** The card belonging to the finding that leads. */
  original: SignalCard,
  viewer: MobileViewer,
  container: TileContainer | null,
): MobileAdoptionResult {
  const composed = composeTargetPair(pair, viewer.coverage)
  if (!composed) {
    return { ok: false, reason: 'insufficient_facts', detail: `${pair.assetId}: no target finding` }
  }

  const capability = canReviseArtefact(
    pair.expired ? staleTargetAuthors(pair.expired.row) : targetHitAuthors(),
    viewer.readerId,
  )

  const plan = resolvePresentation({
    situation: composed.situation,
    surface: 'mobile_brief',
    viewer: { canCommit: capability.canCommit, coverage: viewer.coverage },
    container,
    state: 'passive',
  })

  const copy = displayCopyFor(composed.situation, plan)
  const card = projectPlanOntoCard(original, composed.situation, plan, copy)

  return { ok: true, adoption: { situation: composed.situation, plan, copy, capability, card } }
}

/**
 * The Research producer, both halves.
 *
 * One entry point because one producer emits both: `useDerivedInsights` yields
 * a `no_thesis` or a `stale_research` insight and `buildInsightCard` renders
 * either. Which adapter runs is the insight's own `kind` — the same boundary
 * `insightSignalType` draws — so the adopted set cannot widen because a framing
 * was reclassified upstream.
 */
export function adoptResearchInsight(
  insight: DerivedInsight,
  original: SignalCard,
  viewer: MobileViewer,
  container: TileContainer | null,
): MobileAdoptionResult {
  return insight.kind === 'stale_research'
    ? complete(
        original,
        unreviewedMoveFinding({ insight, card: original, coverage: viewer.coverage }),
        noCoreThesisAuthors(),
        viewer,
        container,
      )
    : adoptNoCoreThesis(insight, original, viewer, container)
}

/** No Core Thesis: `useDerivedInsights` → `buildInsightCard` → here. */
export function adoptNoCoreThesis(
  insight: DerivedInsight,
  original: SignalCard,
  viewer: MobileViewer,
  container: TileContainer | null,
): MobileAdoptionResult {
  return complete(
    original,
    noCoreThesisFinding({ insight, card: original, coverage: viewer.coverage }),
    noCoreThesisAuthors(),
    viewer,
    container,
  )
}

/**
 * The card to render, whatever happened.
 *
 * A decline returns the production card unchanged. That is the property that
 * makes the flag safe to leave on: the worst case is that a card looks exactly
 * as it does today, never that it disappears.
 */
export function cardOrOriginal(original: SignalCard, result: MobileAdoptionResult): SignalCard {
  return result.ok ? result.adoption.card : original
}
