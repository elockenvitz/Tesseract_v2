/**
 * Today — turning real evaluator output into a surfaced item.
 *
 * ── Everything here is derived from data the engine already loads ─────────
 *
 * No new query, no new column, no schema change. The evaluators publish what
 * they found as `chips` (label/value pairs), `context` (ids and a few typed
 * extras) and `ctas`. This module reads exactly that.
 *
 * Where a specialised visual needs a number the evaluator does not carry, the
 * item degrades to `metrics` rather than inventing one. That is why there is
 * no scenario-band archetype here: `useDecisionEngine` loads holdings, theses,
 * trade queue items, ratings and projects — it does not load scenario ladders
 * or price history, so a bear/base/bull band would be drawing numbers that do
 * not exist. Adding that data is a later stage; faking it is never one.
 */

import type { DecisionItem } from '../../engine/decisionEngine/types'
import { fromDecisionContext } from '../engagement'
import type { EngagementTarget } from '../engagement'
import type { TodayArchetype, TodayItem, TodayMetric, TodayVisual } from './types'
import { tierFor } from './tiers'

// ---------------------------------------------------------------------------
// Chip reading
// ---------------------------------------------------------------------------

const chip = (item: DecisionItem, label: string): string | null =>
  item.chips?.find(c => c.label.toLowerCase() === label.toLowerCase())?.value ?? null

/** Pull the leading number out of a chip like "142d" or "-8.4% upside". */
function num(value: string | null): number | null {
  if (!value) return null
  const m = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

// ---------------------------------------------------------------------------
// Why now
// ---------------------------------------------------------------------------

/**
 * One sentence saying why this is in front of the user TODAY.
 *
 * Written per evaluator, and deliberately not a restatement of the metric
 * strip — "142 days" is already a metric, so the sentence has to say what 142
 * days means for the position. When a titleKey has no bespoke sentence, the
 * engine's own `description` is used rather than a generated one.
 */
function whyNowFor(item: DecisionItem): string {
  const t = chip(item, 'Ticker') ?? 'this name'
  const age = num(chip(item, 'Age'))

  switch (item.titleKey) {
    case 'THESIS_STALE':
      return age && age >= 180
        ? `The written case for ${t} has not been revisited in over six months, so the position is sized on reasoning nobody has checked against what has happened since.`
        : `The written case for ${t} is ageing, and nothing has confirmed it since it was last updated.`
    case 'PROPOSAL_AWAITING_DECISION':
      return `A proposal is open and unanswered. The position may be small, but an unanswered proposal is an unowned decision.`
    case 'EXECUTION_NOT_CONFIRMED':
      return `Capital was committed and the fill has not been confirmed, so the book and the intent disagree until someone reconciles them.`
    case 'RATING_NO_FOLLOWUP':
      return `The view on ${t} changed and nothing downstream moved with it — the rating and the book now say different things.`
    case 'IDEA_NOT_SIMULATED':
      return `An idea is being carried without having been sized against the portfolio, so its effect on the book is unknown.`
    case 'OVERDUE_DELIVERABLE':
      return `Work someone is waiting on has passed its date, and the people depending on it have not been told otherwise.`
    case 'HIGH_EV_NO_IDEA':
      return `The model implies meaningful upside on ${t} that nobody has turned into an idea. Nothing is wrong — it is simply unclaimed.`
    default:
      return item.description
  }
}

// ---------------------------------------------------------------------------
// Visuals
// ---------------------------------------------------------------------------

/**
 * Pick the visual that explains why THIS item surfaced.
 *
 * Each branch requires its own data to be present; if it is not, control falls
 * through to `metrics`. So an evaluator that usually produces an exposure bar
 * will quietly produce a typographic tile on a row with no weight, rather than
 * a bar of width zero implying the position is empty.
 */
export function visualFor(item: DecisionItem): TodayVisual {
  const fallback: TodayVisual = {
    archetype: 'metrics',
    caption: 'What the engine found',
    window: 'current',
  }

  switch (item.titleKey) {
    case 'THESIS_STALE': {
      const days = num(chip(item, 'Age'))
      if (days == null) return fallback
      // Four quarters of decay. The bars are a shape, not a measurement:
      // the only real number is the age, and the caption says so.
      const q = [0, 1, 2, 3].map(i => Math.max(8, 100 - (days / 365) * 100 - i * 18))
      return {
        archetype: 'staleness',
        caption: 'Evidence recency',
        window: '4 quarters',
        note: `Last updated ${days} days ago.`,
        staleness: { days, quarters: q },
      }
    }

    case 'PROPOSAL_AWAITING_DECISION':
    case 'EXECUTION_NOT_CONFIRMED':
    case 'OVERDUE_DELIVERABLE': {
      const days =
        item.context.overdueDays ??
        num(chip(item, 'Open')) ??
        num(chip(item, 'Age')) ??
        ageInDays(item.createdAt)
      if (days == null) return fallback
      return {
        archetype: 'aging',
        caption: item.titleKey === 'OVERDUE_DELIVERABLE' ? 'Days overdue' : 'Unresolved for',
        window: `${days} day${days === 1 ? '' : 's'}`,
        note:
          item.titleKey === 'OVERDUE_DELIVERABLE'
            ? 'Past its date, with nobody told otherwise.'
            : 'Open with no resolution recorded.',
        aging: {
          days,
          milestones: [
            { label: 'Raised', atPct: 4, hot: true },
            { label: 'Today', atPct: 96 },
          ],
        },
      }
    }

    case 'RATING_NO_FOLLOWUP': {
      const from = chip(item, 'From')
      const to = chip(item, 'To')
      if (!from || !to) return fallback
      return {
        archetype: 'transition',
        caption: 'Rating change',
        window: chip(item, 'Changed') ?? 'recent',
        note: 'The view moved; nothing downstream did.',
        transition: { from, to },
      }
    }

    case 'HIGH_EV_NO_IDEA': {
      const raw = chip(item, 'EV')
      const evPct = num(raw)
      if (evPct == null) return fallback
      return {
        archetype: 'expected-return',
        caption: 'Modelled upside',
        window: 'vs current price',
        note: 'No idea exists against this yet.',
        expectedReturn: { evPct, direction: raw?.replace(/[-\d.%\s]/g, '') || '' },
      }
    }

    case 'IDEA_NOT_SIMULATED': {
      const weight = item.context.proposedWeight
      if (weight == null) return fallback
      return {
        archetype: 'exposure',
        caption: 'Proposed weight',
        window: `${weight.toFixed(1)}% of NAV`,
        note: 'Not yet sized against the book.',
        exposure: { weightPct: weight },
      }
    }

    default:
      return fallback
  }
}

function ageInDays(iso?: string): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Two or three numbers, taken from the chips the evaluator published.
 *
 * `Ticker` is excluded because it is the tile's identity, not a metric, and
 * showing it twice wastes the strip that is meant to carry the numbers.
 */
function metricsFor(item: DecisionItem): TodayMetric[] {
  const out: TodayMetric[] = []
  for (const c of item.chips ?? []) {
    if (c.label.toLowerCase() === 'ticker') continue
    if (!c.value) continue
    const lower = c.label.toLowerCase()
    const tone: TodayMetric['tone'] =
      lower === 'age' || lower === 'open' || lower === 'overdue' ? 'down'
      : lower === 'ev' ? 'up'
      : 'neutral'
    out.push({ label: c.label, value: c.value, tone })
    if (out.length === 3) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Seed prompts
// ---------------------------------------------------------------------------

/**
 * The question worth asking the model about THIS problem.
 *
 * The seam carries it; it is never auto-sent. Written per evaluator because
 * only the evaluator knows what it found — a generic "tell me about AMZN"
 * would be exactly the context-recreation the engagement seam exists to remove.
 */
function seedPromptFor(item: DecisionItem): string | null {
  const t = chip(item, 'Ticker') ?? 'this position'
  switch (item.titleKey) {
    case 'THESIS_STALE':
      return `Our thesis on ${t} has not been updated in ${chip(item, 'Age') ?? 'months'}. Which of its claims are most likely to be stale now, and what would you check first?`
    case 'PROPOSAL_AWAITING_DECISION':
      return `This proposal has been open without a decision. What has changed since it was written, and does the original rationale still hold?`
    case 'EXECUTION_NOT_CONFIRMED':
      return `An execution is unconfirmed. What are the plausible explanations, and what should we reconcile first?`
    case 'RATING_NO_FOLLOWUP':
      return `The rating on ${t} moved from ${chip(item, 'From') ?? '?'} to ${chip(item, 'To') ?? '?'} with no follow-up. What would the position look like if we acted on the new rating?`
    case 'IDEA_NOT_SIMULATED':
      return `This idea has not been sized against the book. What would you want to know before simulating it?`
    case 'OVERDUE_DELIVERABLE':
      return `This deliverable is overdue. What is the smallest useful version that could ship now?`
    case 'HIGH_EV_NO_IDEA':
      return `The model implies ${chip(item, 'EV') ?? 'meaningful'} upside on ${t} with no idea against it. What would have to be true for that to be real rather than a data artefact?`
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Adaptation
// ---------------------------------------------------------------------------

/**
 * Build the engagement target for an item.
 *
 * Returns null when the evaluator named no object — a real case for
 * book-level intel. A tile with no target renders no Ask AI and no Discuss
 * rather than opening a pane bound to nothing.
 */
export function targetFor(item: DecisionItem): EngagementTarget | null {
  const ticker = chip(item, 'Ticker')
  const label = ticker ? `${ticker}` : item.title
  return fromDecisionContext(item.context, {
    label,
    issue: {
      title: item.title,
      detail: whyNowFor(item),
      reason: item.titleKey ?? item.category,
      detectedAt: item.createdAt,
    },
    origin: { itemId: item.id, surface: 'today' },
    seedPrompt: seedPromptFor(item) ?? undefined,
    contextChips: (item.chips ?? []).map(c => ({ label: c.label, value: c.value })),
  })
}

export function adaptDecisionItem(item: DecisionItem): TodayItem {
  const primaryCta = item.ctas?.find(c => c.kind === 'primary') ?? item.ctas?.[0] ?? null
  const ticker = chip(item, 'Ticker')
  const { tier, base } = tierFor(item)

  return {
    id: item.id,
    tier,
    score: base,
    severity: item.severity,
    ticker,
    objectLabel: ticker ?? item.title,
    state: item.title,
    claim: item.description,
    metrics: metricsFor(item),
    whyNow: whyNowFor(item),
    nextAction: primaryCta?.label ?? null,
    primary: primaryCta
      ? { label: primaryCta.label, actionKey: primaryCta.actionKey, payload: primaryCta.payload }
      : null,
    target: targetFor(item),
    seedPrompt: seedPromptFor(item),
    visual: visualFor(item),
    source: item,
  }
}

export const __test = { chip, num, whyNowFor, metricsFor, seedPromptFor, ageInDays }
