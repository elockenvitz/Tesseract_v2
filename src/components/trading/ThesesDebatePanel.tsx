/**
 * ThesesDebatePanel — Bull vs Bear side-by-side debate view.
 *
 * Renders inside the trade idea detail modal's "Debate" tab.
 * Shows bullish theses on the left, bearish on the right.
 * Supports shared (idea-level) and portfolio-scoped debate.
 */

import { useState, useEffect, useMemo } from 'react'
import { TrendingUp, TrendingDown, Plus, Pencil, Trash2, Zap, ShieldAlert, FileText, X, Globe, Briefcase, Link2, MessageSquare, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useTheses, useCreateThesis, useDeleteThesis, useUpdateThesis } from '../../hooks/useTheses'
import { useAuth } from '../../hooks/useAuth'
import { useArgumentResearchCounts } from '../../hooks/useLinkedResearch'
import { usePendingResearchLinksStore } from '../../stores/pendingResearchLinksStore'
import type { ThesisWithUser, ThesisConviction, ThesisDirection } from '../../types/trading'
import type { LinkableEntityType } from '../../lib/object-links'
import { grantEvidenceReadAccess } from '../../lib/services/evidence-access-service'

const CONTEXT_DIRECTIONS = new Set<ThesisDirection>(['catalyst', 'risk', 'context'])

const CONTEXT_META: Record<string, { icon: typeof Zap; label: string; color: string; border: string; bg: string }> = {
  catalyst: { icon: Zap, label: 'Catalyst', color: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200/60 dark:border-amber-800/40', bg: 'bg-amber-50/50 dark:bg-amber-900/10' },
  risk: { icon: ShieldAlert, label: 'Risk', color: 'text-orange-600 dark:text-orange-400', border: 'border-orange-200/60 dark:border-orange-800/40', bg: 'bg-orange-50/50 dark:bg-orange-900/10' },
  context: { icon: FileText, label: 'Why Now', color: 'text-violet-600 dark:text-violet-400', border: 'border-violet-200/60 dark:border-violet-800/40', bg: 'bg-violet-50/50 dark:bg-violet-900/10' },
}

/** A linked portfolio for the scope selector */
export interface DebatePortfolio {
  id: string
  name: string
}

/** Scope: null = shared, string = portfolio ID */
type DebateScope = string | null

interface ThesesDebatePanelProps {
  tradeIdeaId: string
  /** Asset ID from the parent trade idea (for auto-linking research) */
  assetId?: string
  /** e.g. "SELL CROX" */
  ideaLabel?: string
  /** e.g. ["CROX"] or ["V", "PYPL"] */
  assetSymbols?: string[]
  readOnly?: boolean
  /** Close the parent modal (called before launching external creators) */
  onCloseModal?: () => void
  /** Portfolios linked to this trade idea — enables scope selector */
  linkedPortfolios?: DebatePortfolio[]
  /** Optional: open a composer on mount */
  openComposer?: 'argument' | 'context' | null
  /** Default direction when opening the argument composer externally */
  defaultDirection?: ThesisDirection
  /** Default rationale text (e.g. promoted from discussion) */
  defaultRationale?: string
  /** Called after the panel has consumed the openComposer prop */
  onComposerConsumed?: () => void
  /** @deprecated Kept for call-site compat */
  onAddThesis?: (direction?: ThesisDirection) => void
  /** @deprecated */
  ideaRationale?: string | null
  /** @deprecated */
  ideaAction?: string | null
  /** @deprecated */
  ideaCreatedBy?: string | null
}

const CONVICTION_BADGE: Record<string, { label: string; color: string }> = {
  low: { label: 'Low', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
  medium: { label: 'Med', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
  high: { label: 'High', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
}

function formatName(user: ThesisWithUser['users']): string {
  if (!user) return 'Unknown'
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return name || user.email?.split('@')[0] || 'Unknown'
}

// ---------------------------------------------------------------------------
// Add Research Menu (dropdown on argument cards)
// ---------------------------------------------------------------------------

function AddResearchMenu({
  argumentId,
  ideaId,
  assetId,
  argumentLabel,
  ideaLabel,
  assetSymbols,
  onClose,
  onCloseModal,
}: {
  argumentId: string
  ideaId: string
  assetId?: string
  argumentLabel?: string
  ideaLabel?: string
  assetSymbols?: string[]
  onClose: () => void
  onCloseModal?: () => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const setPending = usePendingResearchLinksStore(s => s.setPending)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const buildTargets = () => {
    const targets: Array<{ targetType: LinkableEntityType; targetId: string; linkType: string }> = [
      { targetType: 'trade_idea_thesis', targetId: argumentId, linkType: 'supports' },
      { targetType: 'trade_idea', targetId: ideaId, linkType: 'supports' },
    ]
    if (assetId) targets.push({ targetType: 'asset', targetId: assetId, linkType: 'references' })
    return targets
  }

  const buildLinkRows = (sourceType: LinkableEntityType, sourceId: string) => {
    const rows = [
      { source_type: sourceType, source_id: sourceId, target_type: 'trade_idea_thesis', target_id: argumentId, link_type: 'supports', is_auto: false, created_by: user?.id },
      { source_type: sourceType, source_id: sourceId, target_type: 'trade_idea', target_id: ideaId, link_type: 'supports', is_auto: false, created_by: user?.id },
    ]
    if (assetId) rows.push({ source_type: sourceType, source_id: sourceId, target_type: 'asset', target_id: assetId, link_type: 'references', is_auto: false, created_by: user?.id })
    return rows
  }

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['linked-research'] })
    queryClient.invalidateQueries({ queryKey: ['argument-research-counts'] })
    queryClient.invalidateQueries({ queryKey: ['object-links'] })
  }

  const launchCreator = (type: 'thought' | 'prompt' | 'note') => {
    setPending(buildTargets(), {
      ideaLabel: ideaLabel || 'Trade Idea',
      argumentLabel: argumentLabel,
      assetSymbols: assetSymbols || [],
    })
    // Close the modal so the right-hand pane creator is accessible
    onCloseModal?.()
    setTimeout(() => {
      if (type === 'note') {
        const symbols = assetSymbols || []
        const noteTitle = symbols.length > 0 ? `Note - ${symbols[0]}` : 'Note'
        if (assetId) {
          window.dispatchEvent(new CustomEvent('decision-engine-action', {
            detail: {
              id: `notes-${assetId}`,
              title: noteTitle,
              type: 'note',
              data: { entityType: 'asset', assetId, entityId: assetId, assetSymbol: symbols[0] },
            },
          }))
        } else {
          window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
            detail: { captureType: 'idea' },
          }))
        }
      } else {
        window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
          detail: { captureType: type === 'prompt' ? 'prompt' : 'idea' },
        }))
      }
    }, 150)
  }

  // Search existing
  const { data: searchResults = [], isFetching: isSearching } = useQuery({
    queryKey: ['arg-research-search', searchQuery],
    enabled: showSearch && searchQuery.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const results: Array<{ id: string; type: LinkableEntityType; title: string; preview?: string }> = []
      const q = `%${searchQuery}%`
      for (const [table, type] of [['asset_notes', 'asset_note'], ['portfolio_notes', 'portfolio_note']] as const) {
        const { data } = await supabase.from(table).select('id, title, content').ilike('title', q).eq('is_deleted', false).limit(4)
        if (data) data.forEach((n: any) => results.push({ id: n.id, type: type as LinkableEntityType, title: n.title || 'Untitled', preview: n.content?.replace(/<[^>]*>/g, '').slice(0, 60) }))
      }
      const { data: thoughts } = await supabase.from('quick_thoughts').select('id, content, idea_type').ilike('content', q).limit(4)
      if (thoughts) (thoughts as any[]).forEach(t => results.push({ id: t.id, type: 'quick_thought', title: t.idea_type === 'prompt' ? 'Prompt' : 'Thought', preview: t.content?.slice(0, 60) }))
      return results.slice(0, 8)
    },
  })

  const linkExistingMutation = useMutation({
    mutationFn: async (item: { id: string; type: LinkableEntityType }) => {
      // 1. Create the object_links
      for (const row of buildLinkRows(item.type, item.id)) {
        await supabase.from('object_links').upsert(row as any, { onConflict: 'source_type,source_id,target_type,target_id,link_type' })
      }

      // 2. Grant read access to trade idea stakeholders so they can see the evidence
      if (user?.id) {
        await grantEvidenceReadAccess({
          sourceType: item.type,
          sourceId: item.id,
          ideaId,
          currentUserId: user.id,
        })
      }
    },
    onSuccess: () => { invalidateAll(); onClose() },
  })

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[220px] overflow-hidden">
        {showSearch ? (
          <div>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
              <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search notes, thoughts..."
                className="flex-1 text-xs bg-transparent text-gray-900 dark:text-white placeholder-gray-400 border-none focus:ring-0 focus:outline-none p-0"
                autoFocus
              />
              <button onClick={() => setShowSearch(false)} className="p-0.5 text-gray-400 hover:text-gray-600">
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {searchQuery.length < 2 ? (
                <p className="px-3 py-2 text-[11px] text-gray-400">{searchQuery.length === 0 ? '' : 'Keep typing...'}</p>
              ) : isSearching ? (
                <p className="px-3 py-2 text-[11px] text-gray-400">Searching...</p>
              ) : searchResults.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-gray-400">No results</p>
              ) : (
                searchResults.map(item => (
                  <button
                    key={`${item.type}-${item.id}`}
                    onClick={() => linkExistingMutation.mutate(item)}
                    disabled={linkExistingMutation.isPending}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate block">{item.title}</span>
                    {item.preview && <span className="text-[10px] text-gray-400 truncate block">{item.preview}</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="py-1">
            {argumentLabel && (
              <p className="px-3 py-1 text-[10px] text-gray-400 border-b border-gray-100 dark:border-gray-700 mb-0.5">
                Links to: {argumentLabel}
              </p>
            )}
            <button onClick={() => setShowSearch(true)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <Search className="h-3 w-3 text-gray-400" />
              Attach existing
            </button>
            <button onClick={() => launchCreator('thought')} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <Zap className="h-3 w-3 text-violet-500" />
              New thought
            </button>
            <button onClick={() => launchCreator('note')} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <FileText className="h-3 w-3 text-blue-500" />
              New note
            </button>
            <button onClick={() => launchCreator('prompt')} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <MessageSquare className="h-3 w-3 text-amber-500" />
              New prompt
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Thesis Card
// ---------------------------------------------------------------------------

function ThesisCard({
  thesis,
  isAuthor,
  onEdit,
  onDelete,
  readOnly,
  researchCount,
  ideaId,
  assetId,
  ideaLabel,
  assetSymbols,
  onCloseModal,
}: {
  thesis: ThesisWithUser
  isAuthor: boolean
  onEdit: () => void
  onDelete: () => void
  readOnly?: boolean
  researchCount?: number
  ideaId?: string
  assetId?: string
  ideaLabel?: string
  assetSymbols?: string[]
  onCloseModal?: () => void
}) {
  const [showResearchMenu, setShowResearchMenu] = useState(false)
  const conviction = thesis.conviction ? CONVICTION_BADGE[thesis.conviction] : null
  const isContext = CONTEXT_DIRECTIONS.has(thesis.direction)
  const ctxMeta = isContext ? CONTEXT_META[thesis.direction] : null

  // Fetch linked research previews (always when evidence exists)
  const { data: linkedPreviews } = useQuery({
    queryKey: ['argument-research-preview', thesis.id],
    enabled: (researchCount ?? 0) > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: links } = await supabase
        .from('object_links')
        .select('source_type, source_id')
        .eq('target_type', 'trade_idea_thesis')
        .eq('target_id', thesis.id)
        .limit(5)
      if (!links || links.length === 0) return []

      const previews: Array<{ id: string; title: string; type: string }> = []
      // Notes
      for (const [srcType, table] of [['asset_note', 'asset_notes'], ['portfolio_note', 'portfolio_notes'], ['theme_note', 'theme_notes']] as const) {
        const noteLinks = links.filter(l => l.source_type === srcType)
        if (noteLinks.length === 0) continue
        const { data: notes } = await supabase.from(table).select('id, title').in('id', noteLinks.map(l => l.source_id)).eq('is_deleted', false)
        if (notes) notes.forEach((n: any) => previews.push({ id: n.id, title: n.title || 'Untitled', type: 'Note' }))
      }
      // Thoughts
      const thoughtLinks = links.filter(l => l.source_type === 'quick_thought')
      if (thoughtLinks.length > 0) {
        const { data: thoughts } = await supabase.from('quick_thoughts').select('id, content, idea_type').in('id', thoughtLinks.map(l => l.source_id))
        if (thoughts) (thoughts as any[]).forEach(t => previews.push({ id: t.id, title: t.content?.slice(0, 60) || 'Thought', type: t.idea_type === 'prompt' ? 'Prompt' : 'Thought' }))
      }
      return previews
    },
  })

  return (
    <div className={clsx(
      'group rounded-md border p-3 space-y-1',
      isContext && ctxMeta
        ? `${ctxMeta.border} ${ctxMeta.bg}`
        : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30'
    )}>
      <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
        {thesis.rationale}
      </p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
          <span>{formatName(thesis.users)}</span>
          {conviction && (
            <>
              <span>·</span>
              <span className={clsx('font-medium px-1 py-px rounded', conviction.color)}>
                {conviction.label}
              </span>
            </>
          )}
          <span>·</span>
          <span>{new Date(thesis.created_at).toLocaleDateString()}</span>
          {(researchCount ?? 0) > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-0.5 text-gray-500 dark:text-gray-400">
                <Link2 className="h-2.5 w-2.5" />
                {researchCount} evidence
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {!readOnly && !isContext && ideaId && (
            <div className="relative">
              <button
                onClick={() => setShowResearchMenu(!showResearchMenu)}
                className="p-1 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 rounded"
                title="Link research"
              >
                <Link2 className="h-3 w-3" />
              </button>
              {showResearchMenu && (
                <AddResearchMenu
                  argumentId={thesis.id}
                  ideaId={ideaId}
                  assetId={assetId}
                  argumentLabel={`${thesis.direction === 'bull' ? 'Bull' : 'Bear'} \u2014 ${thesis.rationale.slice(0, 60)}${thesis.rationale.length > 60 ? '...' : ''}`}
                  ideaLabel={ideaLabel}
                  assetSymbols={assetSymbols}
                  onClose={() => setShowResearchMenu(false)}
                  onCloseModal={onCloseModal}
                />
              )}
            </div>
          )}
          {isAuthor && !readOnly && (
            <>
              <button onClick={onEdit} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded" title="Edit">
                <Pencil className="h-3 w-3" />
              </button>
              <button onClick={onDelete} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Delete">
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </div>
      {/* Evidence items — always visible when present */}
      {linkedPreviews && linkedPreviews.length > 0 && (
        <div className="pt-1.5 mt-1 border-t border-gray-100 dark:border-gray-700/50">
          <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Evidence</div>
          <div className="space-y-0.5">
          {linkedPreviews.map(p => (
            <div key={p.id} className="flex items-center gap-1.5 text-[10px] px-0.5 py-0.5">
              {p.type === 'Note' ? <FileText className="h-2.5 w-2.5 shrink-0 text-gray-400" /> : <Zap className="h-2.5 w-2.5 shrink-0 text-gray-400" />}
              <span className="truncate text-gray-600 dark:text-gray-300">{p.title}</span>
              <span className="shrink-0 text-[9px] text-gray-400">{p.type}</span>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scope Selector
// ---------------------------------------------------------------------------

function ScopeSelector({
  scope,
  onScopeChange,
  portfolios,
  thesesByScope,
}: {
  scope: DebateScope
  onScopeChange: (s: DebateScope) => void
  portfolios: DebatePortfolio[]
  thesesByScope: Record<string, number>
}) {
  if (portfolios.length <= 1) return null

  return (
    <div>
      <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">Scope</div>
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
      <button
        onClick={() => onScopeChange(null)}
        className={clsx(
          'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
          scope === null
            ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
        )}
      >
        <Globe className="h-3 w-3" />
        Shared
        {(thesesByScope['shared'] ?? 0) > 0 && (
          <span className="ml-0.5 text-[10px] opacity-60">{thesesByScope['shared']}</span>
        )}
      </button>
      {portfolios.map(p => (
        <button
          key={p.id}
          onClick={() => onScopeChange(p.id)}
          className={clsx(
            'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
            scope === p.id
              ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
          )}
        >
          <Briefcase className="h-3 w-3" />
          {p.name}
          {(thesesByScope[p.id] ?? 0) > 0 && (
            <span className="ml-0.5 text-[10px] opacity-60">{thesesByScope[p.id]}</span>
          )}
        </button>
      ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline Argument Composer (renders inside bull or bear column)
// ---------------------------------------------------------------------------

function InlineArgumentComposer({
  tradeIdeaId,
  direction,
  defaultRationale,
  portfolioId,
  portfolios,
  onClose,
}: {
  tradeIdeaId: string
  direction: 'bull' | 'bear'
  defaultRationale?: string
  portfolioId: DebateScope
  portfolios: DebatePortfolio[]
  onClose: () => void
}) {
  const createMutation = useCreateThesis()
  const [conviction, setConviction] = useState<ThesisConviction>('medium')
  const [rationale, setRationale] = useState(defaultRationale || '')
  const [scope, setScope] = useState<DebateScope>(portfolioId)

  const isBull = direction === 'bull'

  const handleSubmit = async () => {
    if (!rationale.trim()) return
    try {
      await createMutation.mutateAsync({
        tradeQueueItemId: tradeIdeaId,
        direction,
        rationale: rationale.trim(),
        conviction,
        portfolioId: scope,
      })
      onClose()
    } catch (err) {
      console.error('[InlineArgumentComposer] Failed:', err)
    }
  }

  const placeholder = isBull
    ? 'What supports the bull case? Key fundamentals, trends, or signals.'
    : 'What supports the bear case? Risks, headwinds, or deteriorating fundamentals.'

  return (
    <div className={clsx(
      'rounded-md border p-2.5 space-y-2',
      isBull ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-900/10' : 'border-red-200 bg-red-50/30 dark:border-red-800 dark:bg-red-900/10',
    )}>
      <textarea
        value={rationale}
        onChange={e => setRationale(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full px-2.5 py-1.5 text-[12px] rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 resize-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 placeholder:text-gray-400 leading-relaxed"
        autoFocus
        onKeyDown={e => { if (e.key === 'Enter' && e.metaKey && rationale.trim()) handleSubmit() }}
      />

      {/* Conviction + scope + actions — all on one row */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          {(['low', 'medium', 'high'] as const).map(c => (
            <button
              key={c}
              onClick={() => setConviction(c)}
              className={clsx(
                'px-2 py-0.5 text-[10px] font-medium rounded transition-colors capitalize',
                conviction === c
                  ? 'bg-gray-700 text-white dark:bg-gray-300 dark:text-gray-900'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700',
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {portfolios.length > 1 && (
          <select
            value={scope ?? '__shared__'}
            onChange={e => setScope(e.target.value === '__shared__' ? null : e.target.value)}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500"
          >
            <option value="__shared__">Shared</option>
            {portfolios.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-1.5 ml-auto">
          <button onClick={onClose} className="px-2 py-0.5 text-[11px] text-gray-400 hover:text-gray-600">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending || !rationale.trim()}
            className={clsx(
              'px-2.5 py-1 text-[11px] font-semibold rounded text-white transition-colors',
              isBull ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700',
              (createMutation.isPending || !rationale.trim()) && 'opacity-50 cursor-not-allowed',
            )}
          >
            {createMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {createMutation.isError && (
        <p className="text-[10px] text-red-600">Failed to save. Please try again.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline Context Composer (renders inside Context section)
// ---------------------------------------------------------------------------

function InlineContextComposer({
  tradeIdeaId,
  defaultType,
  portfolioId,
  portfolios,
  onClose,
}: {
  tradeIdeaId: string
  defaultType?: ThesisDirection
  portfolioId: DebateScope
  portfolios: DebatePortfolio[]
  onClose: () => void
}) {
  const createMutation = useCreateThesis()
  const [contextType, setContextType] = useState<ThesisDirection>(
    defaultType && CONTEXT_DIRECTIONS.has(defaultType) ? defaultType : 'catalyst'
  )
  const [rationale, setRationale] = useState('')
  const [scope, setScope] = useState<DebateScope>(portfolioId)

  const placeholder = contextType === 'catalyst'
    ? 'What specific catalyst or event could move this? Timeline?'
    : contextType === 'risk'
    ? 'What are the key risks or downside scenarios?'
    : 'Why now? What timing factors are relevant?'

  const handleSubmit = async () => {
    if (!rationale.trim()) return
    try {
      await createMutation.mutateAsync({
        tradeQueueItemId: tradeIdeaId,
        direction: contextType,
        rationale: rationale.trim(),
        portfolioId: scope,
      })
      onClose()
    } catch (err) {
      console.error('[InlineContextComposer] Failed:', err)
    }
  }

  return (
    <div className="rounded-md border border-violet-200/60 dark:border-violet-800/40 bg-violet-50/30 dark:bg-violet-900/10 p-3 space-y-2">
      {/* Context type selector */}
      <div className="flex gap-1.5">
        {([
          { key: 'catalyst' as const, icon: Zap, label: 'Catalyst' },
          { key: 'risk' as const, icon: ShieldAlert, label: 'Risk' },
          { key: 'context' as const, icon: FileText, label: 'Why Now' },
        ]).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setContextType(key)}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors',
              contextType === key
                ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      <textarea
        value={rationale}
        onChange={e => setRationale(e.target.value)}
        placeholder={placeholder}
        className="w-full h-16 px-2.5 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 resize-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 placeholder:text-gray-400"
        autoFocus
      />

      {/* Scope + actions */}
      <div className="flex items-center justify-between">
        {portfolios.length > 1 ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Scope</span>
            <select
              value={scope ?? '__shared__'}
              onChange={e => setScope(e.target.value === '__shared__' ? null : e.target.value)}
              className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              <option value="__shared__">Shared</option>
              {portfolios.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        ) : <div />}

        <div className="flex items-center gap-1.5">
          <button onClick={onClose} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending || !rationale.trim()}
            className={clsx(
              'px-3 py-1 text-xs font-medium rounded-md text-white bg-violet-600 hover:bg-violet-700 transition-colors',
              (createMutation.isPending || !rationale.trim()) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {createMutation.isPending ? 'Saving...' : 'Add'}
          </button>
        </div>
      </div>

      {createMutation.isError && (
        <p className="text-xs text-red-600">Failed to save. Please try again.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function ThesesDebatePanel({
  tradeIdeaId,
  assetId,
  ideaLabel,
  assetSymbols,
  readOnly,
  onCloseModal,
  linkedPortfolios = [],
  openComposer: openComposerProp,
  defaultDirection,
  defaultRationale,
  onComposerConsumed,
}: ThesesDebatePanelProps) {
  const { user } = useAuth()
  const { data: allTheses = [], isLoading } = useTheses(tradeIdeaId)

  const deleteMutation = useDeleteThesis(tradeIdeaId)
  const updateMutation = useUpdateThesis(tradeIdeaId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRationale, setEditRationale] = useState('')
  const [editConviction, setEditConviction] = useState<ThesisConviction>('medium')

  // Scope state
  const [scope, setScope] = useState<DebateScope>(null)

  // Composer state — tracks which column is composing
  // 'bull' | 'bear' for argument composers, 'context' for context composer, null for none
  const [activeComposer, setActiveComposer] = useState<'bull' | 'bear' | 'context' | null>(null)
  const [composerRationale, setComposerRationale] = useState<string | undefined>(undefined)

  // Respond to external triggers
  useEffect(() => {
    if (openComposerProp === 'argument') {
      if (defaultDirection === 'bull' || defaultDirection === 'bear') {
        setActiveComposer(defaultDirection)
      } else {
        setActiveComposer('bull')
      }
      setComposerRationale(defaultRationale)
      onComposerConsumed?.()
    } else if (openComposerProp === 'context') {
      setActiveComposer('context')
      setComposerRationale(defaultRationale)
      onComposerConsumed?.()
    }
  }, [openComposerProp, defaultDirection, defaultRationale, onComposerConsumed])

  // Thesis counts per scope (for badge display in scope selector)
  const thesesByScope = useMemo(() => {
    const counts: Record<string, number> = { shared: 0 }
    for (const t of allTheses) {
      if (t.portfolio_id === null) {
        counts['shared'] = (counts['shared'] || 0) + 1
      } else {
        counts[t.portfolio_id] = (counts[t.portfolio_id] || 0) + 1
      }
    }
    return counts
  }, [allTheses])

  // Filter theses by selected scope
  const theses = useMemo(() => {
    if (scope === null) {
      return allTheses.filter(t => t.portfolio_id === null)
    }
    return allTheses.filter(t => t.portfolio_id === scope)
  }, [allTheses, scope])

  const bullTheses = useMemo(() => theses.filter(t => t.direction === 'bull'), [theses])
  const bearTheses = useMemo(() => theses.filter(t => t.direction === 'bear'), [theses])
  const contextTheses = useMemo(() => theses.filter(t => CONTEXT_DIRECTIONS.has(t.direction)), [theses])

  // Research counts per argument (for badge display)
  const allArgumentIds = useMemo(() => [...bullTheses, ...bearTheses].map(t => t.id), [bullTheses, bearTheses])
  const { data: researchCounts = {} } = useArgumentResearchCounts(allArgumentIds)

  const scopeLabel = scope === null ? null : linkedPortfolios.find(p => p.id === scope)?.name

  const handleStartEdit = (thesis: ThesisWithUser) => {
    setEditingId(thesis.id)
    setEditRationale(thesis.rationale)
    setEditConviction(thesis.conviction || 'medium')
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editRationale.trim()) return
    await updateMutation.mutateAsync({
      thesisId: editingId,
      input: { rationale: editRationale.trim(), conviction: editConviction },
    })
    setEditingId(null)
  }

  const handleDelete = async (thesisId: string) => {
    await deleteMutation.mutateAsync(thesisId)
  }

  const closeComposer = () => {
    setActiveComposer(null)
    setComposerRationale(undefined)
  }

  if (isLoading) {
    return <div className="text-sm text-gray-400 py-8 text-center">Loading debate...</div>
  }

  if (allTheses.length === 0 && readOnly) {
    return <div className="text-sm text-gray-400 py-8 text-center">No arguments yet.</div>
  }

  // Empty state copy adapts to scope
  const emptyBullText = scopeLabel
    ? `No bullish arguments for ${scopeLabel}`
    : 'No bullish arguments yet'
  const emptyBearText = scopeLabel
    ? `No bearish arguments for ${scopeLabel}`
    : 'No bearish arguments yet'
  const emptyContextText = scopeLabel
    ? `No context notes for ${scopeLabel}`
    : 'No context notes yet'

  return (
    <div className="space-y-4">
      {/* Scope selector — only shown when multiple portfolios are linked */}
      {linkedPortfolios.length > 1 && (
        <ScopeSelector
          scope={scope}
          onScopeChange={setScope}
          portfolios={linkedPortfolios}
          thesesByScope={thesesByScope}
        />
      )}

      {/* Compact summary */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-green-600 dark:text-green-400">{bullTheses.length} Bull</span>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <span className="font-semibold text-red-600 dark:text-red-400">{bearTheses.length} Bear</span>
        {contextTheses.length > 0 && (
          <>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="font-medium text-gray-500 dark:text-gray-400">{contextTheses.length} Context</span>
          </>
        )}
      </div>

      {/* Bull / Bear columns */}
      <div className="grid grid-cols-2 gap-6">
        {/* Bull column */}
        <div className="space-y-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-gray-200 dark:border-gray-700">
            <span className="text-xs font-semibold text-green-600 dark:text-green-400">Bull Arguments</span>
            {!readOnly && activeComposer !== 'bull' && (
              <button
                onClick={() => setActiveComposer('bull')}
                className="flex items-center gap-0.5 text-[11px] text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add Bull Argument
              </button>
            )}
          </div>

          {/* Inline composer — inside this column */}
          {activeComposer === 'bull' && (
            <InlineArgumentComposer
              tradeIdeaId={tradeIdeaId}
              direction="bull"
              defaultRationale={composerRationale}
              portfolioId={scope}
              portfolios={linkedPortfolios}
              onClose={closeComposer}
            />
          )}

          {bullTheses.length === 0 && activeComposer !== 'bull' ? (
            <div className="py-3">
              <p className="text-xs text-gray-400">{emptyBullText}</p>
              {!readOnly && (
                <button
                  onClick={() => setActiveComposer('bull')}
                  className="text-xs text-green-600 hover:text-green-700 dark:hover:text-green-300 font-medium mt-1"
                >
                  + Add bull argument
                </button>
              )}
            </div>
          ) : (
            bullTheses.map(t =>
              editingId === t.id ? (
                <EditCard
                  key={t.id}
                  rationale={editRationale}
                  conviction={editConviction}
                  onRationaleChange={setEditRationale}
                  onConvictionChange={setEditConviction}
                  onSave={handleSaveEdit}
                  onCancel={() => setEditingId(null)}
                  saving={updateMutation.isPending}
                  direction="bull"
                />
              ) : (
                <ThesisCard
                  key={t.id}
                  thesis={t}
                  isAuthor={user?.id === t.created_by}
                  onEdit={() => handleStartEdit(t)}
                  onDelete={() => handleDelete(t.id)}
                  readOnly={readOnly}
                  researchCount={researchCounts[t.id]}
                  ideaId={tradeIdeaId}
                  assetId={assetId}
                  ideaLabel={ideaLabel}
                  assetSymbols={assetSymbols}
                  onCloseModal={onCloseModal}
                />
              )
            )
          )}
        </div>

        {/* Bear column */}
        <div className="space-y-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-gray-200 dark:border-gray-700">
            <span className="text-xs font-semibold text-red-600 dark:text-red-400">Bear Arguments</span>
            {!readOnly && activeComposer !== 'bear' && (
              <button
                onClick={() => setActiveComposer('bear')}
                className="flex items-center gap-0.5 text-[11px] text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add Bear Argument
              </button>
            )}
          </div>

          {/* Inline composer — inside this column */}
          {activeComposer === 'bear' && (
            <InlineArgumentComposer
              tradeIdeaId={tradeIdeaId}
              direction="bear"
              defaultRationale={composerRationale}
              portfolioId={scope}
              portfolios={linkedPortfolios}
              onClose={closeComposer}
            />
          )}

          {bearTheses.length === 0 && activeComposer !== 'bear' ? (
            <div className="py-3">
              <p className="text-xs text-gray-400">{emptyBearText}</p>
              {!readOnly && (
                <button
                  onClick={() => setActiveComposer('bear')}
                  className="text-xs text-red-600 hover:text-red-700 dark:hover:text-red-300 font-medium mt-1"
                >
                  + Add bear argument
                </button>
              )}
            </div>
          ) : (
            bearTheses.map(t =>
              editingId === t.id ? (
                <EditCard
                  key={t.id}
                  rationale={editRationale}
                  conviction={editConviction}
                  onRationaleChange={setEditRationale}
                  onConvictionChange={setEditConviction}
                  onSave={handleSaveEdit}
                  onCancel={() => setEditingId(null)}
                  saving={updateMutation.isPending}
                  direction="bear"
                />
              ) : (
                <ThesisCard
                  key={t.id}
                  thesis={t}
                  isAuthor={user?.id === t.created_by}
                  onEdit={() => handleStartEdit(t)}
                  onDelete={() => handleDelete(t.id)}
                  readOnly={readOnly}
                  researchCount={researchCounts[t.id]}
                  ideaId={tradeIdeaId}
                  assetId={assetId}
                  ideaLabel={ideaLabel}
                  assetSymbols={assetSymbols}
                  onCloseModal={onCloseModal}
                />
              )
            )
          )}
        </div>
      </div>

      {/* Context & Catalysts — below arguments */}
      {(contextTheses.length > 0 || !readOnly) && (
        <div className="pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Context &amp; Catalysts</span>
              {!readOnly && activeComposer !== 'context' && (
                <button
                  onClick={() => setActiveComposer('context')}
                  className="flex items-center gap-0.5 text-[11px] text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">Macro drivers, themes, or catalysts relevant to this idea.</p>
          </div>

          {/* Inline context composer */}
          {activeComposer === 'context' && (
            <InlineContextComposer
              tradeIdeaId={tradeIdeaId}
              portfolioId={scope}
              portfolios={linkedPortfolios}
              onClose={closeComposer}
            />
          )}

          {contextTheses.length === 0 && activeComposer !== 'context' ? (
            <div className="py-2">
              <p className="text-xs text-gray-400">{emptyContextText}</p>
              {!readOnly && (
                <button
                  onClick={() => setActiveComposer('context')}
                  className="text-xs text-violet-600 hover:text-violet-700 dark:hover:text-violet-300 font-medium mt-1"
                >
                  + Add context
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {contextTheses.map(t => {
                const meta = CONTEXT_META[t.direction]
                const CtxIcon = meta?.icon || FileText
                return editingId === t.id ? (
                  <EditCard
                    key={t.id}
                    rationale={editRationale}
                    conviction={editConviction}
                    onRationaleChange={setEditRationale}
                    onConvictionChange={setEditConviction}
                    onSave={handleSaveEdit}
                    onCancel={() => setEditingId(null)}
                    saving={updateMutation.isPending}
                    direction={t.direction as 'bull' | 'bear'}
                    contextMeta={meta}
                  />
                ) : (
                  <div key={t.id} className="relative">
                    {meta && (
                      <div className={clsx('absolute top-2.5 right-2.5 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide', meta.color)}>
                        <CtxIcon className="h-3 w-3" />
                        {meta.label}
                      </div>
                    )}
                    <ThesisCard
                      thesis={t}
                      isAuthor={user?.id === t.created_by}
                      onEdit={() => handleStartEdit(t)}
                      onDelete={() => handleDelete(t.id)}
                      readOnly={readOnly}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline edit card (for editing existing theses)
// ---------------------------------------------------------------------------

function EditCard({
  rationale,
  conviction,
  onRationaleChange,
  onConvictionChange,
  onSave,
  onCancel,
  saving,
  direction,
  contextMeta,
}: {
  rationale: string
  conviction: ThesisConviction
  onRationaleChange: (v: string) => void
  onConvictionChange: (v: ThesisConviction) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  direction: 'bull' | 'bear'
  contextMeta?: typeof CONTEXT_META[string]
}) {
  const isBull = direction === 'bull'
  const isContext = !!contextMeta
  return (
    <div className={clsx(
      'rounded-md border p-3 space-y-2',
      isContext && contextMeta
        ? `${contextMeta.border} ${contextMeta.bg}`
        : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50'
    )}>
      <textarea
        value={rationale}
        onChange={e => onRationaleChange(e.target.value)}
        className="w-full h-20 px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 resize-none focus:ring-1 focus:ring-blue-400"
        autoFocus
      />
      {!isContext && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Conviction</span>
          <div className="flex items-center gap-3">
            {(['low', 'medium', 'high'] as const).map(c => (
              <label key={c} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="edit-conviction"
                  checked={conviction === c}
                  onChange={() => onConvictionChange(c)}
                  className="h-3 w-3 accent-gray-600 dark:accent-gray-400"
                />
                <span className={clsx(
                  'text-xs capitalize',
                  conviction === c ? 'text-gray-700 dark:text-gray-200 font-medium' : 'text-gray-400'
                )}>
                  {c}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end gap-1">
        <button onClick={onCancel} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving || !rationale.trim()}
          className={clsx(
            'px-2 py-1 text-xs font-medium rounded text-white',
            isContext ? 'bg-violet-600 hover:bg-violet-700'
              : isBull ? 'bg-green-600 hover:bg-green-700'
              : 'bg-red-600 hover:bg-red-700',
            (saving || !rationale.trim()) && 'opacity-50'
          )}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
