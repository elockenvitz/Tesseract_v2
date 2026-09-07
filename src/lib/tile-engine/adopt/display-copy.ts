/**
 * Words. The smallest layer that can turn a structural plan into a card face.
 *
 * ── Why the plan does not carry copy ──────────────────────────────────────
 *
 * A `PresentationPlan` says a claim is `outside_band`, that its quantity is a
 * percentage, and that the band has a low, a high and a current. It does not
 * say "AMZN is trading below every case you modelled", and it must not: the
 * moment a plan carries a sentence, the sentence is written by whoever built
 * the finding, and two producers of the same shape write it two ways. That is
 * how the product ended up with a copy generator per card family.
 *
 * ── Keyed on the PREDICATE, never on the kind ─────────────────────────────
 *
 * The same rule the resolver follows, for the same reason. There is no switch
 * on `FindingKind` here and a test asserts there never is. A seventh situation
 * whose claim is `expired` gets this copy for free; one that needs different
 * words needs a different predicate, which is a real semantic distinction
 * rather than a new template.
 *
 * ── Deterministic, and what that rules out ────────────────────────────────
 *
 * Pure functions over the claim's own numbers. No model, no clock, no locale
 * lookup — dates are formatted in UTC because the horizon belongs to when the
 * analyst wrote it, not to where the reader is standing, which is the rule the
 * card eyebrows already follow. The same situation produces the same sentence
 * on every render, in every timezone, forever.
 *
 * ── What it deliberately is NOT ───────────────────────────────────────────
 *
 * Not a port of `scenarioLanguage` or of `buildStaleTargetCard`'s prose. Those
 * are two bespoke copy generators for two families and reproducing them would
 * carry the very thing being replaced across the boundary. The copy below is
 * generic by construction, and the report says plainly where it reads
 * differently from what ships.
 */

import type { PresentationPlan } from '../presentation'
import type { FindingPredicate, Quantity } from '../finding'
import type { Situation } from '../situation'

export interface DisplayCopy {
  /** The claim, as a sentence. Never contains the metric's own number. */
  headline: string
  /** The one number the decision turns on, preformatted. */
  metric: { value: string; label: string } | null
  /** One or two sentences: why it matters, what happens if ignored. */
  body: string
  /** The question, from the plan. Present only when the plan asks it. */
  prompt: string | null
}

// ── Formatters ───────────────────────────────────────────────────────────────

/** "$520" — whole dollars, because a price objective is not a tick. */
const money = (v: number): string => `$${Math.round(v)}`

/** "12 Mar 2026", UTC. The card eyebrow's own format. */
function day(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'an unrecorded date'
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

/**
 * The quantity, in the unit the claim declared.
 *
 * The unit is on the claim rather than inferred from the predicate because two
 * findings with one predicate can legitimately count different things — an
 * expiry measured in months and one measured in days are the same claim about
 * different clocks, and the copy should not have to know which producer it is
 * reading.
 */
function amount(q: Quantity | null | undefined): string | null {
  if (!q || !Number.isFinite(q.value)) return null
  const v = Math.abs(q.value)
  switch (q.unit) {
    case 'pct': return `${Math.round(v)}%`
    case 'price': return money(v)
    case 'days': return v === 1 ? '1 day' : `${Math.round(v)} days`
    case 'count': return `${Math.round(v)}`
  }
}

/** The reader's name for the subject. Ticker where there is one. */
const nameOf = (s: Situation): string => s.subject.ticker || s.subject.name

// ── The copy table ───────────────────────────────────────────────────────────

/**
 * One entry per predicate, exhaustive by construction.
 *
 * `Record<FindingPredicate, …>` so a seventh predicate cannot be added without
 * somebody saying how it reads. The same discipline the situation table and
 * the reader-question map already use.
 */
type CopyWriter = (s: Situation, plan: PresentationPlan) => Omit<DisplayCopy, 'prompt'>

const COPY: Record<FindingPredicate, CopyWriter> = {
  /**
   * A stated horizon has passed.
   *
   * The headline carries the fact and the metric carries the size of it — the
   * separation the card contract asks for, and the one the shipping card
   * arrived at after stating the same elapsed time five times over.
   */
  expired: (s) => {
    const q = s.lead.claim.quantity
    const iv = s.lead.claim.interval
    const size = amount(q)
    return {
      headline: `${nameOf(s)} has outlived the horizon it was given`,
      metric: size ? { value: `${size}mo`, label: 'Past its horizon' } : null,
      body: iv
        ? `Stated ${day(iv.from)}, due ${day(iv.to)}, and not revisited since. A number nobody has restated is not a view.`
        : 'The horizon it was given has passed and nobody has restated it.',
    }
  },

  /**
   * An observed value sits outside a band somebody wrote down.
   *
   * Direction comes from the geometry — where `current` sits against `low` and
   * `high` — rather than from a flag on the finding. A producer that had to
   * declare which side it was on could declare it wrongly; the numbers cannot.
   */
  outside_band: (s) => {
    const band = s.lead.claim.band
    const size = amount(s.lead.claim.quantity)
    if (!band) {
      return {
        headline: `${nameOf(s)} has left the range that was written for it`,
        metric: size ? { value: size, label: 'Outside the modelled range' } : null,
        body: 'Either the view has changed or the range has, and only a person can say which.',
      }
    }
    const below = band.current < band.low
    const bound = below ? band.low : band.high
    return {
      headline: `${nameOf(s)} is trading ${below ? 'below' : 'above'} every case that was modelled`,
      metric: size
        ? {
            value: below ? size : `+${size}`,
            label: `${below ? 'Below the lowest' : 'Above the highest'} case of ${money(bound)}`,
          }
        : null,
      body: below
        ? 'Either the thesis has broken or this is the best entry anyone modelled.'
        : 'No stated upside is left — every written case now sits below the market.',
    }
  },

  /**
   * A level somebody set has been reached.
   *
   * The headline states the event and the metric carries how far past — the
   * same separation every other writer here follows, and the one the shipping
   * card already made ("has reached the target you set for it", with `+18%`
   * beneath it).
   */
  threshold_passed: (s) => {
    const t = s.lead.claim.threshold
    const size = amount(s.lead.claim.quantity)
    return {
      headline: `${nameOf(s)} has reached the level it was given`,
      metric: size && t
        ? { value: `+${size}`, label: `Past a ${money(t.level)} objective` }
        : size
          ? { value: `+${size}`, label: 'Past its objective' }
          : null,
      body: 'The view played out and nothing in the record says so. Either the number rises or this is a hold with no stated upside.',
    }
  },

  unreviewed: (s) => {
    const size = amount(s.lead.claim.quantity)
    const iv = s.lead.claim.interval
    return {
      headline: `${nameOf(s)} has moved since anyone last looked`,
      metric: size ? { value: size, label: 'Since the last review' } : null,
      body: iv
        ? `Last reviewed ${day(iv.from)}. The move has not been accounted for in anything written.`
        : 'The move has not been accounted for in anything written.',
    }
  },

  /**
   * A required artefact was never created.
   *
   * ── Leading with the judgment, not the price ────────────────────────────
   *
   * The finding is that nobody has said what this name is for, so that is the
   * headline and there is no hero number at all. A weight in that slot would
   * make the card read as a sizing observation — a different family with a
   * different action — and would put a figure the reader can already see on the
   * position row into the one place reserved for what they cannot.
   *
   * The shipping card reaches the same answer: `buildInsightCard` shows a
   * metric only where the capital reframe applies, and `buildNoTargetCard`
   * spells out why a count of missing things is not one.
   */
  absent: (s) => {
    const c = s.lead.claim.completeness
    /**
     * No metric, on either branch.
     *
     * `buildNoTargetCard` states the rule: the obvious figure here is a count
     * of what is missing, and "a number standing in for nothing" is exactly
     * what the surface keeps out. The shipping card shows no metric for this
     * family either, so emitting one would put a figure in the hero slot that
     * production deliberately leaves empty and that no decision turns on.
     *
     * The completeness shape still does real work — it decides whether the
     * reader is told nothing was written or that part of it was.
     */
    const nothingWritten = !c || c.present === 0

    if (!c) {
      return {
        headline: `Nobody has written what ${nameOf(s)} is for`,
        metric: null,
        body: 'The position exists and the argument for it does not, so there is nothing to check it against later.',
      }
    }

    return {
      headline: nothingWritten
        ? `Nobody has written what ${nameOf(s)} is for`
        : `The argument for ${nameOf(s)} is only part written`,
      metric: null,
      body: nothingWritten
        ? 'No thesis, no differentiated view, no stated risks. There is nothing here a later reader could disagree with.'
        : `${c.present} of ${c.expected} core sections are written. What is missing is the part that would let somebody check the view later.`,
    }
  },

  unowned: (s) => {
    const size = amount(s.lead.claim.quantity)
    return {
      headline: `${nameOf(s)} has nobody responsible for it`,
      metric: size ? { value: size, label: 'Of the book, uncovered' } : null,
      body: 'A position this size with no analyst assigned is nobody’s to answer for.',
    }
  },

  awaiting: (s) => {
    const size = amount(s.lead.claim.quantity)
    return {
      headline: `${nameOf(s)} is waiting on a decision that was already taken`,
      metric: size ? { value: size, label: 'Open' } : null,
      body: 'The decision was made and the step it implied has not happened.',
    }
  },
}

/**
 * The card face for a plan.
 *
 * `plan` is read for two things only: whether the question is being asked, and
 * whether the metric region survived degradation. Both are the resolver's
 * decisions, and the copy layer's job is to respect them rather than to
 * re-decide them — a headline that appears when the plan dropped its region is
 * the copy layer overruling the geometry.
 */
export function displayCopyFor(situation: Situation, plan: PresentationPlan): DisplayCopy {
  const written = COPY[situation.lead.claim.predicate](situation, plan)
  return {
    headline: written.headline,
    metric: plan.hierarchy.order.includes('metric') ? written.metric : null,
    body: written.body,
    prompt: plan.hierarchy.order.includes('prompt') ? plan.question.prompt : null,
  }
}
