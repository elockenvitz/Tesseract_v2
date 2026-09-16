/**
 * Global Decision Engine — Single source of truth.
 *
 * Evaluates all relevant items for the current user across
 * trade ideas, proposals, projects, ratings, and thesis research.
 * Returns normalized DecisionItem[] split into action vs intel.
 *
 * Pure function — no side effects, no DB calls, no React hooks.
 */

import type { DecisionItem } from './types'
import { postprocess } from './postprocess'
import {
  evaluateProposalAwaiting,
  evaluateExecutionNotConfirmed,
  evaluateIdeaNotSimulated,
  evaluateOverdueDeliverable,
  evaluateRatingNoFollowup,
  evaluateHighExpectedReturn,
  evaluateThesisStale,
  evaluateTradeReviewOwed,
  evaluateResearchChangedSinceView,
  type OpenTradeReviewObligation,
  type ViewedResearchSubject,
} from './evaluators'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GlobalDecisionEngineResult = {
  actionItems: DecisionItem[]
  intelItems: DecisionItem[]
  meta: {
    generatedAt: string
    counts: { action: number; intel: number }
  }
}

export interface EngineArgs {
  userId: string
  role: string
  coverage: {
    assetIds: string[]
    portfolioIds: string[]
  }
  data: {
    tradeIdeas?: any[]
    proposals?: any[]
    decisions?: any[]
    executions?: any[]
    assets?: any[]
    thesisUpdates?: any[]
    /** Newest `thesis.reviewed` per asset id. Moves the staleness clock only;
     *  the thesis's own written date is unchanged wherever it is shown. */
    thesisReviews?: Map<string, string>
    /** Open `trade_review` obligations. Raised and cleared by the lifecycle
     *  rule; this surface only reports them. */
    tradeReviewObligations?: OpenTradeReviewObligation[]
    /** Research subjects and when this reader last opened each one. Together
     *  they answer "what changed since I looked"; neither answers it alone. */
    researchSubjects?: readonly ViewedResearchSubject[]
    assetViewCursors?: Map<string, string>
    organizationId?: string | null
    ratings?: any[]
    ratingChanges?: any[]
    projects?: any[]
    recurrentWorkflows?: any[]
    prompts?: any[]
    catalysts?: any[]
    roleByPortfolioId?: Record<string, string>
  }
  now?: Date
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function runGlobalDecisionEngine(args: EngineArgs): GlobalDecisionEngineResult {
  const now = args.now ?? new Date()
  const allItems: DecisionItem[] = []

  // ---- Action evaluators ----

  // A1: Proposal awaiting decision
  allItems.push(...evaluateProposalAwaiting({
    tradeIdeas: args.data.tradeIdeas,
    now,
    userId: args.userId,
    role: args.role,
    roleByPortfolioId: args.data.roleByPortfolioId,
  }))

  // A2: Execution not confirmed
  allItems.push(...evaluateExecutionNotConfirmed({
    tradeIdeas: args.data.tradeIdeas,
    now,
  }))

  // A3: Idea not simulated
  allItems.push(...evaluateIdeaNotSimulated({
    tradeIdeas: args.data.tradeIdeas,
    proposals: args.data.proposals,
    now,
  }))

  // A4: Overdue deliverables
  allItems.push(...evaluateOverdueDeliverable({
    projects: args.data.projects,
    now,
  }))

  // ---- Risk evaluators ----

  // Rating changed, no follow-up (action)
  allItems.push(...evaluateRatingNoFollowup({
    ratingChanges: args.data.ratingChanges,
    tradeIdeas: args.data.tradeIdeas,
    now,
  }))

  // Intel: High expected return, no idea
  allItems.push(...evaluateHighExpectedReturn({
    assets: args.data.assets,
    tradeIdeas: args.data.tradeIdeas,
  }))

  // Thesis stale (always action)
  allItems.push(...evaluateThesisStale({
    thesisUpdates: args.data.thesisUpdates,
    // A thesis confirmed to still hold is not stale, even if nobody edited it.
    thesisReviews: args.data.thesisReviews,
    now,
  }))

  // Committed trades the lifecycle rule says need review. The obligation is
  // already a row; this only voices it on the surface that exists to say what
  // needs doing.
  allItems.push(...evaluateTradeReviewOwed({
    tradeReviewObligations: args.data.tradeReviewObligations,
    now,
  }))

  // Intel: research that arrived while this reader was not looking. Lands on
  // the intel surface because it is information, not work owed -- so it is
  // scored and sorted apart from the action queue and cannot displace it.
  allItems.push(...evaluateResearchChangedSinceView({
    subjects: args.data.researchSubjects,
    viewCursors: args.data.assetViewCursors,
    organizationId: args.data.organizationId,
  }))

  // I2 (Catalysts) and I4 (Prompts) — skip gracefully if no data
  // Future evaluators can be added here without changing the pipeline.

  // ---- Post-process: dedup, conflict removal, scoring, split ----
  const { actionItems, intelItems } = postprocess(allItems, now)

  return {
    actionItems,
    intelItems,
    meta: {
      generatedAt: now.toISOString(),
      counts: {
        action: actionItems.length,
        intel: intelItems.length,
      },
    },
  }
}
