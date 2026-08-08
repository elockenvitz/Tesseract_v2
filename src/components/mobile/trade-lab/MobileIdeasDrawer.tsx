import { useState } from 'react'
import { clsx } from 'clsx'
import { Check, ChevronRight, Layers, Lightbulb, Scale, Search, X } from 'lucide-react'

/**
 * Deliberately loose. The drawer's items come from three different shapes in
 * SimulationPage — trade ideas, pair-trade groups and proposals, each carrying
 * its own joined rows — and typing them properly here would mean exporting
 * three internal types out of a 7,900-line page. This component only reads the
 * handful of fields listed, and renders a placeholder for anything absent.
 */
interface DrawerItem {
  type: 'single' | 'pair'
  idea?: any
  pairTrade?: any
  legs?: any[]
  allAdded?: boolean
  someAdded?: boolean
}

interface MobileIdeasDrawerProps {
  /** The lab's portfolio, so ideas belonging elsewhere can be called out. */
  currentPortfolioId?: string | null
  items: DrawerItem[]
  proposals: any[]
  search: string
  onSearchChange: (v: string) => void
  onToggleAsset: (idea: any, isAdded: boolean) => void
  onOpenIdea: (ideaId: string) => void
}

const STAGE_LABEL: Record<string, string> = {
  investigate: 'Investigate',
  working_on: 'Investigate',
  discussing: 'Investigate',
  deep_research: 'Deep research',
  modeling: 'Deep research',
  simulating: 'Deep research',
  thesis_forming: 'Thesis forming',
  ready_for_decision: 'Ready',
}

/**
 * Trade ideas, as a full-screen list.
 *
 * The desktop panel is a 320px column, and every dimension in it is tuned to
 * that: 10-11px type, half-pixel padding, a 20px checkbox. Rendered
 * full-screen on a phone it does not become spacious, it becomes a wall of
 * tiny text with tap targets under the 44px floor — the same information, no
 * easier to hit.
 *
 * So the list is rebuilt at phone scale. The checkbox is the primary action
 * and gets a real target; the row body opens the idea. Those are separate
 * targets on purpose — on the desktop the distinction is carried by a
 * stopPropagation on a small square, which on a thumb is a coin toss.
 */
export function MobileIdeasDrawer({
  currentPortfolioId,
  items,
  proposals,
  search,
  onSearchChange,
  onToggleAsset,
  onOpenIdea,
}: MobileIdeasDrawerProps) {
  const [tab, setTab] = useState<'ideas' | 'proposals'>(
    proposals.length > 0 ? 'proposals' : 'ideas'
  )

  const list = tab === 'ideas' ? items : proposals

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-shrink-0 px-3 pt-2 pb-2 space-y-2">
        {/* Recommendations are a different kind of thing from your own ideas —
            someone is waiting on them — so they get a tab rather than being a
            collapsible section buried above the list. */}
        <div className="flex gap-1">
          <TabButton active={tab === 'proposals'} onClick={() => setTab('proposals')} icon={Scale} label="Recommendations" count={proposals.length} />
          <TabButton active={tab === 'ideas'} onClick={() => setTab('ideas')} icon={Lightbulb} label="Ideas" count={items.length} />
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search ideas"
            className="w-full h-10 pl-8 pr-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full text-gray-400"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-4 space-y-2">
        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
            <Layers className="h-8 w-8 opacity-50" />
            <p className="text-sm text-center">
              {search
                ? 'Nothing matches that.'
                : tab === 'proposals'
                  ? 'No recommendations waiting.'
                  : 'No ideas are ready to simulate yet.'}
            </p>
          </div>
        ) : tab === 'ideas' ? (
          items.map((item, i) =>
            item.type === 'pair' ? (
              <PairRow key={item.pairTrade?.id ?? `pair-${i}`} item={item} currentPortfolioId={currentPortfolioId} onToggleAsset={onToggleAsset} onOpenIdea={onOpenIdea} />
            ) : (
              <IdeaRow key={item.idea?.id ?? `idea-${i}`} idea={item.idea} currentPortfolioId={currentPortfolioId} onToggleAsset={onToggleAsset} onOpenIdea={onOpenIdea} />
            )
          )
        ) : (
          proposals.map((p, i) => {
            const item = p.proposal?.trade_queue_items
            const asset = item?.assets
            const proposer = p.proposal?.users
            return (
              <button
                key={p.proposal?.id ?? `proposal-${i}`}
                type="button"
                onClick={() => onOpenIdea(item?.id ?? p.proposal?.trade_queue_item_id)}
                className="w-full text-left rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-900/10 p-3 active:bg-amber-100/60"
              >
                <div className="flex items-center gap-2">
                  <Scale className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {asset?.symbol ?? p.legs?.[0]?.symbol ?? '—'}
                  </span>
                  {(item?.action || p.legs?.[0]?.action) && (
                    <span
                      className={clsx(
                        'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
                        (item?.action ?? p.legs?.[0]?.action) === 'buy' || (item?.action ?? p.legs?.[0]?.action) === 'add'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                      )}
                    >
                      {item?.action ?? p.legs?.[0]?.action}
                    </span>
                  )}
                  {p.isPairTrade && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      Pair
                    </span>
                  )}
                  <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-gray-300" />
                </div>

                <p className="mt-0.5 min-w-0 truncate text-[11px] text-gray-500 dark:text-gray-400">
                  {asset?.company_name}
                </p>

                {/* The recommended size is the recommendation. Without it the
                    card names a ticker and says nothing about what is being
                    asked for. */}
                {(p.proposal?.weight != null || p.proposal?.shares != null) && (
                  <p className="mt-1 text-[12px] font-semibold tabular-nums text-gray-800 dark:text-gray-100">
                    {p.proposal.weight != null ? `${Number(p.proposal.weight).toFixed(2)}% target` : ''}
                    {p.proposal.weight != null && p.proposal.shares != null ? ' · ' : ''}
                    {p.proposal.shares != null ? `${Number(p.proposal.shares).toLocaleString()} sh` : ''}
                  </p>
                )}

                {(p.proposal?.notes || item?.rationale) && (
                  <p className="mt-1 text-[12px] leading-snug text-gray-600 dark:text-gray-300 line-clamp-2">
                    {p.proposal?.notes || item?.rationale}
                  </p>
                )}

                {proposer && (
                  <p className="mt-1 text-[11px] text-gray-400 truncate">
                    from {[proposer.first_name, proposer.last_name].filter(Boolean).join(' ') || proposer.email}
                  </p>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function TabButton({
  active, onClick, icon: Icon, label, count,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Scale
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={clsx(
        'flex-1 h-10 inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium no-touch-target',
        active
          ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
          : 'text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
      {count > 0 && <span className="text-[11px] tabular-nums opacity-70">{count}</span>}
    </button>
  )
}

/**
 * The checkbox and the row body are separate targets.
 *
 * Adding an idea to the simulation and opening it to read are different
 * intentions with different costs, and on the desktop they are told apart by a
 * stopPropagation on a 20px square. At thumb resolution that is a coin toss,
 * so the toggle gets its own 44px column outside the row's tap area.
 */
function IdeaRow({
  idea,
  currentPortfolioId,
  onToggleAsset,
  onOpenIdea,
}: {
  idea: any
  currentPortfolioId?: string | null
  onToggleAsset: (idea: any, isAdded: boolean) => void
  onOpenIdea: (id: string) => void
}) {
  if (!idea) return null
  const added = !!idea.isAdded
  const stage = idea.effectiveStage || idea.stage || idea.status
  // The drawer is not scoped to the lab's portfolio — ideas also arrive via
  // trade_lab_idea_links, so a row can belong somewhere else entirely. Adding
  // one still simulates it against the portfolio selected at the top, which is
  // worth knowing before you tick it.
  const portfolioName = idea.portfolios?.name ?? null
  const isForeign = !!idea.portfolio_id && !!currentPortfolioId && idea.portfolio_id !== currentPortfolioId

  return (
    <div className="flex items-stretch gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      <button
        type="button"
        onClick={() => onToggleAsset(idea, added)}
        aria-pressed={added}
        aria-label={`${added ? 'Remove' : 'Add'} ${idea.assets?.symbol ?? 'this idea'} ${added ? 'from' : 'to'} the simulation`}
        className="shrink-0 w-12 flex items-center justify-center border-r border-gray-100 dark:border-gray-800 active:bg-gray-50 dark:active:bg-gray-800"
      >
        <span
          className={clsx(
            'h-6 w-6 rounded-md border-2 flex items-center justify-center transition-colors',
            added
              ? 'bg-primary-600 border-primary-600 text-white'
              : 'border-gray-300 dark:border-gray-600'
          )}
        >
          {added && <Check className="h-4 w-4" />}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onOpenIdea(idea.id)}
        className="min-w-0 flex-1 text-left py-2.5 pr-3 active:bg-gray-50 dark:active:bg-gray-800"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900 dark:text-white">
            {idea.assets?.symbol ?? '—'}
          </span>
          {idea.action && (
            <span
              className={clsx(
                'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
                idea.action === 'buy' || idea.action === 'add'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              )}
            >
              {idea.action}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">
            {idea.assets?.company_name}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
          {stage && (
            <span className="text-gray-400">{STAGE_LABEL[stage] ?? String(stage).replace(/_/g, ' ')}</span>
          )}
          {portfolioName && (
            <>
              <span className="text-gray-300">·</span>
              <span
                className={clsx(
                  'min-w-0 truncate',
                  isForeign ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-400'
                )}
              >
                {portfolioName}
              </span>
            </>
          )}
          {!idea.portfolio_id && (
            <>
              <span className="text-gray-300">·</span>
              <span className="text-gray-400">No portfolio</span>
            </>
          )}
        </div>
      </button>
    </div>
  )
}

/** A pair, with each leg individually addable — legs can be simulated apart. */
function PairRow({
  item,
  currentPortfolioId,
  onToggleAsset,
  onOpenIdea,
}: {
  item: DrawerItem
  currentPortfolioId?: string | null
  onToggleAsset: (idea: any, isAdded: boolean) => void
  onOpenIdea: (id: string) => void
}) {
  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-900/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
          Pair
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">
          {item.pairTrade?.name || 'Pair trade'}
        </span>
      </div>
      <div className="space-y-1.5 px-2 pb-2">
        {(item.legs ?? []).map((leg: any) => (
          <IdeaRow key={leg.id} idea={leg} currentPortfolioId={currentPortfolioId} onToggleAsset={onToggleAsset} onOpenIdea={onOpenIdea} />
        ))}
      </div>
    </div>
  )
}
