import React, { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { useIsMobile } from '../../../hooks/useMediaQuery'
import {
  Settings2, Users, Layers, Sparkles, History as HistoryIcon, Link2, Star, UserPlus,
} from 'lucide-react'
import { Button } from '../../ui/Button'
import {
  ThemeContributionSection,
  type ThemeResearchActiveTab,
} from './ThemeContributionSection'
import { OptionPicker } from '../../ui/OptionPicker'
import { ThemeFieldManagerModal } from './ThemeFieldManagerModal'
import { ThemeThesisSummaryView } from './ThemeThesisSummaryView'
import { ThemeThesisHistoryView } from './ThemeThesisHistoryView'
import { ThemeKeyReferencesSection } from './ThemeKeyReferencesSection'
import {
  useThemeResearchLayout,
  useThemeContributionsV2,
} from '../../../hooks/useThemeResearch'
import { useThemeKeyReferences } from '../../../hooks/useThemeKeyReferences'
import { useAuth } from '../../../hooks/useAuth'

interface ThemeResearchTabProps {
  themeId: string
  themeIsPublic: boolean
}

type ThesisViewMode = 'all' | 'summary' | 'history' | 'references'

function tabLabel(author: { first_name: string | null; last_name: string | null; email: string | null } | null | undefined, fallback = 'User'): string {
  if (!author) return fallback
  const full = [author.first_name, author.last_name].filter(Boolean).join(' ').trim()
  return full || author.email?.split('@')[0] || fallback
}
function shortName(author: { first_name: string | null; last_name: string | null; email: string | null } | null | undefined, fallback = 'User'): string {
  if (!author) return fallback
  const first = author.first_name
  const last = author.last_name
  if (first && last) return `${first[0]}. ${last}`
  return author.first_name || author.email?.split('@')[0] || fallback
}

export function ThemeResearchTab({ themeId, themeIsPublic }: ThemeResearchTabProps) {
  const { user } = useAuth()
  const { layout, isLoading: layoutLoading } = useThemeResearchLayout()
  const { contributors, isLoading: contribsLoading } = useThemeContributionsV2(themeId)
  const { references } = useThemeKeyReferences(themeId)
  const [showManager, setShowManager] = useState(false)

  // One control naming the current view, as on the asset case — a row of
  // analyst pills does not survive 390px.
  const isMobileViewport = useIsMobile()
  const [viewFilter, setViewFilter] = useState<ThemeResearchActiveTab>('aggregated')
  const [viewMode, setViewMode] = useState<ThesisViewMode>('all')

  // Analyst pills: contributors + current user if not already there
  const analysts = useMemo(() => {
    const seen = new Set<string>()
    const list: { id: string; name: string; shortName: string; isSelf: boolean }[] = []
    for (const c of contributors) {
      if (seen.has(c.user_id)) continue
      seen.add(c.user_id)
      const isSelf = c.user_id === user?.id
      list.push({
        id: c.user_id,
        name: isSelf ? 'You' : tabLabel(c.author),
        shortName: isSelf ? 'You' : shortName(c.author),
        isSelf,
      })
    }
    if (user?.id && !seen.has(user.id)) {
      list.push({ id: user.id, name: 'You', shortName: 'You', isSelf: true })
    }
    return list
  }, [contributors, user?.id])

  // If selected analyst disappears, snap back to aggregated
  useEffect(() => {
    if (viewFilter === 'aggregated') return
    if (!analysts.some(a => a.id === viewFilter)) setViewFilter('aggregated')
  }, [analysts, viewFilter])

  const viewingOther = viewFilter !== 'aggregated' && viewFilter !== user?.id

  return (
    <div className="space-y-3">
      {/* Filter bar.

          Two controls, both named. The whose-view control was a full-width
          native select on a phone — 16px type in a chrome-drawn box, taller
          than everything beside it and unable to say "Our View" without also
          saying "(All Contributors)". The what-to-show control was four
          unlabelled icons: a stack, a sparkle, a clock and a chain, which is
          not a legible way to offer Summary, Changes and Links. Both are
          pickers now, and the modes carry their names. */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
          {/* Left: analyst pills */}
          <div className="flex items-center gap-3 min-w-0 flex-1 sm:flex-none flex-wrap">
            <span className="hidden sm:inline text-xs text-gray-400 uppercase tracking-wide font-medium">View</span>
            {isMobileViewport ? (
              <OptionPicker
                label="Whose view"
                value={viewFilter}
                onChange={setViewFilter}
                className="min-w-0"
                options={[
                  { value: 'aggregated', label: 'Our View', hint: 'All contributors' },
                  ...analysts.map(a => ({
                    value: a.id,
                    label: a.name,
                    hint: a.isSelf ? 'You' : undefined,
                  })),
                ]}
              />
            ) : analysts.length <= 5 ? (
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 dark:bg-gray-800">
                <button
                  onClick={() => setViewFilter('aggregated')}
                  className={clsx(
                    'px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5',
                    viewFilter === 'aggregated'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 dark:hover:text-white dark:text-gray-400'
                  )}
                >
                  <Users className="w-3.5 h-3.5" />
                  Our View
                </button>
                {analysts.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setViewFilter(a.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5',
                      viewFilter === a.id
                        ? 'bg-primary-600 text-white shadow-sm'
                        : a.isSelf ? 'text-primary-600 hover:text-primary-700' : 'text-gray-600 hover:text-gray-900 dark:hover:text-white dark:text-gray-400'
                    )}
                  >
                    {a.isSelf && viewFilter !== a.id && <Star className="w-3 h-3 text-primary-500" />}
                    {a.shortName}
                  </button>
                ))}
              </div>
            ) : (
              <select
                value={viewFilter}
                onChange={(e) => setViewFilter(e.target.value)}
                className="w-full sm:w-auto px-3 h-9 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 border-0 focus:ring-2 focus:ring-primary-500 dark:text-gray-300 dark:bg-gray-800"
              >
                <option value="aggregated">Our View (All Contributors)</option>
                {analysts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Right: view mode + manage */}
          <div className="flex items-center gap-2 min-w-0">
            {isMobileViewport ? (
              <OptionPicker
                label="Show"
                value={viewMode}
                onChange={setViewMode}
                align="right"
                className="min-w-0"
                options={[
                  { value: 'all',        label: 'All sections' },
                  { value: 'summary',    label: 'Summary' },
                  { value: 'history',    label: 'Changes' },
                  { value: 'references', label: 'Links', count: references.length },
                ]}
              />
            ) : (
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5 dark:bg-gray-800">
                {([
                  { mode: 'all',        label: 'All',      Icon: Layers,       active: 'text-primary-600' },
                  { mode: 'summary',    label: 'Summary',  Icon: Sparkles,     active: 'text-purple-600' },
                  { mode: 'history',    label: 'Changes',  Icon: HistoryIcon,  active: 'text-primary-600' },
                  { mode: 'references', label: 'Links',    Icon: Link2,        active: 'text-primary-600' },
                ] as const).map(({ mode, label, Icon, active }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={clsx(
                      'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors',
                      viewMode === mode
                        ? clsx('bg-white shadow-sm dark:bg-gray-800', active)
                        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 dark:text-gray-400',
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                    {mode === 'references' && references.length > 0 && (
                      <span className="tabular-nums text-[10px] text-gray-400">{references.length}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowManager(true)}
              className="shrink-0"
              aria-label="Manage fields"
            >
              <Settings2 className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Manage</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Content area */}
      {viewMode === 'summary' ? (
        <ThemeThesisSummaryView themeId={themeId} viewFilter={viewFilter} />
      ) : viewMode === 'history' ? (
        <ThemeThesisHistoryView themeId={themeId} viewFilter={viewFilter} />
      ) : viewMode === 'references' ? (
        <ThemeKeyReferencesSection themeId={themeId} />
      ) : layoutLoading || contribsLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse dark:bg-gray-800" />)}
        </div>
      ) : (
        layout.map(section => (
          <section key={section.id} className="space-y-2">
            <div className="px-1">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{section.name}</h2>
              {section.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{section.description}</p>
              )}
            </div>
            <div className="space-y-2">
              {section.fields.length === 0 ? (
                <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-6 text-center dark:border-gray-600 dark:bg-gray-900">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No fields in this section yet. Click "Manage" to add one.
                  </p>
                </div>
              ) : (
                section.fields.map(field => (
                  <ThemeContributionSection
                    key={field.id}
                    themeId={themeId}
                    themeIsPublic={themeIsPublic}
                    field={field}
                    activeTab={viewFilter}
                    hideWhenEmpty={viewingOther}
                    onTabChange={setViewFilter}
                  />
                ))
              )}
            </div>
          </section>
        ))
      )}

      {showManager && (
        <ThemeFieldManagerModal onClose={() => setShowManager(false)} />
      )}
    </div>
  )
}
