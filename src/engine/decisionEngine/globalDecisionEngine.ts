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
    ratings?: any[]
    ratingChanges?: any[]
    projects?: any[]
    recurrentWorkflows?: any[]
    prompts?: any[]
    catalysts?: any[]
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
    now,
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
