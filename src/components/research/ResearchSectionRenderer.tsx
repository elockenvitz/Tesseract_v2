/**
 * ResearchSectionRenderer Component
 *
 * Renders a research section based on its type/slug.
 * Handles special sections (thesis, forecasts, supporting_docs) and generic sections.
 */

import { memo } from 'react'
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
import { DocumentLibrarySection } from '../documents/DocumentLibrarySection'
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
  const specialSections = ['thesis', 'forecasts', 'supporting_docs']
  if (!specialSections.includes(section.section_slug) && !hasVisibleFields) {
    return null
  }

  // For ContributionSection: activeTab is either 'aggregated' or a user ID
  const activeTab = viewFilter

  // Render section header
  const renderHeader = () => (
    <button
      onClick={onToggleCollapsed}
      className="w-full px-6 py-4 flex items-center gap-2 hover:bg-gray-50 transition-colors"
    >
      <span className="font-medium text-gray-900">{section.section_name}</span>
      {isCollapsed ? (
        <ChevronDown className="h-5 w-5 text-gray-400" />
      ) : (
        <ChevronUp className="h-5 w-5 text-gray-400" />
      )}
    </button>
  )

  // Render field based on type
  const renderField = (field: FieldWithPreference) => {
    if (!field.is_visible) return null

    const fieldType = field.field_type

    // Checklist field
    if (fieldType === 'checklist') {
      return (
        <div key={field.field_id} className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">{field.field_name}</h4>
          {field.field_description && (
            <p className="text-xs text-gray-500">{field.field_description}</p>
          )}
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
        <div key={field.field_id} className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">{field.field_name}</h4>
          {field.field_description && (
            <p className="text-xs text-gray-500">{field.field_description}</p>
          )}
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
        <div key={field.field_id} className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">{field.field_name}</h4>
          {field.field_description && (
            <p className="text-xs text-gray-500">{field.field_description}</p>
          )}
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
        <div key={field.field_id} className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">{field.field_name}</h4>
          {field.field_description && (
            <p className="text-xs text-gray-500">{field.field_description}</p>
          )}
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
        <div key={field.field_id} className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">{field.field_name}</h4>
          {field.field_description && (
            <p className="text-xs text-gray-500">{field.field_description}</p>
          )}
          <DateField
            fieldId={field.field_id}
            assetId={assetId}
            config={{}}
          />
        </div>
      )
    }

    // Documents field - render document library inline
    if (fieldType === 'documents') {
      return (
        <div key={field.field_id} className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">{field.field_name}</h4>
          {field.field_description && (
            <p className="text-xs text-gray-500">{field.field_description}</p>
          )}
          <DocumentLibrarySection
            assetId={assetId}
            notes={notes}
            researchViewFilter={viewFilter}
            isExpanded={true}
            onToggleExpanded={() => {}}
            onNoteClick={onNoteClick}
            onCreateNote={onCreateNote}
            onViewAllNotes={onViewAllNotes}
            onViewAllFiles={onViewAllFiles}
            isEmbedded={true}
          />
        </div>
      )
    }

    // Rating field - render analyst ratings section
    if (fieldType === 'rating') {
      return (
        <div key={field.field_id} className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">{field.field_name}</h4>
          {field.field_description && (
            <p className="text-xs text-gray-500">{field.field_description}</p>
          )}
          <AnalystRatingsSection
            assetId={assetId}
            isEditable={true}
          />
        </div>
      )
    }

    // Estimates field - render analyst estimates section
    if (fieldType === 'estimates') {
      return (
        <div key={field.field_id} className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">{field.field_name}</h4>
          {field.field_description && (
            <p className="text-xs text-gray-500">{field.field_description}</p>
          )}
          <AnalystEstimatesSection
            assetId={assetId}
            isEditable={true}
          />
        </div>
      )
    }

    // Price target field - render outcomes container for price targets
    if (fieldType === 'price_target') {
      return (
        <div key={field.field_id} className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">{field.field_name}</h4>
          {field.field_description && (
            <p className="text-xs text-gray-500">{field.field_description}</p>
          )}
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
          <div className="border-t border-gray-100 px-6 py-6">
            {isLayoutLoading ? (
              <div className="space-y-6">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-1/4 mb-3" />
                    <div className="h-24 bg-gray-100 rounded" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                <ThesisContainer
                  assetId={assetId}
                  viewFilter={viewFilter}
                  viewMode={thesisViewMode}
                  sharedVisibility={sharedVisibility}
                  sharedTargetIds={sharedTargetIds}
                />
                {/* Additional custom fields in thesis section */}
                {section.fields
                  .filter(f => f.is_visible && !['investment_thesis', 'key_points', 'key_risks'].includes(f.field_slug))
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
          <div className="border-t border-gray-100 px-6 py-6 space-y-4">
            {section.fields
              .filter(f => f.is_visible)
              .map(renderField)}
          </div>
        )}
      </Card>
    )
  }

  // Special section: Supporting Documents
  if (section.section_slug === 'supporting_docs') {
    return (
      <DocumentLibrarySection
        assetId={assetId}
        notes={notes}
        researchViewFilter={viewFilter}
        isExpanded={!isCollapsed}
        onToggleExpanded={onToggleCollapsed}
        onNoteClick={onNoteClick}
        onCreateNote={onCreateNote}
        onViewAllNotes={onViewAllNotes}
        onViewAllFiles={onViewAllFiles}
      />
    )
  }

  // Generic section: render all visible fields
  return (
    <Card padding="none">
      {renderHeader()}
      {!isCollapsed && (
        <div className="border-t border-gray-100 px-6 py-6 space-y-4">
          {section.fields
            .filter(f => f.is_visible)
            .map(renderField)}
        </div>
      )}
    </Card>
  )
})
