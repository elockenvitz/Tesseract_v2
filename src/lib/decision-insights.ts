/**
 * decision-insights — rules-based generators for the Outcomes right
 * panel's "System Insight" and "Things to Consider" sections.
 *
 * Product direction: the system thinks, the user reacts. These helpers
 * read what's already known about a decision (action, result direction,
 * size of move, age, etc.) and emit short, action-framed prose so the
 * PM doesn't have to grade themselves.
 *
 * No AI yet — pure deterministic rules. The output is intentionally
 * conservative: a single sentence for the insight, 2–3 short prompts
 * for things to consider. When data is missing we lean on monitoring
 * language ("still early") rather than fabricating a verdict.
 */

import type { AccountabilityRow, DecisionDirection } from '../types/decision-accountability'

export type InsightTone = 'positive' | 'negative' | 'neutral'

export interface SystemInsight {
  /** Single short sentence rendered in the System Insight card —
   *  the OBSERVATION ("you increased exposure before appreciation"). */
  text: string
  /** Second line — the system's CONCLUSION on what the observation
   *  means ("→ Conviction was rewarded — consider follow-on size").
   *  Reads as a takeaway, not a description. */
  conclusion: string
  /** Drives the colour rail: emerald for positive, red for negative,
   *  slate for neutral / "still early" states. */
  tone: InsightTone
}

/** Short, opinionated assessment label rendered as a badge under the
 *  insight. Distilled to 2–4 words so it can sit alongside the result
 *  number without crowding the row. */
export type AssessmentLabel =
  | 'Aligned with intent'
  | 'Outcome diverged'
  | 'Risk reduced as planned'
  | 'Left upside on table'
  | 'Potential timing issue'
  | 'Conviction rewarded'
  | 'Too early to assess'

/** Right-panel header summary: a STATE category (uppercase, terse)
 *  + a single sentence explaining why this row is in that state and
 *  what to do next. The category and explanation are deliberately
 *  distinct from the System Insight (which talks about WHAT it
 *  means) so the surfaces complement instead of repeat. */
export interface StateSummary {
  category: string
  explanation: string
}

/** Translate the row's direction (buy / sell / add / trim / pass /
 *  initiate / exit / etc.) into a coarse direction the insight engine
 *  can reason about. The page's `direction` field is already canonical
 *  but we collapse the long tail to two buckets. */
function actionBucket(direction: DecisionDirection | string | null): 'increase' | 'reduce' | 'pass' | 'other' {
  if (!direction) return 'other'
  const d = String(direction).toLowerCase()
  if (d === 'buy' || d === 'add' || d === 'initiate' || d === 'increase') return 'increase'
  if (d === 'sell' || d === 'trim' || d === 'exit' || d === 'reduce') return 'reduce'
  if (d === 'pass' || d === 'reject' || d === 'defer') return 'pass'
  return 'other'
}

/** Past-tense action phrase used in insight / state / CTA copy.
 *  Picks the more PM-natural shorthand ("trimmed META" vs the heavier
 *  "reduced exposure to META") so sentences read like a desk note,
 *  not a system log. */
function actionPhrase(direction: DecisionDirection | string | null, sym: string): string {
  const bucket = actionBucket(direction)
  if (bucket === 'increase') {
    const d = String(direction || '').toLowerCase()
    if (d === 'buy' || d === 'initiate') return `bought ${sym}`
    return `added to ${sym}`
  }
  if (bucket === 'reduce') {
    const d = String(direction || '').toLowerCase()
    if (d === 'sell' || d === 'exit') return `sold ${sym}`
    return `trimmed ${sym}`
  }
  if (bucket === 'pass') return `passed on ${sym}`
  return `decided on ${sym}`
}

/** Title-case verb form ("Trimmed", "Added to", etc.) for state-summary
 *  copy where the phrase leads a sentence. */
function actionPhraseTitle(direction: DecisionDirection | string | null, sym: string): string {
  const phrase = actionPhrase(direction, sym)
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/**
 * Generate the one-liner that headlines the System Insight card.
 *
 * Priority of signals:
 *   1. Action-aware combinations (add + positive, trim + positive…)
 *      because they read as the most specific story.
 *   2. Generic positive / negative outcome.
 *   3. Neutral / no-result-yet — split into "very early" (no signal
 *      yet, avoid reacting to noise) vs "early" (has some movement
 *      but not enough to judge — focus on thesis milestones).
 *
 * "Tone" is from the *system's* perspective on whether the move
 * helped — an action like "trim" with subsequent upside is tonally
 * negative for the PM (left money on the table) even though the
 * result direction is positive.
 */
/** Magnitude tier — pure result-direction × magnitude classification.
 *  Drives the multi-factor branching in `buildSystemInsight` so that
 *  two rows with different result tiers produce different insights
 *  even when they share the same action verb. Thresholds:
 *    strong  → |move| ≥ 5%
 *    mild    → 1.5% ≤ |move| < 5%
 *    noise   → |move| < 1.5%
 *    null    → no price data yet  */
export type MagnitudeTier =
  | 'strong_positive' | 'mild_positive'
  | 'strong_negative' | 'mild_negative'
  | 'noise' | 'no_data'

export function magnitudeTier(row: AccountabilityRow): MagnitudeTier {
  const m = row.move_since_decision_pct
  if (m == null || !Number.isFinite(m)) return 'no_data'
  if (m >= 5) return 'strong_positive'
  if (m >= 1.5) return 'mild_positive'
  if (m <= -5) return 'strong_negative'
  if (m <= -1.5) return 'mild_negative'
  return 'noise'
}

/**
 * Multi-factor System Insight — interprets a decision through
 * (action × magnitude × age) so every row reads as an opinion on
 * THAT specific outcome, not a templated narration of the action.
 *
 * Priority of branches:
 *   1. Pass / reject — speak from the "skipped" perspective.
 *   2. Strong magnitude (≥5%) — interpretive: was this skill, timing,
 *      or noise? These are the rows where the system has a real view.
 *   3. Mild magnitude (1.5–5%) — directional but cautious; capture
 *      what was seen early.
 *   4. Noise (<1.5%) — refuse to fabricate a verdict; nudge to
 *      thesis milestones / capture rationale.
 */
export function buildSystemInsight(row: AccountabilityRow): SystemInsight {
  const action = actionBucket(row.direction)
  const ageDays = row.days_since_decision ?? 0
  const hasRationale = !!(row.rationale_text && row.rationale_text.trim())
  const sym = row.asset_symbol || 'this'
  const tier = magnitudeTier(row)

  // ── Pass / reject / withdrawn ─────────────────────────────────
  if (action === 'pass') {
    if (tier === 'strong_positive' || tier === 'mild_positive') return {
      text: `You passed on ${sym} and it appreciated — the position you skipped moved against you.`,
      conclusion: tier === 'strong_positive'
        ? 'A meaningful conviction signal was missed — review what made you pass.'
        : 'Worth reviewing whether the case has changed since you passed.',
      tone: 'negative',
    }
    if (tier === 'strong_negative' || tier === 'mild_negative') return {
      text: `You passed on ${sym} and it underperformed — avoiding the risk improved the portfolio.`,
      conclusion: tier === 'strong_negative'
        ? 'The decision to skip clearly protected capital.'
        : 'A small win for risk discipline.',
      tone: 'positive',
    }
    return {
      text: `You passed on ${sym} — no clear signal yet on whether that was the right call.`,
      conclusion: 'Monitor whether the original case still holds.',
      tone: 'neutral',
    }
  }

  // ── Strong-magnitude branch (≥5%) ─────────────────────────────
  // The system has a real interpretation here — speak to skill vs
  // timing rather than just describing the move.
  if (tier === 'strong_positive') {
    if (action === 'increase') return {
      text: `You increased exposure to ${sym} before strong appreciation — conviction has been rewarded.`,
      conclusion: 'Strong outcome — but too early to attribute to skill vs timing. Track the catalysts that would confirm the thesis.',
      tone: 'positive',
    }
    if (action === 'reduce') return {
      text: `You reduced exposure to ${sym} before strong upside — significant gains were left on the table.`,
      conclusion: 'Was this risk management working as intended, or did you mistime the trim?',
      tone: 'negative',
    }
    return {
      text: `${sym} has rallied sharply since this decision.`,
      conclusion: 'Capture whether this was thesis-driven or market noise.',
      tone: 'positive',
    }
  }
  if (tier === 'strong_negative') {
    if (action === 'increase') return {
      text: `You increased exposure to ${sym} and it moved against you — outcome is diverging materially.`,
      conclusion: 'Reassess whether this is thesis-driven or timing noise before adding more.',
      tone: 'negative',
    }
    if (action === 'reduce') return {
      text: `You reduced exposure to ${sym} before strong weakness — risk was managed effectively.`,
      conclusion: 'Decision aligned with what played out — a good test case for the process.',
      tone: 'positive',
    }
    return {
      text: `${sym} has dropped sharply since this decision.`,
      conclusion: 'Capture whether this was a thesis miss or just timing.',
      tone: 'negative',
    }
  }

  // ── Mild-magnitude branch (1.5–5%) ────────────────────────────
  if (tier === 'mild_positive') {
    if (action === 'increase') return {
      text: `You increased exposure to ${sym} before appreciation — capture what you saw early.`,
      conclusion: 'Track the catalysts that would actually confirm your call, not the tape.',
      tone: 'positive',
    }
    if (action === 'reduce') return {
      text: `You reduced exposure to ${sym} before further upside — small gains being missed.`,
      conclusion: 'Define a re-entry trigger — even modest upside compounds over time.',
      tone: 'negative',
    }
    return {
      text: `${sym} has moved up modestly since this decision.`,
      conclusion: 'Don\'t anchor on price — track thesis drivers.',
      tone: 'neutral',
    }
  }
  if (tier === 'mild_negative') {
    if (action === 'increase') return {
      text: `Initial move on ${sym} is against you — too early to react, focus on whether the thesis changed.`,
      conclusion: 'Don\'t let a short-term move force a change of mind on a longer thesis.',
      tone: 'negative',
    }
    if (action === 'reduce') return {
      text: `You reduced exposure to ${sym} before weakness — early risk management is working.`,
      conclusion: 'This improved portfolio risk positioning so far.',
      tone: 'positive',
    }
    return {
      text: `${sym} has slipped modestly since this decision.`,
      conclusion: 'Watch whether this is noise or the start of a thesis-relevant move.',
      tone: 'negative',
    }
  }

  // ── Noise / no-data branch (<1.5% or null) ────────────────────
  // Refuse to fabricate a verdict — language varies by rationale +
  // age so two noise rows don't read identically.
  if (!hasRationale) {
    const phrase = actionPhrase(row.direction, sym)
    return {
      text: `This decision has no recorded reasoning — write down why you ${phrase} before hindsight biases it.`,
      conclusion: 'Lock in your reasoning now so the outcome can be evaluated honestly later.',
      tone: 'neutral',
    }
  }
  if (ageDays >= 14) {
    const phrase = actionPhrase(row.direction, sym)
    return {
      text: `Two weeks since you ${phrase} with no clear signal — the thesis hasn't been tested either way.`,
      conclusion: 'Define what would prove or break the thesis before more time passes.',
      tone: 'neutral',
    }
  }
  return {
    text: `No meaningful signal on ${sym} yet — avoid reacting to short-term noise.`,
    conclusion: 'No action required yet — revisit when new data emerges.',
    tone: 'neutral',
  }
}

/**
 * One-line, opinionated assessment label rendered as a small badge
 * under the System Insight. Designed to fit alongside the result
 * number without crowding the row.
 *
 * Mapping mirrors `buildSystemInsight` but distils the outcome into
 * a 2–4 word verdict the PM can read at a glance.
 */
export function buildAssessment(row: AccountabilityRow): AssessmentLabel {
  const result = row.result_direction
  const action = actionBucket(row.direction)
  const ageDays = row.days_since_decision ?? 0
  const moveMag = row.move_since_decision_pct != null ? Math.abs(row.move_since_decision_pct) : 0

  // Early / no-signal — bail before any directional verdict.
  if (!result || result === 'neutral' || (ageDays < 7 && moveMag < 1.5)) {
    return 'Too early to assess'
  }

  if (action === 'pass') {
    if (result === 'positive') return 'Outcome diverged'
    if (result === 'negative') return 'Risk reduced as planned'
    return 'Too early to assess'
  }

  if (action === 'increase') {
    return result === 'positive' ? 'Conviction rewarded' : 'Potential timing issue'
  }
  if (action === 'reduce') {
    return result === 'positive' ? 'Left upside on table' : 'Risk reduced as planned'
  }

  return result === 'positive' ? 'Aligned with intent' : 'Outcome diverged'
}

/**
 * Generate 2–3 lightweight prompts for the "Things to Consider"
 * section, tailored to the specific decision (action × result).
 * Returns at most 3 so the panel doesn't feel like homework.
 *
 * The prompts are written to feel like a senior PM asking the right
 * question for the situation, not a textbook checklist:
 *   - ADD + positive  → was it thesis vs. broader market? size larger?
 *   - ADD + negative  → was the thesis wrong, or just timing?
 *   - TRIM + positive → exit too early, or appropriate risk mgmt?
 *   - TRIM + negative → did the trim reduce risk as intended?
 *   - Pre-result      → what would confirm or invalidate the thesis?
 */
export function buildConsiderations(row: AccountabilityRow): string[] {
  const result = row.result_direction
  const action = actionBucket(row.direction)
  const ageDays = row.days_since_decision ?? 0
  const move = row.move_since_decision_pct
  const moveMag = move != null ? Math.abs(move) : 0
  const earlyOrNoSignal = !result || result === 'neutral' || (ageDays < 14 && moveMag < 3)

  // Action × result-specific prompt sets. These are the headlines
  // the PM should be asking themselves about THIS decision.
  if (earlyOrNoSignal) {
    return ['What would confirm or invalidate your thesis in the next 30–60 days?']
  }

  if (action === 'increase' && result === 'positive') {
    return [
      'Was this outcome driven by your thesis or by market movement?',
      'Would you size this position larger making the decision again?',
      'What signal would tell you to take partial profits?',
    ]
  }
  if (action === 'increase' && result === 'negative') {
    return [
      'Is the thesis wrong, or is this a timing issue?',
      'Would you still add at this level today?',
      'What would invalidate your case from here?',
    ]
  }
  if (action === 'reduce' && result === 'positive') {
    return [
      'At what level would you reverse this trim?',
      'What signal would make you re-enter this position?',
      'Was this risk management or a conviction shift?',
    ]
  }
  if (action === 'reduce' && result === 'negative') {
    return [
      'Did this trim protect the portfolio or just track price?',
      'At what level would your view change again?',
      'Would you size the trim differently in hindsight?',
    ]
  }

  if (result === 'positive') {
    return [
      'Was this outcome driven by your thesis or by market movement?',
      'What would change your view from here?',
    ]
  }
  return [
    'Has anything in the underlying thesis actually changed?',
    'Would you act differently with the same information today?',
  ]
}

// ─── Suggested next actions ─────────────────────────────────────

export interface SuggestedAction {
  /** Stable identifier — drives the CustomEvent type the parent
   *  shell listens for to wire the actual flow. */
  key: 'create-followup' | 'update-thesis' | 'prompt-teammate' | 'revisit-position' | 'add-note'
  /** Short, contextual button label (e.g. "Re-enter META on weakness"
   *  rather than the generic "Create follow-up idea"). */
  label: string
  /** Primary actions render with a filled / accent style; secondary
   *  with a quieter outline. Cap to 1–2 primary per row. */
  primary: boolean
}

/**
 * Generate up to three contextual CTAs for the Suggested Next Action
 * card. The headline should feel like a coach saying "here's the
 * specific next move," not a generic "create idea" button.
 *
 * Logic:
 *   - TRIM + positive after  → re-enter on weakness
 *   - TRIM + negative after  → lock in lesson, watch for re-entry
 *   - ADD  + positive after  → take partial gains / trim on strength
 *   - ADD  + negative after  → update thesis (is this timing or wrong?)
 *   - Hurting (any action)   → prompt teammate for sanity check
 *   - Early / no-signal      → set thesis milestone, monitor
 *   - Default                → create follow-up idea
 */
export function buildSuggestedActions(row: AccountabilityRow): SuggestedAction[] {
  const sym = row.asset_symbol || 'this position'
  const action = actionBucket(row.direction)
  const result = row.result_direction
  const ageDays = row.days_since_decision ?? 0
  const moveMag = row.move_since_decision_pct != null ? Math.abs(row.move_since_decision_pct) : 0
  const hasRationale = !!(row.rationale_text && row.rationale_text.trim())
  const earlyOrNoSignal = !result || result === 'neutral' || (ageDays < 14 && moveMag < 3)

  const out: SuggestedAction[] = []

  // ── Early-stage paths — keep CTAs forward-looking, never backward ──
  // The most useful early action is almost always "make the
  // reasoning explicit." We use the same `add-note` key for both
  // the no-rationale and has-rationale paths so the click reliably
  // routes to the "Why this decision was made" section. Labels are
  // concrete enough that the user knows what clicking does.
  if (earlyOrNoSignal) {
    if (!hasRationale) {
      out.push({ key: 'add-note', label: 'Write your reasoning', primary: true })
    } else {
      out.push({ key: 'add-note', label: 'Note thesis milestones', primary: true })
    }
    // Only add a sanity-check CTA when sizing is meaningful enough
    // that a peer review actually adds value. For tiny positions
    // the second CTA reads as filler.
    if (moveMag >= 0.5 || ageDays >= 7) {
      out.push({ key: 'prompt-teammate', label: 'Get teammate sanity check', primary: false })
    }
    return out
  }

  // ── Resulted paths — primary CTA tuned to action × result ────────
  // TRIM rows always lead with "define re-entry criteria" — the
  // most useful next move regardless of outcome direction. ADD
  // rows lead with "track what would invalidate the thesis" so
  // the position is stress-tested before any further sizing.
  if (action === 'reduce') {
    out.push({ key: 'add-note', label: `Set re-entry criteria for ${sym}`, primary: true })
    if (result === 'negative') {
      out.push({ key: 'prompt-teammate', label: 'Timing or thesis?', primary: false })
    }
    return out
  }

  if (action === 'increase') {
    if (result === 'negative') {
      out.push({ key: 'update-thesis', label: `Timing or thesis?`, primary: true })
      out.push({ key: 'add-note', label: `Track invalidation signals`, primary: false })
    } else {
      out.push({ key: 'add-note', label: `Track invalidation signals`, primary: true })
      if (result === 'positive') {
        out.push({ key: 'create-followup', label: `Trim ${sym} on strength`, primary: false })
      }
    }
    return out
  }

  // Generic fallback — single primary CTA.
  if (result === 'negative') {
    out.push({ key: 'update-thesis', label: `Timing or thesis?`, primary: true })
  } else {
    out.push({ key: 'create-followup', label: `Create follow-up idea`, primary: true })
  }
  return out
}

// ─── Right-panel state summary ──────────────────────────────────

/**
 * Build the upgraded right-panel header for a row: an ALL-CAPS state
 * category plus one explanatory sentence covering "why this matters"
 * and "what to do next." This is distinct from the System Insight
 * (which talks about WHAT happened) — the state summary covers WHY
 * the row is in this state and the user's immediate next step.
 *
 * `verdict` is the engine-derived state (already promoted with any
 * review data). The summary varies for `needs_review` based on
 * whether a rationale exists, the magnitude of the move, and age,
 * so two early decisions don't read identically.
 */
export function buildStateSummary(
  row: AccountabilityRow,
  verdict:
    | 'working' | 'hurting' | 'stalled' | 'awaiting' | 'unmatched'
    | 'needs_review' | 'evaluate' | 'rejected' | 'withdrawn'
    | 'discretionary' | 'resolved',
): StateSummary {
  const result = row.result_direction
  const ageDays = row.days_since_decision ?? 0
  const moveMag = row.move_since_decision_pct != null ? Math.abs(row.move_since_decision_pct) : 0
  const hasRationale = !!(row.rationale_text && row.rationale_text.trim())
  const sym = row.asset_symbol || 'this position'

  const action = actionBucket(row.direction)
  const tier = magnitudeTier(row)
  // Action verb in past tense, used as a sentence-leading phrase.
  // "reduced exposure" / "increased exposure" reads more naturally
  // in interpretive copy than "trimmed" / "added to".
  const exposurePhrase = action === 'reduce'
    ? `reduced exposure to ${sym}`
    : action === 'increase'
      ? `increased exposure to ${sym}`
      : action === 'pass'
        ? `passed on ${sym}`
        : sym

  if (verdict === 'needs_review') {
    // Strong magnitude — speak to the interpretation question first.
    if (tier === 'strong_negative') {
      return {
        category: 'NEEDS CONTEXT — OUTCOME DIVERGED',
        explanation: `You ${exposurePhrase} and it moved sharply against you — capture whether this was timing or thesis-driven.`,
      }
    }
    if (tier === 'strong_positive') {
      return {
        category: 'NEEDS CONTEXT — STRONG OUTCOME',
        explanation: `You ${exposurePhrase} and it has moved sharply — capture whether this was a real call or timing luck.`,
      }
    }
    if (tier === 'mild_negative') {
      return {
        category: 'NEEDS CONTEXT — OUTCOME DIVERGING',
        explanation: `You ${exposurePhrase} and it has moved against you — write down what you saw so the outcome can be evaluated honestly.`,
      }
    }
    if (tier === 'mild_positive') {
      return {
        category: 'NEEDS CONTEXT — EARLY SIGNAL',
        explanation: `You ${exposurePhrase} and it has moved your way — capture what you saw early before the outcome colours the memory.`,
      }
    }
    // No signal yet — vary by rationale presence.
    if (!hasRationale && (ageDays < 7 || (!result || result === 'neutral'))) {
      return {
        category: 'NEEDS CONTEXT — EARLY DECISION',
        explanation: `Write down why you ${exposurePhrase} before the outcome rewrites the memory.`,
      }
    }
    return {
      category: 'NEEDS CONTEXT',
      explanation: `Write down why you ${exposurePhrase} so this decision can be evaluated honestly later.`,
    }
  }

  if (verdict === 'evaluate') {
    if (tier === 'strong_negative' || tier === 'mild_negative') return {
      category: 'MONITORING — OUTCOME DIVERGING',
      explanation: `You ${exposurePhrase} and it has moved against you — reflect when the thesis becomes clearer.`,
    }
    if (tier === 'strong_positive' || tier === 'mild_positive') return {
      category: 'MONITORING — POSITIVE SIGNAL',
      explanation: `You ${exposurePhrase} and it has moved your way — reflect on whether the thesis is playing out.`,
    }
    return {
      category: 'MONITORING',
      explanation: `Tesseract is watching ${sym} — reflect when the thesis becomes clearer.`,
    }
  }

  if (verdict === 'hurting') {
    return {
      category: 'THESIS UNDER STRESS',
      explanation: `You ${exposurePhrase} and it has moved against your case — decide whether the original thesis still holds.`,
    }
  }

  if (verdict === 'resolved') {
    return {
      category: 'REVIEWED',
      explanation: 'Decision is on the record. Tesseract has the context it needs to feed scorecards.',
    }
  }

  if (verdict === 'working') {
    return {
      category: 'ON TRACK',
      explanation: 'The decision is moving with the thesis. No action required yet.',
    }
  }

  if (verdict === 'stalled') {
    return {
      category: 'STALLED',
      explanation: 'Approved but not executed. Either act on it or withdraw the decision.',
    }
  }

  if (verdict === 'awaiting') {
    return {
      category: 'AWAITING EXECUTION',
      explanation: 'Approved recently and pending. Normal state — no action needed yet.',
    }
  }

  if (verdict === 'unmatched') {
    return {
      category: 'UNMATCHED',
      explanation: 'Approved 30+ days ago with no matching trade. Resolve or mark withdrawn.',
    }
  }

  if (verdict === 'discretionary') {
    return {
      category: 'AD HOC TRADE',
      explanation: 'Trade made outside the decision process. Add rationale to bring it into the loop.',
    }
  }

  if (verdict === 'rejected') {
    return {
      category: 'REJECTED',
      explanation: 'The decision was rejected at approval. Kept on the log for accountability.',
    }
  }

  return {
    category: 'WITHDRAWN',
    explanation: 'The decision was cancelled before execution.',
  }
}
