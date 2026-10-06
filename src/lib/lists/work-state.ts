/**
 * What a name's "Work" column should say, in priority order.
 *
 * ── The problem this fixes ────────────────────────────────────────────────
 *
 * Work used to be the research-hygiene state alone — `stateOf()` over a
 * `ResearchSubject`. So a name carrying a live BUY at `ready_to_recommend`,
 * waiting on a PM, reported "Thin evidence": true, and the least important true
 * thing about it. A reader scanning for what needs doing was shown a filing
 * problem and not the decision.
 *
 * ── The order ─────────────────────────────────────────────────────────────
 *
 * Highest first. Each tier is strictly more urgent than the one below:
 *
 *   decision    an idea is at the final stage — somebody owes an answer
 *   idea        a live idea is moving through the lifecycle
 *   evidence    research has arrived that the written case has not answered
 *   review      the case is past its clock, or the price moved away from it
 *   gap         there is no case, or not enough of one, to review against
 *   clear       nothing outstanding
 *
 * Research hygiene survives as the SECONDARY line: a name with a live idea and
 * a thin file still says so, quietly, after the thing that matters.
 *
 * ── No new state ──────────────────────────────────────────────────────────
 *
 * Every input is canonical and already on the page: `IdeaRow.stage` from
 * `useIdeaScan` (whose rows are already filtered to live, non-terminal,
 * non-parked ideas) and `ResearchState` from `stateOf`. Nothing here invents a
 * status, and nothing here writes.
 */
import { FINAL_STAGE } from '../ideas/stage-model'
import { STATE_LABEL, type ResearchState } from '../desktop-research/model'

export type WorkTier = 'decision' | 'idea' | 'evidence' | 'review' | 'gap' | 'clear'

export interface WorkState {
  tier: WorkTier
  /** The headline. Always present. */
  label: string
  /** A count worth showing beside the label — unreviewed notes, today. */
  count: number
  /** The quieter true thing, when it adds something the label does not. */
  secondary: string | null
}

/** Just enough of an idea to rank it. */
export interface WorkIdea {
  direction?: string | null
  stage?: string | null
  portfolioName?: string | null
}

/**
 * Stage, in the words a desk uses.
 *
 * The enum still carries fifteen legacy values in production, so this maps the
 * ones a live idea can actually hold and falls back to the raw value with its
 * underscores removed rather than hiding a stage it has not seen.
 */
const STAGE_LABEL: Record<string, string> = {
  idea: 'Idea',
  exploring: 'Exploring',
  researching: 'Researching',
  investigate: 'Investigating',
  deep_research: 'Deep research',
  developing: 'Developing',
  modeling: 'Modelling',
  thesis_forming: 'Thesis forming',
  simulating: 'Simulating',
  discussing: 'Discussing',
  working_on: 'In progress',
  aware: 'Watching',
  ready_for_decision: 'Decision ready',
  deciding: 'Deciding',
  ready_to_recommend: 'Recommendation ready',
}

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return 'Idea'
  return STAGE_LABEL[stage] ?? stage.replace(/_/g, ' ')
}

/** Research states that are a deficiency in the file rather than a change. */
const GAP_STATES = new Set<ResearchState>(['no-thesis', 'incomplete-thesis', 'thin'])

/**
 * Research hygiene worth repeating under a louder headline.
 *
 * Only the deficiencies: repeating "New research" beside a decision would be
 * two headlines, and "Current" under anything is noise.
 */
function secondaryFor(state: ResearchState | null): string | null {
  if (!state || !GAP_STATES.has(state)) return null
  return STATE_LABEL[state]
}

/**
 * @param idea      the live idea on this name, if any
 * @param state     the research-lifecycle state, if the name is in the scan
 * @param unread    notes that arrived after the case was written
 */
export function workStateFor(
  idea: WorkIdea | null | undefined,
  state: ResearchState | null | undefined,
  unread: number,
): WorkState {
  const research = state ?? null

  if (idea) {
    const dir = (idea.direction ?? '').toUpperCase()
    const stage = stageLabel(idea.stage)
    // An idea at the final stage is waiting on a person, which outranks every
    // research fact including unreviewed evidence.
    const tier: WorkTier = idea.stage === FINAL_STAGE ? 'decision' : 'idea'
    return {
      tier,
      label: dir ? `${dir} · ${stage}` : stage,
      count: 0,
      // Unreviewed evidence under a live idea is the useful second line — it
      // says the thing being decided may be out of date.
      secondary: unread > 0
        ? `${unread} new research`
        : secondaryFor(research),
    }
  }

  if (research === 'evidence-since-review') {
    return {
      tier: 'evidence',
      label: STATE_LABEL[research],
      count: unread,
      secondary: null,
    }
  }

  if (research === 'stale' || research === 'moved-since-review') {
    return { tier: 'review', label: STATE_LABEL[research], count: 0, secondary: null }
  }

  if (research && GAP_STATES.has(research)) {
    return { tier: 'gap', label: STATE_LABEL[research], count: 0, secondary: null }
  }

  return {
    tier: 'clear',
    label: research ? STATE_LABEL[research] : '',
    count: 0,
    secondary: null,
  }
}

/** Sort weight, highest first when ordering descending. */
export const WORK_TIER_RANK: Record<WorkTier, number> = {
  decision: 5,
  idea: 4,
  evidence: 3,
  review: 2,
  gap: 1,
  clear: 0,
}
