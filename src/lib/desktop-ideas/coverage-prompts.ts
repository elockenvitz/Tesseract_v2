/**
 * Ideas' thin-field backfill: coverage names worth thinking about, as ordinary
 * Ideas tiles.
 *
 * A newly graduated account has almost nothing open, and an Ideas lens with two
 * tiles says the product has nothing to offer. The reader's own coverage does:
 * a position nobody has an idea on, a name that moved since the case was last
 * looked at, evidence that arrived and was never acted on, a case that was
 * never written.
 *
 * These are SUGGESTIONS. Nothing here writes a row: a prompt carries the
 * asset and the reason, and the tile's action opens the product's existing
 * capture form with that asset bound (lib/today/create-actions). A trade idea
 * exists only once the reader submits one.
 *
 * ── What decides the order ────────────────────────────────────────────────
 *
 * Real ideas always rank first and are never displaced -- prompts sit in their
 * own tiers below every real idea (lib/desktop-ideas/rank). Among prompts:
 * exposure and change first, a bare covered name last, with structural caps so
 * fifty names with no thesis cannot become fifty identical tiles.
 *
 * Nothing here decides which names have which gap (the shared coverage source)
 * or what "most important" means (lib/research/coverage-work). This says it in
 * Ideas' shape and decides how many Ideas can use.
 */

import type { CoverageResearchCandidate } from '../research/coverage-research-gaps'
import { coverageWorkContext, selectCoverageWork, type StructuralKey } from '../research/coverage-work'
import { CORE_SECTION_LABEL } from '../research/case-state'
import type { IdeaRow } from './model'

/** A thin Ideas field is topped up to this many tiles with prompts. */
export const IDEAS_FIELD_TARGET = 8

/** At most this many prompts, however thin the field: a page of suggestions is not a queue. */
export const IDEAS_PROMPT_LIMIT = 6

/** Generated prompts allowed per structural gap: repetition is the failure mode. */
export const IDEAS_PROMPT_CAPS: Record<StructuralKey, number> = {
  'no_case:unheld': 2,
  incomplete_case: 2,
  long_silence: 2,
}

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

/** Where the exposure sits, in words, or null for a name nobody holds. */
function position(c: CoverageResearchCandidate): string | null {
  const e = c.exposure
  if (!e.held || e.weightPct == null || e.weightPct <= 0) return null
  return e.portfolioName
    ? `${e.weightPct.toFixed(1)}% position in ${e.portfolioName}`
    : `${e.weightPct.toFixed(1)}% position`
}

/** The short state, in the reader's words: what kind of prompt this is. */
export function promptLabel(c: CoverageResearchCandidate): string {
  switch (c.framing) {
    case 'new_evidence': return 'New evidence, no idea'
    case 'price_move': return 'Moved, no idea'
    case 'incomplete_case': return 'Case unfinished, no idea'
    case 'long_silence': return 'Not looked at, no idea'
    case 'no_case':
      return position(c) ? 'Position without an idea' : 'Covered, no idea'
  }
}

/**
 * Why this name is worth thinking about now.
 *
 * The emphasis follows what is actually true of it: the exposure where there
 * is one, the change where something changed, the missing case where that is
 * the gap, and coverage alone last.
 */
export function promptClaim(c: CoverageResearchCandidate): string {
  const t = c.symbol
  const f = c.facts
  const where = position(c)
  const since = f.anchoredOn === 'reviewed' ? 'last reviewed' : 'written'
  switch (c.framing) {
    case 'new_evidence': {
      const n = f.evidenceSince.length
      const what = `${t} has ${n === 1 ? 'new evidence' : `${n} new research items`} since the case was ${since} and no active idea`
      return where ? `${what}, on a ${where}.` : `${what}.`
    }
    case 'price_move': {
      const what = `${t} has moved ${pct(f.movePct ?? 0)} since the case was ${since}, with no active idea`
      return where ? `${what} on a ${where}.` : `${what}.`
    }
    case 'incomplete_case': {
      const missing = f.missingSections.map(s => (CORE_SECTION_LABEL[s] ?? s).toLowerCase()).join(' and ')
      const what = `The ${t} case is missing ${missing}, and no idea is open on it`
      return where ? `${what} — a ${where}.` : `${what}.`
    }
    case 'long_silence': {
      const span = f.daysSinceReview != null ? `${f.daysSinceReview} days` : 'over 90 days'
      const what = `Nothing has been recorded on ${t} in ${span} and no idea is open`
      return where ? `${what} on a ${where}.` : `${what}.`
    }
    case 'no_case':
      return where
        ? `A ${where} with no active idea and no written thesis.`
        : `${t} is on your coverage with no active idea.`
  }
}

/**
 * One candidate as an ordinary Ideas row.
 *
 * Deliberately an `IdeaRow`: it renders through the same card, the same
 * densities and the same footer as every other tile, so a reader cannot tell
 * this is a thin-account layout. `generated` is what stops it pretending to be
 * a trade idea -- no direction, no maturity claim, and an action that opens
 * capture rather than a detail pane that does not exist.
 */
export function coverageIdeaPrompt(c: CoverageResearchCandidate): IdeaRow {
  const e = c.exposure
  const held = e.held && e.weightPct != null && e.weightPct > 0
  return {
    id: `coverage-prompt:${c.framing}:${c.assetId}`,
    assetId: c.assetId,
    symbol: c.symbol,
    companyName: c.companyName,
    direction: null,
    stage: null,
    maturity: 'researching',
    conviction: null,
    thesis: promptClaim(c),
    urgency: null,
    proposedWeight: null,
    portfolioId: held ? e.portfolioId : null,
    portfolioName: held ? e.portfolioName : null,
    createdBy: null,
    authorName: null,
    createdAt: c.facts.reviewAnchor ?? new Date().toISOString(),
    updatedAt: null,
    decisionOutcome: null,
    generated: {
      source: 'coverage',
      framing: c.framing,
      coverage: c.coverage,
      context: coverageWorkContext(c),
      label: promptLabel(c),
      weightPct: held ? e.weightPct! : null,
      movePct: c.framing === 'price_move' ? c.facts.movePct : null,
      priority: c.priority,
      score: c.score,
    },
  }
}

/**
 * The prompts a thin Ideas field should show, in work order.
 *
 * `realCount` is how many real ideas the field already holds; `ideaAssetIds`
 * is every asset they concern -- including ideas hidden from the field, such
 * as a graduated pilot's seeded demo rows -- so a prompt never suggests
 * starting work that already exists somewhere.
 */
export function coverageIdeaPrompts(
  candidates: readonly CoverageResearchCandidate[],
  { realCount, ideaAssetIds }: { realCount: number; ideaAssetIds: ReadonlySet<string> },
): IdeaRow[] {
  const room = Math.min(IDEAS_PROMPT_LIMIT, IDEAS_FIELD_TARGET - realCount)
  if (room <= 0) return []
  return selectCoverageWork(candidates, {
    limit: room,
    caps: IDEAS_PROMPT_CAPS,
    exclude: ideaAssetIds,
  }).map(coverageIdeaPrompt)
}
