/**
 * LinkedResearchSection — Research management surface inside the Debate tab.
 *
 * Provides:
 * - "+ Add" button with inline panel: Link existing | Create new
 * - Grouped view: General / Bull / Bear argument research
 * - Clickable rows that open in the right-hand pane
 */

import { useState, useMemo } from 'react'
import { FileText, Zap, MessageSquare, X, Plus, Search, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useLinkedResearchForIdea, useDeleteResearchLink, useCreateResearchLink, useUpdateResearchLinkType } from '../../hooks/useLinkedResearch'
import { usePendingResearchLinksStore } from '../../stores/pendingResearchLinksStore'
import type { LinkedResearchItem } from '../../hooks/useLinkedResearch'
import type { LinkableEntityType } from '../../lib/object-links'
import type { ThesisWithUser } from '../../types/trading'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LinkedResearchSectionProps {
  ideaId: string
  assetId?: string
  /** Rich context for the idea instance */
  ideaContext?: {
    label: string           // e.g. "SELL CROX"
    portfolioName?: string  // e.g. "Barbero Fund"
    creatorName?: string    // e.g. "Eric Lockenvitz"
    createdAt?: string      // ISO
    assetSymbols: string[]  // e.g. ["CROX"] or ["V", "PYPL"]
  }
  theses: ThesisWithUser[]
  readOnly?: boolean
  /** Close the parent modal (called before launching external creators) */
  onCloseModal?: () => void
}

const NOTE_TYPES: LinkableEntityType[] = ['asset_note', 'portfolio_note', 'theme_note', 'custom_note']

function getTypeLabel(type: LinkableEntityType): string {
  if (NOTE_TYPES.includes(type)) return 'Note'
  if (type === 'quick_thought') return 'Thought'
  return type
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Inline Add Research Panel
// ---------------------------------------------------------------------------

interface SearchResult {
  id: string
  type: LinkableEntityType
  title: string
  preview?: string
  author?: string
  created_at: string
}

function AddResearchPanel({
  ideaId,
  assetId,
  ideaContext,
  onClose,
  onCloseModal,
}: {
  ideaId: string
  assetId?: string
  ideaContext?: LinkedResearchSectionProps['ideaContext']
  onClose: () => void
  onCloseModal?: () => void
}) {
  const { user } = useAuth()
  const createLinkMutation = useCreateResearchLink()
  const setPending = usePendingResearchLinksStore(s => s.setPending)

  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const buildTargets = () => {
    const targets: Array<{ targetType: LinkableEntityType; targetId: string; linkType: string }> = [
      { targetType: 'trade_idea', targetId: ideaId, linkType: 'supports' },
    ]
    if (assetId) targets.push({ targetType: 'asset', targetId: assetId, linkType: 'references' })
    return targets
  }

  const launchCreator = (type: 'thought' | 'prompt' | 'note') => {
    setPending(buildTargets(), {
      ideaLabel: ideaContext?.label || 'Trade Idea',
      portfolioName: ideaContext?.portfolioName,
      creatorName: ideaContext?.creatorName,
      createdAt: ideaContext?.createdAt,
      assetSymbols: ideaContext?.assetSymbols || [],
    })
    // Close the modal first so the right-hand pane creator is accessible
    onCloseModal?.()
    // Delay to let modal unmount before dispatching
    // Wait for current modal to unmount before dispatching creator events.
    // Uses rAF + setTimeout to reliably wait for React commit + DOM cleanup.
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (type === 'note') {
          const symbols = ideaContext?.assetSymbols || []
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
      }, 50)
    })
  }

  // Search existing notes + thoughts
  const { data: searchResults = [], isFetching: isSearching } = useQuery({
    queryKey: ['research-search', searchQuery],
    enabled: showSearch && searchQuery.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const results: SearchResult[] = []
      const q = `%${searchQuery}%`

      const noteTables: Array<{ table: string; type: LinkableEntityType }> = [
        { table: 'asset_notes', type: 'asset_note' },
        { table: 'portfolio_notes', type: 'portfolio_note' },
        { table: 'theme_notes', type: 'theme_note' },
      ]
      for (const { table, type } of noteTables) {
        const { data } = await supabase
          .from(table)
          .select('id, title, content, created_at, users!created_by(first_name, last_name)')
          .ilike('title', q)
          .eq('is_deleted', false)
          .order('updated_at', { ascending: false })
          .limit(5)
        if (data) {
          for (const n of data as any[]) {
            results.push({
              id: n.id, type,
              title: n.title || 'Untitled',
              preview: n.content?.replace(/<[^>]*>/g, '').slice(0, 80) || undefined,
              author: n.users ? [n.users.first_name, n.users.last_name].filter(Boolean).join(' ') : undefined,
              created_at: n.created_at,
            })
          }
        }
      }

      const { data: thoughts } = await supabase
        .from('quick_thoughts')
        .select('id, content, idea_type, created_at, users!created_by(first_name, last_name)')
        .ilike('content', q)
        .order('created_at', { ascending: false })
        .limit(5)
      if (thoughts) {
        for (const t of thoughts as any[]) {
          results.push({
            id: t.id, type: 'quick_thought',
            title: t.idea_type === 'prompt' ? 'Prompt' : 'Thought',
            preview: t.content?.slice(0, 80) || undefined,
            author: t.users ? [t.users.first_name, t.users.last_name].filter(Boolean).join(' ') : undefined,
            created_at: t.created_at,
          })
        }
      }

      return results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 10)
    },
  })

  const handleLinkExisting = (item: SearchResult) => {
    if (!user?.id) return
    createLinkMutation.mutate({
      sourceType: item.type,
      sourceId: item.id,
      targetType: 'trade_idea',
      targetId: ideaId,
      linkType: 'supports',
      userId: user.id,
    }, {
      onSuccess: () => onClose(),
    })
  }

  // Search picker view
  if (showSearch) {
    return (
      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
          <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search your research (notes, thoughts, prompts)"
            className="flex-1 text-sm bg-transparent text-gray-900 dark:text-white placeholder-gray-400 border-none focus:ring-0 focus:outline-none p-0"
            autoFocus
          />
          <button onClick={() => setShowSearch(false)} className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="max-h-48 overflow-y-auto">
          {searchQuery.length < 2 ? (
            <p className="px-3 py-2.5 text-xs text-gray-400">{searchQuery.length === 0 ? '' : 'Keep typing...'}</p>
          ) : isSearching ? (
            <div className="px-3 py-3 flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Searching...
            </div>
          ) : searchResults.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-400">No results found</p>
          ) : (
            searchResults.map(item => (
              <button
                key={`${item.type}-${item.id}`}
                onClick={() => handleLinkExisting(item)}
                disabled={createLinkMutation.isPending}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-50 dark:border-gray-700/50 last:border-b-0"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{item.title}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{getTypeLabel(item.type)}</span>
                </div>
                {item.preview && (
                  <p className="text-xs text-gray-400 truncate mt-0.5">{item.preview}</p>
                )}
                {item.author && (
                  <span className="text-[10px] text-gray-400">{item.author}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    )
  }

  // Action menu — launches canonical creators or opens search
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 space-y-0.5">
      <div className="flex items-center justify-between px-2.5 py-1 mb-0.5">
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Add research</span>
        <button onClick={onClose} className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="h-3 w-3" />
        </button>
      </div>
      {ideaContext?.label && (
        <p className="px-2.5 text-[10px] text-gray-400 dark:text-gray-500 mb-1">
          Links to: {ideaContext.label}
        </p>
      )}
      <button
        onClick={() => setShowSearch(true)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded transition-colors"
      >
        <Search className="h-3 w-3 text-gray-400" />
        Attach existing
      </button>
      <button
        onClick={() => launchCreator('thought')}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded transition-colors"
      >
        <Zap className="h-3 w-3 text-violet-500" />
        New thought
      </button>
      <button
        onClick={() => launchCreator('note')}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded transition-colors"
      >
        <FileText className="h-3 w-3 text-blue-500" />
        New note
      </button>
      <button
        onClick={() => launchCreator('prompt')}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded transition-colors"
      >
        <MessageSquare className="h-3 w-3 text-amber-500" />
        New prompt
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function LinkedResearchSection({ ideaId, assetId, ideaContext, theses, readOnly, onCloseModal }: LinkedResearchSectionProps) {
  const argumentIds = useMemo(() => theses.map(t => t.id), [theses])
  const { data: research = [], isLoading } = useLinkedResearchForIdea(ideaId, argumentIds)
  const deleteLinkMutation = useDeleteResearchLink()
  const updateLinkTypeMutation = useUpdateResearchLinkType()

  const [showAddPanel, setShowAddPanel] = useState(false)

  const argumentDirectionMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const t of theses) map[t.id] = t.direction
    return map
  }, [theses])

  const argumentSnippetMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const t of theses) {
      const dir = t.direction === 'bull' ? 'Bull' : t.direction === 'bear' ? 'Bear' : t.direction
      map[t.id] = `${dir} \u2192 ${t.rationale.slice(0, 50)}${t.rationale.length > 50 ? '...' : ''}`
    }
    return map
  }, [theses])

  const generalItems = useMemo(() => research.filter(r => !r.argument_id), [research])
  const bullItems = useMemo(() => research.filter(r => r.argument_id && argumentDirectionMap[r.argument_id] === 'bull'), [research, argumentDirectionMap])
  const bearItems = useMemo(() => research.filter(r => r.argument_id && argumentDirectionMap[r.argument_id] === 'bear'), [research, argumentDirectionMap])

  if (isLoading) {
    return <div className="text-xs text-gray-400 py-4 text-center">Loading...</div>
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
      {/* Header + add button */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
          Idea Research{research.length > 0 ? ` (${research.length})` : ''}
        </span>
        {!readOnly && !showAddPanel && (
          <button
            onClick={() => setShowAddPanel(true)}
            className="flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        )}
      </div>

      {/* Inline add panel */}
      {showAddPanel && (
        <AddResearchPanel
          ideaId={ideaId}
          assetId={assetId}
          ideaContext={ideaContext}
          onClose={() => setShowAddPanel(false)}
          onCloseModal={onCloseModal}
        />
      )}

      {/* Empty state */}
      {research.length === 0 && !showAddPanel && (
        <div className="py-2">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            No research linked yet. Create research for this idea or attach existing work.
          </p>
        </div>
      )}

      {/* Grouped research */}
      {research.length > 0 && (
        <div className="space-y-3">
          <ResearchGroup
            label="Evidence"
            labelColor="text-gray-500 dark:text-gray-400"
            items={generalItems}
            argumentSnippetMap={argumentSnippetMap}
            onUnlink={readOnly ? undefined : (id) => deleteLinkMutation.mutate(id)}
            onUpdateLinkType={readOnly ? undefined : (linkId, lt) => updateLinkTypeMutation.mutate({ linkId, linkType: lt })}
          />
          <ResearchGroup
            label="Bull Argument Evidence"
            labelColor="text-green-600 dark:text-green-400"
            items={bullItems}
            argumentSnippetMap={argumentSnippetMap}
            onUnlink={readOnly ? undefined : (id) => deleteLinkMutation.mutate(id)}
            onUpdateLinkType={readOnly ? undefined : (linkId, lt) => updateLinkTypeMutation.mutate({ linkId, linkType: lt })}
          />
          <ResearchGroup
            label="Bear Argument Evidence"
            labelColor="text-red-600 dark:text-red-400"
            items={bearItems}
            argumentSnippetMap={argumentSnippetMap}
            onUnlink={readOnly ? undefined : (id) => deleteLinkMutation.mutate(id)}
            onUpdateLinkType={readOnly ? undefined : (linkId, lt) => updateLinkTypeMutation.mutate({ linkId, linkType: lt })}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

function ResearchGroup({
  label,
  labelColor,
  items,
  argumentSnippetMap,
  onUnlink,
  onUpdateLinkType,
}: {
  label: string
  labelColor: string
  items: LinkedResearchItem[]
  argumentSnippetMap: Record<string, string>
  onUnlink?: (linkId: string) => void
  onUpdateLinkType?: (linkId: string, newType: string) => void
}) {
  if (items.length === 0) return null

  return (
    <div>
      <div className={clsx('text-[11px] font-semibold mb-1', labelColor)}>{label}</div>
      <div className="space-y-0.5">
        {items.map(item => (
          <ResearchRow
            key={item.link_id}
            item={item}
            argumentSnippet={item.argument_id ? argumentSnippetMap[item.argument_id] : undefined}
            onUnlink={onUnlink ? () => onUnlink(item.link_id) : undefined}
            onUpdateLinkType={onUpdateLinkType}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

// Relationship type config
const LINK_TYPE_CONFIG: Record<string, { label: string; color: string; badgeColor: string }> = {
  supports:    { label: 'Supports',     color: 'text-green-600 dark:text-green-400', badgeColor: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/40' },
  opposes:     { label: 'Contradicts',  color: 'text-red-600 dark:text-red-400',     badgeColor: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/40' },
  related_to:  { label: 'Related',      color: 'text-blue-600 dark:text-blue-400',   badgeColor: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/40' },
  informs:     { label: 'Informs',      color: 'text-purple-600 dark:text-purple-400', badgeColor: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800/40' },
  derived_from:{ label: 'Derived from', color: 'text-gray-600 dark:text-gray-400',   badgeColor: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700' },
  references:  { label: 'References',   color: 'text-gray-500 dark:text-gray-400',   badgeColor: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700' },
  results_in:  { label: 'Results in',   color: 'text-amber-600 dark:text-amber-400', badgeColor: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/40' },
}

const EDITABLE_LINK_TYPES = ['supports', 'opposes', 'related_to', 'informs', 'derived_from'] as const

function ResearchRow({
  item,
  argumentSnippet,
  onUnlink,
  onUpdateLinkType,
}: {
  item: LinkedResearchItem
  argumentSnippet?: string
  onUnlink?: () => void
  onUpdateLinkType?: (linkId: string, newType: string) => void
}) {
  const [showInspector, setShowInspector] = useState(false)
  const typeLabel = getTypeLabel(item.object_type)
  const linkConfig = LINK_TYPE_CONFIG[item.link_type] || LINK_TYPE_CONFIG.references

  const handleOpen = async () => {
    if (NOTE_TYPES.includes(item.object_type)) {
      const entityTypeMap: Record<string, { entityType: string; table: string; fk: string }> = {
        asset_note:     { entityType: 'asset',     table: 'asset_notes',           fk: 'asset_id' },
        portfolio_note: { entityType: 'portfolio', table: 'portfolio_notes',       fk: 'portfolio_id' },
        theme_note:     { entityType: 'theme',     table: 'theme_notes',           fk: 'theme_id' },
        custom_note:    { entityType: 'custom',    table: 'custom_notebook_notes', fk: 'custom_notebook_id' },
      }
      const config = entityTypeMap[item.object_type] || entityTypeMap.asset_note
      // Resolve the parent entity ID so the editor opens the right notebook
      const { data: noteRow } = await supabase
        .from(config.table)
        .select(`id, ${config.fk}`)
        .eq('id', item.object_id)
        .single()
      const parentId = noteRow?.[config.fk] || undefined
      // Open the parent's notebook tab (not a separate per-note tab) with this note selected
      window.dispatchEvent(new CustomEvent('decision-engine-action', {
        detail: {
          id: parentId ? `notes-${parentId}` : `note-${item.object_id}`,
          title: item.title || 'Note',
          type: 'note',
          data: { entityType: config.entityType, id: item.object_id, entityId: parentId },
        },
      }))
    } else if (item.object_type === 'quick_thought') {
      window.dispatchEvent(new CustomEvent('openThoughtDetail', {
        detail: { thoughtId: item.object_id },
      }))
    }
  }

  return (
    <div className="group flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors cursor-pointer" onClick={handleOpen}>
      <div className="flex-1 min-w-0 text-left">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate block">
          {item.title}
        </span>
        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-400">
          <span className="font-medium">{typeLabel}</span>
          {item.author_name && (
            <>
              <span>·</span>
              <span>{item.author_name}</span>
            </>
          )}
          <span>·</span>
          <span>{formatRelative(item.created_at)}</span>
        </div>
        {/* Relationship badge */}
        <div className="flex items-center gap-1 mt-1">
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowInspector(!showInspector) }}
              className={clsx(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium transition-colors hover:opacity-80',
                linkConfig.badgeColor
              )}
            >
              {linkConfig.label}
              {argumentSnippet ? ` \u00b7 ${argumentSnippet.split(' \u2192 ')[0]}` : ''}
            </button>
            {/* Inspector popover */}
            {showInspector && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowInspector(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[200px] py-1">
                  <div className="px-3 py-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-700">
                    Relationship
                  </div>
                  {EDITABLE_LINK_TYPES.map(lt => {
                    const cfg = LINK_TYPE_CONFIG[lt]
                    const isActive = item.link_type === lt
                    return (
                      <button
                        key={lt}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!isActive && onUpdateLinkType) {
                            onUpdateLinkType(item.link_id, lt)
                          }
                          setShowInspector(false)
                        }}
                        className={clsx(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                          isActive
                            ? 'bg-gray-50 dark:bg-gray-700 font-medium'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                        )}
                      >
                        <span className={clsx('w-1.5 h-1.5 rounded-full', cfg.color.replace('text-', 'bg-').split(' ')[0])} />
                        <span className="text-gray-700 dark:text-gray-300">{cfg.label}</span>
                        {isActive && <span className="ml-auto text-[10px] text-gray-400">current</span>}
                      </button>
                    )
                  })}
                  {onUnlink && (
                    <>
                      <div className="border-t border-gray-100 dark:border-gray-700 my-0.5" />
                      <button
                        onClick={(e) => { e.stopPropagation(); onUnlink(); setShowInspector(false) }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <X className="h-3 w-3" />
                        Remove link
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {onUnlink && (
        <button
          onClick={(e) => { e.stopPropagation(); onUnlink() }}
          className="p-1 text-gray-400 hover:text-red-500 rounded shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Unlink"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
