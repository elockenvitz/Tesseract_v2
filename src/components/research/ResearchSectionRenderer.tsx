/**
 * ResearchSectionRenderer Component
 *
 * Renders a research section based on its type/slug.
 * Handles special sections (thesis, forecasts, supporting_docs) and generic sections.
 */

import { memo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Card } from '../ui/Card'
import { ThesisContainer, ContributionSection } from '../contributions'
import { OutcomesContainer, AnalystRatingsSection, AnalystEstimatesSection } from '../outcomes'
import {
  ChecklistField,
  MetricField,
  TimelineField,
  NumericField,
  DateField
} from './FieldTypeRenderers'
import { KeyReferencesSection, ModelVersionHistory } from '../contributions'
import { useAssetModels } from '../../hooks/useAssetModels'
import type { FieldWithPreference } from '../../hooks/useUserAssetPagePreferences'

interface SectionData {
  section_id: string
  section_name: string
  section_slug: string
  section_display_order: number
  section_is_hidden: boolean
  section_is_added: boolean
  fields: FieldWithPreference[]
}

interface ResearchSectionRendererProps {
  section: SectionData
  assetId: string
  assetSymbol?: string
  currentPrice?: number
  isCollapsed: boolean
  onToggleCollapsed: () => void
  viewFilter: 'aggregated' | string
  sharedVisibility?: 'private' | 'team' | 'firm'
  sharedTargetIds?: string[]
  onNavigate?: (tab: any) => void
  // For document library section
  notes?: any[]
  onNoteClick?: (noteId: string) => void
  onCreateNote?: () => void
  onViewAllNotes?: () => void
  onViewAllFiles?: () => void
  // For thesis section
  thesisViewMode?: 'compact' | 'detailed'
  // Loading state
  isLayoutLoading?: boolean
}

// Inline Key References wrapper for ResearchSectionRenderer
function ResearchKeyReferencesInline({
  assetId,
  isCollapsed,
  onToggle,
  notes,
  onCreateNote
}: {
  assetId: string
  isCollapsed: boolean
  onToggle: () => void
  notes?: any[]
  onCreateNote?: () => void
}) {
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const { models } = useAssetModels(assetId)
  const selectedModel = selectedModelId ? models.find(m => m.id === selectedModelId) : null

  return (
    <>
      <KeyReferencesSection
        assetId={assetId}
        isExpanded={!isCollapsed}
        onToggleExpanded={onToggle}
        onViewModelHistory={(modelId) => { setSelectedModelId(modelId); setShowVersionHistory(true) }}
        onCreateNote={onCreateNote}
        notes={notes}
      />
      {selectedModel && (
        <ModelVersionHistory
          isOpen={showVersionHistory}
          onClose={() => { setShowVersionHistory(false); setSelectedModelId(null) }}
          modelId={selectedModel.id}
          assetId={assetId}
          modelName={selectedModel.name}
          currentVersion={selectedModel.version}
        />
      )}
    </>
  )
}

export const ResearchSectionRenderer = memo(function ResearchSectionRenderer({
  section,
  assetId,
  assetSymbol,
  currentPrice,
  isCollapsed,
  onToggleCollapsed,
  viewFilter,
  sharedVisibility = 'private',
  sharedTargetIds = [],
  onNavigate,
  notes = [],
  onNoteClick,
  onCreateNote,
  onViewAllNotes,
  onViewAllFiles,
  thesisViewMode = 'detailed',
  isLayoutLoading = false
}: ResearchSectionRendererProps) {
  // Don't render hidden sections
  if (section.section_is_hidden) {
    return null
  }

  // Check if section has any visible fields
  const hasVisibleFields = section.fields.some(f => f.is_visible)

  // For non-special sections, don't render if no visible fields
  const specialSections = ['thesis', 'forecasts']
  if (!specialSections.includes(section.section_slug) && !hasVisibleFields) {
    return null
  }

  // For ContributionSection: activeTab is either 'aggregated' or a user ID
  const activeTab = viewFilter

  // Render section header
  const renderHeader = () => (
    <button
      onClick={onToggleCollapsed}
      className="w-full px-5 py-2.5 flex items-center gap-2 hover:bg-gray-50 transition-colors"
    >
      <span className="font-medium text-gray-900">{section.section_name}</span>
      {isCollapsed ? (
        <ChevronDown className="h-5 w-5 text-gray-400" />
      ) : (
        <ChevronUp className="h-5 w-5 text-gray-400" />
      )}
    </button>
  )

  // Consistent field wrapper styling to match ContributionSection
  const fieldWrapperClass = "bg-white border border-gray-200 rounded-lg p-3 space-y-2"

  // Render field based on type
  const renderField = (field: FieldWithPreference) => {
    if (!field.is_visible) return null

    const fieldType = field.field_type

    // Checklist field
    if (fieldType === 'checklist') {
      return (
        <div key={field.field_id} className={fieldWrapperClass}>
          <div className="flex items-baseline gap-3">
            <h4 className="text-base font-semibold text-gray-900">{field.field_name}</h4>
            {field.field_description && (
              <p className="text-sm text-gray-500">{field.field_description}</p>
            )}
          </div>
          <ChecklistField
            fieldId={field.field_id}
            assetId={assetId}
            config={{}}
          />
        </div>
      )
    }

    // Metric field
    if (fieldType === 'metric') {
      return (
        <div key={field.field_id} className={fieldWrapperClass}>
          <div className="flex items-baseline gap-3">
            <h4 className="text-base font-semibold text-gray-900">{field.field_name}</h4>
            {field.field_description && (
              <p className="text-sm text-gray-500">{field.field_description}</p>
            )}
          </div>
          <MetricField
            fieldId={field.field_id}
            assetId={assetId}
            config={{}}
          />
        </div>
      )
    }

    // Timeline field
    if (fieldType === 'timeline') {
      return (
        <div key={field.field_id} className={fieldWrapperClass}>
          <div className="flex items-baseline gap-3">
            <h4 className="text-base font-semibold text-gray-900">{field.field_name}</h4>
            {field.field_description && (
              <p className="text-sm text-gray-500">{field.field_description}</p>
            )}
          </div>
          <TimelineField
            fieldId={field.field_id}
            assetId={assetId}
            config={{}}
          />
        </div>
      )
    }

    // Numeric field
    if (fieldType === 'numeric') {
      return (
        <div key={field.field_id} className={fieldWrapperClass}>
          <div className="flex items-baseline gap-3">
            <h4 className="text-base font-semibold text-gray-900">{field.field_name}</h4>
            {field.field_description && (
              <p className="text-sm text-gray-500">{field.field_description}</p>
            )}
          </div>
          <NumericField
            fieldId={field.field_id}
            assetId={assetId}
            config={{}}
          />
        </div>
      )
    }

    // Date field
    if (fieldType === 'date') {
      return (
        <div key={field.field_id} className={fieldWrapperClass}>
          <div className="flex items-baseline gap-3">
            <h4 className="text-base font-semibold text-gray-900">{field.field_name}</h4>
            {field.field_description && (
              <p className="text-sm text-gray-500">{field.field_description}</p>
            )}
          </div>
          <DateField
            fieldId={field.field_id}
            assetId={assetId}
            config={{}}
          />
        </div>
      )
    }

    // Rating field - render analyst ratings section
    if (fieldType === 'rating') {
      return (
        <div key={field.field_id} className={fieldWrapperClass}>
          <div className="flex items-baseline gap-3">
            <h4 className="text-base font-semibold text-gray-900">{field.field_name}</h4>
            {field.field_description && (
              <p className="text-sm text-gray-500">{field.field_description}</p>
            )}
          </div>
          <AnalystRatingsSection
            assetId={assetId}
            isEditable={true}
            embedded={true}
          />
        </div>
      )
    }

    // Estimates field - render analyst estimates section
    if (fieldType === 'estimates') {
      return (
        <div key={field.field_id} className={fieldWrapperClass}>
          <div className="flex items-baseline gap-3">
            <h4 className="text-base font-semibold text-gray-900">{field.field_name}</h4>
            {field.field_description && (
              <p className="text-sm text-gray-500">{field.field_description}</p>
            )}
          </div>
          <AnalystEstimatesSection
            assetId={assetId}
            isEditable={true}
            embedded={true}
          />
        </div>
      )
    }

    // Price target field - render outcomes container for price targets
    if (fieldType === 'price_target') {
      return (
        <div key={field.field_id} className={fieldWrapperClass}>
          <div className="flex items-baseline gap-3">
            <h4 className="text-base font-semibold text-gray-900">{field.field_name}</h4>
            {field.field_description && (
              <p className="text-sm text-gray-500">{field.field_description}</p>
            )}
          </div>
          <OutcomesContainer
            assetId={assetId}
            symbol={assetSymbol}
            currentPrice={currentPrice}
            viewFilter={viewFilter}
          />
        </div>
      )
    }

    // Default: rich_text or other text-based fields use ContributionSection
    // Match the styling of Investment Thesis, Where We Are Different, and Risks to Thesis
    return (
      <ContributionSection
        key={field.field_id}
        assetId={assetId}
        section={field.field_slug}
        title={field.field_name}
        description={field.field_description || undefined}
        activeTab={activeTab}
        defaultVisibility={sharedVisibility}
        hideViewModeButtons={true}
        hideVisibility={true}
        sharedVisibility={sharedVisibility}
        sharedTargetIds={sharedTargetIds}
      />
    )
  }

  // Special section: Thesis
  if (section.section_slug === 'thesis') {
    return (
      <Card padding="none">
        {renderHeader()}
        {!isCollapsed && (
          <div className="border-t border-gray-100 px-5 py-1.5">
            {isLayoutLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-1/4 mb-3" />
                    <div className="h-24 bg-gray-100 rounded" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <ThesisContainer
                  assetId={assetId}
                  viewFilter={viewFilter}
                  viewMode={thesisViewMode}
                  sharedVisibility={sharedVisibility}
                  sharedTargetIds={sharedTargetIds}
                />
                {/* Additional custom fields in thesis section */}
                {section.fields
                  .filter(f => f.is_visible && !['thesis', 'where_different', 'risks_to_thesis'].includes(f.field_slug))
                  .map(renderField)}
              </div>
            )}
          </div>
        )}
      </Card>
    )
  }

  // Special section: Forecasts/Outcomes - render fields individually as tiles
  if (section.section_slug === 'forecasts') {
    return (
      <Card padding="none">
        {renderHeader()}
        {!isCollapsed && (
          <div className="border-t border-gray-100 px-5 py-1.5 space-y-4">
            {section.fields
              .filter(f => f.is_visible)
              .map(renderField)}
          </div>
        )}
      </Card>
    )
  }

  // Key References has its own dedicated view tab — skip in layout
  if (section.section_slug === 'supporting_docs') {
    return null
  }

  // Generic section: render all visible fields
  return (
    <Card padding="none">
      {renderHeader()}
      {!isCollapsed && (
        <div className="border-t border-gray-100 px-5 py-1.5 space-y-4">
          {section.fields
            .filter(f => f.is_visible)
            .map(renderField)}
        </div>
      )}
    </Card>
  )
})
