/**
 * PromptModal
 *
 * Allows a PM/Analyst to ask for insight tied to current context (asset/portfolio/theme).
 * Supports multi-context, assigned-to recipient, and multi-check audience.
 * Stores as a quick_thought with idea_type='prompt'.
 * Creates a notification for the assignee.
 */

import { useState, useEffect, useRef } from 'react'
import { X, Send, HelpCircle, Plus, Users, Check, ChevronRight, Search, TrendingUp, FolderKanban, Briefcase, Palette, List as ListIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../common/Toast'
import type { CapturedContext } from './ContextSelector'

// -- Types --

interface AudienceMember {
  kind: 'user' | 'group'
  id: string
  label: string
}

interface PromptModalProps {
  isOpen: boolean
  onClose: () => void
  context?: CapturedContext | null
  /** When true, renders as an inline form (no modal overlay) */
  embedded?: boolean
}

interface TeamMember {
  id: string
  full_name: string
  email: string
}

// -- Helpers --

// Matches ContextTagsInput entityConfig for consistent chip styling
const CTX_CONFIG: Record<string, { icon: typeof TrendingUp; color: string; bgColor: string; borderColor: string }> = {
  asset: { icon: TrendingUp, color: 'text-blue-600', bgColor: 'bg-blue-50', borderColor: 'border-blue-200' },
  project: { icon: FolderKanban, color: 'text-purple-600', bgColor: 'bg-purple-50', borderColor: 'border-purple-200' },
  portfolio: { icon: Briefcase, color: 'text-purple-600', bgColor: 'bg-purple-50', borderColor: 'border-purple-200' },
  theme: { icon: Palette, color: 'text-amber-600', bgColor: 'bg-amber-50', borderColor: 'border-amber-200' },
  list: { icon: ListIcon, color: 'text-green-600', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
  'trade-lab': { icon: TrendingUp, color: 'text-rose-600', bgColor: 'bg-rose-50', borderColor: 'border-rose-200' },
}

interface CtxSearchResult {
  type: string
  id: string
  title: string
  subtitle?: string
}

/** Map audience list to legacy visibility field for backward compat */
function audienceToVisibility(audience: AudienceMember[]): 'private' | 'team' {
  if (audience.length === 0) return 'private'
  if (audience.some(a => a.kind === 'group')) return 'team'
  return 'team'
}

export function PromptModal({ isOpen, onClose, context, embedded = false }: PromptModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { success, error: showError } = useToast()

  // Form state
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [audience, setAudience] = useState<AudienceMember[]>([])
  const [additionalContexts, setAdditionalContexts] = useState<CapturedContext[]>([])
  const [contextSearchOpen, setContextSearchOpen] = useState(false)
  const [contextSearch, setContextSearch] = useState('')
  const contextInputRef = useRef<HTMLInputElement>(null)
  const contextDropdownRef = useRef<HTMLDivElement>(null)
  const [showAudiencePicker, setShowAudiencePicker] = useState(false)
  const [audienceSearch, setAudienceSearch] = useState('')
  const [expandedGroupTypes, setExpandedGroupTypes] = useState<Set<string>>(new Set())

  // Reset form when opening
  useEffect(() => {
    if (isOpen) {
      setTitle(context?.title ? `Question on ${context.title}` : '')
      setQuestion('')
      setAssigneeId('')
      setAudience([])
      setAdditionalContexts([])
      setContextSearchOpen(false)
      setContextSearch('')
      setShowAudiencePicker(false)
      setAudienceSearch('')
      setExpandedGroupTypes(new Set())
    }
  }, [isOpen])

  // Fetch team members
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team-members-for-prompt'],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email')
        .neq('id', user.id)
        .order('full_name')
        .limit(50)

      if (error) {
        console.error('Failed to fetch team members:', error)
        return []
      }
      return data as TeamMember[]
    },
    enabled: isOpen && !!user?.id,
  })

  // Fetch org groups (departments + teams) and portfolios for audience picker
  const { data: orgGroups = [] } = useQuery({
    queryKey: ['org-groups-for-audience', user?.id, 'v2'],
    queryFn: async () => {
      if (!user?.id) return []

      // Get user's organization
      const { data: membership } = await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()

      if (!membership) return []

      // Fetch departments + teams from org chart
      const { data: nodes, error: nodesError } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type')
        .eq('organization_id', membership.organization_id)
        .eq('is_active', true)
        .in('node_type', ['team', 'department'])
        .order('node_type')
        .order('name')

      if (nodesError) {
        console.error('Failed to fetch org groups:', nodesError)
      }

      // Fetch active portfolios from portfolios table
      const { data: portfolios, error: portfoliosError } = await supabase
        .from('portfolios')
        .select('id, name')
        .neq('is_active', false)
        .order('name')

      if (portfoliosError) {
        console.error('Failed to fetch portfolios:', portfoliosError)
      }

      const groupItems = (nodes || []).map(n => ({
        kind: 'group' as const,
        id: n.id,
        label: n.name,
        nodeType: n.node_type,
      }))

      const portfolioItems = (portfolios || []).map(p => ({
        kind: 'group' as const,
        id: p.id,
        label: p.name,
        nodeType: 'portfolio',
      }))

      return [...groupItems, ...portfolioItems]
    },
    enabled: isOpen && !!user?.id,
    staleTime: 5 * 60_000,
  })

  // Inline context search query
  const { data: contextResults = [], isLoading: contextSearchLoading } = useQuery({
    queryKey: ['inline-context-search', contextSearch],
    queryFn: async (): Promise<CtxSearchResult[]> => {
      if (!contextSearch || contextSearch.length < 2) return []
      const results: CtxSearchResult[] = []
      const q = contextSearch

      const [assetRes, projRes, portRes, themeRes, listRes] = await Promise.all([
        supabase.from('assets').select('id, symbol, company_name')
          .or(`symbol.ilike.%${q}%,company_name.ilike.%${q}%`).limit(4),
        supabase.from('projects').select('id, title')
          .ilike('title', `%${q}%`).limit(3),
        supabase.from('portfolios').select('id, name')
          .ilike('name', `%${q}%`).limit(3),
        supabase.from('themes').select('id, name')
          .ilike('name', `%${q}%`).limit(3),
        supabase.from('asset_lists').select('id, name')
          .ilike('name', `%${q}%`).limit(3),
      ])

      if (assetRes.data) results.push(...assetRes.data.map(a => ({ type: 'asset', id: a.id, title: a.symbol, subtitle: a.company_name })))
      if (projRes.data) results.push(...projRes.data.map(p => ({ type: 'project', id: p.id, title: p.title })))
      if (portRes.data) results.push(...portRes.data.map(p => ({ type: 'portfolio', id: p.id, title: p.name })))
      if (themeRes.data) results.push(...themeRes.data.map(t => ({ type: 'theme', id: t.id, title: t.name })))
      if (listRes.data) results.push(...listRes.data.map(l => ({ type: 'list', id: l.id, title: l.name })))

      return results
    },
    enabled: contextSearch.length >= 2,
  })

  // Focus inline search input when opened
  useEffect(() => {
    if (contextSearchOpen) {
      // Small delay to let the input mount
      requestAnimationFrame(() => contextInputRef.current?.focus())
    }
  }, [contextSearchOpen])

  // Close inline context search on click outside
  useEffect(() => {
    if (!contextSearchOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (contextDropdownRef.current && !contextDropdownRef.current.contains(e.target as Node)) {
        setContextSearchOpen(false)
        setContextSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextSearchOpen])

  // All contexts: primary (from prop) + additional
  const allContexts: CapturedContext[] = []
  if (context?.id) allContexts.push(context)
  allContexts.push(...additionalContexts.filter(c => c.id !== context?.id))

  // -- Context handlers --
  const handleAddContext = (newContext: CapturedContext | null) => {
    if (!newContext?.id) return
    if (allContexts.some(c => c.id === newContext.id)) return
    setAdditionalContexts(prev => [...prev, newContext])
    setContextSearchOpen(false)
    setContextSearch('')
  }

  const handleRemoveContext = (contextId: string) => {
    setAdditionalContexts(prev => prev.filter(c => c.id !== contextId))
  }

  // -- Audience handlers --
  const isInAudience = (member: AudienceMember) =>
    audience.some(a => a.kind === member.kind && a.id === member.id)

  const toggleAudienceMember = (member: AudienceMember) => {
    setAudience(prev => {
      if (prev.some(a => a.kind === member.kind && a.id === member.id)) {
        return prev.filter(a => !(a.kind === member.kind && a.id === member.id))
      }
      return [...prev, member]
    })
  }

  // Filtered team members for audience picker (exclude assignee)
  const audienceFilteredMembers = teamMembers.filter(m => {
    if (m.id === assigneeId) return false
    if (audienceSearch.trim()) {
      const q = audienceSearch.toLowerCase()
      return (m.full_name || '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    }
    return true
  })

  // Filtered groups for audience picker, grouped by node_type
  const audienceFilteredGroups = orgGroups.filter(g => {
    if (!audienceSearch.trim()) return true
    return g.label.toLowerCase().includes(audienceSearch.toLowerCase())
  })

  // Group by node_type for collapsible sections
  const GROUP_TYPE_ORDER = ['department', 'team', 'portfolio'] as const
  const GROUP_TYPE_LABELS: Record<string, string> = {
    department: 'Departments',
    team: 'Teams',
    portfolio: 'Portfolios',
  }
  const groupsByType = GROUP_TYPE_ORDER
    .map(type => ({
      type,
      label: GROUP_TYPE_LABELS[type] || type,
      items: audienceFilteredGroups.filter(g => g.nodeType === type),
    }))
    .filter(g => g.items.length > 0)

  const toggleGroupType = (type: string) => {
    setExpandedGroupTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  // When searching, auto-expand all types so results are visible
  const isSearching = !!audienceSearch.trim()

  // Audience summary for collapsed view
  const audienceSummary = audience.length === 0
    ? 'Only you + assignee'
    : audience.map(a => a.label).join(', ')

  // -- Mutation --
  const createPrompt = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Not authenticated')
      if (!question.trim()) throw new Error('Question is required')
      if (!assigneeId) throw new Error('Assignee is required')

      // Build tags for backward compat + structured data
      const tags: string[] = [
        `title:${title.trim() || `Question on ${context?.title || 'context'}`}`,
        `assignee:${assigneeId}`,
      ]
      for (const a of audience) {
        tags.push(`audience:${a.kind}:${a.id}`)
      }
      for (const c of additionalContexts) {
        if (c.id && c.type) tags.push(`context:${c.type}:${c.id}`)
      }

      // Map audience to visibility for backward compat
      const visibility = audienceToVisibility(audience)

      // Use primary context for FK columns
      const primaryCtx = allContexts[0] || null

      const { data: prompt, error: insertError } = await supabase
        .from('quick_thoughts')
        .insert({
          created_by: user.id,
          content: question.trim(),
          idea_type: 'prompt',
          visibility,
          tags,
          asset_id: primaryCtx?.type === 'asset' ? primaryCtx.id : null,
          portfolio_id: primaryCtx?.type === 'portfolio' ? primaryCtx.id : null,
          theme_id: primaryCtx?.type === 'theme' ? primaryCtx.id : null,
        })
        .select('id')
        .single()

      if (insertError) throw insertError

      // Create notification for the assignee
      const userDetails = user as any
      const authorName = userDetails?.full_name || userDetails?.email || 'Someone'
      const promptTitle = title.trim() || `Question on ${primaryCtx?.title || 'context'}`

      await supabase.from('notifications').insert({
        user_id: assigneeId,
        type: 'note_shared',
        title: promptTitle,
        message: `${authorName} asked you: "${question.trim().slice(0, 100)}${question.trim().length > 100 ? '...' : ''}"`,
        context_type: primaryCtx?.type || 'asset',
        context_id: primaryCtx?.id || prompt.id,
        context_data: {
          prompt_id: prompt.id,
          author_name: authorName,
          context_title: primaryCtx?.title,
        },
        is_read: false,
      })

      return prompt
    },
    onSuccess: () => {
      success('Prompt sent')
      queryClient.invalidateQueries({ queryKey: ['recent-quick-ideas'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['direct-open-prompt-count'] })
      onClose()
    },
    onError: (err) => {
      showError(err instanceof Error ? err.message : 'Failed to send prompt')
    },
  })

  if (!isOpen) return null

  const canSubmit = question.trim() && assigneeId && !createPrompt.isPending

  // Title placeholder: context-aware
  const primaryLabel = allContexts[0]?.title || 'General'
  const titlePlaceholder = primaryLabel !== 'General'
    ? `Question on ${primaryLabel}`
    : 'Question title (optional)'

  // -- Shared form content --
  const formContent = (
    <div className={embedded ? 'space-y-3' : 'px-5 py-4 space-y-4'}>
      {/* Context chips + inline search (matches ContextTagsInput style) */}
      <div ref={contextDropdownRef} className="relative">
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-1 block">
          Context
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* "General" fallback when no context is attached */}
          {allContexts.length === 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-50 text-gray-500 border-gray-200">
              General
            </span>
          )}
          {/* Existing context chips */}
          {allContexts.map(ctx => {
            const cfg = CTX_CONFIG[ctx.type || ''] || { icon: TrendingUp, color: 'text-gray-600', bgColor: 'bg-gray-50', borderColor: 'border-gray-200' }
            const Icon = cfg.icon
            return (
              <span
                key={ctx.id}
                className={clsx(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
                  cfg.bgColor, cfg.color, cfg.borderColor
                )}
              >
                <Icon className="h-3 w-3" />
                <span>{ctx.title || 'Untitled'}</span>
                {ctx.id !== context?.id && (
                  <button
                    type="button"
                    onClick={() => handleRemoveContext(ctx.id!)}
                    className="hover:opacity-70 -mr-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            )
          })}

          {/* Inline search input — sits next to chips like ContextTagsInput */}
          {contextSearchOpen ? (
            <input
              ref={contextInputRef}
              type="text"
              value={contextSearch}
              onChange={e => {
                setContextSearch(e.target.value)
              }}
              placeholder={allContexts.length === 0 ? 'Search assets, portfolios...' : 'Add...'}
              className="flex-1 min-w-[80px] text-xs bg-transparent border-none outline-none placeholder:text-gray-400 text-gray-700 dark:text-gray-200 py-0.5"
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setContextSearchOpen(false)
                  setContextSearch('')
                }
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setContextSearchOpen(true)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border border-dashed border-gray-300 dark:border-gray-600 rounded-full hover:border-gray-400 transition-colors"
            >
              <Plus className="h-3 w-3" />
              Context
            </button>
          )}
        </div>

        {/* Results dropdown — below the full chip row */}
        {contextSearchOpen && contextSearch.length >= 2 && (
          <div className="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {contextSearchLoading ? (
              <div className="px-3 py-2 text-xs text-gray-400">Searching...</div>
            ) : contextResults.length > 0 ? (
              contextResults.map(r => {
                const cfg = CTX_CONFIG[r.type] || CTX_CONFIG.asset
                const Icon = cfg.icon
                const alreadyAdded = allContexts.some(c => c.id === r.id)
                return (
                  <button
                    key={`${r.type}-${r.id}`}
                    type="button"
                    disabled={alreadyAdded}
                    onClick={() => handleAddContext({
                      type: r.type,
                      id: r.id,
                      title: r.subtitle ? `${r.title} - ${r.subtitle}` : r.title,
                    })}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors',
                      alreadyAdded && 'opacity-40 cursor-default'
                    )}
                  >
                    <Icon className={clsx('h-3.5 w-3.5 shrink-0', cfg.color)} />
                    <span className="font-medium text-gray-900 dark:text-white truncate">{r.title}</span>
                    {r.subtitle && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.subtitle}</span>
                    )}
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-2 text-xs text-gray-400">No results</div>
            )}
          </div>
        )}
      </div>

      {/* Assigned To — required single select */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Assigned To <span className="text-red-500">*</span>
        </label>
        <select
          value={assigneeId}
          onChange={e => setAssigneeId(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent"
        >
          <option value="">Select a team member...</option>
          {teamMembers.map(m => (
            <option key={m.id} value={m.id}>
              {m.full_name || m.email}
            </option>
          ))}
        </select>
        <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
          Required.
        </p>
      </div>

      {/* Title */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Title <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={titlePlaceholder}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent"
        />
      </div>

      {/* Question */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Question <span className="text-red-500">*</span>
        </label>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="What would you like reviewed or analyzed?"
          rows={embedded ? 3 : 4}
          autoFocus
          className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none"
        />
      </div>

      {/* Audience — multi-check with users + org groups */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Audience <span className="text-gray-400 font-normal">(optional)</span>
        </label>

        {/* Collapsed summary / trigger */}
        {!showAudiencePicker ? (
          <button
            type="button"
            onClick={() => setShowAudiencePicker(true)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-left hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
          >
            <span className={clsx(
              'truncate',
              audience.length === 0
                ? 'text-gray-400'
                : 'text-gray-900 dark:text-white'
            )}>
              {audienceSummary}
            </span>
            <Plus className="h-3.5 w-3.5 text-gray-400 shrink-0 ml-2" />
          </button>
        ) : (
          /* Expanded checklist */
          <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
            <input
              type="text"
              value={audienceSearch}
              onChange={e => setAudienceSearch(e.target.value)}
              placeholder="Search users or groups..."
              autoFocus
              className="w-full px-2.5 py-1.5 text-xs border-b border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
            />
            <div className="max-h-52 overflow-y-auto">
              {/* Org groups — collapsible by type */}
              {groupsByType.map(({ type, label, items }) => {
                const isExpanded = isSearching || expandedGroupTypes.has(type)
                const checkedCount = items.filter(g => isInAudience(g)).length
                return (
                  <div key={type}>
                    <button
                      type="button"
                      onClick={() => toggleGroupType(type)}
                      className="w-full flex items-center gap-1.5 px-2.5 pt-1.5 pb-0.5 hover:bg-gray-50 dark:hover:bg-gray-700/30"
                    >
                      <ChevronRight className={clsx(
                        'h-3 w-3 text-gray-400 transition-transform',
                        isExpanded && 'rotate-90'
                      )} />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        {label}
                      </span>
                      <span className="text-[10px] text-gray-400 ml-auto">
                        {checkedCount > 0 && (
                          <span className="text-violet-500 font-medium">{checkedCount} selected</span>
                        )}
                        {checkedCount === 0 && items.length}
                      </span>
                    </button>
                    {isExpanded && items.map(g => {
                      const checked = isInAudience(g)
                      return (
                        <label
                          key={g.id}
                          className="w-full flex items-center gap-2 px-2.5 pl-6 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                        >
                          <span className={clsx(
                            'flex items-center justify-center h-4 w-4 rounded border shrink-0',
                            checked
                              ? 'bg-violet-600 border-violet-600'
                              : 'border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700'
                          )}>
                            {checked && <Check className="h-3 w-3 text-white" />}
                          </span>
                          <Users className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                          <span className="text-gray-700 dark:text-gray-300">{g.label}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAudienceMember(g)}
                            className="sr-only"
                          />
                        </label>
                      )
                    })}
                  </div>
                )
              })}

              {/* Individual users */}
              {audienceFilteredMembers.length > 0 && (
                <>
                  <div className="px-2.5 pt-1.5 pb-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      People
                    </span>
                  </div>
                  {audienceFilteredMembers.slice(0, 10).map(m => {
                    const member: AudienceMember = { kind: 'user', id: m.id, label: m.full_name || m.email }
                    const checked = isInAudience(member)
                    return (
                      <label
                        key={m.id}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                      >
                        <span className={clsx(
                          'flex items-center justify-center h-4 w-4 rounded border shrink-0',
                          checked
                            ? 'bg-violet-600 border-violet-600'
                            : 'border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700'
                        )}>
                          {checked && <Check className="h-3 w-3 text-white" />}
                        </span>
                        <span className="text-gray-700 dark:text-gray-300">
                          {m.full_name || m.email}
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAudienceMember(member)}
                          className="sr-only"
                        />
                      </label>
                    )
                  })}
                </>
              )}

              {groupsByType.length === 0 && audienceFilteredMembers.length === 0 && (
                <div className="px-2.5 py-2 text-[11px] text-gray-400">
                  No matches
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowAudiencePicker(false)
                setAudienceSearch('')
              }}
              className="w-full px-2.5 py-1 text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border-t border-gray-200 dark:border-gray-600"
            >
              Done
            </button>
          </div>
        )}
        <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
          {audience.length === 0
            ? 'Private to you and the assignee.'
            : `Visible to ${audience.length} additional ${audience.length === 1 ? 'recipient' : 'recipients'}.`}
        </p>
      </div>

      {/* Submit button */}
      <div className={embedded ? 'pt-1' : 'flex justify-end gap-3 pt-3 border-t border-gray-200 dark:border-gray-700'}>
        <button
          onClick={() => createPrompt.mutate()}
          disabled={!canSubmit}
          className={
            embedded
              ? 'w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              : 'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          }
        >
          <Send className="h-4 w-4" />
          {createPrompt.isPending ? 'Sending...' : 'Send Prompt'}
        </button>
      </div>
    </div>
  )

  // -- Embedded mode: plain form, no overlay --
  if (embedded) {
    return formContent
  }

  // -- Modal mode --
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-violet-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Ask a Question
              </h3>
            </div>
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500 pl-7">
              Assign a question, add context, and choose who can see it.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 self-start"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {formContent}
      </div>
    </div>
  )
}
