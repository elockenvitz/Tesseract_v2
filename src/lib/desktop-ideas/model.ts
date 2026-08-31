/**
 * Desktop Ideas — the canonical Idea object.
 *
 * An Idea is an investment object: what we believe, how mature the belief is,
 * what has changed, and what should happen next. It is not an alert and not a
 * queue row — attention is a STATE around an Idea, which is why Today surfaces
 * findings and this surfaces objects.
 *
 * ── Direction and maturity are separate, because the data says so ─────────
 *
 * `trade_queue_items` carries BOTH `action` (buy | sell | add | trim) and
 * `stage` (the research pipeline). Collapsing them into one badge is what
 * produced "WATCH" for anything early — which is a claim about conviction made
 * from a fact about progress. "BUY · RESEARCHING" is both truthful and more
 * useful: we lean long, and the work is not finished.
 */

import type { EngagementTarget } from '../engagement'

/** What we intend to do. From `trade_queue_items.action`. */
export type IdeaDirection = 'buy' | 'sell' | 'add' | 'trim'

/**
 * How far the thinking has got. Bucketed from the real stage vocabulary.
 *
 * `ResearchStage` is aware → investigate → deep_research → thesis_forming →
 * ready_for_decision, and legacy rows still carry idea/working_on/modeling/
 * deciding. Four buckets is the smallest set that keeps the distinctions a
 * reader acts on: still gathering, forming a view, ready to decide, being
 * decided.
 */
export type IdeaMaturity = 'researching' | 'thesis_forming' | 'decision_ready' | 'deciding'

export const MATURITY_LABEL: Record<IdeaMaturity, string> = {
  researching: 'Researching',
  thesis_forming: 'Thesis forming',
  decision_ready: 'Decision ready',
  deciding: 'Deciding',
}

const STAGE_TO_MATURITY: Record<string, IdeaMaturity> = {
  aware: 'researching',
  idea: 'researching',
  investigate: 'researching',
  research: 'researching',
  analysis: 'researching',
  deep_research: 'researching',
  discussing: 'researching',
  working_on: 'thesis_forming',
  thesis_forming: 'thesis_forming',
  modeling: 'thesis_forming',
  simulating: 'thesis_forming',
  ready_for_decision: 'decision_ready',
  deciding: 'deciding',
}

export function maturityOf(stage: string | null | undefined): IdeaMaturity {
  return (stage && STAGE_TO_MATURITY[stage]) ?? 'researching'
}

export type IdeaConviction = 'low' | 'medium' | 'high'

/** The row as the scan needs it — deliberately light. */
export interface IdeaRow {
  id: string
  assetId: string | null
  symbol: string | null
  companyName: string | null
  direction: IdeaDirection | null
  stage: string | null
  maturity: IdeaMaturity
  conviction: IdeaConviction | null
  /** `rationale` — the central claim, as written. */
  thesis: string | null
  urgency: string | null
  proposedWeight: number | null
  portfolioId: string | null
  portfolioName: string | null
  createdBy: string | null
  authorName: string | null
  createdAt: string
  updatedAt: string | null
  decisionOutcome: string | null
}

/**
 * Which single visual explains this Idea.
 *
 * One per Idea, never several stacked. `thesis` is a real answer, not a
 * fallback for failure: an early Idea whose whole content is a written claim
 * is best served by that claim set large, and a chart would be decoration.
 *
 * There is deliberately no `catalyst` family. No durable catalyst/event data
 * exists in what Ideas can read, and a fabricated date is worse than none.
 */
export type IdeaFamily =
  | 'thesis'       // the written claim leads
  | 'target'       // current against target
  | 'scenario'     // the desk's own ladder, and where price sits in it
  | 'performance'  // movement over an honestly-named window
  | 'conviction'   // what changed about the Idea itself
  | 'team'         // ownership and who is waiting

export interface IdeaEnrichment {
  history?: { date: string; close: number }[]
  spot?: number
  ladder?: { cases: { name: string; price: number }[]; updatedAt: string }
  target?: number
  weightPct?: number
  marketValue?: number
  researchCount?: number
  collaborators?: number
}

/**
 * Pick the family.
 *
 * Ordered by how much the datum explains, not by how good it looks. A ladder
 * beats a single target because it shows the whole framework; a target beats
 * raw movement because it carries intent; movement beats a bare claim only
 * when the series actually reaches the Idea's creation.
 */
export function familyFor(idea: IdeaRow, e: IdeaEnrichment | undefined): IdeaFamily {
  if (e?.ladder && e.ladder.cases.length >= 2 && e.spot != null) return 'scenario'
  if (e?.target != null && e.spot != null) return 'target'
  if (e?.history && e.history.length >= 2) return 'performance'
  if (idea.maturity === 'deciding' || idea.maturity === 'decision_ready') return 'team'
  if (idea.conviction) return 'conviction'
  return 'thesis'
}

/* -------------------------------------------------------------------------- */
/* Engagement                                                                 */
/* -------------------------------------------------------------------------- */

/** The one-line situation, used as the issue title and in the pane header. */
export function issueFor(idea: IdeaRow, e: IdeaEnrichment | undefined): string {
  if (e?.ladder && e.spot != null) {
    const bull = Math.max(...e.ladder.cases.map(c => c.price))
    if (e.spot > bull) return 'Spot is above the current bull case'
  }
  if (idea.maturity === 'decision_ready') return 'Ready for a decision, undecided'
  if (idea.maturity === 'deciding') return 'A decision is in progress'
  if (idea.maturity === 'researching') return 'Still being researched'
  return 'Thesis is forming'
}

/**
 * A question worth asking the model about THIS Idea at THIS maturity.
 *
 * Maturity-aware because the useful question genuinely differs: an Idea being
 * researched needs to know what is missing; one ready to decide needs to know
 * what the decision hinges on. A single generic prompt would be the
 * context-recreation the D1 seam exists to remove.
 */
export function seedPromptFor(idea: IdeaRow, e: IdeaEnrichment | undefined): string {
  const t = idea.symbol ?? 'this idea'
  if (e?.ladder && e.spot != null && e.spot > Math.max(...e.ladder.cases.map(c => c.price))) {
    return `${t} is trading above every case in our current framework. What would need to change in the framework to justify the current price?`
  }
  switch (idea.maturity) {
    case 'researching':
      return `What evidence is still missing before this ${t} idea is ready for a decision?`
    case 'thesis_forming':
      return `Which claims in this ${t} thesis are load-bearing, and which are still assumptions?`
    case 'decision_ready':
      return `What assumptions most determine whether this ${t} idea should become a position?`
    case 'deciding':
      return `A decision on ${t} is in progress. What would most change the answer, and what is the strongest case against it?`
  }
}

/**
 * The primary investment verb for this Idea.
 *
 * Never "Open" or "View" — the verb says how the investor moves the situation
 * forward. Returns null when nothing specific applies, and the tile then shows
 * no primary rather than a generic one.
 */
export function primaryActionFor(idea: IdeaRow, e: IdeaEnrichment | undefined): string | null {
  if (e?.ladder && e.spot != null && e.spot > Math.max(...e.ladder.cases.map(c => c.price))) {
    return 'Review scenarios'
  }
  switch (idea.maturity) {
    case 'researching': return 'Advance research'
    case 'thesis_forming': return 'Advance thesis'
    case 'decision_ready': return 'Decide'
    case 'deciding': return 'Review decision'
  }
}

export function targetFor(idea: IdeaRow, e: IdeaEnrichment | undefined): EngagementTarget | null {
  if (!idea.id) return null
  const chips: { label: string; value: string }[] = []
  if (idea.direction) chips.push({ label: 'Direction', value: idea.direction.toUpperCase() })
  chips.push({ label: 'Maturity', value: MATURITY_LABEL[idea.maturity] })
  if (idea.conviction) chips.push({ label: 'Conviction', value: idea.conviction })
  if (idea.thesis) chips.push({ label: 'Thesis', value: 'on record' })
  if (e?.target != null) chips.push({ label: 'Target', value: e.target.toFixed(2) })
  if (e?.ladder) chips.push({ label: 'Framework', value: `${e.ladder.cases.length} cases` })
  if (e?.weightPct != null) chips.push({ label: 'Weight', value: `${e.weightPct.toFixed(1)}%` })
  if (idea.portfolioName) chips.push({ label: 'Portfolio', value: idea.portfolioName })
  if (e?.researchCount) chips.push({ label: 'Research', value: `${e.researchCount} docs` })

  return {
    // `trade_idea` is already in DISCUSSABLE_OBJECT_TYPES, so Team works from
    // day one without widening the allowlist.
    objectType: 'trade_idea',
    objectId: idea.id,
    label: idea.symbol ? `${idea.symbol} idea` : 'Trade idea',
    symbol: idea.symbol ?? undefined,
    assetId: idea.assetId ?? undefined,
    portfolioId: idea.portfolioId ?? undefined,
    portfolioName: idea.portfolioName ?? undefined,
    origin: { itemId: idea.id, surface: 'ideas' },
    issue: {
      title: issueFor(idea, e),
      detail: idea.thesis ?? undefined,
      reason: `idea:${idea.maturity}`,
      detectedAt: idea.updatedAt ?? idea.createdAt,
    },
    seedPrompt: seedPromptFor(idea, e),
    contextChips: chips,
  }
}
