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
import type { StaleTarget } from '../../../hooks/mobile/usePortfolioLenses'
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
  staleTargetAuthors, staleTargetFinding,
  type AdapterDecline, type AdapterResult,
} from './producers'

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
