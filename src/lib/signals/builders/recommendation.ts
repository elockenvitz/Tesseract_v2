import {
  emit,
  suppress,
  type CardMetric,
  type CardResult,
  type Severity,
  type SignalCard,
} from '../contract'
import { gate, isDisplayableNumber, isQualityContent } from '../suppression'
import { actions, assetHref, dayKey, pct, TRIAGE } from './shared'

/**
 * A recommendation waiting on a decision.
 *
 * "Sell DASH" is not a decision anybody can make from a card. The same
 * instruction means something entirely different at a 30bp position than at a
 * 4%, and different again depending on who is asking — so the card leads with
 * the size change, not the verb.
 *
 * This is the one card type where the numbers can genuinely contradict each
 * other: a proposed weight below the current one attached to an "add" is not a
 * rendering problem to be styled around, it is a recommendation that says two
 * things at once, and showing it would ask somebody to approve a
 * contradiction. Those go out through `inconsistent_numbers`.
 */

export type RecommendationAction = 'buy' | 'add' | 'trim' | 'sell' | 'hold'

export interface RecommendationInput {
  /** trade_queue_items.id */
  id: string
  assetId: string
  symbol: string
  companyName?: string | null
  action: RecommendationAction | string | null
  /** Weight the recommendation asks for, percent. */
  proposedWeightPct: number | null
  /** What the portfolio holds today, percent. Null when the name is new. */
  currentWeightPct: number | null
  /** Date of the holdings snapshot `currentWeightPct` came from. ISO. */
  currentWeightAsOf: string | null
  rationale: string | null
  recommendedBy: string | null
  portfolioId: string
  portfolioName: string
  /** When the recommendation was made. ISO. */
  createdAt: string
}

/** A recommendation nobody has answered for this long has become a problem in
 *  its own right, separate from whatever it proposes. */
const STALE_DECISION_DAYS = 5
const DAY_MS = 86_400_000

const INCREASES = new Set(['buy', 'add'])
const DECREASES = new Set(['trim', 'sell'])

function severityFor(ageDays: number): Severity {
  return ageDays >= STALE_DECISION_DAYS ? 'critical' : 'attention'
}

/**
 * A new position has no current weight, and that is not missing data.
 *
 * Distinguishing "we hold none of it" from "we failed to look it up" is the
 * caller's job, which is why `currentWeightPct` is explicitly null for the
 * second case and 0 for the first. Getting this backwards would either hide
 * every new buy or invent a 0% position for every failed join.
 */
export function buildRecommendationCard(input: RecommendationInput): CardResult {
  return gate('recommendation', () => {
    const {
      id, assetId, symbol, action, proposedWeightPct, currentWeightPct,
      currentWeightAsOf, rationale, recommendedBy, portfolioName, createdAt,
    } = input
    const entity = symbol || assetId

    if (!isQualityContent(symbol)) {
      return suppress('content_quality', entity, `symbol: ${JSON.stringify(symbol)}`)
    }
    const verb = String(action ?? '').trim().toLowerCase()
    if (!verb) {
      return suppress('missing_number', entity, 'action is null — nothing is being proposed')
    }
    // Rationale is the field users actually put mash into: `NDDFKJSDNFKJ` and
    // `ksadjfnskdjn` both reached production through here. A recommendation
    // with no readable reason cannot be approved on its merits.
    if (!isQualityContent(rationale)) {
      return suppress('content_quality', entity, `rationale: ${JSON.stringify(rationale)}`)
    }
    const made = new Date(createdAt).getTime()
    if (!Number.isFinite(made)) {
      return suppress('missing_number', entity, `createdAt: ${JSON.stringify(createdAt)}`)
    }

    const hasProposed = isDisplayableNumber(proposedWeightPct, { allowZero: true })
    const hasCurrent = currentWeightPct != null && isDisplayableNumber(currentWeightPct, { allowZero: true })

    if (hasProposed && (proposedWeightPct! < 0 || proposedWeightPct! > 100)) {
      return suppress('inconsistent_numbers', entity, `proposedWeightPct ${proposedWeightPct} outside 0–100`)
    }
    if (hasCurrent && (currentWeightPct! < 0 || currentWeightPct! > 100)) {
      return suppress('inconsistent_numbers', entity, `currentWeightPct ${currentWeightPct} outside 0–100`)
    }

    // The contradiction check. Only runs when both sides are known — an
    // unknown current weight cannot disagree with anything.
    let delta: number | null = null
    if (hasProposed && hasCurrent) {
      delta = proposedWeightPct! - currentWeightPct!
      if (INCREASES.has(verb) && delta < 0) {
        return suppress('inconsistent_numbers', entity,
          `${verb} proposes ${proposedWeightPct}% against a current ${currentWeightPct}% — a decrease`)
      }
      if (DECREASES.has(verb) && delta > 0) {
        return suppress('inconsistent_numbers', entity,
          `${verb} proposes ${proposedWeightPct}% against a current ${currentWeightPct}% — an increase`)
      }
      if (verb !== 'hold' && delta === 0) {
        return suppress('inconsistent_numbers', entity,
          `${verb} proposes no change from ${currentWeightPct}%`)
      }
    }

    /**
     * The delta is only as fresh as its stalest input.
     *
     * It mixes a weight stated by a person against a weight read off a
     * holdings snapshot, so stamping it with the recommendation's own date
     * would claim a freshness the number does not have. The snapshot date
     * wins, and the eyebrow renders it as "book 31 Jul".
     */
    let metric: CardMetric | null = null
    if (delta != null && currentWeightAsOf && !Number.isNaN(new Date(currentWeightAsOf).getTime())) {
      metric = {
        value: pct(delta, 2),
        label: `${currentWeightPct!.toFixed(1)}% → ${proposedWeightPct!.toFixed(1)}%`,
        direction: 'neutral',
        source: 'computed',
        asOf: currentWeightAsOf,
      }
    } else if (hasProposed) {
      // No current weight, or no date to anchor it to. The proposal alone is
      // still a number worth leading with, and it is purely `stated` — no
      // snapshot is involved, so nothing about it is stale.
      metric = {
        value: `${proposedWeightPct!.toFixed(1)}%`,
        label: 'Proposed weight',
        direction: 'neutral',
        source: 'stated',
        asOf: createdAt,
      }
    }
    // metric stays null for a recommendation carrying no weights at all —
    // "sell the position" with a written reason and no size. The contract
    // allows that, and it is a real thing people write.

    const ageDays = Math.floor((Date.now() - made) / DAY_MS)
    const who = recommendedBy || 'A colleague'

    const card: SignalCard = {
      id: `recommendation:${id}`,
      type: 'recommendation',
      surface: 'research',
      severity: severityFor(ageDays),
      headline: delta != null
        ? `${who} wants ${symbol} ${delta > 0 ? 'up' : 'down'} to ${proposedWeightPct!.toFixed(1)}% in ${portfolioName}`
        : `${who} recommends you ${verb} ${symbol} in ${portfolioName}`,
      metric,
      body: rationale!.trim(),
      entity: {
        kind: 'asset',
        id: assetId,
        name: input.companyName || symbol,
        ticker: symbol,
      },
      context: [
        { label: portfolioName },
        { label: verb.charAt(0).toUpperCase() + verb.slice(1) },
        ...(ageDays >= STALE_DECISION_DAYS
          ? [{ label: `Waiting ${ageDays} days` }]
          : []),
      ],
      actions: actions(
        // The only card of the three whose primary action is the decision
        // itself. A recommendation you cannot answer from the feed is a
        // notification, not a card.
        { id: 'approve', label: 'Approve', inline: true },
        { label: `Open ${symbol}`, href: assetHref(assetId) },
        // Decline and snooze, but no dismiss. Five buttons did not fit 390px
        // — e2e caught it as horizontal overflow — and the one to cut was
        // never in doubt: you do not dismiss a recommendation, you answer it.
        // "Not useful" on a colleague's proposal is a decline that avoids
        // telling them so.
        [{ id: 'reject', label: 'Decline', inline: true }, TRIAGE[0]],
      ),
      provenance: {
        actor: recommendedBy ? { name: recommendedBy } : undefined,
        occurredAt: createdAt,
        reason: `${who} raised this ${ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`} against ${portfolioName}, and it is still waiting on a decision.`,
      },
      expiry: {
        // Longer than the risk cards: a recommendation does not stop needing
        // an answer because it got old. It gets louder — see severityFor.
        staleAfterDays: 30,
      },
      // Keyed on the recommendation itself, not on the asset. Two people
      // proposing different sizes for one name are two decisions, and
      // collapsing them would silently discard one person's work.
      dedupeKey: `recommendation:${id}:${dayKey(createdAt)}`,
    }

    return emit(card)
  })
}
