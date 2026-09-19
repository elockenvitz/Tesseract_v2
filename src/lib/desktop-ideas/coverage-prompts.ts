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
/* Explore's shape, for the desktop Ideas field. Type-only: nothing here
   composes or ranks -- that stays with `diversifyExplore`. */
import type { ExploreItem } from '../mobile/explore-item'

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

/**
 * The same candidate, in Explore's shape.
 *
 * ── Why a second projection rather than a second selector ─────────────────
 *
 * Desktop Ideas stopped rendering `IdeaRow`s: its field is the opportunity
 * set, composed from Explore's candidates and ranked by `diversifyExplore`.
 * A prompt that stayed an `IdeaRow` simply never reached the screen.
 *
 * What does NOT move is the selection. `coverageExplorePrompts` below calls
 * the very same `selectCoverageWork` with the very same caps and the very
 * same exclusion set, so every safety rule that governed the old field
 * governs this one:
 *
 *   - a name an idea already concerns is excluded, including ideas hidden
 *     from the field (a graduated pilot's seeded demo rows), because the
 *     caller passes those asset ids in `exclude`
 *   - `IDEAS_PROMPT_CAPS` still stops fifty no-thesis names becoming fifty
 *     identical tiles
 *   - `IDEAS_PROMPT_LIMIT` still holds: a page of suggestions is not a queue
 *
 * Only the shape changed. Splitting the rule from the projection is what
 * keeps that true -- if the selector had been reimplemented here, the two
 * surfaces would have started disagreeing about which names are fair game.
 *
 * ── Still a suggestion, and still says so ─────────────────────────────────
 *
 * `subtype: 'research'` with `signalType: 'coverage_prompt'` is what
 * `opportunityKind` reads to label the chip, and it resolves to its own kind
 * rather than borrowing `authored`. A generated opportunity never wears an
 * authored idea's vocabulary -- the reader can always tell which of the two
 * they are looking at, which was the rule when these were `IdeaRow`s too.
 *
 * `positive` is deliberately absent, which reads as false: every framing here
 * is a GAP -- no idea, no case, nothing recorded -- so the exposure bar is the
 * right picture where a weight exists, and `question` carries the candidate's
 * own prompt where it does not.
 */
export function coverageExplorePrompt(c: CoverageResearchCandidate): ExploreItem {
  const e = c.exposure
  const held = e.held && e.weightPct != null && e.weightPct > 0
  return {
    id: `coverage-prompt:${c.framing}:${c.assetId}`,
    /* Keyed on the ASSET, not the framing: two framings of one name are one
       thing to think about, and `dedupeExplore` should collapse them. */
    dedupeKey: `coverage_prompt:${c.assetId}`,
    signalType: 'coverage_prompt',
    category: 'research',
    subtype: 'research',
    title: promptClaim(c),
    context: coverageWorkContext(c),
    state: promptLabel(c),
    symbol: c.symbol,
    assetId: c.assetId,
    companyName: c.companyName,
    metric: held
      ? { value: `${e.weightPct!.toFixed(1)}%`, label: 'position', direction: 'neutral' }
      : c.framing === 'price_move' && c.facts.movePct != null
        ? {
            value: pct(c.facts.movePct),
            label: 'since last look',
            direction: c.facts.movePct >= 0 ? 'good' : 'bad',
          }
        : undefined,
    portfolio: held
      ? { weightPct: e.weightPct!, name: e.portfolioName ?? undefined }
      : undefined,
    occurredAt: c.facts.reviewAnchor ?? null,
    /*
      Capture, not a detail pane.

      A prompt has no row behind it, so there is nothing to open. The action
      is the product's existing capture form with the asset bound -- the same
      destination the tile had as an `IdeaRow`. A trade idea exists only once
      the reader submits one.
    */
    destination: {
      kind: 'action',
      action: 'create_idea',
      assetId: c.assetId,
      symbol: c.symbol,
    },
    /* The scan's own strength, clamped to Explore's range. Not re-derived:
       `selectCoverageWork` already ordered these by the same number. */
    importance: Math.max(0, Math.min(1, c.score)),
    visual: {
      /* The candidate's own question, for the `question` archetype. Resolved
         last, so a weight still draws exposure and a move still draws its
         anchor -- the prompt fills the cards that would draw nothing. */
      question: c.prompt,
      movePct: c.framing === 'price_move' ? c.facts.movePct : null,
      lastLookAt: c.facts.reviewAnchor,
    },
  }
}

/**
 * The coverage prompts the opportunity set should carry.
 *
 * `realCount` is how many candidates the field already holds from every other
 * producer, so a full page of real findings admits no prompts at all -- the
 * thin-field rule, unchanged, just counting a different population.
 */
export function coverageExplorePrompts(
  candidates: readonly CoverageResearchCandidate[],
  { realCount, ideaAssetIds }: { realCount: number; ideaAssetIds: ReadonlySet<string> },
): ExploreItem[] {
  const room = Math.min(IDEAS_PROMPT_LIMIT, IDEAS_FIELD_TARGET - realCount)
  if (room <= 0) return []
  return selectCoverageWork(candidates, {
    limit: room,
    caps: IDEAS_PROMPT_CAPS,
    exclude: ideaAssetIds,
  }).map(coverageExplorePrompt)
}
