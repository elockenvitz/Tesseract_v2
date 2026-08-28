/**
 * A deterministic candidate set, standing in for a real workspace.
 *
 * ── What it is and is not ─────────────────────────────────────────────────
 *
 * It is not a claim about production data. It is a controlled population with
 * the shapes that make ranking decisions visible — a scoped name that is quiet,
 * an urgent unscoped one that is loud, a prolific author, a dismissed card, a
 * snooze that is about to lapse — so that a reorder has something to be
 * attributed to. Real staging numbers replace it through the same
 * `RankSnapshot` shape, without any of the replay or reporting changing.
 *
 * Everything is derived from a fixed seed and a fixed clock, so two runs months
 * apart produce byte-identical output and a diff in the report means a diff in
 * the ranker.
 */

import { dispositionKey } from '../../signals/dispositions'
import { ideaCardId, ideaCardType } from '../../signals/builders/ideas'
import { TRIAGE_JUDGMENT } from '../../signals/feed-triage'
import { DAY_MS } from '../../signals/thresholds'
import type { DispositionMap } from '../../signals/dispositions'
import type { RankSnapshot, SnapshotCandidate } from './types'
import { SNAPSHOT_VERSION } from './types'

/** Fixed clock. Every age in the fixture is relative to this instant. */
export const FIXTURE_NOW = Date.UTC(2026, 7, 28, 12, 0, 0)

const uuid = (n: number, tag = 'a') =>
  `${tag}${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`

/** Assets. The first two are in the reader's personal scope. */
export const FIXTURE_ASSETS = [
  { id: uuid(1), symbol: 'NVDA' },
  { id: uuid(2), symbol: 'MSFT' },
  { id: uuid(3), symbol: 'AVGO' },
  { id: uuid(4), symbol: 'LLY' },
  { id: uuid(5), symbol: 'XOM' },
  { id: uuid(6), symbol: 'JPM' },
  { id: uuid(7), symbol: 'TSLA' },
  { id: uuid(8), symbol: 'CRM' },
]

const PERSONAL = [FIXTURE_ASSETS[0].id]
const ASSIGNED = [FIXTURE_ASSETS[1].id]
const HELD = [FIXTURE_ASSETS[2].id, FIXTURE_ASSETS[3].id, FIXTURE_ASSETS[0].id]

const AUTHORS = ['author-1', 'author-2', 'author-3', 'author-4']
const READER = 'author-1'
const FOLLOWED = ['author-2']

/** A small deterministic PRNG — mulberry32, so the fixture is reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const at = (daysAgo: number) => new Date(FIXTURE_NOW - daysAgo * DAY_MS).toISOString()

/**
 * The rows that carry the interesting cases, named so a report can point at
 * them. Everything else is background population.
 */
export const MARKED = {
  /** Old, on a personally scoped name. Outside the old newest-20 window. */
  oldScoped: 'marked-old-scoped',
  /** Old, on an org-assigned name. Same situation, other lane. */
  oldAssigned: 'marked-old-assigned',
  /** Today, urgent, on a name in nobody's scope. Must not lose to the above. */
  urgentUnscoped: 'marked-urgent-unscoped',
  /** Dismissed by the reader. Must be absent from both shells. */
  dismissed: 'marked-dismissed',
  /** Snoozed, still inside its quiet window. */
  snoozed: 'marked-snoozed',
  /** Snoozed, quiet already lapsed. Must be present. */
  snoozeLapsed: 'marked-snooze-lapsed',
  /** Merely held, never declared. Should sit below scoped, above nothing. */
  heldOnly: 'marked-held-only',
} as const

function markedCandidates(): SnapshotCandidate[] {
  const base = {
    contentLength: 240, hasSentiment: true, reactionCount: 1, source: 'fixture',
  }
  return [
    {
      ...base, id: MARKED.oldScoped, type: 'quick_thought', created_at: at(46),
      authorId: 'author-3', assetId: FIXTURE_ASSETS[0].id, assetSymbol: 'NVDA',
      fromRelevancePool: true,
    },
    {
      ...base, id: MARKED.oldAssigned, type: 'note', created_at: at(52),
      authorId: 'author-4', assetId: FIXTURE_ASSETS[1].id, assetSymbol: 'MSFT',
      fromRelevancePool: true,
    },
    {
      ...base, id: MARKED.urgentUnscoped, type: 'trade_idea', created_at: at(0.1),
      authorId: 'author-2', assetId: FIXTURE_ASSETS[6].id, assetSymbol: 'TSLA',
      urgency: 'urgent', status: 'idea', reactionCount: 4,
    },
    {
      ...base, id: MARKED.dismissed, type: 'quick_thought', created_at: at(1),
      authorId: 'author-2', assetId: FIXTURE_ASSETS[0].id, assetSymbol: 'NVDA',
    },
    {
      ...base, id: MARKED.snoozed, type: 'note', created_at: at(2),
      authorId: 'author-3', assetId: FIXTURE_ASSETS[2].id, assetSymbol: 'AVGO',
    },
    {
      ...base, id: MARKED.snoozeLapsed, type: 'thesis_update', created_at: at(3),
      authorId: 'author-3', assetId: FIXTURE_ASSETS[3].id, assetSymbol: 'LLY',
    },
    {
      ...base, id: MARKED.heldOnly, type: 'quick_thought', created_at: at(4),
      authorId: 'author-4', assetId: FIXTURE_ASSETS[2].id, assetSymbol: 'AVGO',
    },
  ]
}

/**
 * Background rows, weighted the way a real feed is: mostly recent thoughts on
 * names nobody in this workspace has declared, plus a handful of open proposals
 * that are months old — the population `PROPOSAL_DAYS_BACK` was written for.
 */
function backgroundCandidates(): SnapshotCandidate[] {
  const rand = rng(20260828)
  const out: SnapshotCandidate[] = []

  // 25 recent, unscoped — enough to fill the old 20-row recency window alone.
  for (let i = 0; i < 25; i++) {
    const asset = FIXTURE_ASSETS[4 + (i % 4)]
    out.push({
      id: `noise-${String(i).padStart(2, '0')}`,
      type: i % 5 === 0 ? 'note' : i % 7 === 0 ? 'thesis_update' : 'quick_thought',
      created_at: at(0.2 + i * 0.35),
      // author-4 is deliberately prolific, so diversity has something to do.
      authorId: i % 3 === 0 ? 'author-4' : AUTHORS[i % AUTHORS.length],
      assetId: asset.id,
      assetSymbol: asset.symbol,
      contentLength: Math.floor(rand() * 400) + 20,
      hasSentiment: rand() > 0.5,
      reactionCount: Math.floor(rand() * 3),
      source: 'fixture',
    })
  }

  // 6 open proposals, old, the way the reporting org's actually are.
  for (let i = 0; i < 6; i++) {
    const asset = FIXTURE_ASSETS[i % FIXTURE_ASSETS.length]
    out.push({
      id: `proposal-${i}`,
      type: i === 5 ? 'pair_trade' : 'trade_idea',
      created_at: at(60 + i * 18),
      authorId: AUTHORS[(i + 1) % AUTHORS.length],
      assetId: asset.id,
      assetSymbol: asset.symbol,
      contentLength: 300,
      hasSentiment: false,
      reactionCount: Math.floor(rand() * 2),
      urgency: i === 0 ? 'high' : 'medium',
      status: 'idea',
      source: 'fixture',
      fromRelevancePool: i < 2,
    })
  }

  return out
}

function fixtureDispositions(): DispositionMap {
  const write = (id: string, type: string, key: string, atMs: number): DispositionMap => {
    const t = ideaCardType(type)
    return {
      [dispositionKey(t, ideaCardId(type, id))]: {
        kind: 'settled', key, verdict: key, question: 'Feed triage', cardType: t,
        v: 3, at: atMs, until: atMs + 30 * DAY_MS,
      },
    }
  }
  return {
    ...write(MARKED.dismissed, 'quick_thought', TRIAGE_JUDGMENT.dismiss.key, FIXTURE_NOW - DAY_MS),
    ...write(MARKED.snoozed, 'note', TRIAGE_JUDGMENT.snooze.key, FIXTURE_NOW - 2 * DAY_MS),
    // Recorded nine days ago; the snooze window is seven, so it has lapsed.
    ...write(MARKED.snoozeLapsed, 'thesis_update', TRIAGE_JUDGMENT.snooze.key, FIXTURE_NOW - 9 * DAY_MS),
  }
}

export function buildFixtureSnapshot(label = 'deterministic fixture'): RankSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    capturedAt: new Date(FIXTURE_NOW).toISOString(),
    source: 'fixture',
    label,
    context: {
      userId: READER,
      followedIds: FOLLOWED,
      heldAssetIds: HELD,
      coverage: { ready: true, direct: PERSONAL, assigned: ASSIGNED, held: HELD },
      dispositions: fixtureDispositions(),
      now: FIXTURE_NOW,
    },
    candidates: [...markedCandidates(), ...backgroundCandidates()],
  }
}
