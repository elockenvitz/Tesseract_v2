/**
 * Why you are here, drawn from the item you pressed.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 *
 * The workspace below answers "what do I know about this name". It cannot
 * answer "what happened, and what am I being asked about it", because the
 * event lives on the Dashboard item and not on the asset. This band is that
 * answer, and it is composed entirely from `WorkspaceEntryContext` plus the
 * canonical figures the page has already fetched.
 *
 * ── Why it is small ──────────────────────────────────────────────────────
 *
 * The first draft was right and unusable: a filled blue panel carrying the
 * comparison, the whole scenario ladder, exposure, the waiting request and
 * three sentence-long questions, which together took most of the first
 * viewport and pushed the actual working surface below the fold. Orientation
 * that hides the work is not orientation.
 *
 * So the band now holds only what a reader cannot reconstruct from the page
 * below it: which event this is, the four figures it turns on, what the
 * record cannot say, and the next action. Everything else -- the ladder,
 * exposure, the waiting request, the longer questions -- sits behind one
 * disclosure, closed on arrival. Nothing was deleted; it stopped being first.
 *
 * ── The rules it works under ─────────────────────────────────────────────
 *
 * Every number says where it came from, and the four are four different
 * measurements: a target someone stated on a date, the BOOK'S MARK from a
 * holdings snapshot, the difference between those two, and the last close in
 * price history. The mark and the close are never swapped for each other.
 *
 * Nothing claims a crossing date. The lens compares one snapshot against one
 * stored number; it cannot see the path between them, so this says "on the
 * snapshot of <date>" and states the reading's age rather than "today".
 *
 * Nothing silently reconciles the record with the alert. If the ladder no
 * longer holds the target, or now files that same price under a different
 * case name, the band says so and keeps the alert's own words.
 *
 * Nothing recommends a trade. A target being reached means either the target
 * rises or the position is a hold with no stated upside, and both are the
 * reader's call. The actions here review the case and the scenarios; the
 * assessment asks what the evidence does to the case.
 *
 * Nothing is inert. Every control draws a real destination that exists in
 * this application, and a fact the context does not carry is omitted rather
 * than drawn as a blank.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { ArrowUpRight, ChevronDown, PencilLine, Sparkles, Target } from 'lucide-react'
import { EYEBROW } from '../desktop/DesktopModule'
import { money } from '../portfolio-v2/PortfolioVisual'
import {
  ladderAgainst, daysSinceIso,
  type WorkspaceEntryContext, type TargetReachedEvent, type RecommendationEvent,
  type LadderRung,
} from '../../lib/asset-workspace/entry-context'

/** A date a reader can read, in UTC, or nothing where there is no date. */
function on(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso)
  if (!Number.isFinite(t.getTime())) return null
  return t.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

const ageWords = (days: number | null): string | null =>
  days == null ? null : days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`

/** The canonical facts the PAGE holds, as the band needs them. */
export interface OrientationPageFacts {
  /** The scenario ladder on record now, from `analyst_price_targets`. */
  ladder: readonly LadderRung[]
  /** The official target on record now, where one is flagged. */
  officialTarget: number | null
  /** The last close the page's own chart draws. A different measurement. */
  spot: number | null
  /** The date of that close, where the series carries one. */
  spotAsOf: string | null
  caseWrittenAt: string | null
  /** The book the reader arrived from, or the largest one. */
  position: { portfolioName: string | null; weightPct: number | null; valueUsd: number | null } | null
  /** Other books holding the name, by name only. */
  alsoHeldIn: readonly string[]
  /** A request waiting on a human, where one is open on this name. */
  pending: { label: string; note: string | null; portfolioName: string | null } | null
}

export interface OrientationActions {
  /**
   * Open the case for editing.
   *
   * Optional, like `openScenarios` below, because the band now renders on two
   * surfaces with different destinations. In the Dashboard pane the case is
   * edited in place and the scenarios live one hop away on the canonical
   * page, so both exist and mean different things. ON that canonical page the
   * scenarios are a section of Research, which is where "review the case"
   * already lands -- so it passes one and not the other, and the control it
   * did not give is not drawn. Two buttons doing the same thing is the
   * duplicate control this band was rewritten to remove.
   */
  reviewCase?: () => void
  /** Open the asset page at its scenarios, where that is a separate place. */
  openScenarios?: () => void
  /** The full canonical asset page, where the host offers one. */
  openFullWorkspace?: () => void
  /** Hand off to where the waiting request is answered. */
  openPending?: () => void
  /** Ask ACT AI, with this question seeded. */
  ask: (question: string) => void
}

export function EntryOrientation({
  context, facts, actions, now = Date.now(),
}: {
  context: WorkspaceEntryContext
  facts: OrientationPageFacts
  actions: OrientationActions
  /** Injectable so a test can pin the age of a reading. */
  now?: number
}) {
  const event = context.event
  if (event?.kind === 'target_reached') {
    return <TargetReview context={context} event={event} facts={facts} actions={actions} now={now} />
  }
  if (event?.kind === 'recommendation') {
    return <DecisionPrep context={context} event={event} facts={facts} actions={actions} now={now} />
  }
  return null
}

/* ------------------------------------------------------------ the frame */

/**
 * The band.
 *
 * A bordered card with a coloured EDGE rather than a coloured fill. The fill
 * version read as a banner -- something to be dismissed rather than worked
 * with -- and at this width a tinted block that tall is most of what the
 * reader sees. The edge keeps the colour's job, which is to say at a glance
 * which kind of entry this is.
 */
function Band({
  testId, tone, eyebrow, title, reason, children,
}: {
  testId: string
  tone: 'target' | 'decision'
  eyebrow: string
  title: string
  reason: string | null
  children: React.ReactNode
}) {
  return (
    <section
      data-testid={testId}
      data-entry-intent={tone === 'target' ? 'target_review' : 'decision'}
      className={clsx(
        'rounded-lg border border-l-[3px] bg-white px-4 py-3 dark:bg-gray-900/40',
        tone === 'target'
          ? 'border-gray-200 border-l-blue-500 dark:border-gray-700 dark:border-l-blue-400'
          : 'border-gray-200 border-l-amber-500 dark:border-gray-700 dark:border-l-amber-400',
      )}
    >
      <p className={EYEBROW}>{eyebrow}</p>
      <h2 className="mt-0.5 text-[15px] font-semibold tracking-[-0.015em] text-gray-900 dark:text-gray-100">
        {title}
      </h2>
      {reason && (
        <p className="mt-0.5 max-w-[80ch] text-[12px] leading-snug text-gray-600 dark:text-gray-400">
          {reason}
        </p>
      )}
      {children}
    </section>
  )
}

/** A figure over its label, with the label carrying the source. */
function Figure({ value, label, source, tone }: {
  value: string
  label: string
  source: string | null
  tone?: 'good'
}) {
  return (
    <div data-slot="entry-figure">
      <p className={clsx(
        'font-mono text-[16px] font-semibold tabular-nums leading-tight',
        tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-900 dark:text-gray-100',
      )}>
        {value}
      </p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      {source && <p className="text-[10px] leading-tight text-gray-500 dark:text-gray-400">{source}</p>}
    </div>
  )
}

function Action({ onClick, children, primary, testId }: {
  onClick: () => void
  children: React.ReactNode
  primary?: boolean
  testId: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold',
        primary
          ? 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200'
          : 'border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-white/[0.06]',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The disclosure that holds everything that is not the lead.
 *
 * Closed on arrival, and its label names what is inside rather than saying
 * "more", so a reader can decide without opening it. Unmounted while closed:
 * the ladder and the exposure line are a dozen DOM nodes each and neither is
 * worth rendering for a reader who never looks.
 */
function Detail({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2.5 border-t border-gray-100 pt-2 dark:border-gray-800">
      <button
        type="button"
        data-testid="entry-detail-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-[12px] font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        {open ? 'Hide' : summary}
      </button>
      {open && (
        <div data-testid="entry-detail" className="mt-2">
          {children}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------- target review */

/**
 * The one assessment this band asks ACT AI for.
 *
 * Three sentence-long links were replaced by one action with a name, because
 * a reader at this moment has one question and reads none of three. The
 * prompt still carries the numbers the band is showing, so the answer is
 * grounded in what the reader can see, and it still asks what the evidence
 * does to the case rather than what to do about the position: the product
 * does not let an assistant form a recommendation, and this is the moment
 * that temptation is strongest.
 */
function assessmentPrompt(symbol: string | null, event: TargetReachedEvent, facts: OrientationPageFacts, caseAge: number | null): string {
  const name = symbol ?? 'this name'
  const target = money(event.targetPrice)
  const label = event.caseName ? `${event.caseName} case at ${target}` : `target of ${target}`
  const close = facts.spot != null ? ` Price history last closes at ${money(facts.spot)}.` : ''
  const age = caseAge != null ? ` The written case is ${caseAge} days old.` : ''
  return [
    `Assess the ${label} on ${name}, which the book's mark of ${money(event.observedPrice)}`,
    `${on(event.asOf) ? ` on the holdings snapshot of ${on(event.asOf)}` : ''} has passed.${close}${age}`,
    ` Cover why this matters, which assumptions in the written case the target rests on,`,
    ` what evidence on record has changed since, what is still unresolved, and what the`,
    ` exposure and any open request imply. Do not recommend buying or selling.`,
  ].join('')
}

/** The follow-ups, kept short and behind the disclosure. */
function followUps(symbol: string | null, event: TargetReachedEvent, caseAge: number | null): string[] {
  const name = symbol ?? 'this name'
  const target = money(event.targetPrice)
  const label = event.caseName ? `${event.caseName} case at ${target}` : `target of ${target}`
  const out = [
    `What would have to be true for the ${label} on ${name} to be raised, and what evidence on record speaks to it?`,
  ]
  if (caseAge != null) {
    out.push(`What has been filed on ${name} in the ${caseAge} days since the case was written, and does any of it bear on the ${label}?`)
  }
  return out
}

/** Short labels for the follow-up chips. The prompt stays the long version. */
const FOLLOW_UP_LABELS = ['What would raise the target', 'What was filed since the case'] as const

function TargetReview({ context, event, facts, actions, now }: {
  context: WorkspaceEntryContext
  event: TargetReachedEvent
  facts: OrientationPageFacts
  actions: OrientationActions
  now: number
}) {
  const symbol = context.symbol
  const readingAge = daysSinceIso(event.asOf, now)
  const caseAge = daysSinceIso(facts.caseWrittenAt, now)
  const { passed, ahead } = ladderAgainst(event)
  const overshoot = `${event.overshootPct >= 0 ? '+' : ''}${(event.overshootPct * 100).toFixed(1)}%`

  /*
   * Whether the record still holds the number this alert was about.
   *
   * The event carries the ladder as it stood when the lens ran; `facts.ladder`
   * is `analyst_price_targets` as it stands now. A reader who edited the
   * ladder in between must be told, because every figure above it describes a
   * target that no longer exists. Compared on PRICE rather than on the row id:
   * raising the Bull case is the edit this is about, and it keeps its id.
   */
  const matching = facts.ladder.find(r => Math.abs(r.price - event.targetPrice) < 0.005) ?? null
  const stillOnRecord = facts.ladder.length === 0 || matching != null

  /*
   * A label the record disagrees with.
   *
   * The alert fired on a case it called something -- "Base" -- and the ladder
   * may now file that same price under another name. Both readings are true
   * of different moments, so neither is corrected: the alert keeps its words
   * and the disagreement is stated. Silently adopting the current name would
   * rewrite what the reader was told on the Dashboard, and silently keeping
   * it would leave the band and the ladder below it naming one price twice.
   */
  const renamedTo = matching && event.caseName && matching.name && matching.name !== event.caseName
    ? matching.name
    : null

  const title = event.caseName
    ? `The book's mark has passed the ${event.caseName} case you set`
    : `The book's mark has passed the target you set`

  return (
    <Band
      testId="entry-target-review"
      tone="target"
      eyebrow={`${symbol ?? 'This name'} · Valuation review`}
      title={title}
      reason={context.why?.reason ?? null}
    >
      {/* Four measurements, four sources. The mark and the close are the pair
          most easily mistaken for each other, so they stand side by side. */}
      <div className="mt-2.5 flex flex-wrap items-start gap-x-6 gap-y-2.5" data-testid="target-comparison">
        <Figure
          value={money(event.targetPrice)}
          label={event.caseName ? `${event.caseName} case` : 'Target'}
          source={on(event.statedAt) ? `stated ${on(event.statedAt)}` : 'stated, date not on record'}
        />
        <Figure
          value={money(event.observedPrice)}
          label="Book mark"
          source={on(event.asOf) ? `snapshot ${on(event.asOf)}` : 'holdings snapshot'}
        />
        <Figure value={overshoot} label="Past the target" source="mark against target" tone="good" />
        {facts.spot != null && (
          <Figure
            value={money(facts.spot)}
            label="Last close"
            source={on(facts.spotAsOf) ? `price history ${on(facts.spotAsOf)}` : 'price history'}
          />
        )}
      </div>

      {/* The honesty line. It is not decoration: the alert cannot say when the
          crossing happened, and a reader who assumes "today" will act on a
          reading that may be a week old. */}
      <p className="mt-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400" data-testid="target-reading-age">
        {event.asOf
          ? `The comparison is the snapshot of ${on(event.asOf)}${readingAge ? ` (${ageWords(readingAge)})` : ''} against the stored target. When the price first passed it is not recorded.`
          : 'The comparison is a holdings snapshot against the stored target. Neither the snapshot date nor the date the price first passed it is recorded.'}
      </p>

      {!stillOnRecord && (
        <p
          className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          data-testid="target-record-changed"
        >
          The scenarios on record no longer hold a case at {money(event.targetPrice)}, so this alert describes a target that has since been edited.
        </p>
      )}

      {renamedTo && (
        <p
          className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          data-testid="target-case-renamed"
        >
          The alert calls {money(event.targetPrice)} the {event.caseName} case. On record now the same price is the {renamedTo} case.
        </p>
      )}

      {/* ---------------------------------------------------------- doing */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Action
          testId="target-assess"
          primary
          onClick={() => actions.ask(assessmentPrompt(symbol, event, facts, caseAge))}
        >
          <Sparkles className="h-3.5 w-3.5" />Assess the target breach
        </Action>
        {actions.reviewCase && (
          <Action testId="target-review-case" onClick={actions.reviewCase}>
            <PencilLine className="h-3.5 w-3.5" />Review the case
          </Action>
        )}
        {actions.openScenarios && (
          <Action testId="target-open-scenarios" onClick={actions.openScenarios}>
            <Target className="h-3.5 w-3.5" />Update the scenarios
          </Action>
        )}
        {actions.openFullWorkspace && (
          <Action testId="target-open-full" onClick={actions.openFullWorkspace}>
            Full workspace<ArrowUpRight className="h-3.5 w-3.5" />
          </Action>
        )}
      </div>

      <Detail summary="Scenarios, the case, exposure and the waiting request">
        <div data-testid="target-scenarios">
          <p className={EYEBROW}>Scenarios on record</p>
          {facts.ladder.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-0.5">
              {[...facts.ladder].sort((a, b) => a.price - b.price).map((rung, i) => {
                const reached = event.observedPrice >= rung.price
                const isThisAlert = Math.abs(rung.price - event.targetPrice) < 0.005
                return (
                  <li
                    key={rung.id ?? `${rung.name ?? 'case'}-${i}`}
                    data-slot="scenario-rung"
                    data-reached={reached || undefined}
                    data-alert-case={isThisAlert || undefined}
                    className="flex items-baseline gap-2 text-[12px]"
                  >
                    <span className="w-[76px] shrink-0 font-semibold text-gray-700 dark:text-gray-200">
                      {rung.name ?? 'Case'}
                    </span>
                    <span className="font-mono tabular-nums text-gray-900 dark:text-gray-100">{money(rung.price)}</span>
                    <span className={clsx(
                      'text-[10px] font-semibold uppercase tracking-wide',
                      reached ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-400',
                    )}>
                      {reached ? 'passed by the mark' : 'above the mark'}
                    </span>
                    {isThisAlert && (
                      <span className="text-[10px] font-medium text-blue-700 dark:text-blue-300">this alert</span>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
              {passed.length + ahead.length > 0
                ? `No ladder is on record for this name now. When the alert was raised it held ${passed.length + ahead.length} case${passed.length + ahead.length === 1 ? '' : 's'}.`
                : 'No scenario ladder is on record for this name.'}
            </p>
          )}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div data-testid="target-case-age">
            {/* "The written case", not "The case": the section further down the
                page is titled The case, and two identical headings on one
                screen read as the same block twice. */}
            <p className={EYEBROW}>The written case</p>
            <p className="mt-0.5 text-[12px] text-gray-700 dark:text-gray-300">
              {facts.caseWrittenAt
                ? `Written ${on(facts.caseWrittenAt)}, ${ageWords(caseAge)}.`
                : 'Nothing is written for this name yet.'}
            </p>
          </div>
          <div data-testid="target-exposure">
            <p className={EYEBROW}>Exposure</p>
            <p className="mt-0.5 text-[12px] text-gray-700 dark:text-gray-300">
              {facts.position && facts.position.weightPct != null
                ? `${facts.position.portfolioName ?? 'A book'} carries ${facts.position.weightPct.toFixed(2)}%${
                  facts.position.valueUsd != null ? ` (${money(facts.position.valueUsd)})` : ''}.`
                : event.heldIn.length
                  ? `Held in ${event.heldIn.map(b => b.name).join(', ')}. No weight is on record for the book you arrived from.`
                  : 'Not held in any book on record.'}
            </p>
            {facts.alsoHeldIn.length > 0 && (
              <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                Also held in {facts.alsoHeldIn.join(', ')}.
              </p>
            )}
          </div>
        </div>

        {facts.pending && (
          /* Supporting, and deliberately NOT the lead: the reader pressed a
             target event. The request keeps its own band below this one, which
             is where it is answered. */
          <div className="mt-3 rounded-md border border-amber-300/60 px-2.5 py-1.5 dark:border-amber-400/30" data-testid="target-pending-decision">
            <p className={EYEBROW}>Also waiting on this name</p>
            <p className="mt-0.5 text-[12px] text-gray-700 dark:text-gray-300">
              {facts.pending.label}{facts.pending.portfolioName ? ` · ${facts.pending.portfolioName}` : ''}
            </p>
            {actions.openPending && (
              <button
                type="button"
                data-testid="target-open-pending"
                onClick={actions.openPending}
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-400"
              >
                Go to the request<ArrowUpRight className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        <div className="mt-3" data-testid="target-ai-questions">
          <p className={EYEBROW}>Follow up with ACT AI</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {followUps(symbol, event, caseAge).map((q, i) => (
              <button
                key={i}
                type="button"
                data-slot="entry-ai-question"
                data-prompt={q}
                onClick={() => actions.ask(q)}
                className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-white/[0.06]"
              >
                {FOLLOW_UP_LABELS[i] ?? 'Ask'}
              </button>
            ))}
          </div>
        </div>
      </Detail>
    </Band>
  )
}

/* ------------------------------------------------------ decision prep */

/**
 * The proposal itself, for a reader who arrived to answer one.
 *
 * It does not decide. The request's own band below this one carries the hand
 * off to where ruling happens, which is the rule this surface has always
 * worked under: it shows and hands off, it never decides inline.
 */
function DecisionPrep({ context, event, facts, actions, now }: {
  context: WorkspaceEntryContext
  event: RecommendationEvent
  facts: OrientationPageFacts
  actions: OrientationActions
  now: number
}) {
  const symbol = context.symbol ?? 'this name'
  const book = context.portfolioName ?? facts.position?.portfolioName ?? null
  const madeAge = daysSinceIso(event.madeAt, now)
  const caseAge = daysSinceIso(facts.caseWrittenAt, now)

  const sizing = event.proposedWeightPct != null
    ? `${event.proposedWeightPct.toFixed(2)}%${
      event.currentWeightPct != null
        ? ` against ${event.currentWeightPct.toFixed(2)}% held`
        : ', on a name the book does not hold'}`
    : null

  const question = `A ${event.action ?? 'request'} on ${symbol}${book ? ` for ${book}` : ''}${
    sizing ? ` proposes ${sizing}` : ''}. Which parts of the written case support it, what is still unanswered, and what would make it wrong? Do not recommend buying or selling.`

  return (
    <Band
      testId="entry-decision-prep"
      tone="decision"
      eyebrow={`${context.symbol ?? 'This name'} · Decision preparation`}
      title={`${event.recommendedBy ?? 'Someone'} is asking you to answer a ${event.action ?? 'request'}${book ? ` in ${book}` : ''}`}
      reason={context.why?.reason ?? null}
    >
      <div className="mt-2.5 flex flex-wrap items-start gap-x-6 gap-y-2.5" data-testid="recommendation-sizing">
        <Figure
          value={event.proposedWeightPct != null ? `${event.proposedWeightPct.toFixed(2)}%` : 'Not sized'}
          label="Proposed weight"
          source={event.action ? `a ${event.action} request` : null}
        />
        <Figure
          value={event.currentWeightPct != null ? `${event.currentWeightPct.toFixed(2)}%` : 'Not held'}
          label="Held today"
          source={on(event.currentWeightAsOf) ? `snapshot ${on(event.currentWeightAsOf)}` : null}
        />
        {event.madeAt && (
          <Figure value={ageWords(madeAge) ?? 'Undated'} label="Raised" source={on(event.madeAt)} />
        )}
      </div>

      {event.rationale && (
        <p className="mt-2 max-w-[80ch] text-[12px] leading-snug text-gray-700 dark:text-gray-300" data-testid="recommendation-rationale">
          <span className="font-semibold text-gray-500">Their reason: </span>{event.rationale}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {actions.openPending && (
          <Action testId="recommendation-open-request" primary onClick={actions.openPending}>
            Go to the request<ArrowUpRight className="h-3.5 w-3.5" />
          </Action>
        )}
        <Action testId="recommendation-assess" onClick={() => actions.ask(question)}>
          <Sparkles className="h-3.5 w-3.5" />Assess this request
        </Action>
        {actions.reviewCase && (
          <Action testId="recommendation-review-case" onClick={actions.reviewCase}>
            <PencilLine className="h-3.5 w-3.5" />Review the case
          </Action>
        )}
      </div>

      <Detail summary="The case behind it and the book it is for">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div data-testid="recommendation-case-age">
            <p className={EYEBROW}>The case behind it</p>
            <p className="mt-0.5 text-[12px] text-gray-700 dark:text-gray-300">
              {facts.caseWrittenAt
                ? `Written ${on(facts.caseWrittenAt)}, ${ageWords(caseAge)}.`
                : 'Nothing is written for this name yet, so there is no case to weigh it against.'}
            </p>
          </div>
          <div data-testid="recommendation-exposure">
            <p className={EYEBROW}>Against the book</p>
            <p className="mt-0.5 text-[12px] text-gray-700 dark:text-gray-300">
              {facts.position && facts.position.weightPct != null
                ? `${facts.position.portfolioName ?? 'A book'} carries ${facts.position.weightPct.toFixed(2)}% today.`
                : 'Not held in the book this request is for.'}
            </p>
          </div>
        </div>
      </Detail>
    </Band>
  )
}
