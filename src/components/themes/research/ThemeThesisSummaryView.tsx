import React, { useMemo } from 'react'
import { Users, Target, Sparkles } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import {
  useThemeContributionsV2,
  useThemeResearchLayout,
  type ThemeContribution,
  type ThemeResearchField,
} from '../../../hooks/useThemeResearch'
import type { ThemeResearchActiveTab } from './ThemeContributionSection'

interface ThemeThesisSummaryViewProps {
  themeId: string
  viewFilter: ThemeResearchActiveTab
}

// Strip HTML → plain text and truncate to N sentences
function toText(html: string | null | undefined): string {
  if (!html) return ''
  const tmp = html.replace(/<\/?[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return tmp
}

function truncateToSentences(text: string, maxSentences = 3): string {
  if (!text) return text
  const sentences = text.match(/[^.!?]+[.!?]+/g)
  if (!sentences || sentences.length <= maxSentences) return text
  return sentences.slice(0, maxSentences).join('').trim() + '…'
}

function authorName(c: ThemeContribution): string {
  const u = c.author
  if (!u) return 'Unknown'
  if (u.first_name && u.last_name) return `${u.first_name[0]}. ${u.last_name}`
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return full || u.email?.split('@')[0] || 'Unknown'
}

export function ThemeThesisSummaryView({ themeId, viewFilter }: ThemeThesisSummaryViewProps) {
  const { layout, isLoading: layoutLoading } = useThemeResearchLayout()
  const { contributions, isLoading: cLoading } = useThemeContributionsV2(themeId)

  const sections = useMemo(() => {
    // Group contributions by field slug, filtered by viewFilter if set
    const filtered = contributions.filter(c => (viewFilter === 'aggregated' ? true : c.created_by === viewFilter))
    const bySlug = new Map<string, ThemeContribution[]>()
    for (const c of filtered) {
      if (!(c.content || '').replace(/<[^>]*>/g, '').trim()) continue
      const list = bySlug.get(c.section) || []
      list.push(c)
      bySlug.set(c.section, list)
    }

    return layout.map(section => ({
      section,
      fields: section.fields
        .map(field => ({
          field,
          contributions: bySlug.get(field.slug) || [],
        }))
        .filter(f => f.contributions.length > 0),
    })).filter(s => s.fields.length > 0)
  }, [layout, contributions, viewFilter])

  const isLoading = layoutLoading || cLoading
  const hasAny = sections.some(s => s.fields.length > 0)

  // Find primary contribution to highlight (first one with content)
  const primary = useMemo<{ field: ThemeResearchField; contribution: ThemeContribution } | null>(() => {
    for (const s of sections) {
      for (const f of s.fields) {
        if (f.contributions.length > 0) return { field: f.field, contribution: f.contributions[0] }
      }
    }
    return null
  }, [sections])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />)}
      </div>
    )
  }

  if (!hasAny) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No contributions to summarize.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Primary highlight */}
        {primary && (
          <div className="p-4 bg-primary-50 border-b border-primary-100">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-primary-600" />
              <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">
                {primary.field.name}
              </span>
              <span className="ml-auto text-xs text-primary-700/70">
                {formatDistanceToNow(new Date(primary.contribution.updated_at), { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm text-gray-800 leading-relaxed">
              {truncateToSentences(toText(primary.contribution.content), 3)}
            </p>
            <p className="text-xs text-gray-500 mt-2">— {authorName(primary.contribution)}</p>
          </div>
        )}

        {/* Sections */}
        <div className="p-4 space-y-5">
          {sections.map(({ section, fields }) => (
            <div key={section.id}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-gray-900 uppercase tracking-wide">
                  {section.name}
                </span>
              </div>
              <div className="space-y-4">
                {fields.map(({ field, contributions: fieldContribs }) => {
                  // Skip primary contribution if we already highlighted it at top
                  const isPrimaryField = primary?.field.id === field.id
                  const visible = isPrimaryField ? fieldContribs.slice(1) : fieldContribs
                  if (visible.length === 0) return null
                  return (
                    <div key={field.id}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Target className="w-3.5 h-3.5 text-primary-600" />
                        <span className="text-xs font-semibold text-gray-700">
                          {field.name} ({visible.length})
                        </span>
                      </div>
                      <ul className="space-y-1.5 pl-5">
                        {visible.map(c => (
                          <li key={c.id} className="text-xs text-gray-600 leading-relaxed">
                            <span className="font-medium text-gray-700">{authorName(c)}:</span>{' '}
                            {truncateToSentences(toText(c.content), 2)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs text-gray-400 flex items-center gap-1 justify-end">
        <Sparkles className="w-3 h-3" />
        Non-AI narrative summary. AI synthesis can be enabled later.
      </div>
    </div>
  )
}
