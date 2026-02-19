/**
 * CompositeFieldRenderer
 *
 * Renders a composite container field using react-grid-layout.
 * The layout is fixed on the asset page (non-draggable, non-resizable) —
 * the creator defines the grid in the Container Builder.
 *
 * Each widget delegates to the appropriate field component via
 * InnerWidgetRenderer, passing externalValue + onExternalSave to avoid
 * per-widget DB queries.
 */

import { useCallback, useMemo, useRef } from 'react'
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { Loader2, Link2 } from 'lucide-react'
import type { CompositeFieldConfig, CompositeWidget } from '../../lib/research/field-types'
import { useCompositeFieldContribution } from '../../hooks/useCompositeFieldContribution'
import { useFieldContribution } from './FieldTypeRenderers'
import {
  ChecklistField,
  MetricField,
  TimelineField,
  NumericField,
  DateField,
  SliderField,
  ScorecardField,
  ScenarioField,
  SpreadsheetField,
  SingleSelectField,
  MultiSelectField,
  BooleanField,
  PercentageField,
  CurrencyField,
  TableField,
  ChartField,
} from './FieldTypeRenderers'
import { ContributionSection } from '../contributions/ContributionSection'
import type { ResearchField } from '../../hooks/useResearchFields'

// ── Row height in px — controls grid density ──
const ROW_HEIGHT = 60

// ============================================================================
// INNER WIDGET RENDERER
// ============================================================================

interface InnerWidgetRendererProps {
  widget: CompositeWidget
  fieldId: string
  assetId: string
  value: Record<string, unknown>
  onSave: (metadata: Record<string, unknown>) => Promise<void>
  readOnly?: boolean
}

function InnerWidgetRenderer({
  widget,
  fieldId,
  assetId,
  value,
  onSave,
  readOnly,
}: InnerWidgetRendererProps) {
  const common = {
    fieldId,
    assetId,
    config: widget.config as any,
    readOnly,
    externalValue: value,
    onExternalSave: onSave,
  }

  switch (widget.type) {
    case 'rich_text':
      return (
        <ContributionSection
          assetId={assetId}
          section={`composite-${fieldId}-${widget.id}`}
          title=""
          viewMode="individual"
          hideVisibility
        />
      )
    case 'checklist':
      return <ChecklistField {...common} />
    case 'metric':
      return <MetricField {...common} />
    case 'timeline':
      return <TimelineField {...common} />
    case 'numeric':
      return <NumericField {...common} />
    case 'date':
      return <DateField {...common} />
    case 'slider':
      return <SliderField {...common} />
    case 'scorecard':
      return <ScorecardField {...common} />
    case 'scenario':
      return <ScenarioField {...common} />
    case 'spreadsheet':
      return <SpreadsheetField {...common} />
    case 'single_select':
      return <SingleSelectField {...common} />
    case 'multi_select':
      return <MultiSelectField {...common} />
    case 'boolean':
      return <BooleanField {...common} />
    case 'percentage':
      return <PercentageField {...common} />
    case 'currency':
      return <CurrencyField {...common} />
    case 'table':
      return <TableField {...common} />
    case 'chart':
      return <ChartField {...common} />
    default:
      return (
        <div className="text-xs text-gray-400 italic py-2">
          Unknown widget type: {widget.type}
        </div>
      )
  }
}

// ============================================================================
// LINKED WIDGET RENDERER
// ============================================================================

function LinkedWidgetRenderer({ widget, assetId, readOnly }: {
  widget: CompositeWidget
  assetId: string
  readOnly?: boolean
}) {
  const { contribution, isLoading, saveContribution } =
    useFieldContribution(widget.linked_field_id!, assetId)

  if (isLoading) return <Loader2 className="w-4 h-4 animate-spin text-gray-300" />

  // Rich text linked widgets use ContributionSection with the linked field's
  // section key so contributions go to the real field
  if (widget.type === 'rich_text') {
    return (
      <ContributionSection
        assetId={assetId}
        section={widget.linked_field_id!}
        title=""
        viewMode="individual"
        hideVisibility
      />
    )
  }

  // All other types: delegate to InnerWidgetRenderer with the linked field's data
  const value = contribution?.metadata ?? {}
  const onSave = async (metadata: Record<string, unknown>) => {
    await saveContribution.mutateAsync({ metadata })
  }

  return (
    <InnerWidgetRenderer
      widget={widget}
      fieldId={widget.linked_field_id!}
      assetId={assetId}
      value={value}
      onSave={onSave}
      readOnly={readOnly}
    />
  )
}

// ============================================================================
// COMPOSITE FIELD RENDERER
// ============================================================================

interface CompositeFieldRendererProps {
  field: ResearchField
  assetId: string
  readOnly?: boolean
}

export function CompositeFieldRenderer({
  field,
  assetId,
  readOnly = false,
}: CompositeFieldRendererProps) {
  const config = field.config as unknown as CompositeFieldConfig | undefined
  const containerRef = useRef<HTMLDivElement>(null)
  const width = useContainerWidth(containerRef)

  const { isLoading, getWidgetValue, saveWidgetValue } =
    useCompositeFieldContribution(field.id, assetId)

  // Build widget map for O(1) lookup
  const widgetMap = useMemo(() => {
    const map = new Map<string, CompositeWidget>()
    for (const w of config?.widgets ?? []) map.set(w.id, w)
    return map
  }, [config?.widgets])

  // Build layout for react-grid-layout
  const gridLayout = useMemo(
    () =>
      (config?.layout ?? []).map((l) => ({
        ...l,
        static: true, // non-draggable, non-resizable on asset page
      })),
    [config?.layout],
  )

  const handleSaveWidget = useCallback(
    (widgetId: string) => async (metadata: Record<string, unknown>) => {
      await saveWidgetValue(widgetId, metadata)
    },
    [saveWidgetValue],
  )

  if (!config || !config.widgets?.length) {
    return (
      <div className="text-sm text-gray-400 italic py-4">
        This container has no widgets configured.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div ref={containerRef}>
      {width > 0 && (
        <ResponsiveGridLayout
          className="composite-grid"
          layouts={{ lg: gridLayout }}
          breakpoints={{ lg: 0 }}
          cols={{ lg: config.cols || 12 }}
          rowHeight={ROW_HEIGHT}
          width={width}
          isDraggable={false}
          isResizable={false}
          compactType="vertical"
          margin={[12, 12]}
          containerPadding={[0, 0]}
        >
          {gridLayout.map((item) => {
            const widget = widgetMap.get(item.i)
            if (!widget) return <div key={item.i} />
            const isLinked = !!widget.linked_field_id
            return (
              <div key={item.i} className="overflow-auto">
                {widget.label && (
                  <div className="text-xs font-medium text-gray-500 mb-1 truncate flex items-center gap-1">
                    {widget.label}
                    {isLinked && <Link2 className="w-3 h-3 text-primary-400" />}
                  </div>
                )}
                {isLinked ? (
                  <LinkedWidgetRenderer widget={widget} assetId={assetId} readOnly={readOnly} />
                ) : (
                  <InnerWidgetRenderer
                    widget={widget}
                    fieldId={field.id}
                    assetId={assetId}
                    value={getWidgetValue(widget.id)}
                    onSave={handleSaveWidget(widget.id)}
                    readOnly={readOnly}
                  />
                )}
              </div>
            )
          })}
        </ResponsiveGridLayout>
      )}
    </div>
  )
}
