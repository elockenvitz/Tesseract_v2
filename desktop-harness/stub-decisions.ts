/**
 * The Decisions lens, with a decision log behind it.
 *
 * Same reason as `stub-portfolio`: without it the lens renders blank, and a
 * change nobody has looked at is a change nobody has made.
 *
 * The names are the ones the rest of the harness uses, so a decision on NVDA
 * and the NVDA idea are visibly about the same position.
 *
 * The set deliberately spans every outcome family the model defines --
 * pending, accepted, accepted-with-modification, rejected, deferred,
 * withdrawn -- because the lens's whole job is telling them apart, and a
 * fixture of six accepted rows would let a regression in that distinction
 * pass unseen.
 *
 * It also spans both kinds of WORK. Every resolved row originally carried a
 * written rationale, so the "decided with no reason recorded" half of this
 * lens had nothing to render and could not be looked at -- the same
 * stubbed-but-inert trap that hid the Today ladder. Two rows now have no
 * human reason: one with nothing at all, one with a system line, because a
 * workflow log is not a rationale and `provenanceOf` is the thing that has
 * to keep telling them apart.
 *
 * And several carry NO baseline weight, because `submission_snapshot` is
 * optional and plenty of real records do not have one. Every fixture row
 * having a baseline is how "most decision cards draw no visual at all"
 * survived a review: the gate that suppressed them could not fire here.
 */
import type { DecisionRecord, DecisionStatus } from '../src/lib/desktop-decisions/model'

const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
const ahead = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()

interface Row {
  id: string; symbol: string; name: string; assetId: string
  status: DecisionStatus; action: string
  requested: number; decided: number | null
  sizing: number | null; baseline: number | null
  note: string | null; context: string
  executed: boolean
}

const ROWS: Row[] = [
  {
    id: 'd-1', symbol: 'LLY', name: 'Eli Lilly & Co', assetId: 'a-lly',
    status: 'pending', action: 'buy', requested: 3, decided: null,
    sizing: 4.5, baseline: 0, note: null,
    context: 'Incretin capacity comes online two quarters ahead of consensus and the Street is still modelling the supply constraint as the demand ceiling.',
    executed: false,
  },
  {
    id: 'd-2', symbol: 'NVDA', name: 'NVIDIA Corp', assetId: 'a-nvda',
    status: 'needs_discussion', action: 'trim', requested: 6, decided: null,
    sizing: 5.0, baseline: 7.4, note: null,
    context: 'Position is now the largest in the book on a thesis written when the multiple was half this.',
    executed: false,
  },
  {
    id: 'd-3', symbol: 'DASH', name: 'DoorDash Inc', assetId: 'a-dash',
    status: 'accepted', action: 'add', requested: 24, decided: 19,
    sizing: 2.0, baseline: 0.9,
    note: 'Grocery attach is the whole call and it is compounding. Sized to 2% and no further until the Q4 cohort prints.',
    context: 'Grocery order frequency is compounding faster than the restaurant cohort ever did.',
    executed: true,
  },
  {
    id: 'd-4', symbol: 'PFE', name: 'Pfizer Inc', assetId: 'a-pfe',
    status: 'accepted_with_modification', action: 'sell', requested: 41, decided: 36,
    sizing: 0, baseline: 2.1,
    note: null,
    context: 'The 2028 LOE cliff is being financed with buybacks rather than pipeline.',
    executed: true,
  },
  {
    id: 'd-5', symbol: 'XOM', name: 'Exxon Mobil', assetId: 'a-xom',
    status: 'rejected', action: 'buy', requested: 58, decided: 52,
    sizing: 2.5, baseline: null,
    note: 'The Guyana breakeven is the case and we cannot see it at the asset level. Not a no on the name, a no on the evidence.',
    context: 'Guyana breakevens are the whole equity story and they are not disclosed at the asset level.',
    executed: false,
  },
  {
    id: 'd-6', symbol: 'MSFT', name: 'Microsoft Corp', assetId: 'a-msft',
    status: 'deferred', action: 'add', requested: 31, decided: 26,
    sizing: 7.0, baseline: null,
    note: 'Waiting on the capex-per-seat disclosure. Revisit after the next refresh.',
    context: 'Copilot seat attach is running ahead of the disclosed number.',
    executed: false,
  },
  {
    id: 'd-7', symbol: 'BABA', name: 'Alibaba Group', assetId: 'a-baba',
    status: 'withdrawn', action: 'buy', requested: 74, decided: 70,
    sizing: 1.5, baseline: 1.6, note: 'Withdrawn by the requester before review.',
    context: 'No written case was ever attached to this request.',
    executed: false,
  },
  {
    id: 'd-9', symbol: 'KO', name: 'Coca-Cola Co', assetId: 'a-ko',
    status: 'accepted', action: 'trim', requested: 110, decided: 104,
    sizing: null, baseline: null, note: null,
    context: 'Pricing power in Latin America is being read as inflation pass-through.',
    executed: true,
  },
  {
    id: 'd-10', symbol: 'AAPL', name: 'Apple Inc', assetId: 'a-aapl',
    status: 'rejected', action: 'buy', requested: 130, decided: 121,
    sizing: 3.4, baseline: null, note: null,
    context: 'Services gross margin has carried three years of flat hardware.',
    executed: false,
  },
  {
    id: 'd-11', symbol: 'UNH', name: 'UnitedHealth Group', assetId: 'a-unh',
    status: 'accepted', action: 'add', requested: 145, decided: 140,
    sizing: 1.9, baseline: 1.2, note: null,
    context: 'Utilisation has normalised faster than the guide implied.',
    executed: false,
  },
  {
    id: 'd-8', symbol: 'TSM', name: 'Taiwan Semiconductor', assetId: 'a-tsm',
    status: 'accepted', action: 'buy', requested: 92, decided: 88,
    sizing: 2.8, baseline: null,
    note: 'Auto-resolved on batch approval.',
    context: 'N2 pricing holds because there is no second source.',
    executed: true,
  },
]

const record = (r: Row): DecisionRecord => ({
  id: r.id,
  ideaId: `i-${r.id}`,
  portfolioId: 'p1',
  portfolioName: 'Global Equity',
  assetId: r.assetId,
  symbol: r.symbol,
  companyName: r.name,
  status: r.status,
  action: r.action,
  decidedBy: r.decided == null ? null : 'u1',
  decidedByName: r.decided == null ? null : 'Eric Lockenvitz',
  decidedAt: r.decided == null ? null : ago(r.decided),
  requestedByName: 'Dana Whitfield',
  requestedAt: ago(r.requested),
  decisionNote: r.note,
  contextNote: r.context,
  sizingWeight: r.sizing,
  sizingShares: null,
  baselineWeight: r.baseline,
  deferredUntil: r.status === 'deferred' ? ahead(21) : null,
  execution: r.executed
    ? {
        id: `x-${r.id}`,
        status: 'filled',
        completedAt: ago(Math.max(0, (r.decided ?? 1) - 1)),
        executedByName: 'Marta Klein',
      }
    : null,
})

const DECISIONS = ROWS.map(record)

export const useDecisionScan = (portfolioId: string | null) => ({
  decisions: portfolioId && portfolioId !== 'p1' ? [] : DECISIONS,
  isLoading: false,
  error: null,
})

export const usePortfoliosWithDecisions = (_d: DecisionRecord[]) => [
  { id: 'p1', name: 'Global Equity', count: DECISIONS.length },
]

export const useDecisionDetail = (d: DecisionRecord | null) => {
  if (!d) return { detail: undefined, isLoading: false }
  return {
    detail: {
      thesis: ROWS.find(r => r.id === d.id)?.context ?? null,
      evidenceCount: 3,
      sectionCount: 3,
    } as never,
    isLoading: false,
  }
}
