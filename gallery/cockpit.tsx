/**
 * The desktop cockpit, at real viewport sizes, with no workspace behind it.
 *
 * ── Why this is a gallery entry and not a screenshot of the app ───────────
 *
 * The app cannot be photographed here. Every Ideas query runs under RLS, so an
 * unauthenticated build renders an empty feed, and this worktree has no
 * credentials by design. A layout claim — "eight decisions above the fold at
 * 1440×900" — has to be measured in a real browser at a real size or it is a
 * guess, which is the same argument the phone gallery already makes for cards.
 *
 * So the cockpit is built from props only, and this page supplies them from a
 * fixed fixture ranked by the real `rankMixedCandidates`. What is on screen is
 * the production component and the production ranking; only the rows are
 * invented, and they are invented once, deterministically.
 *
 * ── The BEFORE panel ──────────────────────────────────────────────────────
 *
 * `FeedCard` cannot be rendered here: it reaches Supabase through
 * `IdeaReactions` and `FeedChart`, and `guard:gallery` fails the build for it.
 * The before panel is therefore a GEOMETRIC REPLICA — the class strings are
 * copied verbatim from `FeedCard`'s card variants and `IdeasFeedPage`'s
 * container, so the heights and the column width are the real ones, while the
 * data hooks are absent. It is honest about being a replica and it is measured
 * rather than asserted: the density numbers in the report come from
 * `getBoundingClientRect` on this page, not from reading CSS.
 */

import { useMemo, useState } from 'react'
import { rankMixedCandidates } from '../src/lib/ideas/idea-priority'
import type { GeneratedSignal } from '../src/lib/ideas/signal-candidates'
import type { PortfolioLens } from '../src/lib/ideas/card-candidates'
import {
  processSupportsTriage, type ProcessFinding,
} from '../src/lib/ideas/process-candidates'
import type { SignalCard } from '../src/lib/signals/contract'
import { signalToIdeaRow, cardToIdeaRow } from '../src/components/ideas/cockpit/to-row'
import type { IdeaRowModel } from '../src/components/ideas/cockpit/IdeaRow'
import { CockpitStream } from '../src/components/ideas/cockpit/CockpitStream'
import { toIdeaRow } from '../src/components/ideas/cockpit/to-row'
import { DAY_MS } from '../src/lib/signals/thresholds'

const NOW = new Date('2026-08-28T12:00:00.000Z').getTime()
const ago = (d: number) => new Date(NOW - d * DAY_MS).toISOString()

const A = {
  NVDA: { id: 'aaaaaaa1-0000-4000-8000-000000000000', symbol: 'NVDA', company_name: 'NVIDIA' },
  MSFT: { id: 'aaaaaaa2-0000-4000-8000-000000000000', symbol: 'MSFT', company_name: 'Microsoft' },
  AVGO: { id: 'aaaaaaa3-0000-4000-8000-000000000000', symbol: 'AVGO', company_name: 'Broadcom' },
  LLY: { id: 'aaaaaaa4-0000-4000-8000-000000000000', symbol: 'LLY', company_name: 'Eli Lilly' },
  XOM: { id: 'aaaaaaa5-0000-4000-8000-000000000000', symbol: 'XOM', company_name: 'Exxon' },
  TSLA: { id: 'aaaaaaa6-0000-4000-8000-000000000000', symbol: 'TSLA', company_name: 'Tesla' },
  JPM: { id: 'aaaaaaa7-0000-4000-8000-000000000000', symbol: 'JPM', company_name: 'JPMorgan' },
}

const PEOPLE = {
  me: { id: 'u-me', first_name: 'You', last_name: '' },
  priya: { id: 'u-priya', first_name: 'Priya', last_name: 'N' },
  marcus: { id: 'u-marcus', first_name: 'Marcus', last_name: 'W' },
  dana: { id: 'u-dana', first_name: 'Dana', last_name: 'R' },
}

const CTX = {
  userId: PEOPLE.me.id,
  followedIds: [PEOPLE.priya.id],
  coverageIndex: {
    ready: true,
    direct: new Set([A.NVDA.id]),
    assigned: new Set([A.MSFT.id]),
    held: new Set([A.AVGO.id, A.LLY.id, A.NVDA.id]),
  },
}

/** A realistic desk, mixed on purpose: proposals, notes, thoughts, updates. */
const FEED = [
  { id: 'i1', type: 'trade_idea', created_at: ago(3), asset: A.NVDA, author: PEOPLE.priya, action: 'buy', rationale: 'Adding on the capex guide; supply commentary reads better than the tape.', urgency: 'high' },
  { id: 'i2', type: 'trade_idea', created_at: ago(61), asset: A.MSFT, author: PEOPLE.dana, action: 'buy', rationale: 'Still open from June. Nobody has taken a view since the Azure print.' },
  { id: 'i3', type: 'thesis_update', created_at: ago(0.2), asset: A.NVDA, author: PEOPLE.marcus, title: 'Bear case revised', content: 'Cut the bear case to 92 on the hyperscaler digestion risk.' },
  { id: 'i4', type: 'note', created_at: ago(1), asset: A.MSFT, author: PEOPLE.priya, title: 'Azure capex read', content: 'Capex guide implies a materially larger GPU order book into next year.' },
  { id: 'i5', type: 'trade_idea', created_at: ago(0.05), asset: A.TSLA, author: PEOPLE.marcus, action: 'sell', rationale: 'Deliveries miss and the price has not moved. Wants a decision today.', urgency: 'urgent' },
  { id: 'i6', type: 'quick_thought', created_at: ago(46), asset: A.NVDA, author: PEOPLE.dana, content: 'Worth revisiting the supply constraint assumption from the spring work.' },
  { id: 'i7', type: 'note', created_at: ago(2), asset: A.AVGO, author: PEOPLE.marcus, title: 'Custom silicon share', content: 'Share gains look durable through the next product cycle.' },
  { id: 'i8', type: 'quick_thought', created_at: ago(0.4), asset: A.LLY, author: PEOPLE.priya, content: 'Script trend still decelerating week over week.' },
  { id: 'i9', type: 'thesis_update', created_at: ago(5), asset: A.XOM, author: PEOPLE.dana, title: 'Refining margin', content: 'Refining margin assumption lowered for the second half.' },
  { id: 'i10', type: 'quick_thought', created_at: ago(1.5), asset: A.JPM, author: PEOPLE.marcus, content: 'NII guide looks conservative against the deposit beta they showed.' },
  { id: 'i11', type: 'note', created_at: ago(8), asset: A.TSLA, author: PEOPLE.dana, title: 'Energy storage', content: 'Storage attach rate is the part of the model nobody is arguing about.' },
  { id: 'i12', type: 'quick_thought', created_at: ago(11), asset: A.XOM, author: PEOPLE.me, content: 'My own note from a fortnight ago on the buyback pace.' },
] as any[]

/**
 * The signals `useSignalCards` actually produces, in its own shape.
 *
 * Ranked through `rankMixedCandidates` exactly as the page ranks them, so what
 * this page shows about the Attention band is what the product will show: the
 * conflict reaches it because `thesis_conflict` is tier 0, and the other two do
 * not, because activity and silence are not decisions that have gone wrong.
 */
const SIGNALS: GeneratedSignal[] = [
  {
    id: 'signal-conflict-nvda',
    signalType: 'conflict',
    headline: 'NVDA: team is split — 2 bullish vs 1 bearish',
    body: 'Opposing recorded views on a name you follow. Worth settling before the print.',
    relatedAssets: [{ id: A.NVDA.id, symbol: 'NVDA' }],
    metric: '2/1', metricLabel: 'bull / bear',
    createdAt: new Date(NOW).toISOString(), priority: 0.8,
  },
  {
    id: 'signal-stale-avgo',
    signalType: 'stale_coverage',
    headline: 'AVGO: held position with no recent activity',
    body: 'No posts, thesis updates, notes or target changes in the last 30 days.',
    relatedAssets: [{ id: A.AVGO.id, symbol: 'AVGO' }],
    metric: '30+', metricLabel: 'days silent',
    createdAt: new Date(NOW).toISOString(), priority: 0.6,
  },
  {
    id: 'signal-cluster-jpm',
    signalType: 'attention_cluster',
    headline: 'JPM: 4 posts in 7 days from 3 people',
    body: 'Activity is building, but no formal trade idea exists yet.',
    relatedAssets: [{ id: A.JPM.id, symbol: 'JPM' }],
    metric: '4', metricLabel: 'posts this week',
    createdAt: new Date(NOW).toISOString(), priority: 0.4,
  },
]

/**
 * A scenario ladder, in the shape `buildScenarioGapCard` emits.
 *
 * tier 0, base 1.00 — the highest entry in the TIER table, and the reason this
 * migration mattered more than the Dashboard one.
 */
const SCENARIO_CARDS: SignalCard[] = [
  {
    id: 'scenario_gap:nvda',
    type: 'scenario_gap',
    surface: 'research',
    severity: 'critical',
    headline: 'NVDA is trading 14% below your bear case',
    body: 'Either the case is wrong or the position is. Both scenarios were written before the capex guide.',
    metric: { value: '14% below', label: 'vs bear case', direction: 'bad', source: 'quote', asOf: ago(0.2) },
    entity: { kind: 'asset', id: A.NVDA.id, name: 'NVIDIA', ticker: 'NVDA' },
    context: [{ label: 'Portfolio', value: 'Global Equity' }],
  } as any,
  {
    id: 'scenario_gap:lly',
    type: 'scenario_gap',
    surface: 'research',
    severity: 'attention',
    headline: 'LLY is priced above your bull case',
    body: 'The market is ahead of every scenario on the ladder.',
    metric: { value: '6% above', label: 'vs bull case', direction: 'good', source: 'quote', asOf: ago(0.6) },
    entity: { kind: 'asset', id: A.LLY.id, name: 'Eli Lilly', ticker: 'LLY' },
    context: [{ label: 'Portfolio', value: 'Global Equity' }],
  } as any,
]

/** Portfolio lenses, in the five-bucket shape `usePortfolioLenses` returns. */
const LENSES: PortfolioLens[] = [
  { type: 'untargeted', position: { assetId: A.AVGO.id, symbol: 'AVGO', weightPct: 6.4, asOf: ago(1) } as any },
  { type: 'conviction', gap: { assetId: A.XOM.id, symbol: 'XOM', direction: 'overweight', weightPct: 4.1, tension: 0.35, asOf: ago(2) } as any },
  { type: 'crowded', name: { assetId: A.JPM.id, symbol: 'JPM', maxWeightPct: 3.2, asOf: ago(3) } as any },
]

const LENS_COPY: Record<string, { symbol: string; headline: string; body: string }> = {
  ['untargeted-' + A.AVGO.id]: { symbol: 'AVGO', headline: 'AVGO is held with no price target', body: '6.4% of the book, with nothing recorded to value it against.' },
  ['conviction-' + A.XOM.id]: { symbol: 'XOM', headline: 'XOM is sized against your conviction', body: 'Held at 4.1%, overweight relative to the rating recorded for it.' },
  ['crowded-' + A.JPM.id]: { symbol: 'JPM', headline: 'JPM is crowded across the book', body: 'Up to 3.2% in a single portfolio.' },
}

/**
 * Process failures, in the Decision Engine's own shape.
 *
 * The first is tier 0 — the desk decided and the book has not caught up. The
 * second is tier 3, and has no asset at all, which is the case the row layout
 * has to survive: a workflow object in a stream built around tickers.
 */
const PROCESS: ProcessFinding[] = [
  {
    id: 'a2-execution-t1',
    titleKey: 'EXECUTION_NOT_CONFIRMED',
    title: 'Execution Not Confirmed',
    description: 'Approved trade has not been logged as executed.',
    severity: 'red',
    createdAt: ago(3),
    context: {
      assetId: A.MSFT.id, assetTicker: 'MSFT', tradeIdeaId: 't1',
      portfolioName: 'Global Equity', action: 'Buy',
    },
  },
  {
    id: 'a4-deliverable-d1',
    titleKey: 'OVERDUE_DELIVERABLE',
    title: 'Q3 sector review',
    description: 'Due 5d ago in Semis deep-dive.',
    severity: 'red',
    createdAt: ago(12),
    context: { projectId: 'p1', projectName: 'Semis deep-dive', overdueDays: 5 },
  },
]

const PROCESS_COPY: Record<string, { symbol: string | null; headline: string; body: string }> = {
  'a2-execution-t1': {
    symbol: 'MSFT',
    headline: 'Execution Not Confirmed',
    body: 'Approved trade has not been logged as executed.',
  },
  'a4-deliverable-d1': {
    symbol: null,
    headline: 'Q3 sector review',
    body: 'Due 5d ago in Semis deep-dive.',
  },
}

/**
 * A synthetic readthrough, to prove the row survives one before the graph
 * exists. Nothing produces this today — see the ticket's integration map.
 */
const READTHROUGH_ROW: IdeaRowModel = {
  id: 'readthrough-demo',
  symbol: 'MSFT',
  kindLabel: 'News',
  headline: 'Microsoft raises FY capex guidance',
  age: '5h',
  tier: 2,
  reasons: [{
    code: 'readthrough',
    contribution: 0.1,
    detail: {
      via: {
        sourceAssetId: A.MSFT.id, targetAssetId: A.NVDA.id, targetTicker: 'NVDA',
        relationshipType: 'capex_exposure', strength: 0.8,
        explanation: 'Microsoft AI capex may affect GPU demand.',
      },
    },
  }],
}

type Density = 'populated' | 'sparse' | 'no-scope' | 'no-attention'



function useRows(density: Density) {
  return useMemo(() => {
    const items = density === 'sparse' ? FEED.slice(0, 3) : FEED
    const ctx = density === 'no-scope'
      ? { ...CTX, coverageIndex: { ready: true, direct: new Set<string>(), assigned: new Set<string>(), held: new Set<string>() } }
      : CTX
    // One ranked pass over both kinds — the same call the page makes. Where a
    // signal lands is the ranker's decision, not a splice.
    const signals = density === 'sparse' ? []
      : density === 'no-attention' ? SIGNALS.filter(s => s.signalType !== 'conflict')
      : SIGNALS
    /**
     * `no-attention` withholds every lead-tier producer, not just the
     * conflict: scenario ladders and target lenses are tier 0 too, which is
     * the point of this pass. The state it demonstrates is a desk with nothing
     * broken, which is a real and common morning.
     */
    const cards = density === 'sparse' || density === 'no-attention' ? [] : SCENARIO_CARDS
    /**
     * Only `crowded` survives, because it is the only tier-2 lens. Breaches and
     * expired targets are tier 0; untargeted positions and conviction gaps are
     * tier 1. Four of the five portfolio lenses are lead-tier producers, which
     * is the finding this migration was chasing.
     */
    const lenses = density === 'sparse' ? []
      : density === 'no-attention' ? LENSES.filter(l => l.type === 'crowded')
      : LENSES
    const process = density === 'sparse' ? []
      // Only the tier-3 deliverable survives in the no-attention state; the
      // unconfirmed execution is tier 0 by design.
      : density === 'no-attention' ? PROCESS.filter(p => p.titleKey === 'OVERDUE_DELIVERABLE')
      : PROCESS
    const rows = rankMixedCandidates({ posts: items, signals, cards, lenses, process }, ctx, NOW)
      .map(r => {
        if (r.item.kind === 'signal') return signalToIdeaRow(r.item.signal!, r.priority)
        if (r.item.kind === 'card') return cardToIdeaRow(r.item.card!, r.priority, NOW)
        if (r.item.kind === 'lens') {
          const copy = LENS_COPY[r.input.id]
          return cardToIdeaRow({
            id: r.input.id, type: r.input.type, headline: copy.headline, body: copy.body,
            entity: { ticker: copy.symbol }, metric: { asOf: r.input.occurredAt },
          } as any, r.priority, NOW)
        }
        if (r.item.kind === 'process') {
          const copy = PROCESS_COPY[r.input.id]
          return cardToIdeaRow({
            id: r.input.id, type: r.input.type, headline: copy.headline, body: copy.body,
            entity: { ticker: copy.symbol }, metric: { asOf: r.input.occurredAt },
          } as any, r.priority, NOW, { canTriage: processSupportsTriage() })
        }
        return toIdeaRow({ ...(r.item.post as any), priority: r.priority }, NOW)
      })
    return density === 'populated' ? [...rows, READTHROUGH_ROW] : rows
  }, [density])
}

/**
 * The current desktop, reproduced at its real geometry.
 *
 * Class strings copied from `FeedCard`'s `RichContentCard` / `TradeIdeaFeedCard`
 * and `IdeasFeedPage`'s container. The 140px block stands in for `FeedChart`,
 * which is the height the real one renders at.
 */
function BeforePanel() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/50">
      <div className="sticky top-0 z-10 shrink-0 border-b border-gray-100 bg-white px-6 py-2.5">
        <div className="mx-auto max-w-[1060px]">
          <div className="mb-2 flex items-center justify-between">
            <h1 className="text-[16px] font-semibold text-gray-900">Ideas</h1>
            <div className="h-[30px] w-[220px] rounded-lg bg-gray-100" />
          </div>
          <div className="mb-2 h-[36px] rounded-lg border border-gray-200 bg-white" />
          <div className="flex gap-1.5">
            {['All', 'Thoughts', 'Trades', 'Notes', 'Thesis'].map(t => (
              <span key={t} className="rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">{t}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-[1060px] px-4 py-3">
        <div className="space-y-3">
          {FEED.slice(0, 6).map((item, idx) => (
            <div key={item.id} data-testid="before-card"
              className="rounded-xl border border-gray-200 bg-white shadow-sm">
              {idx % 2 === 0 && <div className="h-[140px] rounded-t-xl bg-gray-100" />}
              <div className="px-4 pt-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[13px] font-bold text-gray-900">{item.asset.symbol}</span>
                  <span className="text-[11px] text-gray-400">
                    {item.author.first_name} · {idx + 1}d ago
                  </span>
                </div>
                <h3 className="text-[14px] font-semibold leading-snug text-gray-900">
                  {item.title ?? 'Idea'}
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-gray-700">
                  {item.content ?? item.rationale}
                </p>
              </div>
              <div className="mt-2 border-t border-gray-100 px-4 py-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex gap-3">
                    {['👍', '💡', '📈'].map(e => <span key={e} className="text-[13px]">{e}</span>)}
                  </div>
                  <span className="text-[13px] text-gray-300">⋯</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AfterPanel({ density }: { density: Density }) {
  const rows = useRows(density)
  const [selected, setSelected] = useState<string | null>(null)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const visible = rows.filter(r => !gone.has(r.id))
  const hide = (id: string) => setGone(prev => new Set(prev).add(id))

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-900">
      {/* Context bar. One line, because the workspace context is a fact, not a
          control panel — the filters that used to live here belong behind an
          affordance, not in front of the first decision. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 px-3 py-1.5 dark:border-gray-700">
        <span className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-white">Ideas</span>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          {density === 'no-scope' ? 'No scope yet' : 'Global Equity · My Scope 1 · Assigned 1'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="rounded border border-gray-200 px-1.5 py-0.5 text-[10.5px] text-gray-500 dark:border-gray-700 dark:text-gray-400">Filter</span>
          <span className="rounded bg-primary-600 px-2 py-0.5 text-[10.5px] font-semibold text-white">Capture</span>
        </div>
      </div>

      {density === 'no-scope' && (
        /* The first-session prompt, inline and one row tall. It occupies a
           stream slot rather than a banner above the stream, so when scope
           exists it disappears and leaves no gap behind it. */
        <div data-testid="scope-prompt" className="flex shrink-0 items-center gap-3 border-b border-primary-200 bg-primary-50/60 px-3 py-2 dark:border-primary-500/30 dark:bg-primary-500/10">
          <span className="text-[12px] font-medium text-gray-900 dark:text-white">
            Which names do you follow?
          </span>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            Tesseract uses this to decide what to put in front of you.
          </span>
          <span className="ml-auto rounded bg-primary-600 px-2 py-0.5 text-[10.5px] font-semibold text-white">
            Choose names
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <CockpitStream
          items={visible}
          selectedId={selected}
          onOpen={setSelected}
          onSnooze={hide}
          onDismiss={hide}
        />
        {visible.length === 0 && (
          <div className="px-3 py-6 text-[12px] text-gray-400">Nothing left in this view.</div>
        )}
      </div>
    </div>
  )
}

export function CockpitGallery() {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view') ?? 'after'
  const density = (params.get('density') as Density) ?? 'populated'

  if (view === 'before') return <BeforePanel />
  if (view === 'split') {
    return (
      <div className="grid h-screen grid-cols-2 divide-x divide-gray-300">
        <div className="min-h-0"><BeforePanel /></div>
        <div className="min-h-0"><AfterPanel density="populated" /></div>
      </div>
    )
  }
  return <AfterPanel density={density} />
}
