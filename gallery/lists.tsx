/**
 * The Lists surfaces, as fixtures.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The real Lists surfaces are auth-gated, virtualised and fixed-height, so the
 * only way to review their LAYOUT is to render the composition against static
 * data. `guard:gallery` walks this file's import graph and fails on anything
 * reaching `src/lib/supabase`, which is what keeps the mode views pure — the
 * hooks live in `ListRowExpansion`, the picture lives in `ListModeViews`, and
 * only the second is imported here.
 *
 * The expanded row is wrapped at its REAL height budget (320px at compact
 * density, the figure `AssetTableView` gives the virtualiser) so the fixtures
 * show the actual constraint rather than a comfortable approximation.
 */
import {
  OverviewMode, MarketMode, CaseMode, ValuationMode, PositionMode, WorkMode,
  RailBlock, Label, PrimaryButton, QuietButton,
} from '../src/components/lists/ListModeViews'
import { ListSurfaceCard } from '../src/components/lists/ListSurfaceCard'
import { renderSignalCell, LIST_SIGNAL_COLUMNS, listColumnPreset } from '../src/components/lists/ListRowCells'
import { ExternalLink, Pencil, Plus, Flag } from 'lucide-react'

// ── Fixtures ───────────────────────────────────────────────────────────

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString()

const CLOSES = [
  168.2, 169.1, 167.4, 170.9, 172.3, 171.0, 173.8, 176.2, 175.1, 174.0,
  177.5, 179.9, 178.2, 181.4, 183.0, 182.1, 185.6, 188.2, 186.9, 190.4,
]

const EVIDENCE = [
  { id: 'e1', title: 'Q3 print beat on Services margin', content: 'Gross margin 46.6% vs 45.1% consensus; management guided the mix shift to continue into FY26.', authorName: 'Dana R', createdAt: daysAgo(2), isNewSinceReview: true },
  { id: 'e2', title: 'Supplier channel checks — builds raised', content: 'Two of three Asian suppliers raised Q4 build plans by 6-9%.', authorName: 'Eric L', createdAt: daysAgo(5), isNewSinceReview: true },
  { id: 'e3', title: 'Regulatory: EU DMA remedy accepted', content: 'Removes the tail risk we flagged in the original case.', authorName: 'Dana R', createdAt: daysAgo(9), isNewSinceReview: true },
  { id: 'e4', title: 'Initiation note — peer at Neutral', authorName: 'Priya S', createdAt: daysAgo(40), isNewSinceReview: false },
  { id: 'e5', title: 'FY25 model refresh', authorName: 'Eric L', createdAt: daysAgo(64), isNewSinceReview: false },
]

const CASE_SECTIONS = [
  {
    key: 'thesis',
    row: {
      authorName: 'Eric L',
      content: 'Services is being underwritten as a hardware attach rate rather than as a subscription business with its own retention curve. At 46% gross margin and 11% annual growth it is already a third of gross profit, and the market is paying a hardware multiple for the whole company.\n\nWe think the re-rate happens when Services crosses 30% of revenue, which on our build is FY26.',
    },
  },
  {
    key: 'where_different',
    row: {
      authorName: 'Dana R',
      content: 'Street models hardware cyclicality and treats Services as a derivative of unit sales. Our cohort work says installed-base monetisation is largely independent of the replacement cycle.',
    },
  },
  {
    key: 'risks_to_thesis',
    row: {
      authorName: 'Eric L',
      content: 'China exposure is 19% of revenue. A forced App Store remedy in a second major jurisdiction would take roughly 4 points off the Services margin.',
    },
  },
]

const RUNGS = [
  { id: 'r1', name: 'Regulatory downside', price: 142, probability: 0.2, reasoning: 'Second-jurisdiction App Store remedy' },
  { id: 'r2', name: 'Base', price: 205, probability: 0.55, reasoning: 'Services at 30% of revenue by FY26' },
  { id: 'r3', name: 'Services re-rate', price: 248, probability: 0.25, reasoning: 'Multiple converges on software peers' },
]

const POSITIONS = [
  { portfolioId: 'p1', portfolioName: 'Global Equity', shares: 128400, weightPct: 6.12, marketValue: 24_441_360, unrealisedPct: 18.4 },
  { portfolioId: 'p2', portfolioName: 'Concentrated Growth', shares: 41200, weightPct: 4.05, marketValue: 7_840_480, unrealisedPct: 9.1 },
  { portfolioId: 'p3', portfolioName: 'Income & Growth', shares: 6100, weightPct: 0.38, marketValue: 1_160_840, unrealisedPct: -2.6 },
]

const COVERAGE = [
  { analyst: 'Dana Rivera', team: 'Technology', isLead: true },
  { analyst: 'Eric Lockenvitz', team: 'Technology', isLead: false },
]

const SHARED = {
  spot: 190.4,
  changePct: 1.24,
  target: 205,
  upsidePct: ((205 - 190.4) / 190.4) * 100,
  weightPct: 6.12,
  bookName: 'Global Equity',
  ratingValue: 'Buy',
  ratingColor: '#059669',
  conviction: 'high' as const,
}

// ── Chrome ─────────────────────────────────────────────────────────────

/**
 * The real expanded-row budget.
 *
 * 420px at compact density — the height `ListTableView` asks for via
 * `expandedRowHeights` — minus the 44px collapsed row it replaces. Using the
 * real figure is the point: a fixture at a comfortable height would show a
 * layout that does not exist.
 */
const EXPANSION_HEIGHT = 420 - 44

function Shot({ title, note, width = 1280, height, children }: {
  title: string
  note?: string
  width?: number
  height?: number
  children: React.ReactNode
}) {
  return (
    <section className="mb-10" style={{ width }} data-shot={title}>
      <div className="mb-2">
        <h2 className="text-[13px] font-semibold text-gray-900">{title}</h2>
        {note && <p className="text-[11px] text-gray-500 mt-0.5">{note}</p>}
      </div>
      <div className="rounded-lg ring-1 ring-gray-200 bg-white overflow-hidden" style={{ height }}>
        {children}
      </div>
    </section>
  )
}

/** The expansion's own padding, as `AssetTableView` applies it. */
function Expansion({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-3 h-full bg-gray-50/60" style={{ height: EXPANSION_HEIGHT }}>
      {children}
    </div>
  )
}

function ModeHeader({ active }: { active: string }) {
  const modes = ['Overview', 'Market', 'Case', 'Valuation', 'Position', 'Work']
  return (
    <div className="flex items-baseline justify-between gap-4 pb-2 mb-2.5">
      <div className="flex items-baseline gap-2.5 min-w-0">
        <span className="text-[17px] font-semibold tracking-tight text-gray-900">AAPL</span>
        <span className="text-[12px] text-gray-400 truncate">Apple Inc.</span>
        {active !== 'Work' && (
          <span className="text-[11px] font-semibold text-amber-700">New research</span>
        )}
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {modes.map(m => (
          <span key={m} className={
            m === active
              ? 'px-2 py-0.5 rounded text-[11.5px] font-medium text-gray-900 bg-gray-900/[0.07]'
              : 'px-2 py-0.5 rounded text-[11.5px] font-medium text-gray-400'
          }>{m}</span>
        ))}
      </div>
    </div>
  )
}

const footerCommon = (
  <>
    <QuietButton icon={Flag}>Flag</QuietButton>
    <QuietButton icon={ExternalLink}>Open full case</QuietButton>
  </>
)

const reviewFooter = (
  <>
    <span className="text-[11.5px] font-semibold text-gray-500">Does the case still hold?</span>
    <div className="flex items-center gap-1.5">
      <span className="px-2 py-1 text-[11.5px] font-semibold rounded-md bg-gray-900 text-white">Still holds</span>
      <span className="px-2 py-1 text-[11.5px] font-semibold rounded-md text-gray-600 bg-gray-100">Changed</span>
      <span className="px-2 py-1 text-[11.5px] font-semibold rounded-md text-gray-600 bg-gray-100">Needs work</span>
    </div>
    <QuietButton icon={Pencil}>Update the case</QuietButton>
    {footerCommon}
  </>
)

// ── Collapsed list ─────────────────────────────────────────────────────

const ROWS = [
  { symbol: 'AAPL', name: 'Apple Inc.', price: 190.4, chg: 1.24, state: 'evidence-since-review', unread: 3, weight: 6.12, rating: 'Buy', color: '#059669', conv: 'high', target: 205, cover: 'Dana Rivera' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', price: 418.1, chg: -0.42, state: 'current', unread: 0, weight: 5.4, rating: 'Buy', color: '#059669', conv: 'medium', target: 465, cover: 'Dana Rivera' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', price: 902.5, chg: 3.18, state: 'stale', unread: 0, weight: 3.85, rating: 'Hold', color: '#d97706', conv: 'low', target: 840, cover: 'Priya Shah' },
  { symbol: 'GOOGL', name: 'Alphabet Inc. Class A', price: 171.9, chg: 0.55, state: 'no-thesis', unread: 0, weight: null, rating: null, color: null, conv: null, target: null, cover: 'Eric Lockenvitz' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing', price: 158.3, chg: -1.07, state: 'evidence-since-review', unread: 1, weight: 2.1, rating: 'Buy', color: '#059669', conv: 'medium', target: 190, cover: 'Priya Shah' },
  { symbol: 'ASML', name: 'ASML Holding N.V.', price: 1021.4, chg: 0.12, state: 'thin', unread: 0, weight: 1.4, rating: 'Hold', color: '#d97706', conv: 'low', target: null, cover: null },
]

const signalFor = (r: typeof ROWS[number]) => ({
  state: r.state as any,
  subject: { newSinceReview: r.unread } as any,
  weightPct: r.weight,
  closes: CLOSES.map((c, i) => c * (1 + (r.symbol.length - 4) * 0.002 * Math.sin(i))),
  ratingValue: r.rating,
  ratingColor: r.color,
  conviction: r.conv as any,
  targetPrice: r.target,
})

function CollapsedList({ width }: { width: number }) {
  // The real preset, grown to this pane exactly as `AssetTableView` does it.
  const cols = listColumnPreset([
    { id: 'select', label: '', visible: true, width: 32, minWidth: 32, sortable: false, pinned: false, category: 'core' },
    { id: 'ticker', label: 'Ticker', visible: true, width: 100, minWidth: 80, sortable: true, pinned: true, category: 'core' },
    { id: 'companyName', label: 'Company', visible: true, width: 220, minWidth: 120, sortable: true, pinned: true, category: 'core' },
    { id: 'price', label: 'Price', visible: true, width: 100, minWidth: 80, sortable: true, pinned: false, category: 'price' },
    { id: 'change', label: 'Change %', visible: true, width: 90, minWidth: 70, sortable: true, pinned: false, category: 'price' },
    { id: 'coverage', label: 'Covered By', visible: true, width: 140, minWidth: 100, sortable: true, pinned: false, category: 'research' },
    { id: 'priority', label: 'My Priority', visible: true, width: 100, minWidth: 80, sortable: true, pinned: false, category: 'research' },
    { id: 'workflows', label: 'Processes', visible: true, width: 120, minWidth: 80, sortable: true, pinned: false, category: 'workflow' },
    { id: 'updated', label: 'Last Updated', visible: true, width: 130, minWidth: 100, sortable: true, pinned: false, category: 'workflow' },
    ...LIST_SIGNAL_COLUMNS,
  ] as any).filter(c => c.visible)

  const fixed = cols.reduce((s, c) => s + c.width, 0)
  const totalGrow = cols.reduce((s, c) => s + (c.grow ?? 0), 0)
  const slack = Math.max(0, width - fixed)
  const widthOf = (c: any) => c.grow
    ? c.width + Math.floor((slack * c.grow) / totalGrow)
    : c.width

  return (
    <div className="text-[13px]">
      <div className="flex items-center border-b border-gray-200 bg-gray-50/80">
        {cols.map(c => (
          <div key={c.id}
            className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 ${c.align === 'right' ? 'text-right' : ''}`}
            style={{ width: widthOf(c) }}>
            {c.label}
          </div>
        ))}
      </div>
      {ROWS.map((r, i) => (
        <div key={r.symbol}
          className={`flex items-center border-b border-gray-100 ${i % 2 ? 'bg-gray-50/40' : ''}`}
          style={{ height: 44 }}>
          {cols.map(c => {
            const w = widthOf(c)
            const signal = signalFor(r)
            const cell = renderSignalCell(c.id, { current_price: r.price }, signal as any)
            return (
              <div key={c.id}
                className={`px-3 flex items-center overflow-hidden ${c.align === 'right' ? 'justify-end text-right' : ''}`}
                style={{ width: w }}>
                {cell !== undefined ? cell : (
                  c.id === 'select' ? <span className="w-3.5 h-3.5 rounded-sm ring-1 ring-gray-300 inline-block" />
                    : c.id === 'ticker' ? <span className="font-semibold text-gray-900 tabular-nums">{r.symbol}</span>
                      : c.id === 'companyName' ? <span className="text-gray-500 truncate">{r.name}</span>
                        : c.id === 'price' ? <span className="tabular-nums font-medium text-gray-900 w-full text-right">{r.price.toFixed(2)}</span>
                          : c.id === 'change' ? (
                            <span className={`tabular-nums font-medium w-full text-right ${r.chg >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {r.chg >= 0 ? '+' : ''}{r.chg.toFixed(2)}%
                            </span>
                          )
                            : c.id === 'coverage' ? <span className="text-[11px] text-gray-500 truncate">{r.cover ?? ''}</span>
                              : null
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Lists home ─────────────────────────────────────────────────────────

const LISTS: Array<{ list: any; metrics: any; attention: any; activity?: any }> = [
  {
    list: {
      id: 'l1', name: 'Work in Process', color: '#6366f1', list_type: 'mutual',
      assetIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'], updated_at: daysAgo(1),
      collaborators: [
        { id: 'c1', user: { first_name: 'Dana', last_name: 'Rivera' } },
        { id: 'c2', user: { first_name: 'Priya', last_name: 'Shah' } },
      ],
      created_by_user: { first_name: 'Eric', last_name: 'Lockenvitz' },
    },
    metrics: { assetCount: 7, portfolioName: 'Global Equity' },
    attention: { newResearch: 1, newResearchNotes: 3, reviewDue: 2, noCase: 1, activeIdeas: 2, needsAttention: 3 },
    activity: { activity_type: 'item_added', actor_name: 'Dana Rivera', created_at: daysAgo(1), metadata: {} },
  },
  {
    list: {
      id: 'l2', name: 'Semis — cycle watch', color: '#0ea5e9', list_type: 'collaborative',
      assetIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12'],
      updated_at: daysAgo(3),
      collaborators: [
        { id: 'c3', user: { first_name: 'Priya', last_name: 'Shah' } },
        { id: 'c4', user: { first_name: 'Dana', last_name: 'Rivera' } },
        { id: 'c5', user: { first_name: 'Sam', last_name: 'Okafor' } },
      ],
      created_by_user: { first_name: 'Priya', last_name: 'Shah' },
    },
    metrics: { assetCount: 12 },
    attention: { newResearch: 2, newResearchNotes: 5, reviewDue: 0, noCase: 3, activeIdeas: 1, needsAttention: 2 },
    activity: { activity_type: 'note_updated', actor_name: 'Priya Shah', created_at: daysAgo(3), metadata: {} },
  },
  {
    list: {
      id: 'l3', name: 'Core holdings', color: '#10b981', list_type: 'mutual',
      assetIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'], updated_at: daysAgo(11),
      collaborators: [], created_by_user: { first_name: 'Eric', last_name: 'Lockenvitz' },
    },
    metrics: { assetCount: 9, portfolioName: 'Global Equity' },
    attention: { newResearch: 0, newResearchNotes: 0, reviewDue: 0, noCase: 0, activeIdeas: 3, needsAttention: 0 },
  },
  {
    list: {
      id: 'l4', name: 'Screen — FCF yield > 8%', color: '#a855f7', list_type: 'mutual',
      content_mode: 'screen',
      assetIds: ['a1', 'a2', 'a3', 'a4'], updated_at: daysAgo(6),
      collaborators: [], created_by_user: { first_name: 'Eric', last_name: 'Lockenvitz' },
    },
    metrics: { assetCount: 4 },
    attention: { newResearch: 0, newResearchNotes: 0, reviewDue: 1, noCase: 4, activeIdeas: 0, needsAttention: 1 },
  },
  {
    list: {
      id: 'l5', name: 'Japan — reopening basket', color: '#f59e0b', list_type: 'mutual',
      assetIds: [], updated_at: daysAgo(90),
      collaborators: [], created_by_user: { first_name: 'Eric', last_name: 'Lockenvitz' },
    },
    metrics: { assetCount: 0 },
    attention: { newResearch: 0, newResearchNotes: 0, reviewDue: 0, noCase: 0, activeIdeas: 0, needsAttention: 0 },
  },
  {
    list: {
      id: 'l6', name: 'Parked / revisit 2027', color: '#94a3b8', list_type: 'mutual',
      assetIds: [], updated_at: daysAgo(140),
      collaborators: [], created_by_user: { first_name: 'Eric', last_name: 'Lockenvitz' },
    },
    metrics: { assetCount: 0 },
    attention: { newResearch: 0, newResearchNotes: 0, reviewDue: 0, noCase: 0, activeIdeas: 0, needsAttention: 0 },
  },
]

const SYMBOLS = new Map<string, string>([
  ['a1', 'AAPL'], ['a2', 'MSFT'], ['a3', 'NVDA'], ['a4', 'GOOGL'], ['a5', 'TSM'],
  ['a6', 'ASML'], ['a7', 'AMD'], ['a8', 'AVGO'], ['a9', 'MU'], ['a10', 'LRCX'],
  ['a11', 'KLAC'], ['a12', 'AMAT'],
])

function ListsHome() {
  return (
    <div className="p-5 bg-white">
      <div className="mb-4">
        <h1 className="text-[18px] font-semibold tracking-tight text-gray-900">Lists</h1>
        <p className="text-[12px] text-gray-500 mt-0.5">Sorted by: Needs attention</p>
      </div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h2 className="text-[12px] font-semibold text-gray-700">My Lists</h2>
        <span className="text-[11px] text-gray-400">{LISTS.length}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 [&>*]:border-b [&>*]:border-gray-100">
        {LISTS.map(e => (
          <ListSurfaceCard
            key={e.list.id}
            list={e.list as any}
            metrics={e.metrics}
            isFavorite={e.list.id === 'l1'}
            symbolMap={SYMBOLS}
            lastActivity={e.activity}
            attention={e.attention}
            onClick={() => {}}
            onEdit={() => {}}
          />
        ))}
      </div>
    </div>
  )
}

// ── The gallery ────────────────────────────────────────────────────────

export function ListsGallery() {
  return (
    <div className="p-6 bg-gray-100 min-h-screen" data-gallery="lists">
      <h1 className="text-[15px] font-bold mb-5 text-gray-900">Lists — visual review</h1>

      <Shot title="1 · Lists home" width={1280}
        note="Weight follows useful information. Empty lists are one quiet line.">
        <ListsHome />
      </Shot>

      <Shot title="2 · Collapsed List" width={1280}
        note="The curated preset grown to the pane. Numbers right-aligned; Work is weight, not a badge.">
        <CollapsedList width={1280} />
      </Shot>

      <Shot title="3 · Market expansion" width={1280} height={EXPANSION_HEIGHT + 2}>
        <Expansion>
          <ModeHeader active="Market" />
          <div style={{ height: EXPANSION_HEIGHT - 52 }}>
            <MarketMode
              {...SHARED}
              closes={CLOSES}
              changes={EVIDENCE}
              ideaLabel="BUY · ready_to_recommend"
              footer={footerCommon}
            />
          </div>
        </Expansion>
      </Shot>

      <Shot title="4 · Work expansion — new research" width={1280} height={EXPANSION_HEIGHT + 2}>
        <Expansion>
          <ModeHeader active="Work" />
          <div style={{ height: EXPANSION_HEIGHT - 52 }}>
            <WorkMode
              shape="unread"
              changes={EVIDENCE}
              newSinceReview={3}
              caseWrittenAt={daysAgo(74)}
              leadCase={{ key: 'thesis', content: CASE_SECTIONS[0].row.content }}
              ratingValue={SHARED.ratingValue}
              ratingColor={SHARED.ratingColor}
              conviction={SHARED.conviction}
              weightPct={SHARED.weightPct}
              coverage={COVERAGE}
              footer={reviewFooter}
            />
          </div>
        </Expansion>
      </Shot>

      <Shot title="5 · Case expansion" width={1280} height={EXPANSION_HEIGHT + 2}>
        <Expansion>
          <ModeHeader active="Case" />
          <div style={{ height: EXPANSION_HEIGHT - 52 }}>
            <CaseMode
              symbol="AAPL"
              caseSections={CASE_SECTIONS}
              caseWrittenAt={daysAgo(74)}
              changes={EVIDENCE}
              newSinceReview={3}
              ratingValue={SHARED.ratingValue}
              ratingColor={SHARED.ratingColor}
              conviction={SHARED.conviction}
              scaleValues={[{ value: 'Buy' }, { value: 'Hold' }, { value: 'Sell' }]}
              onRate={() => {}}
              onConviction={() => {}}
              coverage={COVERAGE}
              footer={reviewFooter}
            />
          </div>
        </Expansion>
      </Shot>

      <Shot title="6 · Overview expansion" width={1280} height={EXPANSION_HEIGHT + 2}>
        <Expansion>
          <ModeHeader active="Overview" />
          <div style={{ height: EXPANSION_HEIGHT - 52 }}>
            <OverviewMode
              {...SHARED}
              ideaLabel="BUY · ready_to_recommend"
              writtenCaseSections={CASE_SECTIONS.slice(0, 2)}
              changes={EVIDENCE}
              caseWrittenAt={daysAgo(74)}
              coverage={COVERAGE}
              listFieldsSlot={
                <RailBlock label="On this list">
                  <div className="space-y-1.5 text-[11.5px] text-gray-600">
                    <div>Reviewing</div>
                    <div>Dana Rivera</div>
                    <div><Label>List note</Label>Carrying the Services re-rate into FY26.</div>
                  </div>
                </RailBlock>
              }
              footer={<>{footerCommon}</>}
            />
          </div>
        </Expansion>
      </Shot>

      <Shot title="7 · Valuation expansion" width={1280} height={EXPANSION_HEIGHT + 2}>
        <Expansion>
          <ModeHeader active="Valuation" />
          <div style={{ height: EXPANSION_HEIGHT - 52 }}>
            <ValuationMode
              spot={SHARED.spot}
              target={SHARED.target}
              upsidePct={SHARED.upsidePct}
              rungs={RUNGS}
              weightPct={SHARED.weightPct}
              ratingValue={SHARED.ratingValue}
              ratingColor={SHARED.ratingColor}
              conviction={SHARED.conviction}
              footer={<>
                <QuietButton icon={ExternalLink}>Set a target in the case</QuietButton>
                {footerCommon}
              </>}
            />
          </div>
        </Expansion>
      </Shot>

      <Shot title="8 · Position expansion" width={1280} height={EXPANSION_HEIGHT + 2}>
        <Expansion>
          <ModeHeader active="Position" />
          <div style={{ height: EXPANSION_HEIGHT - 52 }}>
            <PositionMode
              positions={POSITIONS}
              spot={SHARED.spot}
              target={SHARED.target}
              upsidePct={SHARED.upsidePct}
              ratingValue={SHARED.ratingValue}
              ratingColor={SHARED.ratingColor}
              conviction={SHARED.conviction}
              ideaLabel="BUY · ready_to_recommend"
              footer={footerCommon}
            />
          </div>
        </Expansion>
      </Shot>

      <Shot title="9 · Work — no thesis on file" width={1280} height={EXPANSION_HEIGHT + 2}>
        <Expansion>
          <ModeHeader active="Work" />
          <div style={{ height: EXPANSION_HEIGHT - 52 }}>
            <WorkMode
              shape="no-case"
              changes={EVIDENCE.slice(3)}
              newSinceReview={0}
              caseWrittenAt={null}
              ratingValue={null}
              ratingColor={null}
              conviction={null}
              weightPct={null}
              coverage={COVERAGE}
              footer={<>
                <PrimaryButton icon={Pencil}>Write the case</PrimaryButton>
                {footerCommon}
              </>}
            />
          </div>
        </Expansion>
      </Shot>

      <Shot title="10 · Work — live idea" width={1280} height={EXPANSION_HEIGHT + 2}>
        <Expansion>
          <ModeHeader active="Work" />
          <div style={{ height: EXPANSION_HEIGHT - 52 }}>
            <WorkMode
              shape="idea"
              changes={EVIDENCE}
              newSinceReview={0}
              caseWrittenAt={daysAgo(12)}
              idea={{
                action: 'buy', stage: 'ready_to_recommend', portfolioName: 'Global Equity',
                conviction: 'high',
                rationale: 'Adding 150bps ahead of the FY26 Services disclosure change. Sizing assumes the regulatory downside rung at 20%.',
              }}
              decisionLabel="awaiting PM"
              ratingValue={SHARED.ratingValue}
              ratingColor={SHARED.ratingColor}
              conviction={SHARED.conviction}
              weightPct={SHARED.weightPct}
              coverage={COVERAGE}
              footer={<>
                <PrimaryButton icon={Plus}>Continue the idea</PrimaryButton>
                {footerCommon}
              </>}
            />
          </div>
        </Expansion>
      </Shot>
    </div>
  )
}
