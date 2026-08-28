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
 * fixed fixture ranked by the real `rankIdeaCandidates`. What is on screen is
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
import { rankIdeaCandidates } from '../src/lib/ideas/idea-priority'
import { priorityFor, type PriorityInput } from '../src/lib/signals/feed-priority'
import { KIND_LABEL } from '../src/components/signals/card-identity'
import { compactAge } from '../src/components/ideas/cockpit/to-row'
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
 * Lead-tier signals, which the Ideas feed does not currently produce.
 *
 * Worth stating plainly because it is a finding, not a fixture convenience:
 * every row `useIdeasFeed` retrieves is a POST — a thought, note, thesis
 * update or proposal — and every post is tier 4 by construction. So the
 * Attention band, as wired today, would never populate from the feed alone.
 *
 * The signals that belong there — a price through its case, a position with no
 * framework — are produced by the scenario and lens builders that the mobile
 * shell pools in, and desktop does not yet consume. These rows stand in for
 * them so the band's design can be judged; wiring the real sources is the next
 * piece of work, and is recorded as such in the report.
 */
const SIGNALS: PriorityInput[] = [
  {
    id: 's1', type: 'scenario_gap', severity: 'critical', occurredAt: ago(0.3),
    weightPct: 4.2, held: true, deviationPct: 14,
    scope: { kind: 'personal_scope' },
  },
  {
    id: 's2', type: 'no_target', severity: 'attention', occurredAt: ago(1.2),
    weightPct: 2.1, held: true, scope: { kind: 'assigned_scope' },
  },
]

const SIGNAL_META: Record<string, { symbol: string; headline: string }> = {
  s1: { symbol: 'NVDA', headline: 'Price is 14% through the bear case' },
  s2: { symbol: 'MSFT', headline: 'Held at 2.1% with no price target recorded' },
}

function signalRows(): IdeaRowModel[] {
  return SIGNALS.map(input => {
    const p = priorityFor(input, NOW)
    const meta = SIGNAL_META[input.id]
    return {
      id: input.id,
      symbol: meta.symbol,
      kindLabel: KIND_LABEL[input.type] ?? 'Signal',
      headline: meta.headline,
      age: compactAge(String(input.occurredAt), NOW),
      reasons: p.reasons,
      tier: p.tier,
      actionable: true,
    }
  })
}

type Density = 'populated' | 'sparse' | 'no-scope'

function useRows(density: Density) {
  return useMemo(() => {
    const items = density === 'sparse' ? FEED.slice(0, 3) : FEED
    const ctx = density === 'no-scope'
      ? { ...CTX, coverageIndex: { ready: true, direct: new Set<string>(), assigned: new Set<string>(), held: new Set<string>() } }
      : CTX
    const posts = rankIdeaCandidates(items, ctx, NOW)
      .map(r => toIdeaRow({ ...(r.item as any), priority: r.priority }, NOW))
    // Signals first only because their tier puts them there — `CockpitStream`
    // partitions on tier and never re-sorts, so this is the ranker's order.
    return density === 'sparse' ? posts : [...signalRows(), ...posts]
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
