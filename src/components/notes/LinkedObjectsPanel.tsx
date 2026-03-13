/**
 * LinkedObjectsPanel — Compact collapsible display of linked objects on a note.
 *
 * Shows both auto-extracted and manual links as chips.
 * Manual links have a × button for removal.
 * Clicking a chip dispatches navigation (CustomEvent for assets, etc.).
 */

import { useState, useMemo } from 'react'
import {
  X, ChevronDown, ChevronRight,
  TrendingUp, Briefcase, Tag, FileText, GitBranch, Folder, Zap, User, Link2,
  ArrowRightLeft, ClipboardCheck, Calendar
} from 'lucide-react'
import type { EnrichedForwardLink } from '../../hooks/useObjectLinks'
import type { LinkableEntityType } from '../../lib/object-links'

const TYPE_CONFIG: Record<string, { icon: typeof TrendingUp; label: string; color: string }> = {
  asset:          { icon: TrendingUp,      label: 'Asset',        color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  portfolio:      { icon: Briefcase,       label: 'Portfolio',    color: 'bg-orange-50 text-orange-700 border-orange-200' },
  theme:          { icon: Tag,             label: 'Theme',        color: 'bg-purple-50 text-purple-700 border-purple-200' },
  workflow:       { icon: GitBranch,       label: 'Process',      color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  project:        { icon: Folder,          label: 'Project',      color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  trade_idea:     { icon: Zap,             label: 'Trade Idea',   color: 'bg-amber-50 text-amber-700 border-amber-200' },
  trade:          { icon: ArrowRightLeft,  label: 'Trade',        color: 'bg-rose-50 text-rose-700 border-rose-200' },
  trade_sheet:    { icon: ClipboardCheck,  label: 'Trade Sheet',  color: 'bg-teal-50 text-teal-700 border-teal-200' },
  calendar_event: { icon: Calendar,        label: 'Meeting',      color: 'bg-sky-50 text-sky-700 border-sky-200' },
  user:           { icon: User,            label: 'User',         color: 'bg-blue-50 text-blue-700 border-blue-200' },
  asset_note:     { icon: FileText,        label: 'Note',         color: 'bg-gray-50 text-gray-700 border-gray-200' },
  portfolio_note: { icon: FileText,        label: 'Note',         color: 'bg-gray-50 text-gray-700 border-gray-200' },
  theme_note:     { icon: FileText,        label: 'Note',         color: 'bg-gray-50 text-gray-700 border-gray-200' },
  custom_note:    { icon: FileText,        label: 'Note',         color: 'bg-gray-50 text-gray-700 border-gray-200' },
  quick_thought:  { icon: Zap,             label: 'Thought',      color: 'bg-violet-50 text-violet-700 border-violet-200' },
  trade_proposal: { icon: ArrowRightLeft,  label: 'Proposal',     color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

const LINK_TYPE_LABELS: Record<string, string> = {
  references:  'references',
  supports:    'supports',
  results_in:  'results in',
  related_to:  'related to',
}

function getConfig(type: LinkableEntityType) {
  return TYPE_CONFIG[type] || { icon: Link2, label: type, color: 'bg-gray-50 text-gray-700 border-gray-200' }
}

interface LinkedObjectsPanelProps {
  links: EnrichedForwardLink[]
  onDeleteLink?: (linkId: string) => void
  isLoading?: boolean
}

export function LinkedObjectsPanel({ links, onDeleteLink, isLoading }: LinkedObjectsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Deduplicate: if both auto and manual links point to same target, keep manual (user-intentional)
  // and mark auto as hidden so we don't double-show the same object
  const deduped = useMemo(() => {
    const seen = new Map<string, EnrichedForwardLink>()
    // Process manual links first (they take priority)
    for (const link of links.filter(l => !l.is_auto)) {
      const key = `${link.target_type}:${link.target_id}`
      seen.set(key, link)
    }
    // Then auto links — skip if manual already covers this target
    for (const link of links.filter(l => l.is_auto)) {
      const key = `${link.target_type}:${link.target_id}`
      if (!seen.has(key)) seen.set(key, link)
    }
    return Array.from(seen.values())
  }, [links])

  if (isLoading || deduped.length === 0) return null

  const autoLinks = deduped.filter(l => l.is_auto)
  const manualLinks = deduped.filter(l => !l.is_auto)

  const handleChipClick = (link: EnrichedForwardLink) => {
    // Navigate based on type
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
      case 'workflow':
        window.dispatchEvent(new CustomEvent('navigate-to-workflow', { detail: { workflowId: link.target_id } }))
        break
      case 'project':
        window.dispatchEvent(new CustomEvent('navigate-to-project', { detail: { projectId: link.target_id } }))
        break
    }
  }

  return (
    <div className="px-4 py-1.5 border-b border-gray-100 bg-gray-50/60">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Link2 className="h-3 w-3" />
        {deduped.length} linked object{deduped.length === 1 ? '' : 's'}
        {manualLinks.length > 0 && autoLinks.length > 0 && (
          <span className="text-gray-400 ml-1">
            ({manualLinks.length} manual, {autoLinks.length} auto)
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="flex flex-wrap gap-1.5 mt-1.5 pb-0.5">
          {/* Manual links first */}
          {manualLinks.map(link => {
            const cfg = getConfig(link.target_type)
            const Icon = cfg.icon
            const intentLabel = LINK_TYPE_LABELS[link.link_type]
            return (
              <span
                key={link.id}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border cursor-pointer hover:shadow-sm transition-all ${cfg.color}`}
              >
                <Icon className="h-3 w-3 flex-shrink-0" />
                {intentLabel && intentLabel !== 'references' && (
                  <span className="opacity-60 italic">{intentLabel}</span>
                )}
                <span
                  className="truncate max-w-[120px]"
                  onClick={() => handleChipClick(link)}
                  title={[link.label, link.subtitle].filter(Boolean).join(' — ')}
                >
                  {link.label}
                </span>
                {onDeleteLink && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteLink(link.id) }}
                    className="ml-0.5 p-0.5 hover:bg-black/10 rounded transition-colors"
                    title="Remove link"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            )
          })}

          {/* Auto links */}
          {autoLinks.map(link => {
            const cfg = getConfig(link.target_type)
            const Icon = cfg.icon
            return (
              <span
                key={link.id}
                onClick={() => handleChipClick(link)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border cursor-pointer opacity-70 hover:opacity-100 transition-all ${cfg.color}`}
                title={`Auto-detected: ${[link.label, link.subtitle].filter(Boolean).join(' — ')}`}
              >
                <Icon className="h-3 w-3 flex-shrink-0" />
                <span className="truncate max-w-[120px]">{link.label}</span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
