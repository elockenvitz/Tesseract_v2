import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Users } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import { useOrganization } from '../../../contexts/OrganizationContext'
import { useUserAssetPagePreferences } from '../../../hooks/useUserAssetPagePreferences'
import { contributionSectionsForSlug, writeSectionForSlug } from '../../../lib/research/contribution-sections'
import { MobileCaseSection } from './MobileCaseSection'
import { MobilePriceTargetChart } from './MobilePriceTargetChart'
import { MobileRatingField } from './MobileRatingField'
import { MobileEstimatesField } from './MobileEstimatesField'

interface MobileCaseViewProps {
  assetId: string
  symbol: string
}

/** 'aggregated' shows the firm's view; any other value is a user id. */
type ViewFilter = 'aggregated' | string

/**
 * The asset case, laid out from the organisation's research template.
 *
 * The sections and fields are not fixed: an organisation chooses which appear
 * and in what order, and an asset can override that. Hard-coding thesis /
 * where-different / risks — as this did first — showed three fields of a
 * template that may define a dozen, and silently omitted the rest with no
 * indication anything was missing.
 *
 * Fields resolve through useUserAssetPagePreferences, the same hook the
 * desktop page uses, so the phone shows the same template with the same
 * overrides applied rather than a second opinion about what the case contains.
 */
export function MobileCaseView({ assetId, symbol }: MobileCaseViewProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const [view, setView] = useState<ViewFilter>('aggregated')
  const [pickerOpen, setPickerOpen] = useState(false)

  const { displayedFieldsBySection, isLoading } = useUserAssetPagePreferences(assetId)

  // Who covers this name. Ordered lead-first, matching the desktop tab strip.
  const { data: analysts = [] } = useQuery({
    queryKey: ['asset-coverage-analysts', assetId, currentOrgId],
    enabled: !!assetId && !!currentOrgId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('user_id, is_lead, role, user:users!coverage_user_id_fkey(id, first_name, last_name)')
        .eq('asset_id', assetId)
        .eq('organization_id', currentOrgId!)
        .eq('is_active', true)
        .order('is_lead', { ascending: false })
      if (error) throw error
      return (data ?? [])
        .filter((c: any) => c.user_id)
        .map((c: any) => ({
          userId: c.user_id as string,
          name:
            [c.user?.first_name, c.user?.last_name].filter(Boolean).join(' ') ||
            'Analyst',
          isLead: !!c.is_lead,
          role: c.role as string | null,
        }))
    },
  })

  const options = useMemo(() => {
    const rows = [{ userId: 'aggregated', name: 'Firm view', isLead: false, role: null }]
    // The reader's own view is worth reaching even before they have covered
    // the name, since that is where their unpublished drafts live.
    if (user && !analysts.some(a => a.userId === user.id)) {
      rows.push({ userId: user.id, name: 'My view', isLead: false, role: null })
    }
    return [...rows, ...analysts.map(a => ({
      ...a,
      name: a.userId === user?.id ? 'My view' : a.name,
    }))]
  }, [analysts, user])

  const activeLabel = options.find(o => o.userId === view)?.name ?? 'Firm view'

  // useUserAssetPagePreferences returns fields regardless of visibility — its
  // own comment defers the is_visible filter to the renderer. Without it the
  // page shows every field defined anywhere, including hidden scaffolding.
  const sections = (displayedFieldsBySection ?? [])
    .map((section: any) => ({
      ...section,
      fields: (section.fields ?? []).filter((f: any) => f.is_visible),
    }))
    .filter((section: any) => section.fields.length > 0)

  return (
    <div className="space-y-3">
      {/* Whose case is on screen. On desktop this is a tab strip across the
          top; a strip of analyst names does not survive 390px, so it becomes
          a single control naming the current view. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen(v => !v)}
          aria-expanded={pickerOpen}
          className="w-full flex items-center gap-2 h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-left no-touch-target"
        >
          <Users className="h-4 w-4 text-gray-400 shrink-0" />
          <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {activeLabel}
          </span>
          {options.length > 1 && (
            <span className="shrink-0 text-[11px] text-gray-400">
              {options.length - 1} {options.length - 1 === 1 ? 'analyst' : 'analysts'}
            </span>
          )}
          <ChevronDown
            className={clsx('h-4 w-4 shrink-0 text-gray-400 transition-transform', pickerOpen && 'rotate-180')}
          />
        </button>

        {pickerOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setPickerOpen(false)} aria-hidden />
            <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
              {options.map(o => (
                <button
                  key={o.userId}
                  type="button"
                  onClick={() => {
                    setView(o.userId)
                    setPickerOpen(false)
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 min-h-[44px] px-3 text-left text-sm',
                    o.userId === view
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-semibold'
                      : 'text-gray-700 dark:text-gray-200 active:bg-gray-50 dark:active:bg-gray-800'
                  )}
                >
                  <span className="flex-1 min-w-0 truncate">{o.name}</span>
                  {o.isLead && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      Lead
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">
          No research template is configured for this asset.
        </p>
      ) : (
        sections.map((section: any) => (
          <div key={section.id ?? section.section_id ?? section.name} className="space-y-2">
            <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {section.name ?? section.section_name}
            </h2>
            {(section.fields ?? []).map((field: any) => (
              <CaseField
                key={field.field_id}
                assetId={assetId}
                symbol={symbol}
                field={field}
                view={view}
              />
            ))}
          </div>
        ))
      )}
    </div>
  )
}

/**
 * One template field, rendered according to its type.
 *
 * The template orders fields, and a field's position carries meaning — price
 * targets sit where the author put them, not hoisted to the top of the page
 * because they happen to be graphical. Dispatching on field_type here is what
 * keeps the hierarchy the template describes.
 */
function CaseField({
  assetId,
  symbol,
  field,
  view,
}: {
  assetId: string
  symbol: string
  field: any
  view: ViewFilter
}) {
  switch (field.field_type) {
    case 'price_target':
      return (
        <div>
          <h3 className="mb-1 px-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {field.field_name}
          </h3>
          <MobilePriceTargetChart assetId={assetId} symbol={symbol} viewFilter={view} />
        </div>
      )

    case 'rating':
      return <MobileRatingField assetId={assetId} title={field.field_name} viewFilter={view} />

    case 'estimates':
      return <MobileEstimatesField assetId={assetId} title={field.field_name} viewFilter={view} />

    case 'rich_text':
      return (
        <MobileCaseSection
          assetId={assetId}
          sectionKey={writeSectionForSlug(field.field_slug)}
          readSectionKeys={contributionSectionsForSlug(field.field_slug)}
          title={field.field_name}
          emptyHint={field.field_description || 'Nothing written yet.'}
          viewFilter={view}
        />
      )

    default:
      // checklist, key_references, timeline, metric, numeric and date each
      // need their own editor. Naming the field and saying where it lives is
      // honest; rendering it as prose would show its storage format and invite
      // edits that corrupt it.
      return <UnsupportedField name={field.field_name} type={field.field_type} />
  }
}

const FIELD_TYPE_LABEL: Record<string, string> = {
  checklist: 'Checklist',
  key_references: 'Notes and documents',
  timeline: 'Timeline',
  metric: 'Metric',
  numeric: 'Number',
  date: 'Date',
}

function UnsupportedField({ name, type }: { name: string; type: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-3 py-2.5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{name}</h3>
      <p className="mt-0.5 text-xs text-gray-400">
        {FIELD_TYPE_LABEL[type] ?? 'This field'} — open on desktop to view or edit.
      </p>
    </div>
  )
}

