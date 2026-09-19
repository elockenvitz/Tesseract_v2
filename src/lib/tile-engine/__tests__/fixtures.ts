/**
 * The six canonical situations, as data.
 *
 * Shared by every test in this directory so that "prove the architecture on
 * six situations" means the same six everywhere. A fixture built inside one
 * test is a fixture the next test can quietly disagree with, which is how a
 * suite ends up asserting two different products.
 */

import type { Fact } from '../facts'
import type { FindingSubject } from '../finding'
import {
  coverageGapFinding, decisionFollowupFinding, dislocationFinding,
  noCoreThesisFinding, targetExpiredFinding, unreviewedMoveFinding,
} from '../builders'
import type { SemanticFinding } from '../finding'

/** A fixed instant. Nothing in the engine reads a clock; tests must not either. */
export const NOW = Date.parse('2026-09-06T12:00:00.000Z')

export const MSFT: FindingSubject = {
  kind: 'asset', id: 'a-msft', name: 'Microsoft', ticker: 'MSFT',
}
export const AMZN: FindingSubject = {
  kind: 'asset', id: 'a-amzn', name: 'Amazon', ticker: 'AMZN',
}

const fact = <V,>(key: string, value: V, source: Fact['source'], asOf: string): Fact<V> =>
  ({ key, value, source, asOf })

/** 1. A price objective that outlived the horizon its author gave it. */
export const targetExpired = (): SemanticFinding => {
  const f = targetExpiredFinding({
    subject: MSFT,
    target: fact('target_price', 520, 'stated', '2026-01-15T00:00:00.000Z'),
    statedAt: '2026-01-15T00:00:00.000Z',
    horizonAt: '2026-06-30T00:00:00.000Z',
    stakes: { weightPct: 6.2, held: true, coverage: 'direct' },
  }, NOW)
  if (!f) throw new Error('fixture: target_expired did not fire')
  return f
}

/** 2. The live price outside the band somebody modelled. */
export const dislocation = (): SemanticFinding => {
  const f = dislocationFinding({
    subject: MSFT,
    price: fact('price', 310, 'quote', '2026-09-06T11:55:00.000Z'),
    low: 400, high: 620,
    breachedLabel: 'Bear',
    caseAsOf: '2026-01-15T00:00:00.000Z',
    stakes: { weightPct: 6.2, held: true, coverage: 'direct' },
  }, NOW)
  if (!f) throw new Error('fixture: dislocation did not fire')
  return f
}

/** 3. A material move with nobody having looked since. */
export const unreviewedMove = (): SemanticFinding => {
  const f = unreviewedMoveFinding({
    subject: AMZN,
    movePct: fact('move_pct', -22, 'computed', '2026-09-06T11:55:00.000Z'),
    lastReviewedAt: '2026-04-02T00:00:00.000Z',
    observedAt: '2026-09-06T11:55:00.000Z',
    stakes: { weightPct: 3.4, held: true, coverage: 'assigned' },
  }, NOW)
  if (!f) throw new Error('fixture: unreviewed_move did not fire')
  return f
}

/** 4. Capital deployed with no written argument behind it. */
export const noCoreThesis = (): SemanticFinding => {
  const f = noCoreThesisFinding({
    subject: AMZN,
    thesis: fact('core_thesis', null, 'stated', '2026-09-06T00:00:00.000Z'),
    sectionsWritten: 0, sectionsExpected: 3,
    stakes: { weightPct: 3.4, held: true, coverage: 'assigned' },
    observedAt: '2026-09-06T00:00:00.000Z',
  }, NOW)
  if (!f) throw new Error('fixture: no_core_thesis did not fire')
  return f
}

/** 5. A meaningful position nobody is responsible for. */
export const coverageGap = (): SemanticFinding => {
  const f = coverageGapFinding({
    subject: { kind: 'asset', id: 'a-nvda', name: 'NVIDIA', ticker: 'NVDA' },
    analyst: fact('analyst_id', null, 'stated', '2026-09-01T00:00:00.000Z'),
    weightPct: 7.1,
    portfolioName: 'Core Equity',
    stakes: { coverage: 'none' },
    observedAt: '2026-09-01T00:00:00.000Z',
  }, NOW)
  if (!f) throw new Error('fixture: coverage_gap did not fire')
  return f
}

/** 6. A decision taken whose loop is still open. */
export const decisionFollowup = (): SemanticFinding => {
  const f = decisionFollowupFinding({
    subject: MSFT,
    decision: fact('decision', 'trim', 'stated', '2026-08-28T00:00:00.000Z'),
    decidedAt: '2026-08-28T00:00:00.000Z',
    stages: ['proposed', 'approved', 'executed', 'reconciled'],
    stageIndex: 1,
    stakes: { weightPct: 6.2, held: true, coverage: 'direct' },
  }, NOW)
  if (!f) throw new Error('fixture: decision_followup did not fire')
  return f
}

export const ALL_CANONICAL = (): SemanticFinding[] => [
  targetExpired(), dislocation(), unreviewedMove(),
  noCoreThesis(), coverageGap(), decisionFollowup(),
]

/** A phone-sized feed slot, matching the gallery's own container. */
export const PHONE = { width: 390, height: 590 }
/** A workbench pane. Wider, and with room to work. */
export const PANE = { width: 720, height: 900 }
/** Deliberately too small for anything but a claim and a tray. */
export const SLIVER = { width: 320, height: 220 }
