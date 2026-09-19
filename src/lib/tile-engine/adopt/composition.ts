/**
 * What happens when one name carries several findings at once.
 *
 * ── The decision this module makes, and the one it refuses to make ────────
 *
 * `composeSituations` groups by SUBJECT and QUESTION. Two findings about one
 * asset merge only when they are asking the reader the same thing. This module
 * is that rule applied to the three adopted Mobile producers, plus the
 * accounting that says how many tiles came out.
 *
 * It does NOT reduce card count for its own sake. The stage was explicit and
 * the product had already decided the same thing in three separate places:
 *
 *   · `reader-question` exists precisely because filing and asking are
 *     different, and it assigns `target_expired` to `target`, `scenario_gap` to
 *     `framework` and `no_research` to `thesis` — three questions.
 *
 *   · `feed-dedupe` suppresses a general card where a specific one covers the
 *     same name, and its header states the exception in as many words:
 *     "deliberately NOT to `no_thesis`: a name with a stale price target and a
 *     name with no written research at all are two genuinely different gaps,
 *     and the second is not implied by the first."
 *
 *   · `buildStaleTargetCard` records that an expired horizon and a price
 *     outside a modelled range are different findings — "this is the first
 *     place the two are told apart in behaviour rather than only in prose."
 *
 * So a name with all three produces three situations, and that is the correct
 * answer rather than a failure to compose. Collapsing them would take an
 * expired horizon, a broken framework and an unwritten argument — three
 * different jobs for three different afternoons — and offer the reader one
 * button.
 *
 * ── Where the reduction actually lives ────────────────────────────────────
 *
 * In corroboration WITHIN a question. When two findings do share one, the
 * second becomes supporting evidence on the first rather than a second tile:
 * `Situation.supporting` carries it, `corroborationCount` reports it, and
 * `situationPriorityInput` deliberately adds no score for it. That path is
 * exercised below and its live case is named in the report.
 *
 * ── Why this is not wired into the feed pipeline yet ─────────────────────
 *
 * Because for the three adopted situations it would change nothing and risk
 * something. A/B/C all compose to the same number of tiles the feed already
 * renders, so grouping entries before render would touch continuity, windowing
 * and the filter anchors for no observable gain.
 *
 * It becomes necessary at the first pair that genuinely shares a question, and
 * that pair already exists in production: `usePortfolioLenses` pushes a
 * `breach` and a `stale` row for the same asset in the same loop, both of which
 * `reader-question` files under `target`. Today `composeFeed` SPACES those two
 * tiles — `subject-run` and `recent-subject` penalties — and shows both. This
 * module would merge them. That is the next adoption, and it is where the
 * repetition a reader would actually notice lives.
 *
 * Pure. No React, no clock.
 */

import { composeSituations, corroborationCount, type Situation } from '../situation'
import { readerQuestionFor, type ReaderQuestion } from '../../signals/reader-question'
import type { SemanticFinding } from '../finding'
import type { MobileAdoptionResult } from './mobile'

/**
 * One name's worth of adapter output, resolved into what the feed will show.
 */
export interface SubjectComposition {
  /** `subjectKey`, so two names can never be conflated by ticker. */
  subjectId: string
  situations: Situation[]
  /** One tile per situation. The number the reader actually meets. */
  tileCount: number
  /** Findings that became supporting context instead of another tile. */
  absorbed: number
  /** Findings the adapters declined, with the reason. Never silent. */
  declined: { reason: string; detail: string }[]
  /** The questions this name is asking, in composition order. */
  questions: ReaderQuestion[]
}

/**
 * Compose every adapter result for one subject.
 *
 * Takes results rather than findings so a decline is accounted for rather than
 * disappearing: "this name produced two tiles" and "this name produced two
 * tiles and one card the engine would not touch" are different states, and a
 * caller that cannot tell them apart cannot debug either.
 */
export function composeForSubject(results: MobileAdoptionResult[]): SubjectComposition {
  const findings: SemanticFinding[] = []
  const declined: SubjectComposition['declined'] = []

  for (const r of results) {
    /**
     * The LEAD of each single-finding adoption, recomposed together.
     *
     * `adoptX` composes eagerly so its caller gets a plan, and each of those
     * situations holds exactly one finding. Recomposing the leads is not a
     * second composition of the same data — it is the first one that has ever
     * seen more than one finding at a time, which is the whole point of this
     * module.
     */
    if (r.ok) findings.push(r.adoption.situation.lead)
    else declined.push({ reason: r.reason, detail: r.detail })
  }

  const situations = composeSituations(findings)
  const absorbed = situations.reduce((n, s) => n + (corroborationCount(s) - 1), 0)

  return {
    subjectId: situations[0]?.id.split(':').slice(0, 2).join(':') ?? '',
    situations,
    tileCount: situations.length,
    absorbed,
    declined,
    questions: situations.map(s => s.question),
  }
}

/**
 * Whether two findings would compose, and why — without composing them.
 *
 * Written for the report and for tests, and deliberately re-deriving nothing:
 * it asks the same two questions `composeSituations` asks, in the same order,
 * so an answer here that disagreed with the composer would be a bug in one of
 * them rather than a difference of opinion.
 */
export function wouldCompose(
  a: SemanticFinding, b: SemanticFinding,
): { compose: boolean; because: string } {
  const sameSubject = a.subject.kind === b.subject.kind && a.subject.id === b.subject.id
  if (!sameSubject) {
    return { compose: false, because: 'different subjects' }
  }
  if (a.question !== b.question) {
    return {
      compose: false,
      because: `same name, different questions: ${a.question} and ${b.question}`,
    }
  }
  return { compose: true, because: `same name, both asking ${a.question}` }
}

/**
 * The question a shipping signal type asks, for reports that start from a card.
 *
 * A thin pass-through to the product's own map, exported so the comparison
 * path never grows a second opinion about which card asks what.
 */
export const questionOfType = readerQuestionFor
