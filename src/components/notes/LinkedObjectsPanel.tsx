/**
 * LinkedObjectsPanel — Linked object badges on notes.
 *
 * Two badge types:
 * - Asset badges: context chips, click to navigate to asset
 * - Evidence badges: relationship chips for ideas/arguments, split-button
 *   (click text → open idea, click caret → open inspector)
 */

import { useState, useMemo } from 'react'
import {
  X, ChevronDown, ChevronRight,
  TrendingUp, Briefcase, Tag, FileText, GitBranch, Folder, Zap, User, Link2,
  ArrowRightLeft, ClipboardCheck, Calendar
} from 'lucide-react'
import { clsx } from 'clsx'
import type { EnrichedForwardLink } from '../../hooks/useObjectLinks'
import type { LinkableEntityType } from '../../lib/object-links'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<string, { icon: typeof TrendingUp; label: string; color: string }> = {
  asset:          { icon: TrendingUp,      label: 'Asset',        color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/40' },
  portfolio:      { icon: Briefcase,       label: 'Portfolio',    color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800/40' },
  theme:          { icon: Tag,             label: 'Theme',        color: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800/40' },
  workflow:       { icon: GitBranch,       label: 'Process',      color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  project:        { icon: Folder,          label: 'Project',      color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  trade_idea:     { icon: Zap,             label: 'Idea',         color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/40' },
  trade:          { icon: ArrowRightLeft,  label: 'Trade',        color: 'bg-rose-50 text-rose-700 border-rose-200' },
  trade_sheet:    { icon: ClipboardCheck,  label: 'Trade Sheet',  color: 'bg-teal-50 text-teal-700 border-teal-200' },
  calendar_event: { icon: Calendar,        label: 'Meeting',      color: 'bg-sky-50 text-sky-700 border-sky-200' },
  user:           { icon: User,            label: 'User',         color: 'bg-blue-50 text-blue-700 border-blue-200' },
  asset_note:     { icon: FileText,        label: 'Note',         color: 'bg-gray-50 text-gray-700 border-gray-200' },
  portfolio_note: { icon: FileText,        label: 'Note',         color: 'bg-gray-50 text-gray-700 border-gray-200' },
  theme_note:     { icon: FileText,        label: 'Note',         color: 'bg-gray-50 text-gray-700 border-gray-200' },
  custom_note:    { icon: FileText,        label: 'Note',         color: 'bg-gray-50 text-gray-700 border-gray-200' },
  quick_thought:  { icon: Zap,             label: 'Thought',      color: 'bg-violet-50 text-violet-700 border-violet-200' },
  trade_proposal: { icon: ArrowRightLeft,  label: 'Recommendation', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  trade_idea_thesis: { icon: Zap,          label: 'Argument',       color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
}

const LINK_TYPE_DISPLAY: Record<string, { label: string; color: string }> = {
  supports:     { label: 'Supports',     color: 'text-green-600 dark:text-green-400' },
  opposes:      { label: 'Contradicts',  color: 'text-red-600 dark:text-red-400' },
  related_to:   { label: 'Related',      color: 'text-blue-600 dark:text-blue-400' },
  informs:      { label: 'Informs',      color: 'text-purple-600 dark:text-purple-400' },
  derived_from: { label: 'Derived from', color: 'text-gray-500 dark:text-gray-400' },
  references:   { label: 'References',   color: 'text-gray-500 dark:text-gray-400' },
  results_in:   { label: 'Results in',   color: 'text-amber-600 dark:text-amber-400' },
}

const RELATIONSHIP_GROUPS = [
  {
    label: 'Evidence',
    types: [
      { key: 'supports', label: 'Supports', dot: 'bg-green-500' },
      { key: 'opposes',  label: 'Contradicts', dot: 'bg-red-500' },
    ],
  },
  {
    label: 'Context',
    types: [
      { key: 'informs',      label: 'Informs', dot: 'bg-purple-500' },
      { key: 'related_to',   label: 'Related', dot: 'bg-blue-500' },
      { key: 'references',   label: 'References', dot: 'bg-gray-400' },
      { key: 'derived_from', label: 'Derived from', dot: 'bg-gray-400' },
    ],
  },
]

const IDEA_TYPES = new Set<string>(['trade_idea', 'trade_idea_thesis'])

function getConfig(type: LinkableEntityType) {
  return TYPE_CONFIG[type] || { icon: Link2, label: type, color: 'bg-gray-50 text-gray-700 border-gray-200' }
}

/** Extract a short date from subtitle like "Crocs Inc · Eric L · Mar 16, 2026" */
function extractShortDate(subtitle?: string): string {
  if (!subtitle) return ''
  // Find the date-like part (last segment after ·)
  const parts = subtitle.split(' \u00b7 ').map(s => s.trim())
  const datePart = parts.find(p => /^[A-Z][a-z]{2}\s/.test(p))
  if (!datePart) return ''
  // Shorten "Mar 16, 2026" → "Mar 16"
  return datePart.replace(/,\s*\d{4}$/, '')
}

function navigateToObject(link: EnrichedForwardLink) {
  switch (link.target_type) {
    case 'asset':
      window.dispatchEvent(new CustomEvent('navigate-to-asset', { detail: { assetId: link.target_id } }))
      break
    case 'portfolio':
      window.dispatchEvent(new CustomEvent('navigate-to-portfolio', { detail: { portfolioId: link.target_id } }))
      break
    case 'theme':
      window.dispatchEvent(new CustomEvent('navigate-to-theme', { detail: { themeId: link.target_id } }))
      break
    case 'trade_idea':
    case 'trade_idea_thesis':
      // Navigate to trade queue tab, then open the idea modal
      window.dispatchEvent(new CustomEvent('openTradeQueue', { detail: { selectedTradeId: link.target_id } }))
      // Wait for tab navigation to complete before opening modal
      requestAnimationFrame(() => {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('openTradeIdeaModal', { detail: { tradeId: link.target_id } }))
        }, 50)
      })
      break
    case 'workflow':
      window.dispatchEvent(new CustomEvent('navigate-to-workflow', { detail: { workflowId: link.target_id } }))
      break
    case 'project':
      window.dispatchEvent(new CustomEvent('navigate-to-project', { detail: { projectId: link.target_id } }))
      break
  }
}

// ---------------------------------------------------------------------------
// Asset Badge — context chip, simple click-to-navigate
// ---------------------------------------------------------------------------

function AssetBadge({ link }: { link: EnrichedForwardLink }) {
  const cfg = getConfig(link.target_type)
  const Icon = cfg.icon
  return (
    <button
      onClick={() => navigateToObject(link)}
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border cursor-pointer hover:shadow-sm transition-all',
        cfg.color
      )}
      title={[link.label, link.subtitle].filter(Boolean).join(' — ')}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      <span className="truncate max-w-[140px]">{link.label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Evidence Badge — relationship chip for ideas/arguments
// Split: click text → navigate, click caret → inspector
// ---------------------------------------------------------------------------

function EvidenceBadge({
  link,
  onDelete,
  onUpdateLinkType,
}: {
  link: EnrichedForwardLink
  onDelete?: () => void
  onUpdateLinkType?: (newType: string) => void
}) {
  const [showInspector, setShowInspector] = useState(false)
  const cfg = getConfig(link.target_type)
  const Icon = cfg.icon
  const linkDisplay = LINK_TYPE_DISPLAY[link.link_type]
  const relationLabel = linkDisplay?.label || 'Linked'
  const shortDate = extractShortDate(link.subtitle)

  // Build badge text: "Supports SELL CROX · Mar 16"
  const badgeText = shortDate ? `${link.label} \u00b7 ${shortDate}` : link.label

  return (
    <div className="relative inline-flex">
      {/* Main chip — click navigates to idea */}
      <button
        onClick={() => navigateToObject(link)}
        className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 text-[11px] font-medium rounded-l-md border border-r-0 bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/40 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all"
        title={[link.label, link.subtitle].filter(Boolean).join(' — ')}
      >
        <span className={clsx('text-[10px] font-semibold', linkDisplay?.color || 'text-gray-500')}>
          {relationLabel}
        </span>
        <span className="truncate max-w-[160px]">{badgeText}</span>
      </button>
      {/* Caret — opens inspector */}
      <button
        onClick={() => setShowInspector(!showInspector)}
        className="inline-flex items-center px-1 py-0.5 text-[11px] rounded-r-md border bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/40 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all"
      >
        <ChevronDown className="h-2.5 w-2.5" />
      </button>

      {/* Inspector popover */}
      {showInspector && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowInspector(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[250px] overflow-hidden">
            {/* Linked object identity */}
            <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-700">
              <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Linked to</div>
              <div className="flex items-start gap-1.5">
                <Icon className="h-3.5 w-3.5 flex-shrink-0 text-amber-500 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">{link.label}</div>
                  {link.subtitle && (() => {
                    // Parse subtitle: first segment before · may be stage, rest is meta
                    const parts = link.subtitle.split(' \u00b7 ')
                    const stageNames = ['Aware', 'Investigate', 'Deep Research', 'Thesis Forming', 'Ready for Decision', 'Idea', 'Discussing', 'Simulating', 'Deciding']
                    const hasStage = stageNames.includes(parts[0])
                    const stage = hasStage ? parts[0] : null
                    const meta = hasStage ? parts.slice(1).join(' \u00b7 ') : link.subtitle
                    return (
                      <>
                        {stage && (
                          <div className="text-[10px] text-primary-600 dark:text-primary-400 font-medium mt-0.5">{stage}</div>
                        )}
                        {meta && (
                          <div className="text-[10px] text-gray-400 mt-0.5">{meta}</div>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>

            {/* Grouped relationship type selector */}
            {onUpdateLinkType && (
              <div className="py-1">
                {RELATIONSHIP_GROUPS.map(group => (
                  <div key={group.label}>
                    <div className="px-3 py-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide">{group.label}</div>
                    {group.types.map(lt => {
                      const isActive = link.link_type === lt.key
                      return (
                        <button
                          key={lt.key}
                          onClick={() => {
                            if (!isActive) onUpdateLinkType(lt.key)
                            setShowInspector(false)
                          }}
                          className={clsx(
                            'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                            isActive ? 'bg-gray-50 dark:bg-gray-700 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                          )}
                        >
                          <span className={clsx('w-1.5 h-1.5 rounded-full', lt.dot)} />
                          <span className="text-gray-700 dark:text-gray-300">{lt.label}</span>
                          {isActive && <span className="ml-auto text-[10px] text-gray-400">current</span>}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="border-t border-gray-100 dark:border-gray-700 py-1">
              <button
                onClick={() => { navigateToObject(link); setShowInspector(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Open {cfg.label.toLowerCase()}
              </button>
              {onDelete && (
                <button
                  onClick={() => { onDelete(); setShowInspector(false) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <X className="h-3 w-3" />
                  Remove link
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface LinkedObjectsPanelProps {
  links: EnrichedForwardLink[]
  onDeleteLink?: (linkId: string) => void
  onUpdateLinkType?: (linkId: string, newType: string) => void
  isLoading?: boolean
}

export function LinkedObjectsPanel({ links, onDeleteLink, onUpdateLinkType, isLoading }: LinkedObjectsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const deduped = useMemo(() => {
    const seen = new Map<string, EnrichedForwardLink>()
    for (const link of links.filter(l => !l.is_auto)) {
      const key = `${link.target_type}:${link.target_id}`
      seen.set(key, link)
    }
    for (const link of links.filter(l => l.is_auto)) {
      const key = `${link.target_type}:${link.target_id}`
      if (!seen.has(key)) seen.set(key, link)
    }
    return Array.from(seen.values())
  }, [links])

  if (isLoading || deduped.length === 0) return null

  // Separate by semantic layer
  const contextLinks = deduped.filter(l => !IDEA_TYPES.has(l.target_type))   // assets, portfolios, etc.
  const evidenceLinks = deduped.filter(l => IDEA_TYPES.has(l.target_type))   // ideas, arguments

  return (
    <div className="px-4 py-1.5 border-b border-gray-100 bg-gray-50/60 dark:bg-gray-800/30">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors"
      >
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Link2 className="h-3 w-3" />
        Linked Objects
      </button>

      {isExpanded && (
        <div className="flex flex-wrap gap-1.5 mt-1.5 pb-0.5">
          {evidenceLinks.map(link => (
            <EvidenceBadge
              key={link.id}
              link={link}
              onDelete={onDeleteLink && !link.is_auto ? () => onDeleteLink(link.id) : undefined}
              onUpdateLinkType={onUpdateLinkType && !link.is_auto ? (newType) => onUpdateLinkType(link.id, newType) : undefined}
            />
          ))}
          {contextLinks.map(link => (
            link.is_auto ? (
              <button
                key={link.id}
                onClick={() => navigateToObject(link)}
                className={clsx(
                  'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border cursor-pointer opacity-70 hover:opacity-100 transition-all',
                  getConfig(link.target_type).color
                )}
                title={`Auto-detected: ${[link.label, link.subtitle].filter(Boolean).join(' — ')}`}
              >
                {(() => { const C = getConfig(link.target_type); return <C.icon className="h-3 w-3 flex-shrink-0" /> })()}
                <span className="truncate max-w-[120px]">{link.label}</span>
              </button>
            ) : (
              <AssetBadge key={link.id} link={link} />
            )
          ))}
        </div>
      )}
    </div>
  )
}
