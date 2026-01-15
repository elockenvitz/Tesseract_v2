import { useState } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown,
  ChevronUp,
  Globe,
  Lock,
  Users,
  Eye,
  AlertCircle,
  Loader2,
  FileText,
  Hash,
  Calendar,
  CheckSquare,
  Clock,
  Gauge,
  Download
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { InvestmentCaseBuilder } from './InvestmentCaseBuilder'
import { ThesisContainer } from '../contributions'
import { OutcomesContainer, AnalystRatingsSection, AnalystEstimatesSection } from '../outcomes'
import { DocumentLibrarySection } from '../documents/DocumentLibrarySection'
import { ContributionSection } from '../contributions/ContributionSection'
import {
  ChecklistField,
  MetricField,
  TimelineField,
  NumericField,
  DateField
} from './FieldTypeRenderers'
import {
  useUserResearchLayout,
  type AccessibleField,
  type ResearchLayoutSection,
  type FieldType
} from '../../hooks/useResearchFields'
import { useUserAssetPagePreferences } from '../../hooks/useUserAssetPagePreferences'
import type { ContributionVisibility } from '../../hooks/useContributions'

// ============================================================================
// TYPES
// ============================================================================

interface DynamicResearchContainerProps {
  assetId: string
  symbol?: string
  companyName?: string
  currentPrice?: number
  viewFilter?: 'aggregated' | string
  thesisViewMode?: 'all' | 'summary' | 'history' | 'references'
  sharedVisibility?: ContributionVisibility
  sharedTargetIds?: string[]
  collapsedSections?: Record<string, boolean>
  onToggleSection?: (section: string) => void
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
  notes?: any[]
  onNoteClick?: (note: any) => void
  onCreateNote?: () => void
}

// ============================================================================
// FIELD BADGE COMPONENT
// ============================================================================

function FieldAccessBadge({ accessField }: { accessField: AccessibleField }) {
  if (accessField.accessType === 'universal') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
        <Globe className="w-3 h-3" />
        Universal
      </span>
    )
  }

  if (accessField.accessType === 'team_member') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded">
        <Users className="w-3 h-3" />
        {accessField.teamName || 'Team'}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">
      <Eye className="w-3 h-3" />
      Viewer
    </span>
  )
}

// ============================================================================
// CUSTOM FIELD RENDERER
// ============================================================================

interface CustomFieldRendererProps {
  accessField: AccessibleField
  assetId: string
  symbol?: string
  currentPrice?: number
  viewFilter?: 'aggregated' | string
  sharedVisibility?: ContributionVisibility
  sharedTargetIds?: string[]
  // For documents field type
  notes?: any[]
  onNoteClick?: (note: any) => void
  onCreateNote?: () => void
}

// Get icon for field type
function getFieldTypeIcon(type: FieldType) {
  const icons: Record<FieldType, React.ReactNode> = {
    rich_text: <FileText className="w-4 h-4" />,
    numeric: <Hash className="w-4 h-4" />,
    date: <Calendar className="w-4 h-4" />,
    rating: <Gauge className="w-4 h-4" />,
    checklist: <CheckSquare className="w-4 h-4" />,
    excel_table: <FileText className="w-4 h-4" />,
    chart: <FileText className="w-4 h-4" />,
    documents: <FileText className="w-4 h-4" />,
    price_target: <FileText className="w-4 h-4" />,
    estimates: <FileText className="w-4 h-4" />,
    timeline: <Clock className="w-4 h-4" />,
    metric: <Gauge className="w-4 h-4" />
  }
  return icons[type] || <FileText className="w-4 h-4" />
}

function CustomFieldRenderer({
  accessField,
  assetId,
  symbol,
  currentPrice,
  viewFilter,
  sharedVisibility = 'firm',
  sharedTargetIds = [],
  notes = [],
  onNoteClick,
  onCreateNote
}: CustomFieldRendererProps) {
  const { field } = accessField
  const config = field.config as Record<string, unknown>

  // Field header with badges
  const FieldHeader = () => (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-gray-400">{getFieldTypeIcon(field.field_type)}</span>
      <h4 className="text-sm font-medium text-gray-700">{field.name}</h4>
      {accessField.accessType !== 'universal' && (
        <FieldAccessBadge accessField={accessField} />
      )}
      {accessField.isRequired && (
        <span className="inline-flex items-center gap-1 text-xs text-amber-600">
          <AlertCircle className="w-3 h-3" />
          Required
        </span>
      )}
    </div>
  )

  // Rich text field - use ContributionSection
  if (field.field_type === 'rich_text') {
    return (
      <div className="space-y-2">
        <FieldHeader />
        {field.description && (
          <p className="text-xs text-gray-500">{field.description}</p>
        )}
        <ContributionSection
          assetId={assetId}
          section={field.slug}
          title=""
          viewMode={viewFilter === 'aggregated' ? 'aggregated' : 'individual'}
          userId={viewFilter !== 'aggregated' ? viewFilter : undefined}
          defaultVisibility={sharedVisibility}
          defaultTargetIds={sharedTargetIds}
          hideTitle
          hideVisibility={true}
        />
      </div>
    )
  }

  // Checklist field
  if (field.field_type === 'checklist') {
    return (
      <div className="space-y-2">
        <FieldHeader />
        {field.description && (
          <p className="text-xs text-gray-500 mb-3">{field.description}</p>
        )}
        <ChecklistField
          fieldId={field.id}
          assetId={assetId}
          config={config as any}
        />
      </div>
    )
  }

  // Metric field
  if (field.field_type === 'metric') {
    return (
      <div className="space-y-2">
        <FieldHeader />
        {field.description && (
          <p className="text-xs text-gray-500 mb-3">{field.description}</p>
        )}
        <MetricField
          fieldId={field.id}
          assetId={assetId}
          config={config as any}
        />
      </div>
    )
  }

  // Timeline field
  if (field.field_type === 'timeline') {
    return (
      <div className="space-y-2">
        <FieldHeader />
        {field.description && (
          <p className="text-xs text-gray-500 mb-3">{field.description}</p>
        )}
        <TimelineField
          fieldId={field.id}
          assetId={assetId}
          config={config as any}
        />
      </div>
    )
  }

  // Numeric field
  if (field.field_type === 'numeric') {
    return (
      <div className="space-y-2">
        <FieldHeader />
        {field.description && (
          <p className="text-xs text-gray-500 mb-3">{field.description}</p>
        )}
        <NumericField
          fieldId={field.id}
          assetId={assetId}
          config={config as any}
        />
      </div>
    )
  }

  // Date field
  if (field.field_type === 'date') {
    return (
      <div className="space-y-2">
        <FieldHeader />
        {field.description && (
          <p className="text-xs text-gray-500 mb-3">{field.description}</p>
        )}
        <DateField
          fieldId={field.id}
          assetId={assetId}
          config={config as any}
        />
      </div>
    )
  }

  // Documents field - render document library inline
  if (field.field_type === 'documents') {
    return (
      <div className="space-y-2">
        <FieldHeader />
        {field.description && (
          <p className="text-xs text-gray-500 mb-3">{field.description}</p>
        )}
        <DocumentLibrarySection
          assetId={assetId}
          notes={notes}
          researchViewFilter={viewFilter || 'aggregated'}
          isExpanded={true}
          onToggleExpanded={() => {}}
          onNoteClick={onNoteClick ? (noteId) => onNoteClick({ id: noteId }) : undefined}
          onCreateNote={onCreateNote}
          isEmbedded={true}
        />
      </div>
    )
  }

  // Rating field - render analyst ratings section
  if (field.field_type === 'rating') {
    return (
      <div className="space-y-2">
        <FieldHeader />
        {field.description && (
          <p className="text-xs text-gray-500 mb-3">{field.description}</p>
        )}
        <AnalystRatingsSection
          assetId={assetId}
          isEditable={true}
        />
      </div>
    )
  }

  // Estimates field - render analyst estimates section
  if (field.field_type === 'estimates') {
    return (
      <div className="space-y-2">
        <FieldHeader />
        {field.description && (
          <p className="text-xs text-gray-500 mb-3">{field.description}</p>
        )}
        <AnalystEstimatesSection
          assetId={assetId}
          isEditable={true}
        />
      </div>
    )
  }

  // Price target field - render outcomes container for price targets
  if (field.field_type === 'price_target') {
    return (
      <div className="space-y-2">
        <FieldHeader />
        {field.description && (
          <p className="text-xs text-gray-500 mb-3">{field.description}</p>
        )}
        <OutcomesContainer
          assetId={assetId}
          symbol={symbol}
          currentPrice={currentPrice}
          viewFilter={viewFilter}
        />
      </div>
    )
  }

  // For other field types not yet implemented, show a placeholder
  return (
    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
      <FieldHeader />
      {field.description && (
        <p className="text-xs text-gray-500 mb-2">{field.description}</p>
      )}
      <p className="text-xs text-gray-400 italic">
        Field type "{field.field_type}" renderer coming soon
      </p>
    </div>
  )
}

// ============================================================================
// SECTION RENDERER
// ============================================================================

interface SectionRendererProps {
  layoutSection: ResearchLayoutSection
  assetId: string
  symbol?: string
  currentPrice?: number
  viewFilter?: 'aggregated' | string
  thesisViewMode?: 'all' | 'summary' | 'history' | 'references'
  sharedVisibility?: ContributionVisibility
  sharedTargetIds?: string[]
  isCollapsed: boolean
  onToggle: () => void
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
  notes?: any[]
  onNoteClick?: (note: any) => void
  onCreateNote?: () => void
}

function SectionRenderer({
  layoutSection,
  assetId,
  symbol,
  currentPrice,
  viewFilter,
  thesisViewMode = 'all',
  sharedVisibility = 'firm',
  sharedTargetIds = [],
  isCollapsed,
  onToggle,
  onNavigate,
  notes = [],
  onNoteClick,
  onCreateNote
}: SectionRendererProps) {
  const { section, fields } = layoutSection

  const customFields = fields.filter(f => !f.field.is_system)
  const contextualFieldCount = fields.filter(f => f.accessType !== 'universal').length

  // Thesis section - always render ThesisContainer (core system component)
  if (section.slug === 'thesis') {
    return (
      <Card padding="none">
        <button
          onClick={onToggle}
          className="w-full px-6 py-4 flex items-center gap-2 hover:bg-gray-50 transition-colors"
        >
          <span className="font-medium text-gray-900">{section.name}</span>
          {contextualFieldCount > 0 && (
            <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
              +{contextualFieldCount} team fields
            </span>
          )}
          {isCollapsed ? (
            <ChevronDown className="h-5 w-5 text-gray-400 ml-auto" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400 ml-auto" />
          )}
        </button>
        {!isCollapsed && (
          <div className="border-t border-gray-100 px-6 py-6 space-y-6">
            {/* Core thesis component - always render */}
            <ThesisContainer
              assetId={assetId}
              viewFilter={viewFilter}
              viewMode={thesisViewMode}
              sharedVisibility={sharedVisibility}
              sharedTargetIds={sharedTargetIds}
            />

            {/* Custom fields in thesis section */}
            {customFields.length > 0 && (
              <div className="pt-4 border-t border-gray-100 space-y-4">
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Additional Analysis
                </h4>
                {customFields.map(af => (
                  <CustomFieldRenderer
                    key={af.field.id}
                    accessField={af}
                    assetId={assetId}
                    symbol={symbol}
                    currentPrice={currentPrice}
                    viewFilter={viewFilter}
                    sharedVisibility={sharedVisibility}
                    sharedTargetIds={sharedTargetIds}
                    notes={notes}
                    onNoteClick={onNoteClick}
                    onCreateNote={onCreateNote}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    )
  }

  // Forecasts section - render fields individually as tiles
  if (section.slug === 'forecasts') {
    return (
      <Card padding="none">
        <button
          onClick={onToggle}
          className="w-full px-6 py-4 flex items-center gap-2 hover:bg-gray-50 transition-colors"
        >
          <span className="font-medium text-gray-900">{section.name}</span>
          {contextualFieldCount > 0 && (
            <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
              +{contextualFieldCount} team fields
            </span>
          )}
          {isCollapsed ? (
            <ChevronDown className="h-5 w-5 text-gray-400 ml-auto" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400 ml-auto" />
          )}
        </button>
        {!isCollapsed && (
          <div className="border-t border-gray-100 px-6 py-6 space-y-4">
            {fields.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">
                No fields configured for this section
              </p>
            ) : (
              fields.map(af => (
                <CustomFieldRenderer
                  key={af.field.id}
                  accessField={af}
                  assetId={assetId}
                  symbol={symbol}
                  currentPrice={currentPrice}
                  viewFilter={viewFilter}
                  sharedVisibility={sharedVisibility}
                  sharedTargetIds={sharedTargetIds}
                  notes={notes}
                  onNoteClick={onNoteClick}
                  onCreateNote={onCreateNote}
                />
              ))
            )}
          </div>
        )}
      </Card>
    )
  }

  // Supporting docs section - use DocumentLibrarySection
  if (section.slug === 'supporting_docs') {
    return (
      <DocumentLibrarySection
        assetId={assetId}
        notes={notes}
        researchViewFilter={viewFilter}
        isExpanded={!isCollapsed}
        onToggleExpanded={onToggle}
        onNoteClick={onNoteClick}
        onCreateNote={onCreateNote}
        onViewAllNotes={() => onNavigate?.({
          id: 'notes-list',
          title: 'Notes',
          type: 'notes-list',
          data: { initialAssetFilter: assetId }
        })}
        onViewAllFiles={() => onNavigate?.({
          id: 'files',
          title: 'Files',
          type: 'files',
          data: { initialAssetFilter: assetId }
        })}
      />
    )
  }

  // Generic section renderer for other sections (catalysts, custom sections)
  return (
    <Card padding="none">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center gap-2 hover:bg-gray-50 transition-colors"
      >
        <span className="font-medium text-gray-900">{section.name}</span>
        {contextualFieldCount > 0 && (
          <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
            +{contextualFieldCount} team fields
          </span>
        )}
        {isCollapsed ? (
          <ChevronDown className="h-5 w-5 text-gray-400 ml-auto" />
        ) : (
          <ChevronUp className="h-5 w-5 text-gray-400 ml-auto" />
        )}
      </button>
      {!isCollapsed && (
        <div className="border-t border-gray-100 px-6 py-6 space-y-4">
          {fields.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              No fields configured for this section
            </p>
          ) : (
            fields.map(af => (
              <CustomFieldRenderer
                key={af.field.id}
                accessField={af}
                assetId={assetId}
                symbol={symbol}
                currentPrice={currentPrice}
                viewFilter={viewFilter}
                sharedVisibility={sharedVisibility}
                sharedTargetIds={sharedTargetIds}
                notes={notes}
                onNoteClick={onNoteClick}
                onCreateNote={onCreateNote}
              />
            ))
          )}
        </div>
      )}
    </Card>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function DynamicResearchContainer({
  assetId,
  symbol,
  companyName,
  currentPrice,
  viewFilter = 'aggregated',
  thesisViewMode = 'all',
  sharedVisibility = 'firm',
  sharedTargetIds = [],
  collapsedSections = {},
  onToggleSection,
  onNavigate,
  notes = [],
  onNoteClick,
  onCreateNote
}: DynamicResearchContainerProps) {
  const { sections, isLoading, error, contextualFields } = useUserResearchLayout()
  const {
    fieldsWithPreferences,
    activeLayout,
    isLoading: layoutLoading
  } = useUserAssetPagePreferences(assetId)

  const [showCaseBuilder, setShowCaseBuilder] = useState(false)

  // Local collapsed state if not controlled
  const [localCollapsed, setLocalCollapsed] = useState<Record<string, boolean>>({})
  const effectiveCollapsed = onToggleSection ? collapsedSections : localCollapsed
  const handleToggle = (sectionSlug: string) => {
    if (onToggleSection) {
      onToggleSection(sectionSlug)
    } else {
      setLocalCollapsed(prev => ({ ...prev, [sectionSlug]: !prev[sectionSlug] }))
    }
  }

  // Build a set of visible field IDs from user's layout preferences
  const visibleFieldIds = new Set(
    fieldsWithPreferences
      .filter(f => f.is_visible)
      .map(f => f.field_id)
  )

  // Apply layout filtering - show ALL fields for now (no filtering)
  // System sections always show their core components
  const filteredSections = sections.filter(layoutSection => {
    const systemSections = ['thesis', 'forecasts', 'supporting_docs']
    return layoutSection.fields.length > 0 || systemSections.includes(layoutSection.section.slug)
  })

  if (isLoading || layoutLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        Failed to load research layout
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Investment Case Builder Modal */}
      {showCaseBuilder && symbol && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <InvestmentCaseBuilder
                assetId={assetId}
                symbol={symbol}
                companyName={companyName}
                currentPrice={currentPrice}
                onClose={() => setShowCaseBuilder(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Header with actions */}
      <div className="flex items-center justify-between">
        {/* Contextual fields indicator */}
        {contextualFields.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
            <Lock className="w-4 h-4" />
            <span>
              You have access to {contextualFields.length} team-specific field{contextualFields.length !== 1 ? 's' : ''} in this view
            </span>
          </div>
        )}

        {/* Investment Case Builder button */}
        {symbol && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCaseBuilder(true)}
            className="ml-auto"
          >
            <Download className="w-4 h-4 mr-1" />
            Export Case
          </Button>
        )}
      </div>

      {/* Render sections */}
      {filteredSections.map(layoutSection => (
        <SectionRenderer
          key={layoutSection.section.id}
          layoutSection={layoutSection}
          assetId={assetId}
          symbol={symbol}
          currentPrice={currentPrice}
          viewFilter={viewFilter}
          thesisViewMode={thesisViewMode}
          sharedVisibility={sharedVisibility}
          sharedTargetIds={sharedTargetIds}
          isCollapsed={effectiveCollapsed[layoutSection.section.slug] ?? false}
          onToggle={() => handleToggle(layoutSection.section.slug)}
          onNavigate={onNavigate}
          notes={notes}
          onNoteClick={onNoteClick}
          onCreateNote={onCreateNote}
        />
      ))}
    </div>
  )
}
