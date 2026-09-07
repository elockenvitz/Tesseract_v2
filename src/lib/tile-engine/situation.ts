/**
 * A situation: everything true about one subject that bears on one question.
 *
 * ── Why the situation and not the finding is what gets presented ──────────
 *
 * The product's persistent complaint about the feed is that it repeats itself,
 * and the cause is that findings are presented one per card. A name whose
 * target expired in March, whose price then left the bear case, and whose
 * thesis nobody has revised since, produces three cards. All three ask "what
 * should we do about this name's price", all three carry the same asset, and
 * the reader answers the first and then scrolls past two restatements of it.
 *
 * Deduplication cannot fix that, because none of the three is a duplicate.
 * They are corroborating evidence for one situation, and the fix is to compose
 * them into it before anything decides how to draw them.
 *
 * ── The composition key, and why it is not the asset ──────────────────────
 *
 * Subject AND question. An expired target and an unwritten thesis on the same
 * name are two situations, not one: the first asks for a number and the second
 * asks for an argument, and merging them would produce a tile that asks two
 * questions and gets neither answered. `readerQuestion` already exists for
 * exactly this distinction and is reused rather than reinvented — see
 * `lib/signals/reader-question`, whose header documents the three-cards
 * one-question failure this composer is the other half of.
 *
 * ── Deterministic and pure ────────────────────────────────────────────────
 *
 * No clock, no randomness, total ordering at every step. Composition that
 * varies between renders is indistinguishable from a bug in ranking, and the
 * two would be impossible to tell apart from a screenshot.
 */

import type { Severity } from '../signals/contract'
import type { ReaderQuestion } from '../signals/reader-question'
import {
  compareFindings, subjectKey,
  type ActionIntent, type FindingSubject, type SemanticFinding,
} from './finding'

export interface Situation {
  /** `<subjectKind>:<subjectId>:<question>`. Stable across renders. */
  id: string
  subject: FindingSubject
  question: ReaderQuestion
  /**
   * The finding that speaks for the situation.
   *
   * Its claim becomes the plan's headline and its predicate chooses the lead
   * visual. Everything else corroborates.
   */
  lead: SemanticFinding
  /**
   * The rest, in the same total order. Never empty-by-convention: an absent
   * array and an empty one would mean the same thing and one of them would
   * eventually be checked for the wrong reason.
   */
  supporting: SemanticFinding[]
  /** The loudest claim in the group. */
  severity: Severity
  /** The most recent member. ISO. */
  occurredAt: string
  /**
   * The union of member intents, lead first, deduplicated, order preserved.
   *
   * Composed here rather than in the resolver because it is a fact about the
   * situation: if the thesis is unwritten AND the target expired, the reader
   * can genuinely do both, and which of the two a given surface offers is a
   * presentation decision made later against the same list.
   */
  intents: ActionIntent[]
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0, attention: 1, informational: 2,
}

const louder = (a: Severity, b: Severity): Severity =>
  SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b

/**
 * Group findings into situations.
 *
 * The output order is by situation id, which is deliberate and not an ordering
 * claim: importance is decided by `rankSituations`, and a composer that also
 * ordered would be a second, quieter ranking. Sorting by id keeps the function
 * total and its tests stable without pretending to know what matters.
 */
export function composeSituations(findings: SemanticFinding[]): Situation[] {
  const groups = new Map<string, SemanticFinding[]>()

  for (const f of findings) {
    const key = subjectKey(f.subject) + ':' + f.question
    const bucket = groups.get(key)
    if (bucket) bucket.push(f)
    else groups.set(key, [f])
  }

  const out: Situation[] = []
  for (const [id, members] of groups) {
    const ordered = [...members].sort(compareFindings)
    const [lead, ...supporting] = ordered

    let severity = lead.severity
    let occurredAt = lead.occurredAt
    for (const m of supporting) {
      severity = louder(severity, m.severity)
      if (new Date(m.occurredAt).getTime() > new Date(occurredAt).getTime()) {
        occurredAt = m.occurredAt
      }
    }

    const intents: ActionIntent[] = []
    for (const m of ordered) {
      for (const i of m.intents) if (!intents.includes(i)) intents.push(i)
    }

    out.push({
      id,
      subject: lead.subject,
      question: lead.question,
      lead,
      supporting,
      severity,
      occurredAt,
      intents,
    })
  }

  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * How many independent findings back this situation.
 *
 * The resolver reads it to decide whether corroboration is worth a context
 * row. One finding is a claim; three are a pattern, and saying so is often
 * more useful to a reader than any one of the three.
 */
export const corroborationCount = (s: Situation): number => 1 + s.supporting.length
