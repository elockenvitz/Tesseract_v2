import { useState } from 'react'
import { clsx } from 'clsx'
import { Check, ChevronRight, Layers, Lightbulb, Plus, Scale, Search, X } from 'lucide-react'

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
  /**
   * Put a recommendation's trades into the simulation, or take them out.
   *
   * Recommendations had no add control here at all — a trade_queue_item that
   * carries a proposal is filed under proposals and excluded from ideas, so
   * the only row a pilot could reach opened a detail modal and nothing else.
   * The first tutorial step asks for an add, so the list has to offer one.
   */
  onToggleProposal: (proposalItem: any) => void
  isProposalAdded: (proposalItem: any) => boolean
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
  onToggleProposal,
  isProposalAdded,
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
          proposals.map((p, i) => (
            <ProposalRow
              key={p.proposal?.id ?? `proposal-${i}`}
              item={p}
              added={isProposalAdded(p)}
              onToggle={() => onToggleProposal(p)}
              onOpen={() => onOpenIdea(p.proposal?.trade_queue_items?.id ?? p.proposal?.trade_queue_item_id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

/**
 * A recommendation, with the add spelled out.
 *
 * The card used to be one big button whose only action was "open the detail
 * modal", which meant the surface said what the recommendation was and never
 * how to use it. Reading and adding are separate intentions, so they are
 * separate targets: the body opens the detail, and a full-width labelled
 * action underneath puts the trade in the simulation.
 */
function ProposalRow({
  item,
  added,
  onToggle,
  onOpen,
}: {
  item: any
  added: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const queueItem = item.proposal?.trade_queue_items
  const asset = queueItem?.assets
  const proposer = item.proposal?.users
  const action = queueItem?.action ?? item.legs?.[0]?.action
  const symbol = asset?.symbol ?? item.legs?.[0]?.symbol ?? '—'

  return (
    <div
      className={clsx(
        'rounded-xl border overflow-hidden',
        added
          ? 'border-primary-300 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/15'
          : 'border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-900/10'
      )}
    >
      <button type="button" onClick={onOpen} className="w-full text-left px-3 pt-2.5 pb-2 active:opacity-70">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-bold text-gray-900 dark:text-white">{symbol}</span>
          {action && (
            <span
              className={clsx(
                'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
                action === 'buy' || action === 'add'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              )}
            >
              {action}
            </span>
          )}
          {item.isPairTrade && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              Pair
            </span>
          )}
          {/* The chevron is the only thing that said this opens something.
              It keeps a word next to it now that the card has two actions. */}
          <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-gray-400 shrink-0">
            Details
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>

        <p className="mt-0.5 min-w-0 truncate text-[11px] text-gray-500 dark:text-gray-400">
          {asset?.company_name}
        </p>

        {/* The recommended size is the recommendation. Without it the
            card names a ticker and says nothing about what is being
            asked for. */}
        {(item.proposal?.weight != null || item.proposal?.shares != null) && (
          <p className="mt-1 text-[12px] font-semibold tabular-nums text-gray-800 dark:text-gray-100">
            {item.proposal.weight != null ? `${Number(item.proposal.weight).toFixed(2)}% target` : ''}
            {item.proposal.weight != null && item.proposal.shares != null ? ' · ' : ''}
            {item.proposal.shares != null ? `${Number(item.proposal.shares).toLocaleString()} sh` : ''}
          </p>
        )}

        {(item.proposal?.notes || queueItem?.rationale) && (
          <p className="mt-1 text-[12px] leading-snug text-gray-600 dark:text-gray-300 line-clamp-2">
            {item.proposal?.notes || queueItem?.rationale}
          </p>
        )}

        {proposer && (
          <p className="mt-1 text-[11px] text-gray-400 truncate">
            from {[proposer.first_name, proposer.last_name].filter(Boolean).join(' ') || proposer.email}
          </p>
        )}
      </button>

      {/* The action, named. This is what the tutorial's first step asks for,
          and until now the phone had no control that did it. */}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={added}
        data-slot="mobile-rec-add"
        aria-label={`${added ? 'Remove this recommendation from' : 'Add this recommendation to'} the simulation`}
        className={clsx(
          'w-full h-10 inline-flex items-center justify-center gap-1.5 border-t text-[13px] font-semibold no-touch-target',
          added
            ? 'border-primary-200 dark:border-primary-900 text-primary-700 dark:text-primary-300 active:bg-primary-100/60'
            : 'border-amber-200 dark:border-amber-900/50 bg-amber-500 text-white active:bg-amber-600'
        )}
      >
        {added ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {added ? 'Added — tap to remove' : 'Add to simulation'}
      </button>
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
 * An idea, with the add spelled out — the same shape as ProposalRow.
 *
 * Adding an idea to the simulation and opening it to read are different
 * intentions with different costs, and on the desktop they are told apart by a
 * stopPropagation on a 20px square. At thumb resolution that is a coin toss,
 * so the toggle had its own column outside the row's tap area.
 *
 * A column of ticks was still the wrong control. That checkbox ran
 * handleAddAsset / handleRemoveAsset — it put the trade in the simulation and
 * took it out again — while looking exactly like the list-selection checkbox
 * it was not. Nothing on the row said what ticking it would do, and a
 * recommendation two tabs away was by then asking for the same thing with a
 * named button. Same act, same words.
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
    <div
      className={clsx(
        'rounded-xl border overflow-hidden',
        added
          ? 'border-primary-300 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/15'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
      )}
    >
      <button
        type="button"
        onClick={() => onOpenIdea(idea.id)}
        className="w-full min-w-0 text-left px-3 pt-2.5 pb-2 active:opacity-70"
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
          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-gray-400 shrink-0">
            Details
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
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

      {/* The same act and the same words as a recommendation's action. It
          runs the same handlers the checkbox ran — onToggleAsset, which is
          handleAddAsset / handleRemoveAsset in the page. Only the control
          changed; the mutation path did not. */}
      <button
        type="button"
        onClick={() => onToggleAsset(idea, added)}
        aria-pressed={added}
        data-slot="mobile-idea-add"
        aria-label={`${added ? 'Remove' : 'Add'} ${idea.assets?.symbol ?? 'this idea'} ${added ? 'from' : 'to'} the simulation`}
        className={clsx(
          'w-full h-10 inline-flex items-center justify-center gap-1.5 border-t text-[13px] font-semibold no-touch-target',
          added
            ? 'border-primary-200 dark:border-primary-900 text-primary-700 dark:text-primary-300 active:bg-primary-100/60'
            : 'border-gray-200 dark:border-gray-700 bg-primary-600 text-white active:bg-primary-700'
        )}
      >
        {added ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {added ? 'Added — tap to remove' : 'Add to simulation'}
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
