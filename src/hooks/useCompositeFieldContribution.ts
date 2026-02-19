import { useCallback } from 'react'
import { useFieldContribution } from '../components/research/FieldTypeRenderers'

/**
 * Wraps useFieldContribution to provide per-widget value access
 * for composite container fields.
 *
 * Composite field contributions store all widget values in a single
 * `field_contributions.metadata` object keyed by widget ID:
 * ```json
 * { "w-abc": { "value": 42 }, "w-def": { "selected": "hold" } }
 * ```
 */
export function useCompositeFieldContribution(fieldId: string, assetId: string) {
  const { contribution, isLoading, saveContribution, isSaving } =
    useFieldContribution(fieldId, assetId)

  const getWidgetValue = useCallback(
    (widgetId: string): Record<string, unknown> => {
      const meta = contribution?.metadata ?? {}
      return (meta[widgetId] as Record<string, unknown>) ?? {}
    },
    [contribution?.metadata],
  )

  const saveWidgetValue = useCallback(
    async (widgetId: string, widgetMetadata: Record<string, unknown>) => {
      const existing = contribution?.metadata ?? {}
      await saveContribution.mutateAsync({
        metadata: { ...existing, [widgetId]: widgetMetadata },
      })
    },
    [contribution?.metadata, saveContribution],
  )

  return {
    contribution,
    isLoading,
    isSaving,
    getWidgetValue,
    saveWidgetValue,
  }
}
