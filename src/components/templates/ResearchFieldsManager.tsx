/**
 * ResearchFieldsManager Component
 *
 * Allows users to manage their research layout templates.
 * Users can create multiple layouts, reorder sections and fields,
 * create custom sections, and add fields from the library.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { normalizePresetFieldId, SYSTEM_DEFAULT_FIELD_SLUGS } from '../../lib/research/layout-resolver'
import { clsx } from 'clsx'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  MeasuringStrategy
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronLeft,
  Plus,
  Save,
  Trash2,
  Check,
  Loader2,
  Star,
  FileText,
  Hash,
  Calendar,
  CheckSquare,
  Clock,
  Gauge,
  Edit2,
  Copy,
  HelpCircle,
  GripVertical,
  FolderPlus,
  Library,
  X,
  Share2,
  MoreHorizontal,
  Search,
  Building2,
  Users,
  User,
  Shield,
  AlertTriangle,
  Eye,
  Layers,
  Lock,
  List,
  ListChecks,
  ToggleLeft,
  Percent,
  DollarSign,
  Table2,
  GitBranch,
  Info,
  LayoutGrid,
  TrendingUp,
  Link2,
  BarChart3,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import {
  useUserAssetPagePreferences,
  useUserAssetPageLayouts,
  useLayoutUsageMetrics,
  useLayoutCollabSummaries,
  useAffectedAssets,
  type AffectedAsset,
  type FieldWithPreference,
  type FieldConfigItem,
  type SavedLayout,
  type LayoutWithSharing
} from '../../hooks/useUserAssetPagePreferences'
import { useResearchFieldPresets, useResearchSections, useResearchFields } from '../../hooks/useResearchFields'
import {
  getDefaultConfig,
  isConfigurableFieldType,
  WIDGET_GALLERY,
  WIDGET_GALLERY_MAP,
  COMPOSITE_GALLERY_ITEM,
  ENABLE_FIELD_GROUPS,
  FIELD_NAME_MAX_LENGTH,
  compositeConfigSchema,
  type CompositeWidget,
  type CompositeFieldConfig,
} from '../../lib/research/field-types'
import { supabase } from '../../lib/supabase'
import { ResponsiveGridLayout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { useAuth } from '../../hooks/useAuth'
import { LayoutSharingModal } from './LayoutSharingModal'
import {
  mapLayoutCards,
  buildUsageSummary,
  filterCards,
  groupCardsByScope,
  getPermissionLabel,
  getDefaultIndicator,
  getDisabledReason,
  getScopeTooltip,
  getSpecContextLine,
  DEFAULT_FILTER_STATE,
  type LayoutTemplateCardModel,
  type CardFilterState,
  type LayoutScope,
  type ScopeFilter,
  type CardSortKey,
} from '../../lib/research/layout-card-model'

// ============================================================================
// TYPES
// ============================================================================

interface SectionConfig {
  section_id: string
  section_name: string
  section_slug: string
  display_order: number
  is_system: boolean
  fields: FieldConfig[]
}

interface FieldConfig {
  field_id: string
  field_name: string
  field_slug: string
  field_type: string
  is_visible: boolean
  display_order: number
  is_system: boolean
}

// ============================================================================
// FIELD TYPE ICON
// ============================================================================

function FieldTypeIcon({ type, className }: { type: string; className?: string }) {
  const icons: Record<string, React.ReactNode> = {
    rich_text: <FileText className={className} />,
    numeric: <Hash className={className} />,
    date: <Calendar className={className} />,
    checklist: <CheckSquare className={className} />,
    timeline: <Clock className={className} />,
    metric: <Gauge className={className} />,
    single_select: <List className={className} />,
    multi_select: <ListChecks className={className} />,
    boolean: <ToggleLeft className={className} />,
    percentage: <Percent className={className} />,
    currency: <DollarSign className={className} />,
    table: <Table2 className={className} />,
    rating: <Star className={className} />,
    scenario: <GitBranch className={className} />,
    chart: <BarChart3 className={className} />,
    composite: <LayoutGrid className={className} />
  }
  return <>{icons[type] || <FileText className={className} />}</>
}

// ============================================================================
// CONTAINER PRESETS
// ============================================================================

const CONTAINER_PRESETS = [
  {
    key: 'valuation',
    label: 'Valuation',
    description: 'Price Target + key multiples + conviction',
    icon: DollarSign,
    widgets: [
      { id: 'w-pt', type: 'currency', label: 'Price Target', config: { currency_code: 'USD' } },
      { id: 'w-eveb', type: 'numeric', label: 'EV/EBITDA', config: {} },
      { id: 'w-pe', type: 'numeric', label: 'P/E', config: {} },
      { id: 'w-conviction', type: 'single_select', label: 'Conviction', config: { options: ['High', 'Medium', 'Low'] } },
    ],
    layout: [
      { i: 'w-pt', x: 0, y: 0, w: 6, h: 2 },
      { i: 'w-conviction', x: 6, y: 0, w: 6, h: 2 },
      { i: 'w-eveb', x: 0, y: 2, w: 6, h: 2 },
      { i: 'w-pe', x: 6, y: 2, w: 6, h: 2 },
    ],
  },
  {
    key: 'risk',
    label: 'Risk Assessment',
    description: 'Risk rating + checklist + scoring',
    icon: AlertTriangle,
    widgets: [
      { id: 'w-rating', type: 'rating', label: 'Risk Rating', config: { min: 1, max: 5, step: 1 } },
      { id: 'w-checks', type: 'checklist', label: 'Risk Factors', config: {} },
      { id: 'w-impact', type: 'single_select', label: 'Impact Level', config: { options: ['Critical', 'High', 'Medium', 'Low'] } },
    ],
    layout: [
      { i: 'w-rating', x: 0, y: 0, w: 4, h: 2 },
      { i: 'w-checks', x: 4, y: 0, w: 8, h: 4 },
      { i: 'w-impact', x: 0, y: 2, w: 4, h: 2 },
    ],
  },
  {
    key: 'thesis-kpis',
    label: 'KPI Dashboard',
    description: 'Key metrics with conviction + upside',
    icon: Gauge,
    widgets: [
      { id: 'w-conviction', type: 'single_select', label: 'Conviction', config: { options: ['High', 'Medium', 'Low'] } },
      { id: 'w-upside', type: 'percentage', label: 'Upside %', config: { min: -100, max: 500, decimals: 1 } },
      { id: 'w-rating', type: 'rating', label: 'Quality Score', config: { min: 1, max: 5, step: 1 } },
      { id: 'w-timeline', type: 'timeline', label: 'Key Dates', config: {} },
    ],
    layout: [
      { i: 'w-conviction', x: 0, y: 0, w: 6, h: 2 },
      { i: 'w-upside', x: 6, y: 0, w: 6, h: 2 },
      { i: 'w-rating', x: 0, y: 2, w: 6, h: 2 },
      { i: 'w-timeline', x: 6, y: 2, w: 6, h: 2 },
    ],
  },
  {
    key: 'scenario-view',
    label: 'Scenario Analysis',
    description: 'Scenario table with probability weighting',
    icon: GitBranch,
    widgets: [
      { id: 'w-scenario', type: 'scenario', label: 'Scenarios', config: {
        scenarios: [{ key: 'bear', label: 'Bear' }, { key: 'base', label: 'Base' }, { key: 'bull', label: 'Bull' }],
        metrics: [{ key: 'price', label: 'Price Target', type: 'currency' }, { key: 'prob', label: 'Probability', type: 'percentage' }],
      }},
      { id: 'w-expected', type: 'currency', label: 'Expected Value', config: { currency_code: 'USD' } },
    ],
    layout: [
      { i: 'w-scenario', x: 0, y: 0, w: 8, h: 4 },
      { i: 'w-expected', x: 8, y: 0, w: 4, h: 2 },
    ],
  },
] as const

// ============================================================================
// BUILDER WIDGET CELL
// ============================================================================

const WIDGET_TYPE_COLORS: Record<string, { bg: string; border: string; accent: string }> = {
  rich_text:     { bg: 'bg-blue-50/60',    border: 'border-l-blue-400',    accent: 'text-blue-600' },
  numeric:       { bg: 'bg-emerald-50/60',  border: 'border-l-emerald-400', accent: 'text-emerald-600' },
  currency:      { bg: 'bg-emerald-50/60',  border: 'border-l-emerald-400', accent: 'text-emerald-600' },
  percentage:    { bg: 'bg-emerald-50/60',  border: 'border-l-emerald-400', accent: 'text-emerald-600' },
  checklist:     { bg: 'bg-amber-50/60',    border: 'border-l-amber-400',   accent: 'text-amber-600' },
  rating:        { bg: 'bg-amber-50/60',    border: 'border-l-amber-400',   accent: 'text-amber-600' },
  single_select: { bg: 'bg-purple-50/60',   border: 'border-l-purple-400',  accent: 'text-purple-600' },
  multi_select:  { bg: 'bg-purple-50/60',   border: 'border-l-purple-400',  accent: 'text-purple-600' },
  boolean:       { bg: 'bg-purple-50/60',   border: 'border-l-purple-400',  accent: 'text-purple-600' },
  scenario:      { bg: 'bg-rose-50/60',     border: 'border-l-rose-400',    accent: 'text-rose-600' },
  table:         { bg: 'bg-rose-50/60',     border: 'border-l-rose-400',    accent: 'text-rose-600' },
  timeline:      { bg: 'bg-cyan-50/60',     border: 'border-l-cyan-400',    accent: 'text-cyan-600' },
  metric:        { bg: 'bg-cyan-50/60',     border: 'border-l-cyan-400',    accent: 'text-cyan-600' },
  date:          { bg: 'bg-cyan-50/60',     border: 'border-l-cyan-400',    accent: 'text-cyan-600' },
  chart:         { bg: 'bg-indigo-50/60',   border: 'border-l-indigo-400',  accent: 'text-indigo-600' },
}
const DEFAULT_WIDGET_COLORS = { bg: 'bg-gray-50/60', border: 'border-l-gray-400', accent: 'text-gray-600' }

/** Static preview mockup for each widget type — mirrors real renderer visuals */
function WidgetPreviewMockup({ type, config }: { type: string; config?: Record<string, unknown> }) {
  switch (type) {
    case 'rich_text':
      return (
        <div className="space-y-1.5 px-1">
          <div className="h-2 bg-gray-200 rounded w-full" />
          <div className="h-2 bg-gray-200 rounded w-[90%]" />
          <div className="h-2 bg-gray-200 rounded w-[75%]" />
          <div className="h-2 bg-gray-100 rounded w-[60%]" />
        </div>
      )
    case 'checklist':
      return (
        <div className="space-y-1 px-1">
          {['Due diligence review', 'Management call', 'Model update'].map((t, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className={clsx('w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center', i === 0 ? 'bg-green-500 border-green-500' : 'border-gray-300')}>
                {i === 0 && <Check className="w-2 h-2 text-white" />}
              </div>
              <span className={clsx('text-[10px]', i === 0 ? 'line-through text-gray-400' : 'text-gray-600')}>{t}</span>
            </div>
          ))}
        </div>
      )
    case 'numeric':
      return (
        <div className="flex items-center gap-2 px-1">
          <span className="text-lg font-bold text-gray-800">8.5</span>
          <span className="text-[10px] text-gray-400">x</span>
        </div>
      )
    case 'metric':
      return (
        <div className="p-1.5 bg-gray-50 rounded">
          <div className="text-lg font-bold text-gray-800">24.3%</div>
          <div className="flex items-center gap-1 mt-0.5">
            <TrendingUp className="w-3 h-3 text-green-500" />
            <span className="text-[10px] text-green-600">+2.1%</span>
          </div>
        </div>
      )
    case 'percentage':
      return (
        <div className="p-1.5 bg-gray-50 rounded">
          <div className="text-lg font-bold text-gray-800">65.0%</div>
          <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1">
            <div className="h-full bg-primary-500 rounded-full" style={{ width: '65%' }} />
          </div>
        </div>
      )
    case 'currency':
      return (
        <div className="p-1.5 bg-gray-50 rounded">
          <div className="text-lg font-bold text-gray-800">$150.00</div>
          <span className="text-[10px] text-gray-400">{(config?.currency_code as string) || 'USD'}</span>
        </div>
      )
    case 'date':
      return (
        <div className="flex items-center gap-1.5 px-1">
          <Calendar className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-sm text-gray-700">Feb 28, 2026</span>
        </div>
      )
    case 'timeline':
      return (
        <div className="space-y-1 px-1">
          {[{ d: 'Mar 15', t: 'Earnings', c: 'text-blue-600' }, { d: 'Apr 01', t: 'Catalyst', c: 'text-amber-600' }].map((e, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
              <span className="text-[10px] text-gray-400 w-10 flex-shrink-0">{e.d}</span>
              <span className={clsx('text-[10px] font-medium', e.c)}>{e.t}</span>
            </div>
          ))}
        </div>
      )
    case 'single_select': {
      const opts = (config?.options as string[]) ?? ['Option 1', 'Option 2', 'Option 3']
      return (
        <div className="space-y-1 px-1">
          {opts.slice(0, 3).map((opt, i) => (
            <div key={i} className={clsx('flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px]', i === 0 ? 'bg-primary-50 border border-primary-200 text-primary-700' : 'bg-gray-50 border border-gray-200 text-gray-500')}>
              <div className={clsx('w-2.5 h-2.5 rounded-full border-2 flex items-center justify-center flex-shrink-0', i === 0 ? 'border-primary-500' : 'border-gray-300')}>
                {i === 0 && <div className="w-1 h-1 rounded-full bg-primary-500" />}
              </div>
              {opt}
            </div>
          ))}
        </div>
      )
    }
    case 'multi_select': {
      const opts = (config?.options as string[]) ?? ['Tag 1', 'Tag 2', 'Tag 3']
      return (
        <div className="flex flex-wrap gap-1 px-1">
          {opts.slice(0, 4).map((opt, i) => (
            <span key={i} className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', i < 2 ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500')}>
              {opt}
            </span>
          ))}
        </div>
      )
    }
    case 'boolean':
      return (
        <div className="flex items-center gap-2 px-1">
          <div className="relative w-8 h-4 rounded-full bg-primary-500">
            <span className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full translate-x-4" />
          </div>
          <span className="text-[11px] font-medium text-gray-700">{(config?.true_label as string) || 'Yes'}</span>
        </div>
      )
    case 'rating':
      return (
        <div className="flex items-center gap-0.5 px-1">
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} className={clsx('w-3.5 h-3.5', i < 3 ? 'text-amber-400 fill-amber-400' : 'text-gray-200')} />
          ))}
          <span className="text-[10px] text-gray-400 ml-1">3/5</span>
        </div>
      )
    case 'slider':
      return (
        <div className="px-1 py-1">
          <div className="w-full h-1.5 bg-gray-200 rounded-full relative">
            <div className="h-full bg-primary-500 rounded-full" style={{ width: '60%' }} />
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-primary-500 rounded-full" style={{ left: 'calc(60% - 6px)' }} />
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[9px] text-gray-400">0</span>
            <span className="text-[9px] text-gray-400">100</span>
          </div>
        </div>
      )
    case 'table': {
      const cols = (config?.columns as { key: string; label: string }[]) ?? [{ key: 'c1', label: 'Column 1' }, { key: 'c2', label: 'Column 2' }]
      return (
        <div className="px-1 overflow-hidden">
          <div className="border border-gray-200 rounded text-[9px]">
            <div className="flex bg-gray-50 border-b border-gray-200">
              {cols.slice(0, 3).map((c, i) => (
                <div key={i} className="flex-1 px-1.5 py-0.5 font-medium text-gray-600 truncate">{c.label}</div>
              ))}
            </div>
            {[0, 1].map(r => (
              <div key={r} className={clsx('flex', r === 0 && 'border-b border-gray-100')}>
                {cols.slice(0, 3).map((_, i) => (
                  <div key={i} className="flex-1 px-1.5 py-0.5 text-gray-400">—</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )
    }
    case 'scenario': {
      const scenarios = (config?.scenarios as { label: string }[]) ?? [{ label: 'Bear' }, { label: 'Base' }, { label: 'Bull' }]
      return (
        <div className="px-1 overflow-hidden">
          <div className="border border-gray-200 rounded text-[9px]">
            <div className="flex bg-gray-50 border-b border-gray-200">
              <div className="w-12 px-1 py-0.5 font-medium text-gray-500" />
              {scenarios.slice(0, 3).map((s, i) => (
                <div key={i} className="flex-1 px-1 py-0.5 font-medium text-gray-600 text-center truncate">{s.label}</div>
              ))}
            </div>
            <div className="flex border-b border-gray-100">
              <div className="w-12 px-1 py-0.5 text-gray-500">Price</div>
              {scenarios.slice(0, 3).map((_, i) => (
                <div key={i} className="flex-1 px-1 py-0.5 text-gray-400 text-center">—</div>
              ))}
            </div>
          </div>
        </div>
      )
    }
    case 'scorecard':
      return (
        <div className="space-y-1 px-1">
          {['Management', 'Moat'].map((label, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-[10px] text-gray-600">{label}</span>
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }, (_, j) => (
                  <div key={j} className={clsx('w-2 h-2 rounded-sm', j < (i === 0 ? 4 : 3) ? 'bg-primary-400' : 'bg-gray-200')} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    case 'spreadsheet':
      return (
        <div className="px-1">
          <div className="border border-gray-200 rounded text-[9px]">
            <div className="grid grid-cols-3 bg-gray-50 border-b border-gray-200">
              {['A', 'B', 'C'].map(c => (
                <div key={c} className="px-1.5 py-0.5 font-medium text-gray-500 text-center border-r border-gray-200 last:border-r-0">{c}</div>
              ))}
            </div>
            <div className="grid grid-cols-3">
              {['100', '200', '=SUM'].map((v, i) => (
                <div key={i} className="px-1.5 py-0.5 text-gray-400 text-center border-r border-gray-100 last:border-r-0">{v}</div>
              ))}
            </div>
          </div>
        </div>
      )
    case 'chart': {
      const ct = (config?.chart_type as string) ?? 'line'
      return (
        <div className="px-1.5 py-0.5">
          <div className="flex items-end gap-[3px] h-8">
            {ct === 'bar' ? (
              [40, 65, 50, 80, 60].map((h, i) => (
                <div key={i} className="flex-1 bg-indigo-400 rounded-t" style={{ height: `${h}%` }} />
              ))
            ) : (
              <svg viewBox="0 0 60 24" className="w-full h-full" preserveAspectRatio="none">
                {ct === 'area' && (
                  <polygon points="0,20 10,14 20,18 30,8 40,12 50,4 60,10 60,24 0,24" fill="#6366f1" fillOpacity="0.15" />
                )}
                <polyline points="0,20 10,14 20,18 30,8 40,12 50,4 60,10" fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <span className="text-[9px] text-gray-400">{(config?.metric as string) ?? 'Value'}</span>
        </div>
      )
    }
    default:
      return (
        <div className="px-1">
          <div className="h-2 bg-gray-100 rounded w-3/4" />
        </div>
      )
  }
}

function BuilderWidgetCell({ widget, isSelected, isHovered, onSelect, onRemove, layoutItem }: {
  widget: CompositeWidget
  isSelected: boolean
  isHovered?: boolean
  onSelect: () => void
  onRemove: () => void
  layoutItem?: { w: number; h: number }
}) {
  const isLinked = !!widget.linked_field_id
  const colors = WIDGET_TYPE_COLORS[widget.type] ?? DEFAULT_WIDGET_COLORS
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect() }}
      className={clsx(
        'h-full rounded-lg border-2 border-l-4 flex flex-col cursor-pointer group/cell transition-all',
        isLinked ? 'border-l-primary-400' : colors.border,
        isSelected
          ? 'border-primary-400 bg-white shadow-lg shadow-primary-100'
          : isHovered
            ? 'border-primary-300 bg-primary-50/20 shadow-md'
            : 'border-gray-200 bg-white hover:border-gray-300 shadow-sm hover:shadow-md'
      )}
    >
      {/* Header bar with grip + label */}
      <div className={clsx(
        'flex items-center gap-1.5 px-2 py-1 border-b flex-shrink-0 rounded-t-md',
        isSelected ? 'bg-primary-50/50 border-primary-100' : 'bg-gray-50/80 border-gray-100'
      )}>
        {isLinked ? (
          <Link2 className="w-3 h-3 flex-shrink-0 text-primary-400" />
        ) : (
          <FieldTypeIcon type={widget.type} className={clsx('w-3 h-3 flex-shrink-0', colors.accent)} />
        )}
        <span className="text-[11px] font-semibold text-gray-800 truncate flex-1">{widget.label}</span>
        {layoutItem && (
          <span className="text-[8px] font-mono text-gray-400 bg-gray-100 px-1 py-0.5 rounded flex-shrink-0">
            {layoutItem.w}&times;{layoutItem.h}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="p-0.5 text-gray-300 hover:text-red-500 rounded opacity-0 group-hover/cell:opacity-100 transition-opacity flex-shrink-0"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      {/* Preview body */}
      <div className="flex-1 overflow-hidden py-1 min-h-0">
        <WidgetPreviewMockup type={widget.type} config={widget.config} />
      </div>
    </div>
  )
}

/** Scoped CSS for the builder grid — makes resize handles visible and interactive */
const BUILDER_GRID_STYLES = `
.builder-grid .react-grid-item {
  transition: none !important;
}
.builder-grid .react-grid-item > .react-resizable-handle {
  z-index: 20;
  width: 20px;
  height: 20px;
  background: none !important;
}
.builder-grid .react-grid-item > .react-resizable-handle::after {
  content: '';
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 10px;
  height: 10px;
  border-right: 3px solid rgba(156, 163, 175, 0.5);
  border-bottom: 3px solid rgba(156, 163, 175, 0.5);
  border-radius: 0 0 3px 0;
}
.builder-grid .react-grid-item:hover > .react-resizable-handle::after {
  border-color: rgba(99, 102, 241, 0.7);
}
.builder-grid .react-grid-placeholder {
  background: rgba(99, 102, 241, 0.15) !important;
  border: 2px dashed rgba(99, 102, 241, 0.4) !important;
  border-radius: 8px !important;
}
`

/** Mini layout preview for preset cards */
function PresetLayoutPreview({ preset }: { preset: typeof CONTAINER_PRESETS[number] }) {
  const maxY = preset.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0)
  return (
    <div className="relative w-full bg-gray-100 rounded overflow-hidden" style={{ height: 32, marginTop: 4 }}>
      {preset.layout.map((l, i) => {
        const colors = WIDGET_TYPE_COLORS[preset.widgets[i]?.type] ?? DEFAULT_WIDGET_COLORS
        return (
          <div
            key={l.i}
            className={clsx('absolute rounded-sm', colors.bg, 'border border-gray-200/80')}
            style={{
              left: `${(l.x / 12) * 100}%`,
              top: `${(l.y / maxY) * 100}%`,
              width: `${(l.w / 12) * 100}%`,
              height: `${(l.h / maxY) * 100}%`,
            }}
          />
        )
      })}
    </div>
  )
}

// ============================================================================
// SORTABLE FIELD COMPONENT
// ============================================================================

interface SortableFieldProps {
  field: FieldConfig
  sectionId: string
  isVisible: boolean
  readOnly?: boolean
  onToggleVisibility: () => void
  onRemove: () => void
}

/** Capitalize first letter of each word for type labels */
function formatFieldType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function SortableField({ field, sectionId, isVisible, readOnly, onToggleVisibility, onRemove }: SortableFieldProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: field.field_id, disabled: readOnly })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.25 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'flex items-center min-h-[36px] py-[7px] group transition-colors',
        'border-b border-gray-100 last:border-b-0',
        isDragging && 'bg-primary-50/20',
        readOnly
          ? 'hover:bg-gray-50/50'
          : isVisible
          ? 'hover:bg-gray-50/50'
          : 'opacity-40 hover:opacity-60'
      )}
    >
      {/* Drag handle — hidden in read-only, visible on hover */}
      {!readOnly ? (
        <div
          {...attributes}
          {...listeners}
          className="w-7 flex items-center justify-center text-transparent group-hover:text-gray-300 hover:!text-gray-500 cursor-grab active:cursor-grabbing touch-none transition-colors flex-shrink-0"
          title="Drag to reorder"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      ) : (
        <div className="w-3 flex-shrink-0" />
      )}

      {/* Checkbox */}
      {!readOnly && (
        <button
          onClick={onToggleVisibility}
          className={clsx(
            'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-1',
            isVisible
              ? 'border-primary-500 bg-primary-500'
              : 'border-gray-300 bg-white hover:border-gray-400'
          )}
        >
          {isVisible && <Check className="w-2.5 h-2.5 text-white" />}
        </button>
      )}

      {/* Read-only visibility dot */}
      {readOnly && (
        <div className={clsx(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          isVisible ? 'bg-emerald-400' : 'bg-gray-300'
        )} />
      )}

      {/* Field name */}
      <span className={clsx(
        'text-[13px] truncate ml-2.5 flex-1 min-w-0',
        isVisible || readOnly ? 'text-gray-800' : 'text-gray-400'
      )}>{field.field_name}</span>

      {/* Custom badge */}
      {!field.is_system && (
        <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded flex-shrink-0 mr-2">
          Custom
        </span>
      )}

      {/* Type pill */}
      <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded flex-shrink-0 mr-1">
        {formatFieldType(field.field_type)}
      </span>

      {/* Remove button */}
      {!readOnly && (
        <button
          onClick={onRemove}
          className="w-6 flex items-center justify-center text-gray-300 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 mr-1"
          title="Remove field"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

// ============================================================================
// FIELD DRAG OVERLAY (ghost preview while dragging)
// ============================================================================

function FieldDragOverlay({ field }: { field: FieldConfig }) {
  return (
    <div className="flex items-center min-h-[36px] py-[7px] bg-white shadow-lg shadow-black/8 border border-gray-200 rounded-md">
      <div className="w-7 flex items-center justify-center text-primary-400 flex-shrink-0">
        <GripVertical className="w-3.5 h-3.5" />
      </div>
      <div className="w-4 h-4 rounded border border-primary-500 bg-primary-500 flex items-center justify-center flex-shrink-0">
        <Check className="w-2.5 h-2.5 text-white" />
      </div>
      <span className="text-[13px] text-gray-800 truncate ml-2.5 flex-1 min-w-0">{field.field_name}</span>
      <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded flex-shrink-0 mr-2">
        {formatFieldType(field.field_type)}
      </span>
    </div>
  )
}

// ============================================================================
// SECTION DRAG OVERLAY (ghost preview while dragging)
// ============================================================================

function SectionDragOverlay({ section }: { section: SectionConfig }) {
  return (
    <div className="rounded-lg bg-white shadow-lg shadow-black/8 border border-gray-200 overflow-hidden">
      <div className="flex items-center h-10 px-3 bg-gray-50 border-b border-gray-100">
        <div className="text-primary-400 mr-2 flex-shrink-0">
          <GripVertical className="w-4 h-4" />
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-gray-400 mr-1.5 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-gray-700">{section.section_name}</span>
        <span className="text-[11px] text-gray-400 ml-auto">
          {section.fields.length} field{section.fields.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}

// ============================================================================
// SORTABLE SECTION COMPONENT
// ============================================================================

interface SortableSectionProps {
  section: SectionConfig
  isExpanded: boolean
  readOnly?: boolean
  showHiddenFields?: boolean
  onToggleExpand: () => void
  onToggleFieldVisibility: (fieldId: string) => void
  onRemoveField: (fieldId: string) => void
  onRemoveSection: () => void
  onRenameSection: (newName: string) => void
  onAddField: () => void
  onFieldDragEnd: (activeId: string, overId: string) => void
}

function SortableSection({
  section,
  isExpanded,
  readOnly,
  showHiddenFields = true,
  onToggleExpand,
  onToggleFieldVisibility,
  onRemoveField,
  onRemoveSection,
  onRenameSection,
  onAddField,
  onFieldDragEnd
}: SortableSectionProps) {
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(section.section_name)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: section.section_id, disabled: readOnly })

  const fieldSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1
  }

  const sectionVisibleCount = section.fields.filter(f => f.is_visible).length

  const handleFieldDragStart = (event: DragStartEvent) => {
    setActiveFieldId(event.active.id as string)
  }

  const handleFieldDragEnd = (event: DragEndEvent) => {
    setActiveFieldId(null)
    const { active, over } = event
    if (over && active.id !== over.id) {
      onFieldDragEnd(active.id as string, over.id as string)
    }
  }

  const activeField = activeFieldId ? section.fields.find(f => f.field_id === activeFieldId) : null

  // Filter fields when showHiddenFields is false (hide unchecked fields)
  const displayedFields = showHiddenFields
    ? section.fields
    : section.fields.filter(f => f.is_visible)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'rounded-lg border border-gray-200 bg-white overflow-hidden transition-shadow',
        isDragging && 'shadow-md border-gray-300'
      )}
    >
      {/* Section Header */}
      <div className={clsx(
        'flex items-center h-10 group',
        'bg-gray-50/80',
        isExpanded && 'border-b border-gray-200'
      )}>
        {/* Drag handle */}
        {!readOnly ? (
          <div
            {...attributes}
            {...listeners}
            className="w-8 flex items-center justify-center text-transparent group-hover:text-gray-300 hover:!text-gray-500 cursor-grab active:cursor-grabbing touch-none transition-colors flex-shrink-0"
            title="Drag to reorder"
          >
            <GripVertical className="w-4 h-4" />
          </div>
        ) : (
          <div className="w-3 flex-shrink-0" />
        )}

        <div
          onClick={isRenaming ? undefined : onToggleExpand}
          className={clsx(
            "flex-1 flex items-center gap-2 h-full pr-3 transition-colors",
            !readOnly && !isRenaming ? 'cursor-pointer' : ''
          )}
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          )}
          {isRenaming && !readOnly ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (renameValue.trim() && renameValue.trim() !== section.section_name) {
                  onRenameSection(renameValue.trim())
                }
                setIsRenaming(false)
              }}
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="px-2 py-0.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                autoFocus
                onBlur={() => {
                  if (renameValue.trim() && renameValue.trim() !== section.section_name) {
                    onRenameSection(renameValue.trim())
                  }
                  setIsRenaming(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setRenameValue(section.section_name)
                    setIsRenaming(false)
                  }
                }}
              />
            </form>
          ) : (
            <span className="text-[13px] font-semibold text-gray-700">{section.section_name}</span>
          )}
          {!section.is_system && (
            <span className="text-[10px] font-medium bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Custom</span>
          )}

          {/* Right side: field count + actions */}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[11px] text-gray-400 mr-1">
              {readOnly
                ? `${section.fields.length} field${section.fields.length !== 1 ? 's' : ''}`
                : `${sectionVisibleCount} of ${section.fields.length}`}
            </span>
            {!readOnly && (
              <button
                onClick={(e) => { e.stopPropagation(); onAddField() }}
                className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                title="Add field"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
            {!readOnly && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenameValue(section.section_name)
                    setIsRenaming(true)
                  }}
                  className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                  title="Rename section"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onRemoveSection}
                  className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                  title="Remove section"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Section Fields */}
      {isExpanded && (
        <div className="py-px">
          {readOnly ? (
            displayedFields.map(field => (
              <SortableField
                key={field.field_id}
                field={field}
                sectionId={section.section_id}
                isVisible={field.is_visible}
                readOnly
                onToggleVisibility={() => {}}
                onRemove={() => {}}
              />
            ))
          ) : (
            <DndContext
              sensors={fieldSensors}
              collisionDetection={closestCenter}
              onDragStart={handleFieldDragStart}
              onDragEnd={handleFieldDragEnd}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            >
              <SortableContext
                items={displayedFields.map(f => f.field_id)}
                strategy={verticalListSortingStrategy}
              >
                {displayedFields.map(field => (
                  <SortableField
                    key={field.field_id}
                    field={field}
                    sectionId={section.section_id}
                    isVisible={field.is_visible}
                    onToggleVisibility={() => onToggleFieldVisibility(field.field_id)}
                    onRemove={() => onRemoveField(field.field_id)}
                  />
                ))}
              </SortableContext>
              <DragOverlay dropAnimation={null}>
                {activeField ? <FieldDragOverlay field={activeField} /> : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// LAYOUT CARD COMPONENT
// ============================================================================

// ============================================================================
// SCOPE BADGE
// ============================================================================

const SCOPE_CONFIG: Record<LayoutScope, { label: string; icon: typeof Building2; bg: string; text: string }> = {
  system: { label: 'System', icon: Shield, bg: 'bg-gray-100', text: 'text-gray-600' },
  org:    { label: 'Org', icon: Building2, bg: 'bg-purple-50', text: 'text-purple-700' },
  team:   { label: 'Team', icon: Users, bg: 'bg-blue-50', text: 'text-blue-700' },
  personal: { label: 'Personal', icon: User, bg: 'bg-gray-50', text: 'text-gray-500' },
}

function ScopeBadge({ scope }: { scope: LayoutScope }) {
  const config = SCOPE_CONFIG[scope]
  const Icon = config.icon
  return (
    <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium', config.bg, config.text)}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  )
}

// ============================================================================
// TIME AGO HELPER
// ============================================================================

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ''
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

// ============================================================================
// LAYOUT CARD (ENTERPRISE)
// ============================================================================

interface LayoutCardProps {
  card: LayoutTemplateCardModel
  onEdit: () => void
  onView?: () => void
  onDelete?: () => void
  onSetDefault?: () => void
  onDuplicate?: () => void
  onShare?: () => void
  onUsedByClick?: () => void
}

function LayoutCard({ card, onEdit, onView, onDelete, onSetDefault, onDuplicate, onShare, onUsedByClick }: LayoutCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  const permissionLabel = getPermissionLabel(card)
  const defaultIndicator = getDefaultIndicator(card)
  const editReason = getDisabledReason('edit', card)
  const deleteReason = getDisabledReason('delete', card)
  const shareReason = getDisabledReason('share', card)

  const borderStyle = card.isMyDefault
    ? 'border-primary-300 bg-primary-50/30 ring-1 ring-primary-200/60'
    : card.isSystemDefault
    ? 'border-gray-300 bg-gray-50/40 ring-1 ring-gray-200/60'
    : card.permission !== 'owner'
    ? 'border-blue-200 bg-blue-50/20 hover:border-blue-300'
    : 'border-gray-200 hover:border-gray-300 bg-white'

  return (
    <div
      className={clsx(
        'group relative border rounded-lg transition-all cursor-pointer hover:shadow-md',
        borderStyle
      )}
      onClick={card.canEdit ? onEdit : onView}
    >
      {/* Row 1: Title + kebab — shared hover tint */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1 -mb-1 rounded-t-lg transition-colors group-hover:bg-gray-50/60">
        <h3 className="font-medium text-gray-900 truncate leading-6">{card.name}</h3>

        {/* Kebab menu — baseline-aligned with title */}
        <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className={clsx(
              'p-1 rounded transition-colors',
              menuOpen
                ? 'text-gray-600 bg-gray-100'
                : 'text-gray-400 opacity-0 group-hover:opacity-100 hover:text-gray-600 hover:bg-gray-100'
            )}
            title="Actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-7 z-20 w-52 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
                {!card.isSystemDefault && (
                  <button
                    onClick={() => { if (card.canEdit) { setMenuOpen(false); onEdit() } }}
                    disabled={!card.canEdit}
                    className={clsx(
                      'w-full px-3 py-2 text-left text-sm flex items-center gap-2',
                      card.canEdit ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-400 cursor-not-allowed'
                    )}
                    title={editReason || undefined}
                  >
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                )}
                {onDuplicate && (
                  <button
                    onClick={() => { setMenuOpen(false); onDuplicate() }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <Copy className="w-3.5 h-3.5" /> Duplicate
                  </button>
                )}
                {!card.isSystemDefault && onShare && (
                  <button
                    onClick={() => { if (card.canShare) { setMenuOpen(false); onShare() } }}
                    disabled={!card.canShare}
                    className={clsx(
                      'w-full px-3 py-2 text-left text-sm flex items-center gap-2',
                      card.canShare ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-400 cursor-not-allowed'
                    )}
                    title={shareReason || undefined}
                  >
                    <Share2 className="w-3.5 h-3.5" /> Share
                  </button>
                )}
                {onSetDefault && !card.isMyDefault && !card.isSystemDefault && (
                  <button
                    onClick={() => { setMenuOpen(false); onSetDefault() }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <Star className="w-3.5 h-3.5" /> Set as default
                  </button>
                )}
                {!card.isSystemDefault && onDelete && (
                  <>
                    <div className="my-1 border-t border-gray-100" />
                    <button
                      onClick={() => { if (card.canDelete) { setMenuOpen(false); onDelete() } }}
                      disabled={!card.canDelete}
                      className={clsx(
                        'w-full px-3 py-2 text-left text-sm flex items-center gap-2',
                        card.canDelete ? 'text-red-600 hover:bg-red-50' : 'text-gray-400 cursor-not-allowed'
                      )}
                      title={deleteReason || undefined}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Row 2: Metadata chips */}
      <div className="flex items-center gap-1.5 mt-1.5 px-4 flex-wrap">
        <span title={getScopeTooltip(card)}>
          <ScopeBadge scope={card.scope} />
        </span>
        {defaultIndicator === 'My default' && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
            <Star className="w-3 h-3 fill-amber-400" />
            My default
          </span>
        )}
        {defaultIndicator === 'Default for me' && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
            <Check className="w-3 h-3" />
            Default for me
          </span>
        )}
        {permissionLabel && (
          <span className={clsx(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
            permissionLabel === 'Editable' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
          )}>
            {permissionLabel}
          </span>
        )}
      </div>

      {/* Description + created by */}
      {(card.description || card.createdByName || card.sharedByName) && (
        <div className="mt-2 px-4">
          {card.description && (
            <p className="text-sm text-gray-500 line-clamp-1">{card.description}</p>
          )}
          {(card.createdByName || card.sharedByName) && (
            <p className="text-xs text-gray-400 mt-0.5">
              {card.permission !== 'owner' && card.sharedByName
                ? <>Shared by {card.sharedByName}</>
                : card.createdByName
                ? <>Created by {card.createdByName}</>
                : null}
            </p>
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 mt-2.5 px-4 pb-3 text-xs text-gray-400">
        <span className="flex items-center gap-1" title="Visible / Total fields">
          <Eye className="w-3 h-3" />
          {card.fieldVisibleCount}/{card.fieldTotalCount} fields
        </span>
        {card.usedByAssetsCount > 0 && (
          <button
            className="flex items-center gap-1 text-gray-500 hover:text-primary-600 transition-colors"
            title={`${card.usedByAssetsCount} asset${card.usedByAssetsCount !== 1 ? 's' : ''} assigned to this template — click to view`}
            onClick={e => { e.stopPropagation(); onUsedByClick?.() }}
          >
            <Layers className="w-3 h-3" />
            {card.usedByAssetsCount} asset{card.usedByAssetsCount !== 1 ? 's' : ''}
          </button>
        )}
        {card.updatedAt && (
          <span className="ml-auto" title={`Updated ${card.updatedAt}`}>
            {timeAgo(card.updatedAt)}
          </span>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// AFFECTED ASSETS DRAWER
// ============================================================================

type DrawerKind = 'custom_layouts' | 'overrides' | 'by_layout'

const DRAWER_TITLES: Record<DrawerKind, string> = {
  custom_layouts: 'Assets Using Custom Layouts',
  overrides: 'Assets with Layout Overrides',
  by_layout: 'Assets Using Template',
}

interface AffectedAssetsDrawerProps {
  kind: DrawerKind
  layoutId?: string | null
  layoutName?: string | null
  onClose: () => void
  onOpenAsset: (assetId: string, symbol: string) => void
}

function AffectedAssetsDrawer({ kind, layoutId, layoutName, onClose, onOpenAsset }: AffectedAssetsDrawerProps) {
  const { data: assets = [], isLoading } = useAffectedAssets(kind, true, layoutId)
  const [search, setSearch] = useState('')

  const drawerTitle = kind === 'by_layout' && layoutName
    ? `Assets using "${layoutName}"`
    : DRAWER_TITLES[kind]

  // Filter by kind (by_layout is already filtered at DB level)
  const relevantAssets = useMemo(() => {
    let list = assets
    if (kind === 'custom_layouts') {
      list = list.filter(a => a.layout_id !== null)
    } else if (kind === 'overrides') {
      list = list.filter(a => a.has_overrides)
    }
    // kind === 'by_layout' → already filtered by layout_id in the query
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(a =>
        a.symbol.toLowerCase().includes(q) ||
        a.company_name.toLowerCase().includes(q) ||
        (a.layout_name?.toLowerCase().includes(q) ?? false)
      )
    }
    return list.sort((a, b) => a.symbol.localeCompare(b.symbol))
  }, [assets, kind, search])

  const handleCopyTickers = () => {
    const tickers = relevantAssets.map(a => a.symbol).join(', ')
    navigator.clipboard.writeText(tickers)
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{drawerTitle}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{relevantAssets.length} asset{relevantAssets.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search + Copy */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by ticker or name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400"
              autoFocus
            />
          </div>
          {relevantAssets.length > 0 && (
            <button
              onClick={handleCopyTickers}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
              title="Copy all tickers to clipboard"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy tickers
            </button>
          )}
        </div>

        {/* Asset list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : relevantAssets.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-400">
                {search ? 'No assets match your search.' : 'No assets found.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-5 py-2.5">Ticker</th>
                  <th className="px-3 py-2.5">Name</th>
                  <th className="px-3 py-2.5">Layout</th>
                  {kind === 'custom_layouts' && <th className="px-3 py-2.5">Overrides</th>}
                  <th className="px-3 py-2.5">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {relevantAssets.map(asset => (
                  <tr
                    key={asset.asset_id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => onOpenAsset(asset.asset_id, asset.symbol)}
                  >
                    <td className="px-5 py-2.5 font-medium text-gray-900 whitespace-nowrap">{asset.symbol}</td>
                    <td className="px-3 py-2.5 text-gray-600 truncate max-w-[180px]">{asset.company_name}</td>
                    <td className="px-3 py-2.5 text-gray-500 truncate max-w-[120px]">{asset.layout_name || '—'}</td>
                    {kind === 'custom_layouts' && (
                      <td className="px-3 py-2.5">
                        {asset.has_overrides
                          ? <span className="text-amber-600 text-xs font-medium">Yes</span>
                          : <span className="text-gray-300">—</span>
                        }
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">{timeAgo(asset.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}

// ============================================================================
// ADD SECTION MODAL
// ============================================================================

interface SystemSection {
  section_id: string
  section_name: string
  section_slug: string
  fields: { field_id: string; field_name: string; field_slug: string; field_type: string; is_system: boolean }[]
}

interface AddSectionModalProps {
  isOpen: boolean
  onClose: () => void
  onAddCustom: (name: string) => void
  onAddFromLibrary: (section: SystemSection) => void
  existingSectionIds: string[]
  availableSections: SystemSection[]
}

function AddSectionModal({ isOpen, onClose, onAddCustom, onAddFromLibrary, existingSectionIds, availableSections }: AddSectionModalProps) {
  const [mode, setMode] = useState<'library' | 'custom'>('library')
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  // Filter out sections already in the layout
  const sectionsNotInLayout = availableSections.filter(s => !existingSectionIds.includes(s.section_id))

  const handleSubmitCustom = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Section name is required')
      return
    }
    onAddCustom(trimmedName)
    setName('')
    setError('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Add Section</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('library')}
            className={clsx(
              'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors',
              mode === 'library'
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            <Library className="w-4 h-4 inline mr-1" />
            From Library
          </button>
          <button
            onClick={() => setMode('custom')}
            className={clsx(
              'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors',
              mode === 'custom'
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            <Plus className="w-4 h-4 inline mr-1" />
            Custom Section
          </button>
        </div>

        {mode === 'library' ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {sectionsNotInLayout.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">All available sections are already in your layout</p>
            ) : (
              sectionsNotInLayout.map(section => (
                <button
                  key={section.section_id}
                  onClick={() => {
                    onAddFromLibrary(section)
                    onClose()
                  }}
                  className="w-full p-3 border border-gray-200 rounded-lg text-left hover:border-primary-300 hover:bg-primary-50/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-gray-900">{section.section_name}</span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {section.fields.length} field{section.fields.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <Plus className="w-4 h-4 text-gray-400" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Section Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setError('') }}
                placeholder="e.g., Valuation Analysis"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitCustom()}
              />
              {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSubmitCustom}>Add Section</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// FIELD TYPE PREVIEW COMPONENT
// ============================================================================

function FieldTypePreview({ type }: { type: string }) {
  switch (type) {
    case 'rich_text':
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-2 border border-gray-200 shadow-sm">
          <div className="h-2.5 bg-gray-400 rounded w-3/4" />
          <div className="h-2 bg-gray-300 rounded w-full" />
          <div className="h-2 bg-gray-300 rounded w-5/6" />
          <div className="h-2 bg-gray-200 rounded w-2/3" />
        </div>
      )
    case 'checklist':
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-2 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-green-500 bg-green-500 rounded flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </div>
            <span className="text-gray-700">Completed item</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-gray-300 rounded" />
            <span className="text-gray-500">Pending item</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-gray-300 rounded" />
            <span className="text-gray-500">Another task</span>
          </div>
        </div>
      )
    case 'timeline':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 bg-primary-500 rounded-full" />
              <div className="w-0.5 h-6 bg-gray-300" />
              <div className="w-3 h-3 bg-gray-300 rounded-full" />
              <div className="w-0.5 h-6 bg-gray-300" />
              <div className="w-3 h-3 bg-gray-300 rounded-full" />
            </div>
            <div className="flex-1 space-y-4 pt-0.5">
              <div className="text-gray-700">Q1 Earnings</div>
              <div className="text-gray-500">Product Launch</div>
              <div className="text-gray-500">Investor Day</div>
            </div>
          </div>
        </div>
      )
    case 'metric':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="flex items-end gap-1.5 h-12">
            <div className="w-6 bg-primary-300 rounded-t" style={{ height: '40%' }} />
            <div className="w-6 bg-primary-400 rounded-t" style={{ height: '60%' }} />
            <div className="w-6 bg-primary-500 rounded-t" style={{ height: '80%' }} />
            <div className="w-6 bg-primary-600 rounded-t" style={{ height: '100%' }} />
            <div className="w-6 bg-primary-400 rounded-t" style={{ height: '70%' }} />
          </div>
          <div className="text-gray-500 mt-2">Monthly trend</div>
        </div>
      )
    case 'numeric':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="text-2xl font-bold text-gray-800">42.5</div>
          <div className="text-gray-500">Current value</div>
        </div>
      )
    case 'date':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-primary-500" />
            <div>
              <div className="text-gray-800 font-medium">January 15, 2025</div>
              <div className="text-gray-500">Target date</div>
            </div>
          </div>
        </div>
      )
    case 'rating':
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-3 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">BUY</span>
            <div className="flex gap-1">
              {[1,2,3,4,5].map(i => (
                <Star key={i} className={clsx('w-5 h-5', i <= 4 ? 'text-amber-400 fill-amber-400' : 'text-gray-300')} />
              ))}
            </div>
          </div>
          <div className="text-gray-600">High conviction · 4/5 stars</div>
        </div>
      )
    case 'price_target':
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-3 border border-gray-200 shadow-sm">
          <div className="flex justify-between items-center text-sm">
            <span className="text-red-600 font-semibold">Bear: $80</span>
            <span className="text-gray-700 font-semibold">Base: $120</span>
            <span className="text-green-600 font-semibold">Bull: $160</span>
          </div>
          <div className="h-3 bg-gradient-to-r from-red-300 via-gray-300 to-green-300 rounded-full relative">
            <div className="absolute left-1/2 -translate-x-1/2 -top-0.5 w-4 h-4 bg-primary-500 rounded-full border-2 border-white shadow" />
          </div>
          <div className="text-gray-500 text-center">Current: $115</div>
        </div>
      )
    case 'estimates':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-gray-500 mb-1">Revenue</div>
              <div className="text-lg font-semibold text-gray-800">$4.2B</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">EPS</div>
              <div className="text-lg font-semibold text-gray-800">$2.45</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">Growth</div>
              <div className="text-lg font-semibold text-green-600">+12%</div>
            </div>
          </div>
        </div>
      )
    case 'single_select':
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-1.5 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-primary-500 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-primary-500" />
            </div>
            <span className="text-gray-700">Selected option</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" />
            <span className="text-gray-500">Another option</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" />
            <span className="text-gray-500">Third option</span>
          </div>
        </div>
      )
    case 'multi_select':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="flex flex-wrap gap-1.5">
            <span className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-full">Growth</span>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">Value</span>
            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full border border-dashed border-gray-300">+ Add</span>
          </div>
        </div>
      )
    case 'boolean':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-5 bg-primary-500 rounded-full relative">
              <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow" />
            </div>
            <span className="text-gray-700 font-medium">Yes</span>
          </div>
        </div>
      )
    case 'percentage':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="text-2xl font-bold text-gray-800">73.5%</div>
          <div className="w-full h-2 bg-gray-200 rounded-full mt-2">
            <div className="h-full bg-primary-500 rounded-full" style={{ width: '73.5%' }} />
          </div>
        </div>
      )
    case 'currency':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="flex items-baseline gap-1">
            <span className="text-gray-500">$</span>
            <span className="text-2xl font-bold text-gray-800">1,250.00</span>
            <span className="text-gray-400 text-sm ml-1">USD</span>
          </div>
        </div>
      )
    case 'table':
      return (
        <div className="bg-white rounded-lg p-3 text-xs border border-gray-200 shadow-sm">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-1 pr-3 text-gray-500 font-medium">Metric</th>
                <th className="py-1 text-gray-500 font-medium text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-1 pr-3 text-gray-700">Revenue</td>
                <td className="py-1 text-gray-700 text-right">4,200</td>
              </tr>
              <tr>
                <td className="py-1 pr-3 text-gray-700">EBITDA</td>
                <td className="py-1 text-gray-700 text-right">1,050</td>
              </tr>
            </tbody>
          </table>
        </div>
      )
    default:
      // Fallback preview for any unhandled field type
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-2 border border-gray-200 shadow-sm">
          <div className="h-2.5 bg-gray-400 rounded w-3/4" />
          <div className="h-2 bg-gray-300 rounded w-full" />
          <div className="h-2 bg-gray-300 rounded w-5/6" />
        </div>
      )
  }
}

// ============================================================================
// ADD FIELD MODAL
// ============================================================================

interface SystemField {
  id: string
  name: string
  slug: string
  type: string
  description?: string
}

interface CustomFieldWithAuthor {
  id: string
  name: string
  slug: string
  field_type: string
  description: string | null
  created_by: string | null
  author_name: string | null
  config?: Record<string, unknown> | null
}

interface PresetFieldData {
  name: string
  slug: string
  field_type: string
}

// ============================================================================
// FIELD CONFIG EDITORS (inline editors for configurable field types)
// ============================================================================

interface FieldConfigEditorProps {
  fieldType: string
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}

function FieldConfigEditor({ fieldType, config, onChange }: FieldConfigEditorProps) {
  switch (fieldType) {
    case 'single_select':
    case 'multi_select':
      return <SelectOptionsEditor config={config} onChange={onChange} isMulti={fieldType === 'multi_select'} />
    case 'boolean':
      return <BooleanConfigEditor config={config} onChange={onChange} />
    case 'rating':
      return <RatingConfigEditor config={config} onChange={onChange} />
    case 'percentage':
      return <PercentageConfigEditor config={config} onChange={onChange} />
    case 'currency':
      return <CurrencyConfigEditor config={config} onChange={onChange} />
    case 'table':
      return <TableColumnsEditor config={config} onChange={onChange} />
    case 'scenario':
      return <ScenarioConfigEditor config={config} onChange={onChange} />
    case 'chart':
      return <ChartConfigEditor config={config} onChange={onChange} />
    default:
      return null
  }
}

function SelectOptionsEditor({
  config,
  onChange,
  isMulti,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  isMulti: boolean
}) {
  const options = (config.options as string[] | undefined) ?? ['']
  const [newOption, setNewOption] = useState('')

  const updateOptions = (opts: string[]) => onChange({ ...config, options: opts })

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">Options</label>
      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={opt}
              onChange={(e) => {
                const next = [...options]
                next[i] = e.target.value
                updateOptions(next)
              }}
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder={`Option ${i + 1}`}
            />
            {options.length > 1 && (
              <button
                onClick={() => updateOptions(options.filter((_, j) => j !== i))}
                className="p-1 text-gray-400 hover:text-red-500 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newOption}
          onChange={(e) => setNewOption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newOption.trim()) {
              updateOptions([...options, newOption.trim()])
              setNewOption('')
            }
          }}
          placeholder="Add option..."
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        <button
          onClick={() => {
            if (newOption.trim()) {
              updateOptions([...options, newOption.trim()])
              setNewOption('')
            }
          }}
          className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      {isMulti && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Max selections (optional)</label>
          <input
            type="number"
            min={1}
            value={(config.max_selections as number) ?? ''}
            onChange={(e) => {
              const val = e.target.value ? parseInt(e.target.value) : undefined
              onChange({ ...config, max_selections: val })
            }}
            className="w-24 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="No limit"
          />
        </div>
      )}
    </div>
  )
}

function BooleanConfigEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">Labels</label>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">True label</label>
          <input
            type="text"
            value={(config.true_label as string) ?? 'Yes'}
            onChange={(e) => onChange({ ...config, true_label: e.target.value })}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">False label</label>
          <input
            type="text"
            value={(config.false_label as string) ?? 'No'}
            onChange={(e) => onChange({ ...config, false_label: e.target.value })}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>
    </div>
  )
}

function RatingConfigEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">Rating Scale</label>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Min</label>
          <input
            type="number"
            min={0}
            value={(config.min as number) ?? 1}
            onChange={(e) => onChange({ ...config, min: parseInt(e.target.value) || 0 })}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Max</label>
          <input
            type="number"
            min={1}
            max={10}
            value={(config.max as number) ?? 5}
            onChange={(e) => onChange({ ...config, max: parseInt(e.target.value) || 5 })}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Step</label>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={(config.step as number) ?? 1}
            onChange={(e) => onChange({ ...config, step: parseFloat(e.target.value) || 1 })}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>
    </div>
  )
}

function ScenarioConfigEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const scenarios = (config.scenarios as { key: string; label: string }[] | undefined) ?? []
  const metrics = (config.metrics as { key: string; label: string; type: string }[] | undefined) ?? []

  const updateScenarios = (s: typeof scenarios) => onChange({ ...config, scenarios: s })
  const updateMetrics = (m: typeof metrics) => onChange({ ...config, metrics: m })

  return (
    <div className="space-y-4">
      {/* Scenarios */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Scenarios</label>
        {scenarios.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={s.label}
              onChange={(e) => {
                const next = [...scenarios]
                const key = e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || s.key
                next[i] = { ...s, label: e.target.value, key }
                updateScenarios(next)
              }}
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Scenario name"
            />
            {scenarios.length > 1 && (
              <button
                onClick={() => updateScenarios(scenarios.filter((_, j) => j !== i))}
                className="p-1 text-gray-400 hover:text-red-500 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => {
            const idx = scenarios.length + 1
            updateScenarios([...scenarios, { key: `scenario_${idx}`, label: `Scenario ${idx}` }])
          }}
          className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          Add scenario
        </button>
      </div>

      {/* Metrics */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Metrics</label>
        {metrics.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={m.label}
              onChange={(e) => {
                const next = [...metrics]
                const key = e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || m.key
                next[i] = { ...m, label: e.target.value, key }
                updateMetrics(next)
              }}
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Metric name"
            />
            <select
              value={m.type}
              onChange={(e) => {
                const next = [...metrics]
                next[i] = { ...m, type: e.target.value }
                updateMetrics(next)
              }}
              className="w-28 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="number">Number</option>
              <option value="percentage">Percent</option>
              <option value="currency">Currency</option>
              <option value="text">Text</option>
            </select>
            {metrics.length > 1 && (
              <button
                onClick={() => updateMetrics(metrics.filter((_, j) => j !== i))}
                className="p-1 text-gray-400 hover:text-red-500 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => {
            const idx = metrics.length + 1
            updateMetrics([...metrics, { key: `metric_${idx}`, label: `Metric ${idx}`, type: 'number' }])
          }}
          className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          Add metric
        </button>
      </div>
    </div>
  )
}

function ChartConfigEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const chartType = (config.chart_type as string) ?? 'line'
  const metric = (config.metric as string) ?? 'Value'
  const color = (config.color as string) ?? '#6366f1'

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Chart Type</label>
        <select
          value={chartType}
          onChange={(e) => onChange({ ...config, chart_type: e.target.value })}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        >
          <option value="line">Line</option>
          <option value="bar">Bar</option>
          <option value="area">Area</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Metric Label</label>
        <input
          type="text"
          value={metric}
          onChange={(e) => onChange({ ...config, metric: e.target.value })}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          placeholder="e.g. Revenue, EPS, Price"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => onChange({ ...config, color: e.target.value })}
            className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
          />
          <span className="text-xs text-gray-400 font-mono">{color}</span>
        </div>
      </div>
    </div>
  )
}

function PercentageConfigEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">Range &amp; Precision</label>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Min</label>
          <input
            type="number"
            value={(config.min as number) ?? 0}
            onChange={(e) => onChange({ ...config, min: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Max</label>
          <input
            type="number"
            value={(config.max as number) ?? 100}
            onChange={(e) => onChange({ ...config, max: parseFloat(e.target.value) || 100 })}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Decimals</label>
          <input
            type="number"
            min={0}
            max={6}
            value={(config.decimals as number) ?? 1}
            onChange={(e) => onChange({ ...config, decimals: parseInt(e.target.value) || 0 })}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>
    </div>
  )
}

function CurrencyConfigEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY']
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">Currency Settings</label>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Currency</label>
          <select
            value={(config.currency_code as string) ?? 'USD'}
            onChange={(e) => onChange({ ...config, currency_code: e.target.value })}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            {currencies.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Decimals</label>
          <input
            type="number"
            min={0}
            max={6}
            value={(config.decimals as number) ?? 2}
            onChange={(e) => onChange({ ...config, decimals: parseInt(e.target.value) || 0 })}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>
    </div>
  )
}

function TableColumnsEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const columns = (config.columns as { key: string; label: string; type: 'text' | 'number' }[] | undefined) ?? []

  const updateColumns = (cols: typeof columns) => onChange({ ...config, columns: cols })

  const addColumn = () => {
    const idx = columns.length + 1
    updateColumns([...columns, { key: `col${idx}`, label: `Column ${idx}`, type: 'text' }])
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">Columns</label>
      <div className="space-y-2">
        {columns.map((col, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={col.label}
              onChange={(e) => {
                const next = [...columns]
                const key = e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || col.key
                next[i] = { ...col, label: e.target.value, key }
                updateColumns(next)
              }}
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Column name"
            />
            <select
              value={col.type}
              onChange={(e) => {
                const next = [...columns]
                next[i] = { ...col, type: e.target.value as 'text' | 'number' }
                updateColumns(next)
              }}
              className="w-24 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
            </select>
            {columns.length > 1 && (
              <button
                onClick={() => updateColumns(columns.filter((_, j) => j !== i))}
                className="p-1 text-gray-400 hover:text-red-500 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={addColumn}
        className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
      >
        <Plus className="w-3.5 h-3.5" />
        Add column
      </button>
    </div>
  )
}

// ============================================================================
// ADD FIELD MODAL
// ============================================================================

interface AddFieldModalProps {
  isOpen: boolean
  onClose: () => void
  onAddFromLibrary: (preset: PresetFieldData) => void
  onAddCustom: (name: string, fieldType: string, config?: Record<string, unknown>) => void
  onAddSystemField: (field: SystemField) => void
  onAddExistingCustomField: (field: CustomFieldWithAuthor) => void
  existingFieldSlugs: string[]
  systemFields: SystemField[]
  sectionName?: string
}

type SelectedField = {
  type: 'system' | 'preset' | 'custom'
  id: string
  name: string
  fieldType: string
  description?: string
  slug?: string
}

function AddFieldModal({ isOpen, onClose, onAddFromLibrary, onAddCustom, onAddSystemField, onAddExistingCustomField, existingFieldSlugs, systemFields, sectionName }: AddFieldModalProps) {
  const { presets, presetsByCategory, isLoading } = useResearchFieldPresets()
  // Top-level mode: 2 tabs
  const [mode, setMode] = useState<'addExisting' | 'createField'>('addExisting')
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'system' | 'custom'>('all')
  const [librarySearch, setLibrarySearch] = useState('')
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customType, setCustomType] = useState<string | null>(null)
  const [customConfig, setCustomConfig] = useState<Record<string, unknown>>({})
  const [fieldKind, setFieldKind] = useState<'single' | 'multi' | null>(null)
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1)
  const [typeSearch, setTypeSearch] = useState('')
  const [allTypesExpanded, setAllTypesExpanded] = useState(false)
  const [nameBlurred, setNameBlurred] = useState(false)
  const [addingContainerWidget, setAddingContainerWidget] = useState(false)
  const [containerAutoLayout, setContainerAutoLayout] = useState(true)
  const [containerCols, setContainerCols] = useState<1 | 2>(1)
  const [widgetChooserTab, setWidgetChooserTab] = useState<'reuse' | 'create'>('reuse')
  const [editingWidgetLabel, setEditingWidgetLabel] = useState<string | null>(null)
  const [hoveredWidgetId, setHoveredWidgetId] = useState<string | null>(null)
  const [builderTipDismissed, setBuilderTipDismissed] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [confirmDialogState, setConfirmDialogState] = useState<{
    isOpen: boolean
    title: string
    message: string
    confirmText: string
    variant: 'danger' | 'warning' | 'info'
    onConfirm: () => void
  }>({ isOpen: false, title: '', message: '', confirmText: 'Confirm', variant: 'warning', onConfirm: () => {} })
  const [error, setError] = useState('')
  // Container Builder state
  const [compositeWidgets, setCompositeWidgets] = useState<CompositeWidget[]>([])
  const [compositeLayout, setCompositeLayout] = useState<CompositeFieldConfig['layout']>([])
  const [addingWidgetType, setAddingWidgetType] = useState<string | null>(null)
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [linkFieldSearch, setLinkFieldSearch] = useState('')
  const [widgetPaletteOpen, setWidgetPaletteOpen] = useState(false)
  const typeSearchRef = useRef<HTMLInputElement>(null)
  const gridContainerRef = useRef<HTMLDivElement>(null)
  const [gridWidth, setGridWidth] = useState(0)
  // Guardrails
  const [createAnywayConfirmed, setCreateAnywayConfirmed] = useState(false)
  // Post-create highlight
  const [highlightFieldId, setHighlightFieldId] = useState<string | null>(null)

  // Measure grid container width — re-runs when entering the container step
  useEffect(() => {
    const el = gridContainerRef.current
    if (!el) { setGridWidth(0); return }
    // Immediate measurement
    setGridWidth(el.getBoundingClientRect().width)
    // Observe for resize
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setGridWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [mode, fieldKind, createStep, isOpen])
  const [previewField, setPreviewField] = useState<{ name: string; type: string; description?: string } | null>(null)
  const [selectedFields, setSelectedFields] = useState<Map<string, SelectedField>>(new Map())

  const toggleFieldSelection = (field: SelectedField) => {
    setSelectedFields(prev => {
      const next = new Map(prev)
      if (next.has(field.id)) {
        next.delete(field.id)
        // Clear preview if deselecting the previewed field
        if (previewField?.name === field.name) {
          setPreviewField(null)
        }
      } else {
        next.set(field.id, field)
        // Show preview for newly selected field
        setPreviewField({ name: field.name, type: field.fieldType, description: field.description })
      }
      return next
    })
  }

  const handleAddSelected = (customFieldsList: CustomFieldWithAuthor[]) => {
    selectedFields.forEach(field => {
      if (field.type === 'system') {
        const systemField = systemFields.find(f => f.id === field.id)
        if (systemField) onAddSystemField(systemField)
      } else if (field.type === 'preset' && field.slug) {
        onAddFromLibrary({
          name: field.name,
          slug: field.slug,
          field_type: field.fieldType
        })
      } else if (field.type === 'custom') {
        const customField = customFieldsList.find(f => f.id === field.id)
        if (customField) onAddExistingCustomField(customField)
      }
    })
    setSelectedFields(new Map())
    onClose()
  }

  const clearSelection = () => {
    setSelectedFields(new Map())
    setPreviewField(null)
  }

  // Fetch custom fields created by users in the organization
  const { data: customFields = [], isLoading: customFieldsLoading } = useQuery({
    queryKey: ['custom-research-fields'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_fields')
        .select(`
          id,
          name,
          slug,
          field_type,
          description,
          created_by,
          config
        `)
        .eq('is_system', false)
        .eq('is_archived', false)
        .order('name')

      if (error) throw error

      // Fetch creator info separately from public.users (FK points to auth.users)
      const creatorIds = [...new Set((data || []).map(f => f.created_by).filter(Boolean))]
      let creatorsMap = new Map<string, { first_name?: string; last_name?: string }>()

      if (creatorIds.length > 0) {
        const { data: creators } = await supabase
          .from('users')
          .select('id, first_name, last_name')
          .in('id', creatorIds)

        for (const creator of creators || []) {
          creatorsMap.set(creator.id, creator)
        }
      }

      return (data || []).map(f => {
        const creator = f.created_by ? creatorsMap.get(f.created_by) : null
        return {
          id: f.id,
          name: f.name,
          slug: f.slug,
          field_type: f.field_type,
          description: f.description,
          created_by: f.created_by,
          author_name: creator
            ? `${creator.first_name || ''} ${creator.last_name || ''}`.trim() || 'Unknown'
            : null,
          config: f.config as Record<string, unknown> | null,
        }
      }) as CustomFieldWithAuthor[]
    },
    enabled: isOpen
  })

  // Detect similar existing fields as the user types a name
  const similarFields = useMemo(() => {
    const trimmed = customName.trim().toLowerCase()
    if (trimmed.length < 2) return []

    const searchTerms = trimmed.split(/\s+/)

    // Build a unified list of all known fields (system + custom)
    const allFields: { id: string; slug: string; name: string; type: string; source: 'system' | 'custom'; author?: string | null; description?: string }[] = [
      ...systemFields.map(f => ({ id: f.id, slug: f.slug, name: f.name, type: f.type, source: 'system' as const, description: f.description })),
      ...customFields.map(f => ({ id: f.id, slug: f.slug, name: f.name, type: f.field_type, source: 'custom' as const, author: f.author_name, description: f.description ?? undefined })),
    ]

    return allFields
      .filter(f => {
        const fieldName = f.name.toLowerCase()
        // Exact match → always surface
        if (fieldName === trimmed) return true
        // Any search term is a substring of the field name or vice versa
        return searchTerms.some(term =>
          fieldName.includes(term) || term.includes(fieldName.split(/\s+/)[0])
        )
      })
      .slice(0, 5)
  }, [customName, systemFields, customFields])

  const exactMatch = useMemo(() => {
    const trimmed = customName.trim().toLowerCase()
    if (!trimmed) return false
    return similarFields.some(f => f.name.toLowerCase() === trimmed)
  }, [customName, similarFields])

  const resetCustom = () => {
    setCustomName('')
    setCustomDescription('')
    setCustomType(null)
    setCustomConfig({})
    setFieldKind(null)
    setCreateStep(1)
    setTypeSearch('')
    setAllTypesExpanded(false)
    setNameBlurred(false)
    setAddingContainerWidget(false)
    setContainerAutoLayout(true)
    setContainerCols(1)
    setWidgetChooserTab('reuse')
    setEditingWidgetLabel(null)
    setHoveredWidgetId(null)
    setBuilderTipDismissed(false)
    setPreviewExpanded(false)
    setError('')
    setCreateAnywayConfirmed(false)
    setCompositeWidgets([])
    setCompositeLayout([])
    setAddingWidgetType(null)
    setSelectedWidgetId(null)
    setLinkFieldSearch('')
    setWidgetPaletteOpen(false)
  }

  /** Switch to addExisting mode, optionally highlighting a specific field */
  const switchToUseExisting = (fieldId?: string) => {
    resetCustom()
    setMode('addExisting')
    if (fieldId) setHighlightFieldId(fieldId)
  }

  /** Create New Field handler — routes back to addExisting on success */
  const handleAddCustom = async () => {
    const trimmedName = customName.trim()
    if (!trimmedName || !customType) return

    // Re-check duplicate name at save time
    if (exactMatch && !createAnywayConfirmed) { setError('A field with this name already exists'); return }

    try {
      const configToSave = isConfigurableFieldType(customType)
        ? { ...getDefaultConfig(customType), ...customConfig }
        : undefined
      await onAddCustom(trimmedName, customType, configToSave)
      // Route back to Add Existing with the newly created field highlighted
      const slug = trimmedName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      resetCustom()
      setMode('addExisting')
      setHighlightFieldId(slug)
    } catch {
      setError('Failed to create field. Please try again.')
    }
  }

  /** Create Container handler — uses customName for container name */
  const handleAddContainer = async () => {
    const trimmedName = customName.trim()
    if (!trimmedName) { setError('Container name is required'); return }
    if (compositeWidgets.length === 0) { setError('Add at least one widget'); return }

    // Check duplicate
    const allNames = [...systemFields.map(f => f.name), ...customFields.map(f => f.name)]
    if (allNames.some(n => n.toLowerCase() === trimmedName.toLowerCase())) {
      setError('A field with this name already exists')
      return
    }

    try {
      const compositeConfig: CompositeFieldConfig = {
        widgets: compositeWidgets,
        layout: compositeLayout,
        cols: 12,
      }
      const result = compositeConfigSchema.safeParse(compositeConfig)
      if (!result.success) {
        setError(result.error.issues[0]?.message || 'Invalid container configuration')
        return
      }
      await onAddCustom(trimmedName, 'composite', compositeConfig as unknown as Record<string, unknown>)
      const slug = trimmedName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      resetCustom()
      setMode('addExisting')
      setHighlightFieldId(slug)
    } catch {
      setError('Failed to create container. Please try again.')
    }
  }

  /** Select a widget type for single-widget fields. Sets type + default config. */
  const handleSelectWidgetType = (typeValue: string) => {
    setCustomType(typeValue)
    setAllTypesExpanded(false)
    const galleryItem = WIDGET_GALLERY_MAP[typeValue]
    if (galleryItem?.hasConfig) {
      setCustomConfig(getDefaultConfig(typeValue))
    } else {
      setCustomConfig({})
    }
  }

  /** Handle structure step click with confirmation when switching */
  const handleStructureSelect = (kind: 'single' | 'multi') => {
    const hasContent = fieldKind === 'single' ? !!customType : compositeWidgets.length > 0
    if (fieldKind && fieldKind !== kind && hasContent) {
      setConfirmDialogState({
        isOpen: true,
        title: 'Switch structure?',
        message: `You've already configured content for ${fieldKind === 'single' ? 'a single-value field' : 'a multi-widget container'}. Switching to ${kind === 'single' ? 'single-value' : 'multi-widget'} will discard that work.`,
        confirmText: 'Switch and reset',
        variant: 'warning',
        onConfirm: () => {
          setCustomType(null)
          setCustomConfig({})
          setCompositeWidgets([])
          setCompositeLayout([])
          setSelectedWidgetId(null)
          setFieldKind(kind)
          setCreateStep(3)
          setConfirmDialogState(prev => ({ ...prev, isOpen: false }))
        },
      })
      return
    }
    setFieldKind(kind)
    setCreateStep(3)
  }

  /** Recompute auto layout positions from widget list + column count */
  const recomputeAutoLayout = (widgets: CompositeWidget[], cols: 1 | 2) => {
    const newLayout: CompositeFieldConfig['layout'] = []
    let y = 0
    for (let i = 0; i < widgets.length; i++) {
      const w = widgets[i]
      const defaultH = getDefaultWidgetSize(w.type).h
      if (cols === 1) {
        newLayout.push({ i: w.id, x: 0, y, w: 12, h: defaultH })
        y += defaultH
      } else {
        const col = i % 2
        if (col === 0) {
          newLayout.push({ i: w.id, x: 0, y, w: 6, h: defaultH })
        } else {
          const prevH = newLayout[newLayout.length - 1]?.h ?? defaultH
          newLayout.push({ i: w.id, x: 6, y, w: 6, h: defaultH })
          y += Math.max(prevH, defaultH)
        }
      }
    }
    return newLayout
  }

  /** Duplicate a widget */
  const handleDuplicateWidget = (widgetId: string) => {
    const original = compositeWidgets.find(w => w.id === widgetId)
    if (!original) return
    const newId = `w-${crypto.randomUUID()}`
    const duplicate: CompositeWidget = {
      ...original,
      id: newId,
      label: `${original.label} (copy)`,
      config: JSON.parse(JSON.stringify(original.config)),
      linked_field_id: undefined, // duplicated widgets are always standalone
    }
    setCompositeWidgets(prev => {
      const idx = prev.findIndex(w => w.id === widgetId)
      const next = [...prev]
      next.splice(idx + 1, 0, duplicate)
      if (containerAutoLayout) {
        setTimeout(() => setCompositeLayout(recomputeAutoLayout(next, containerCols)), 0)
      } else {
        setCompositeLayout(prevLayout => {
          const placement = autoPlaceWidget(newId, duplicate.type, prevLayout)
          return placement ? [...prevLayout, placement] : prevLayout
        })
      }
      return next
    })
    setSelectedWidgetId(newId)
  }

  /** Move a widget up or down in the list */
  const handleMoveWidget = (widgetId: string, direction: 'up' | 'down') => {
    setCompositeWidgets(prev => {
      const idx = prev.findIndex(w => w.id === widgetId)
      if (idx < 0) return prev
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1
      if (targetIdx < 0 || targetIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[targetIdx]] = [next[targetIdx], next[idx]]
      if (containerAutoLayout) {
        setTimeout(() => setCompositeLayout(recomputeAutoLayout(next, containerCols)), 0)
      }
      return next
    })
  }

  /** Default grid size by widget type */
  const getDefaultWidgetSize = (widgetType: string): { w: number; h: number } => {
    switch (widgetType) {
      case 'rich_text': case 'checklist': case 'chart':
        return { w: 6, h: 3 }
      case 'table': case 'scenario':
        return { w: 12, h: 4 }
      case 'numeric': case 'percentage': case 'currency': case 'boolean': case 'rating':
        return { w: 3, h: 2 }
      default:
        return { w: 6, h: 2 }
    }
  }

  /** Try to auto-place a widget; returns layout item or null if no space */
  const autoPlaceWidget = (id: string, widgetType: string, currentLayout: CompositeFieldConfig['layout']): CompositeFieldConfig['layout'][number] | null => {
    const { w, h } = getDefaultWidgetSize(widgetType)
    if (currentLayout.length === 0) {
      return { i: id, x: 0, y: 0, w, h }
    }
    const maxY = currentLayout.reduce((max, l) => Math.max(max, l.y + l.h), 0)
    // Try to fit next to the last widget on the same row
    const last = currentLayout[currentLayout.length - 1]
    const lastEndX = last.x + last.w
    if (lastEndX + w <= 12) {
      return { i: id, x: lastEndX, y: last.y, w, h }
    }
    // Place in new row
    return { i: id, x: 0, y: maxY, w, h }
  }

  /** Add a widget to the composite container — type-aware placement */
  const handleAddCompositeWidget = (widgetType: string) => {
    const id = `w-${crypto.randomUUID()}`
    const galleryItem = WIDGET_GALLERY_MAP[widgetType]
    const newWidget: CompositeWidget = {
      id,
      type: widgetType,
      label: galleryItem?.label ?? widgetType,
      config: isConfigurableFieldType(widgetType) ? getDefaultConfig(widgetType) : {},
    }
    setCompositeWidgets((prev) => {
      const next = [...prev, newWidget]
      if (containerAutoLayout) {
        setTimeout(() => setCompositeLayout(recomputeAutoLayout(next, containerCols)), 0)
      }
      return next
    })
    if (!containerAutoLayout) {
      setCompositeLayout((prev) => {
        const placement = autoPlaceWidget(id, widgetType, prev)
        if (!placement) return prev
        return [...prev, placement]
      })
    }
    setAddingWidgetType(null)
    setSelectedWidgetId(id)
  }

  /** Set of field IDs already linked in this container — prevents duplicates */
  const linkedFieldIds = useMemo(() => {
    const ids = new Set<string>()
    for (const w of compositeWidgets) {
      if (w.linked_field_id) ids.add(w.linked_field_id)
    }
    return ids
  }, [compositeWidgets])

  /** Per-widget similarity warnings: standalone widgets whose label matches an existing field */
  const widgetSimilarityWarnings = useMemo(() => {
    const warnings = new Map<string, { name: string; id: string; type: string }[]>()
    const allExisting = [
      ...systemFields.map(f => ({ id: f.id, name: f.name, type: f.type })),
      ...customFields.map(f => ({ id: f.id, name: f.name, type: f.field_type })),
    ]
    for (const w of compositeWidgets) {
      if (w.linked_field_id) continue
      const label = w.label.trim().toLowerCase()
      if (label.length < 3) continue
      const terms = label.split(/\s+/).filter(t => t.length >= 3)
      if (terms.length === 0) continue
      const matches = allExisting.filter(f => {
        const fn = f.name.toLowerCase()
        if (fn === label) return true
        return terms.some(term => fn.includes(term) || term.includes(fn.split(/\s+/)[0]))
      })
      if (matches.length > 0) warnings.set(w.id, matches)
    }
    return warnings
  }, [compositeWidgets, systemFields, customFields])

  /** Add a linked widget that reads/writes to an existing research field */
  const handleAddLinkedWidget = (fieldId: string, fieldName: string, fieldType: string, fieldConfig?: Record<string, unknown>) => {
    if (linkedFieldIds.has(fieldId)) return
    const id = `w-${crypto.randomUUID()}`
    const newWidget: CompositeWidget = {
      id,
      type: fieldType,
      label: fieldName,
      config: fieldConfig ?? {},
      linked_field_id: fieldId,
    }
    setCompositeWidgets((prev) => {
      const next = [...prev, newWidget]
      if (containerAutoLayout) {
        setTimeout(() => setCompositeLayout(recomputeAutoLayout(next, containerCols)), 0)
      }
      return next
    })
    if (!containerAutoLayout) {
      setCompositeLayout((prev) => {
        const placement = autoPlaceWidget(id, fieldType, prev)
        if (!placement) return prev
        return [...prev, placement]
      })
    }
    setSelectedWidgetId(id)
  }

  /** Apply a container preset — regenerate IDs to avoid collisions */
  const handleApplyPreset = (preset: typeof CONTAINER_PRESETS[number]) => {
    const idMap = new Map<string, string>()
    const widgets: CompositeWidget[] = preset.widgets.map((w) => {
      const newId = `w-${crypto.randomUUID()}`
      idMap.set(w.id, newId)
      return { id: newId, type: w.type, label: w.label, config: JSON.parse(JSON.stringify(w.config)) }
    })
    const layout = preset.layout
      .filter(l => idMap.has(l.i))
      .map(l => ({
        i: idMap.get(l.i)!,
        x: l.x, y: l.y, w: l.w, h: l.h,
      }))
    setCompositeWidgets(widgets)
    setCompositeLayout(layout)
    setSelectedWidgetId(null)
    setAddingWidgetType(null)
  }

  /** Remove a widget from the composite container */
  const handleRemoveCompositeWidget = (widgetId: string) => {
    setCompositeWidgets((prev) => prev.filter((w) => w.id !== widgetId))
    setCompositeLayout((prev) => prev.filter((l) => l.i !== widgetId))
    if (selectedWidgetId === widgetId) setSelectedWidgetId(null)
  }

  /** Update a widget's config in the composite container */
  const handleUpdateWidgetConfig = (widgetId: string, config: Record<string, unknown>) => {
    setCompositeWidgets((prev) =>
      prev.map((w) => (w.id === widgetId ? { ...w, config } : w)),
    )
  }

  /** Update a widget's label */
  const handleUpdateWidgetLabel = (widgetId: string, label: string) => {
    setCompositeWidgets((prev) =>
      prev.map((w) => (w.id === widgetId ? { ...w, label } : w)),
    )
  }

  if (!isOpen) return null

  // Show all system fields (already-added ones rendered as disabled)
  const availableSystemFields = systemFields
  const availableCustomFields = customFields.filter(f => !existingFieldSlugs.includes(f.slug))

  // Search filtering for Use Existing
  const searchLower = librarySearch.trim().toLowerCase()
  const filteredSystemFields = (() => {
    if (libraryFilter === 'custom') return []
    let fields = availableSystemFields
    if (searchLower) fields = fields.filter(f => f.name.toLowerCase().includes(searchLower))
    return fields
  })()
  const filteredCustomFields = (() => {
    if (libraryFilter === 'system') return []
    let fields = availableCustomFields
    if (searchLower) fields = fields.filter(f => f.name.toLowerCase().includes(searchLower))
    return fields
  })()

  // Counts for metadata header (only truly addable fields)
  const standardCount = availableSystemFields.filter(f => !existingFieldSlugs.includes(f.slug)).length + Object.values(presetsByCategory).flat().filter(p => !existingFieldSlugs.includes(p.slug)).length
  const customCount = availableCustomFields.length
  const totalAvailable = standardCount + customCount

  // Container name duplicate check (reuses customName)
  const containerNameTrimmed = customName.trim().toLowerCase()
  const containerNameDuplicate = containerNameTrimmed.length >= 2 && [
    ...systemFields.map(f => f.name.toLowerCase()),
    ...customFields.map(f => f.name.toLowerCase()),
  ].includes(containerNameTrimmed)

  // Modal title and subtitle by mode
  const modalTitle = mode === 'addExisting' ? 'Add to Layout' : 'Create New Field'
  const modalSubtitle = mode === 'addExisting' ? `${totalAvailable} fields available` : 'Define a new reusable data field'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className={clsx(
        "bg-white rounded-xl shadow-xl w-full mx-4 flex flex-col transition-all duration-200",
        fieldKind === 'multi' && createStep === 3
          ? 'max-w-[1400px] h-[90vh]'
          : 'max-w-3xl h-[85vh]',
        'overflow-hidden'
      )}>
        {/* Header */}
        <div className="px-6 pt-5 pb-0 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h3 className="text-lg font-bold text-gray-900 tracking-tight">{modalTitle}</h3>
              <p className="text-[13px] text-gray-400 mt-0.5">{modalSubtitle}</p>
            </div>
            <button onClick={() => { resetCustom(); onClose() }} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Context anchor */}
          {sectionName && (
            <div className="mb-3 flex items-center gap-1.5 text-[12px] text-gray-400">
              <span>Adding to:</span>
              <span className="font-medium text-gray-600">{sectionName}</span>
            </div>
          )}

          {/* 2-tab navigation — underline style */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => { if (mode !== 'addExisting') { resetCustom(); setMode('addExisting') } }}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                mode === 'addExisting'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              <Library className="w-4 h-4" />
              Add existing
            </button>
            <button
              onClick={() => { if (mode !== 'createField') { resetCustom(); setMode('createField') } }}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                mode === 'createField'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              <Plus className="w-4 h-4" />
              Create field
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 min-w-0 px-6 overflow-x-hidden">

          {/* ═══════════════════════════════════════════════════════════════
              MODE 1: USE EXISTING FIELD
              ═══════════════════════════════════════════════════════════════ */}
          {mode === 'addExisting' && (
            <>
              <div className="flex-1 overflow-y-auto overflow-x-hidden py-4">
                <div className="space-y-4">
                  {/* Search + Filters */}
                  <div className="space-y-3">
                    {/* Search input */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={librarySearch}
                        onChange={(e) => { setLibrarySearch(e.target.value); setHighlightFieldId(null) }}
                        placeholder="Search fields by name..."
                        className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                        autoFocus
                      />
                      {librarySearch && (
                        <button
                          onClick={() => setLibrarySearch('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Filter pills + metadata */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="inline-flex items-center bg-gray-100 rounded-lg p-0.5 flex-shrink-0">
                        {(['all', 'system', 'custom'] as const).map(filter => (
                          <button
                            key={filter}
                            onClick={() => setLibraryFilter(filter)}
                            className={clsx(
                              'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                              libraryFilter === filter
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                            )}
                          >
                            {filter === 'all' ? 'All' : filter === 'system' ? 'System' : 'Custom'}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-3 min-w-0">
                        {selectedFields.size > 0 && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full">
                            {selectedFields.size} selected
                          </span>
                        )}
                        <span className="text-[11px] text-gray-400">
                          {standardCount} system{' '}
                          <span className="text-gray-300 mx-0.5">&middot;</span>{' '}
                          {customCount} custom
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Highlight bar for post-create */}
                  {highlightFieldId && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm">
                      <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span className="text-emerald-800 font-medium">Field created</span>
                      <span className="text-emerald-600">— select it below to add to your section.</span>
                      <button onClick={() => setHighlightFieldId(null)} className="ml-auto text-emerald-400 hover:text-emerald-600 p-0.5">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Field Library - merged system fields and presets by category */}
                  {libraryFilter !== 'custom' && (
                    isLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                      </div>
                    ) : (() => {
                      const getSystemFieldCategory = (field: SystemField): string => {
                        const name = field.name.toLowerCase()
                        const type = field.type
                        if (name.includes('thesis') || name.includes('business model') ||
                            name.includes('differ') || name.includes('risks')) return 'analysis'
                        if (name.includes('catalyst') || name.includes('event')) return 'events'
                        if (type === 'rating' || type === 'price_target' || type === 'estimates' ||
                            name.includes('rating') || name.includes('target') || name.includes('estimate')) return 'data'
                        if (name.includes('document')) return 'specialized'
                        return 'analysis'
                      }

                      const mergedCategories = new Map<string, { systemFields: SystemField[], presets: typeof presetsByCategory[string] }>()
                      filteredSystemFields.forEach(field => {
                        const category = getSystemFieldCategory(field)
                        if (!mergedCategories.has(category)) mergedCategories.set(category, { systemFields: [], presets: [] })
                        mergedCategories.get(category)!.systemFields.push(field)
                      })
                      // Filter presets by search too
                      Object.entries(presetsByCategory).forEach(([category, categoryPresets]) => {
                        const filtered = searchLower
                          ? categoryPresets.filter(p => p.name.toLowerCase().includes(searchLower))
                          : categoryPresets
                        if (filtered.length > 0) {
                          if (!mergedCategories.has(category)) mergedCategories.set(category, { systemFields: [], presets: [] })
                          mergedCategories.get(category)!.presets = filtered
                        }
                      })

                      const sortedCategories = Array.from(mergedCategories.entries()).sort((a, b) => a[0].localeCompare(b[0]))
                      if (sortedCategories.length === 0) return null

                      return sortedCategories.map(([category, { systemFields: catSystemFields, presets: catPresets }]) => (
                        <div key={category}>
                          <div className="flex items-center gap-2 mb-2.5 bg-gray-50/80 px-2 py-1.5 rounded-md">
                            <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                              {category}
                            </h4>
                            <div className="flex-1 h-px bg-gray-200/60" />
                            <span className="text-[11px] text-gray-400 font-medium">{catSystemFields.filter(f => !existingFieldSlugs.includes(f.slug)).length + catPresets.filter(p => !existingFieldSlugs.includes(p.slug)).length}</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {catSystemFields.map(field => {
                              const isAdded = existingFieldSlugs.includes(field.slug)
                              const isSelected = selectedFields.has(field.id)
                              const isHighlighted = highlightFieldId === field.id || highlightFieldId === field.slug
                              return (
                                <div
                                  key={field.id}
                                  onClick={() => !isAdded && toggleFieldSelection({
                                    type: 'system',
                                    id: field.id,
                                    name: field.name,
                                    fieldType: field.type,
                                    description: field.description
                                  })}
                                  className={clsx(
                                    'flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left group min-w-0',
                                    'transition-all duration-150 ease-in-out',
                                    isAdded
                                      ? 'border-gray-100 bg-gray-50/50 opacity-40 cursor-not-allowed'
                                      : isSelected
                                        ? 'border-primary-400 bg-primary-50/50 shadow-md cursor-pointer border-l-[3px] border-l-primary-500 ring-1 ring-inset ring-primary-100'
                                        : isHighlighted
                                          ? 'border-emerald-300 bg-emerald-50/50 shadow-sm cursor-pointer ring-1 ring-emerald-200'
                                          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm hover:bg-gray-50/40 cursor-pointer'
                                  )}
                                >
                                  {!isAdded ? (
                                    <div className={clsx(
                                      'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                                      isSelected
                                        ? 'border-primary-500 bg-primary-500'
                                        : 'border-gray-300 group-hover:border-gray-400'
                                    )}>
                                      {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                    </div>
                                  ) : (
                                    <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                                      <Check className="w-3 h-3 text-gray-300" />
                                    </div>
                                  )}
                                  <FieldTypeIcon type={field.type} className={clsx(
                                    'w-4 h-4 flex-shrink-0 transition-colors',
                                    isAdded ? 'text-gray-300' : isSelected ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
                                  )} />
                                  <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-gray-900 block truncate">{field.name}</span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[11px] text-gray-400">{formatFieldType(field.type)}</span>
                                      <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-medium flex-shrink-0">System</span>
                                    </div>
                                  </div>
                                  {isAdded && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 text-gray-400 bg-gray-100">Added</span>
                                  )}
                                </div>
                              )
                            })}
                            {catPresets.map(preset => {
                              const isAdded = existingFieldSlugs.includes(preset.slug)
                              const isSelected = selectedFields.has(preset.slug)
                              return (
                                <div
                                  key={preset.slug}
                                  onClick={() => !isAdded && toggleFieldSelection({
                                    type: 'preset',
                                    id: preset.slug,
                                    name: preset.name,
                                    fieldType: preset.field_type,
                                    description: preset.description || undefined,
                                    slug: preset.slug
                                  })}
                                  className={clsx(
                                    'flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left group min-w-0',
                                    'transition-all duration-150 ease-in-out',
                                    isAdded
                                      ? 'border-gray-100 bg-gray-50/50 opacity-40 cursor-not-allowed'
                                      : isSelected
                                        ? 'border-primary-400 bg-primary-50/50 shadow-md cursor-pointer border-l-[3px] border-l-primary-500 ring-1 ring-inset ring-primary-100'
                                        : 'border-gray-200 hover:border-gray-300 hover:shadow-sm hover:bg-gray-50/40 cursor-pointer'
                                  )}
                                >
                                  {!isAdded ? (
                                    <div className={clsx(
                                      'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                                      isSelected
                                        ? 'border-primary-500 bg-primary-500'
                                        : 'border-gray-300 group-hover:border-gray-400'
                                    )}>
                                      {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                    </div>
                                  ) : (
                                    <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                                      <Check className="w-3 h-3 text-gray-300" />
                                    </div>
                                  )}
                                  <FieldTypeIcon type={preset.field_type} className={clsx(
                                    'w-4 h-4 flex-shrink-0 transition-colors',
                                    isAdded ? 'text-gray-300' : isSelected ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
                                  )} />
                                  <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-gray-900 block truncate">{preset.name}</span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[11px] text-gray-400">{formatFieldType(preset.field_type)}</span>
                                      <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-medium flex-shrink-0">System</span>
                                    </div>
                                  </div>
                                  {isAdded && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 text-gray-400 bg-gray-100">Added</span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))
                    })()
                  )}

                  {/* Custom Fields Section */}
                  {libraryFilter !== 'system' && (
                    customFieldsLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                      </div>
                    ) : filteredCustomFields.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2.5 bg-gray-50/80 px-2 py-1.5 rounded-md">
                          <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                            Custom Fields
                          </h4>
                          <div className="flex-1 h-px bg-gray-200/60" />
                          <span className="text-[11px] text-gray-400 font-medium">{filteredCustomFields.length}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {filteredCustomFields.map(field => {
                            const isSelected = selectedFields.has(field.id)
                            const isHighlighted = highlightFieldId === field.id || highlightFieldId === field.slug
                            return (
                              <div
                                key={field.id}
                                onClick={() => toggleFieldSelection({
                                  type: 'custom',
                                  id: field.id,
                                  name: field.name,
                                  fieldType: field.field_type,
                                  description: field.description || undefined
                                })}
                                className={clsx(
                                  'flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left cursor-pointer group min-w-0',
                                  'transition-all duration-150 ease-in-out',
                                  isSelected
                                    ? 'border-primary-400 bg-primary-50/50 shadow-md border-l-[3px] border-l-primary-500 ring-1 ring-inset ring-primary-100'
                                    : isHighlighted
                                      ? 'border-emerald-300 bg-emerald-50/50 shadow-sm ring-1 ring-emerald-200'
                                      : 'border-gray-200 hover:border-gray-300 hover:shadow-sm hover:bg-gray-50/40'
                                )}
                              >
                                <div className={clsx(
                                  'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                                  isSelected
                                    ? 'border-primary-500 bg-primary-500'
                                    : 'border-gray-300 group-hover:border-gray-400'
                                )}>
                                  {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                </div>
                                <FieldTypeIcon type={field.field_type} className={clsx(
                                  'w-4 h-4 flex-shrink-0 transition-colors',
                                  isSelected ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
                                )} />
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm font-medium text-gray-900 block truncate">{field.name}</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] text-gray-400 truncate">
                                      {formatFieldType(field.field_type)}
                                      {field.author_name && <> <span className="text-gray-300">&middot;</span> by {field.author_name}</>}
                                    </span>
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-purple-50 text-purple-600 font-medium flex-shrink-0">Custom</span>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  )}

                  {/* Empty states */}
                  {libraryFilter === 'custom' && filteredCustomFields.length === 0 && !customFieldsLoading && (
                    <div className="text-center py-8">
                      <p className="text-sm text-gray-500 mb-2">No custom fields found.</p>
                      <p className="text-xs text-gray-400 mb-3">
                        {searchLower ? 'Try a different search term or ' : ''}Create a new field to get started.
                      </p>
                      <Button onClick={() => { resetCustom(); setMode('createField') }} className="inline-flex">
                        <Plus className="w-4 h-4 mr-1" />
                        Create New Field
                      </Button>
                    </div>
                  )}

                  {libraryFilter === 'system' && filteredSystemFields.length === 0 && Object.keys(presetsByCategory).length === 0 && !isLoading && (
                    <p className="text-sm text-gray-500 text-center py-8">
                      {searchLower ? 'No system fields match your search' : 'All system fields have been added'}
                    </p>
                  )}

                  {libraryFilter === 'all' && filteredSystemFields.length === 0 && filteredCustomFields.length === 0 && !isLoading && !customFieldsLoading && (
                    <p className="text-sm text-gray-500 text-center py-8">
                      {searchLower ? 'No fields match your search' : 'All fields have been added to this section'}
                    </p>
                  )}
                </div>
              </div>

              {/* Sticky action bar */}
              <div className="flex-shrink-0 py-3 border-t border-gray-200 bg-white">
                <div className="flex items-center justify-between gap-4 min-w-0">
                  <div className="flex items-center gap-3 min-w-0">
                    {selectedFields.size > 0 ? (
                      <>
                        <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                          {selectedFields.size} field{selectedFields.size !== 1 ? 's' : ''} selected
                        </span>
                        <button
                          onClick={clearSelection}
                          className="text-xs text-gray-400 hover:text-gray-600 transition-colors whitespace-nowrap"
                        >
                          Clear
                        </button>
                      </>
                    ) : (
                      <span className="text-sm text-gray-400 whitespace-nowrap">Select fields to add</span>
                    )}
                  </div>
                  <Button
                    onClick={() => handleAddSelected(customFields)}
                    disabled={selectedFields.size === 0}
                    className="flex-shrink-0"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    {selectedFields.size > 0
                      ? `Add ${selectedFields.size} to Section`
                      : 'Add to Section'
                    }
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              MODE 2: CREATE FIELD — Step-based builder
              Steps: 1 = Basics, 2 = Structure, 3 = Content
              ═══════════════════════════════════════════════════════════════ */}
          {mode === 'createField' && (
            <>
              {/* ── Stepper ── */}
              {(() => {
                const step1Valid = !!customName.trim() && !exactMatch && (similarFields.length === 0 || createAnywayConfirmed)
                const step2Valid = !!fieldKind
                const STEPS = [
                  { step: 1 as const, label: 'Basics', hint: 'Name and describe this field' },
                  { step: 2 as const, label: 'Structure', hint: 'Single value or container' },
                  { step: 3 as const, label: 'Content', hint: 'Pick type and configure' },
                ] as const
                return (
                  <div className="flex-shrink-0 pt-4 pb-3">
                    <div className="flex items-center">
                      {STEPS.map(({ step, label, hint }, idx) => {
                        const isActive = createStep === step
                        const isComplete = createStep > step
                        const canClickForward = (step === 2 && step1Valid) || (step === 3 && step1Valid && step2Valid)
                        const isClickable = step < createStep || (step > createStep && canClickForward)
                        return (
                          <div key={step} className="flex items-center flex-1">
                            <button
                              onClick={() => { if (isClickable) setCreateStep(step) }}
                              disabled={!isClickable}
                              className={clsx(
                                'flex items-center gap-2.5 transition-colors',
                                isClickable ? 'cursor-pointer' : isActive ? 'cursor-default' : 'cursor-not-allowed'
                              )}
                            >
                              <div className={clsx(
                                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all',
                                isActive
                                  ? 'bg-gray-900 text-white shadow-sm'
                                  : isComplete
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-gray-200 text-gray-400'
                              )}>
                                {isComplete ? <Check className="w-3.5 h-3.5" /> : step}
                              </div>
                              <div>
                                <span className={clsx(
                                  'text-sm block leading-tight transition-colors',
                                  isActive ? 'font-semibold text-gray-900' : isComplete ? 'font-medium text-gray-600' : 'font-medium text-gray-400/70'
                                )}>
                                  {label}
                                </span>
                                <span className={clsx(
                                  'text-[10px] leading-tight transition-colors',
                                  isActive ? 'text-gray-500' : 'text-gray-400/60'
                                )}>
                                  {hint}
                                </span>
                              </div>
                            </button>
                            {idx < 2 && (
                              <div className={clsx(
                                'flex-1 h-px mx-3',
                                isComplete ? 'bg-emerald-300' : 'bg-gray-200'
                              )} />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* ── Step Bodies ── */}
              {createStep === 1 && (
                /* ── STEP 1: Basics ── */
                <div className="flex-1 overflow-y-auto overflow-x-hidden pr-2">
                  <div className="max-w-lg mx-auto space-y-3 pt-1 pb-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Field Name</label>
                      <input
                        type="text"
                        value={customName}
                        onChange={(e) => { setCustomName(e.target.value.slice(0, FIELD_NAME_MAX_LENGTH)); setError(''); setCreateAnywayConfirmed(false) }}
                        onBlur={() => setNameBlurred(true)}
                        placeholder="e.g., Management Quality"
                        maxLength={FIELD_NAME_MAX_LENGTH}
                        className={clsx(
                          'w-full px-3 py-2.5 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent',
                          nameBlurred && !customName.trim() ? 'border-red-300' : 'border-gray-300'
                        )}
                        autoFocus
                      />
                      <div className="flex justify-between mt-1">
                        {error ? (
                          <p className="text-sm text-red-500">{error}</p>
                        ) : nameBlurred && !customName.trim() ? (
                          <p className="text-xs text-red-500">Name is required.</p>
                        ) : (
                          <span />
                        )}
                        <span className="text-[10px] text-gray-300">{customName.length}/{FIELD_NAME_MAX_LENGTH}</span>
                      </div>
                    </div>

                    {/* Similar Fields Warning */}
                    {similarFields.length > 0 && (
                      <div className={clsx(
                        'rounded-lg border p-3',
                        exactMatch ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
                      )}>
                        <div className="flex items-start gap-2 mb-2">
                          <AlertTriangle className={clsx('w-4 h-4 mt-0.5 flex-shrink-0', exactMatch ? 'text-red-500' : 'text-amber-500')} />
                          <p className={clsx('text-xs font-medium', exactMatch ? 'text-red-800' : 'text-amber-800')}>
                            {exactMatch
                              ? 'A field with this exact name already exists.'
                              : 'Similar fields already exist:'}
                          </p>
                        </div>
                        <div className="space-y-1 ml-6">
                          {similarFields.map((f, i) => (
                            <div key={i} className="flex items-center gap-2 bg-white rounded px-2 py-1.5 border border-gray-200">
                              <span className="text-sm font-medium text-gray-900 truncate">{f.name}</span>
                              <span className="text-[10px] text-gray-500 flex-shrink-0">{f.type.replace(/_/g, ' ')}</span>
                              {f.source === 'system' && (
                                <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full flex-shrink-0">System</span>
                              )}
                              {!existingFieldSlugs.includes(f.slug) && (
                                <button
                                  onClick={() => {
                                    toggleFieldSelection({ type: f.source, id: f.id, name: f.name, fieldType: f.type, description: f.description, slug: f.slug })
                                    switchToUseExisting(f.id)
                                  }}
                                  className="ml-auto text-[10px] font-medium text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 px-2 py-0.5 rounded transition-colors flex-shrink-0"
                                >
                                  Use Instead
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        {!exactMatch && (
                          <label className="flex items-center gap-2 mt-3 ml-6 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={createAnywayConfirmed}
                              onChange={(e) => setCreateAnywayConfirmed(e.target.checked)}
                              className="w-3.5 h-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            <span className="text-[11px] text-gray-500">I want to create a new field anyway</span>
                          </label>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Description <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      <textarea
                        value={customDescription}
                        onChange={(e) => setCustomDescription(e.target.value)}
                        placeholder="What does this field capture?"
                        rows={2}
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}

              {createStep === 2 && (
                /* ── STEP 2: Structure ── */
                <div className="flex-1 overflow-y-auto overflow-x-hidden pr-2">
                  <div className="max-w-lg mx-auto pt-1 pb-2">
                    <div className="space-y-3">
                      <button
                        onClick={() => handleStructureSelect('single')}
                        className={clsx(
                          'w-full p-4 rounded-xl border-2 text-left transition-all group',
                          fieldKind === 'single'
                            ? 'border-gray-900 bg-gray-50/80'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={clsx(
                            'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                            fieldKind === 'single' ? 'bg-blue-100' : 'bg-blue-50'
                          )}>
                            <Hash className="w-5 h-5 text-blue-500" />
                          </div>
                          <div className="flex-1">
                            <span className="text-sm font-semibold text-gray-900">Single value field</span>
                            <p className="text-xs text-gray-500 mt-0.5">One data type per field — text, number, rating, etc.</p>
                          </div>
                          {fieldKind === 'single' ? (
                            <div className="w-5 h-5 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" />
                          )}
                        </div>
                      </button>

                      <button
                        onClick={() => handleStructureSelect('multi')}
                        className={clsx(
                          'w-full p-4 rounded-xl border-2 text-left transition-all group',
                          fieldKind === 'multi'
                            ? 'border-gray-900 bg-gray-50/80'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={clsx(
                            'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                            fieldKind === 'multi' ? 'bg-violet-100' : 'bg-violet-50'
                          )}>
                            <LayoutGrid className="w-5 h-5 text-violet-500" />
                          </div>
                          <div className="flex-1">
                            <span className="text-sm font-semibold text-gray-900">Multi-widget field</span>
                            <p className="text-xs text-gray-500 mt-0.5">Multiple fields in a resizable grid layout.</p>
                          </div>
                          {fieldKind === 'multi' ? (
                            <div className="w-5 h-5 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" />
                          )}
                        </div>
                      </button>
                    </div>

                    {!fieldKind && (
                      <p className="text-xs text-gray-400 text-center mt-4">Select a structure to continue.</p>
                    )}
                  </div>
                </div>
              )}

              {createStep === 3 && fieldKind === 'single' && (
                /* ── STEP 3: Content — Single widget type picker ── */
                <div className="flex-1 flex min-h-0 overflow-hidden pt-1">
                  {/* Left: type picker */}
                  <div className="flex-1 min-w-0 flex flex-col min-h-0 pr-4">
                    {/* Search */}
                    <div className="flex-shrink-0 mb-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input
                          ref={typeSearchRef}
                          type="text"
                          value={typeSearch}
                          onChange={(e) => { setTypeSearch(e.target.value); if (e.target.value) setAllTypesExpanded(true) }}
                          placeholder="Search field types..."
                          className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          autoFocus={!customType}
                        />
                        {typeSearch && (
                          <button onClick={() => setTypeSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-1">
                      {(() => {
                        const searchLc = typeSearch.trim().toLowerCase()
                        const COMMON_TYPES = ['rich_text', 'rating', 'single_select', 'numeric', 'percentage', 'currency']

                        // Filter gallery items
                        const filteredGallery = WIDGET_GALLERY.map(cat => ({
                          ...cat,
                          items: cat.items.filter(item =>
                            !searchLc ||
                            item.label.toLowerCase().includes(searchLc) ||
                            item.description.toLowerCase().includes(searchLc) ||
                            item.value.toLowerCase().includes(searchLc)
                          ),
                        })).filter(cat => cat.items.length > 0)

                        // Common types (only when not searching)
                        const commonItems = !searchLc
                          ? COMMON_TYPES.map(v => WIDGET_GALLERY_MAP[v]).filter(Boolean)
                          : []

                        // When type is selected and not searching, collapse categories unless expanded
                        const showCategories = searchLc || allTypesExpanded || !customType

                        if (filteredGallery.length === 0 && commonItems.length === 0) {
                          return (
                            <div className="flex flex-col items-center justify-center py-8 text-center">
                              <Search className="w-6 h-6 text-gray-300 mb-2" />
                              <p className="text-sm text-gray-500">No field types match &ldquo;{typeSearch}&rdquo;</p>
                              <button onClick={() => setTypeSearch('')} className="mt-2 text-xs text-primary-600 hover:text-primary-700">Clear search</button>
                            </div>
                          )
                        }

                        return (
                          <div className="space-y-3">
                            {/* Common types */}
                            {commonItems.length > 0 && (
                              <div>
                                <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Common</h4>
                                <div className="grid grid-cols-2 gap-1.5">
                                  {commonItems.map(item => {
                                    const isSelected = customType === item.value
                                    return (
                                      <button
                                        key={item.value}
                                        onClick={() => handleSelectWidgetType(item.value)}
                                        className={clsx(
                                          'flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all',
                                          isSelected
                                            ? 'border-gray-900 bg-gray-50 shadow-sm'
                                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                                        )}
                                      >
                                        <FieldTypeIcon type={item.value} className={clsx('w-4 h-4 flex-shrink-0', isSelected ? 'text-gray-700' : 'text-gray-400')} />
                                        <span className={clsx('text-sm font-medium', isSelected ? 'text-gray-900' : 'text-gray-700')}>{item.label}</span>
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Toggle to show/hide all categories */}
                            {!searchLc && customType && (
                              <button
                                onClick={() => setAllTypesExpanded(!allTypesExpanded)}
                                className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 transition-colors"
                              >
                                {allTypesExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                {allTypesExpanded ? 'Hide all types' : 'Show all types'}
                              </button>
                            )}

                            {/* All categories (shown when: no type selected, searching, or expanded) */}
                            {showCategories && filteredGallery.map(category => (
                              <div key={category.key}>
                                <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{category.label}</h4>
                                <div className="space-y-1">
                                  {category.items.map(item => {
                                    const isSelected = customType === item.value
                                    return (
                                      <button
                                        key={item.value}
                                        onClick={() => handleSelectWidgetType(item.value)}
                                        className={clsx(
                                          'w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-all group',
                                          isSelected
                                            ? 'border-gray-900 bg-gray-50 shadow-sm'
                                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                                        )}
                                      >
                                        <FieldTypeIcon type={item.value} className={clsx('w-4 h-4 flex-shrink-0', isSelected ? 'text-gray-700' : 'text-gray-400 group-hover:text-gray-500')} />
                                        <div className="flex-1 min-w-0">
                                          <span className={clsx('text-sm font-medium block', isSelected ? 'text-gray-900' : 'text-gray-700')}>{item.label}</span>
                                          <span className="text-xs text-gray-400">{item.description}</span>
                                        </div>
                                        {item.hasConfig && (
                                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 flex-shrink-0">configurable</span>
                                        )}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Vertical divider */}
                  <div className="w-px bg-gray-200 flex-shrink-0" />

                  {/* Right: Preview & Config */}
                  <div className="w-64 flex-shrink-0 pl-4 flex flex-col min-h-0 overflow-y-auto">
                    {customType ? (
                      <div className="space-y-4">
                        {/* Selected type header with Change */}
                        {(() => {
                          const gi = WIDGET_GALLERY_MAP[customType]
                          return (
                            <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                              <FieldTypeIcon type={customType} className="w-5 h-5 text-gray-600" />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-semibold text-gray-900">{gi?.label ?? customType}</span>
                                <p className="text-[11px] text-gray-400">{gi?.description}</p>
                              </div>
                              <button
                                onClick={() => { setCustomType(null); setCustomConfig({}); setAllTypesExpanded(true); setTimeout(() => typeSearchRef.current?.focus(), 50) }}
                                className="text-[11px] text-primary-600 hover:text-primary-700 font-medium flex-shrink-0 transition-colors"
                              >
                                Change
                              </button>
                            </div>
                          )
                        })()}

                        {/* Config editor */}
                        {isConfigurableFieldType(customType) && (
                          <div>
                            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Configuration</label>
                            <FieldConfigEditor
                              fieldType={customType}
                              config={customConfig}
                              onChange={setCustomConfig}
                            />
                          </div>
                        )}

                        {/* Preview */}
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Preview</label>
                          <div className="rounded-lg border border-gray-200 p-3 bg-gray-50/50">
                            <FieldTypePreview type={customType} />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-center py-8">
                        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                          <Eye className="w-5 h-5 text-gray-300" />
                        </div>
                        <p className="text-sm font-medium text-gray-500 mb-1">Preview</p>
                        <p className="text-xs text-gray-400 max-w-[180px]">Select a field type to see a live preview and configuration options.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {createStep === 3 && fieldKind === 'multi' && (
                /* ── STEP 3: Content — Multi-widget container builder ── */
                (() => {
                  const search = linkFieldSearch.trim().toLowerCase()
                  const systemLinkable = systemFields
                    .map(f => ({ id: f.id, name: f.name, fieldType: f.type, config: undefined as Record<string, unknown> | undefined, source: 'system' as const }))
                    .filter(f => !search || f.name.toLowerCase().includes(search))
                  const customLinkable = customFields
                    .filter(f => f.field_type !== 'composite')
                    .map(f => ({ id: f.id, name: f.name, fieldType: f.field_type, config: f.config ?? undefined, source: 'custom' as const }))
                    .filter(f => !search || f.name.toLowerCase().includes(search))

                  const selectedWidget = compositeWidgets.find(w => w.id === selectedWidgetId) ?? null
                  const selectedIsLinked = !!selectedWidget?.linked_field_id

                  return (
                  <div className="flex-1 flex min-h-0 overflow-hidden pt-1 gap-0">
                    {/* ══ LEFT PANEL: Builder ══ */}
                    {!previewExpanded && <div className="flex-1 min-w-0 flex flex-col min-h-0 pr-3 relative">

                      {/* ── Controls row ── */}
                      <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                        {/* Column layout toggle */}
                        <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
                          <button
                            onClick={() => {
                              setContainerCols(1)
                              if (containerAutoLayout) setCompositeLayout(recomputeAutoLayout(compositeWidgets, 1))
                            }}
                            className={clsx(
                              'px-2 py-1 text-[11px] font-medium transition-colors',
                              containerCols === 1 ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                            )}
                            title="Single column layout"
                          >
                            1 col
                          </button>
                          <button
                            onClick={() => {
                              setContainerCols(2)
                              if (containerAutoLayout) setCompositeLayout(recomputeAutoLayout(compositeWidgets, 2))
                            }}
                            className={clsx(
                              'px-2 py-1 text-[11px] font-medium transition-colors border-l border-gray-200',
                              containerCols === 2 ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                            )}
                            title="Two column layout"
                          >
                            2 col
                          </button>
                        </div>

                        {/* Auto-layout toggle */}
                        <button
                          onClick={() => {
                            const next = !containerAutoLayout
                            setContainerAutoLayout(next)
                            if (next) setCompositeLayout(recomputeAutoLayout(compositeWidgets, containerCols))
                          }}
                          className={clsx(
                            'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors border',
                            containerAutoLayout
                              ? 'bg-primary-50 border-primary-200 text-primary-700'
                              : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                          )}
                          title={containerAutoLayout ? 'Auto-layout ON — widgets stack automatically' : 'Auto-layout OFF — drag to reposition'}
                        >
                          <LayoutGrid className="w-3 h-3" />
                          Auto
                        </button>

                        <div className="flex-1" />

                        {/* Clear all */}
                        {compositeWidgets.length > 0 && (
                          <button
                            onClick={() => {
                              if (compositeWidgets.length > 1) {
                                setConfirmDialogState({
                                  isOpen: true,
                                  title: 'Clear all widgets?',
                                  message: `This will remove all ${compositeWidgets.length} widgets and their configuration from this container.`,
                                  confirmText: 'Clear all',
                                  variant: 'danger',
                                  onConfirm: () => {
                                    setCompositeWidgets([]); setCompositeLayout([]); setSelectedWidgetId(null)
                                    setConfirmDialogState(prev => ({ ...prev, isOpen: false }))
                                  },
                                })
                              } else {
                                setCompositeWidgets([]); setCompositeLayout([]); setSelectedWidgetId(null)
                              }
                            }}
                            className="text-[11px] text-gray-400 hover:text-red-500 transition-colors"
                          >
                            Clear all
                          </button>
                        )}
                      </div>

                      {/* ── Widget list ── */}
                      <div className="flex-1 overflow-y-auto min-h-0">
                        {compositeWidgets.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-10 text-center">
                            <Layers className="w-8 h-8 text-gray-200 mb-3" />
                            <p className="text-sm text-gray-500 mb-1">No widgets yet</p>
                            <p className="text-xs text-gray-400 max-w-[220px] mb-4">Add widgets to compose your container field.</p>
                            <button
                              onClick={() => { setAddingContainerWidget(true); setLinkFieldSearch(''); setWidgetChooserTab('create') }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors"
                            >
                              <Plus className="w-4 h-4" />
                              Add first widget
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {compositeWidgets.map((widget, widgetIdx) => {
                              const isSelected = selectedWidgetId === widget.id
                              const isHovered = hoveredWidgetId === widget.id
                              const isLinked = !!widget.linked_field_id
                              const colors = WIDGET_TYPE_COLORS[widget.type] ?? DEFAULT_WIDGET_COLORS
                              const galleryItem = WIDGET_GALLERY_MAP[widget.type]
                              const isEditingLabel = editingWidgetLabel === widget.id
                              return (
                                <div
                                  key={widget.id}
                                  onClick={() => setSelectedWidgetId(isSelected ? null : widget.id)}
                                  onMouseEnter={() => setHoveredWidgetId(widget.id)}
                                  onMouseLeave={() => setHoveredWidgetId(null)}
                                  className={clsx(
                                    'flex items-start gap-1.5 px-2 py-2 rounded-lg border cursor-pointer transition-all group/widget',
                                    isSelected
                                      ? 'border-primary-400 bg-primary-50/50 shadow-sm ring-1 ring-primary-200'
                                      : isHovered
                                        ? 'border-gray-300 bg-gray-50/80'
                                        : 'border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300'
                                  )}
                                >
                                  {/* Drag handle */}
                                  <div
                                    className="flex-shrink-0 pt-0.5"
                                    title={containerAutoLayout ? 'Turn off Auto to reorder manually' : 'Drag to reorder'}
                                  >
                                    <GripVertical className={clsx(
                                      'w-3.5 h-3.5',
                                      containerAutoLayout ? 'text-gray-200 cursor-default' : 'text-gray-400 cursor-grab active:cursor-grabbing'
                                    )} />
                                  </div>

                                  {/* Icon */}
                                  <FieldTypeIcon type={widget.type} className={clsx('w-3.5 h-3.5 flex-shrink-0 mt-0.5', isLinked ? 'text-primary-400' : colors.accent)} />

                                  {/* Label + subtitle */}
                                  <div className="flex-1 min-w-0">
                                    {isEditingLabel ? (
                                      <input
                                        autoFocus
                                        defaultValue={widget.label}
                                        className="w-full text-[13px] font-medium text-gray-800 bg-white border border-primary-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
                                        onClick={(e) => e.stopPropagation()}
                                        onBlur={(e) => {
                                          const val = e.target.value.trim()
                                          if (val && val !== widget.label) {
                                            setCompositeWidgets(prev => prev.map(w => w.id === widget.id ? { ...w, label: val } : w))
                                          }
                                          setEditingWidgetLabel(null)
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                          if (e.key === 'Escape') setEditingWidgetLabel(null)
                                        }}
                                      />
                                    ) : (
                                      <>
                                        <span
                                          className="block text-[13px] font-medium text-gray-800 truncate leading-tight"
                                          onDoubleClick={(e) => { e.stopPropagation(); setEditingWidgetLabel(widget.id) }}
                                          title="Double-click to rename"
                                        >
                                          {widget.label}
                                        </span>
                                        <span className={clsx('block text-[10px] leading-tight mt-0.5', widgetSimilarityWarnings.has(widget.id) ? 'text-amber-500' : 'text-gray-400')}>
                                          {widgetSimilarityWarnings.has(widget.id)
                                            ? `Similar to "${widgetSimilarityWarnings.get(widget.id)![0].name}"`
                                            : isLinked ? 'Linked field' : 'Standalone'
                                          }
                                        </span>
                                      </>
                                    )}
                                  </div>

                                  {/* Type badge + warning dot */}
                                  <span className={clsx('text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5', colors.bg, colors.accent)}>
                                    {galleryItem?.label ?? widget.type}
                                  </span>
                                  {widgetSimilarityWarnings.has(widget.id) && (
                                    <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 mt-1" title="Similar to an existing field" />
                                  )}

                                  {/* Hover actions */}
                                  <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5 opacity-0 group-hover/widget:opacity-100 transition-opacity">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleDuplicateWidget(widget.id) }}
                                      className="p-0.5 text-gray-300 hover:text-gray-600 rounded transition-colors"
                                      title="Duplicate"
                                    >
                                      <Copy className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleRemoveCompositeWidget(widget.id) }}
                                      className="p-0.5 text-gray-300 hover:text-red-500 rounded transition-colors"
                                      title="Remove"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* ── Similarity warning: widgets matching existing fields ── */}
                      {widgetSimilarityWarnings.size > 0 && !builderTipDismissed && (
                        <div className="flex items-start gap-2 mt-1.5 px-2.5 py-2 rounded-lg bg-amber-50/70 border border-amber-100 flex-shrink-0">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                          <p className="text-[11px] text-amber-700 flex-1 leading-relaxed">
                            {widgetSimilarityWarnings.size === 1 ? '1 widget looks' : `${widgetSimilarityWarnings.size} widgets look`} similar to existing fields.
                            Select a flagged widget to review, or use <button onClick={() => { setAddingContainerWidget(true); setLinkFieldSearch(''); setWidgetChooserTab('reuse') }} className="font-semibold underline underline-offset-2 hover:text-amber-900">Reuse field</button> instead.
                          </p>
                          <button onClick={() => setBuilderTipDismissed(true)} className="p-0.5 text-amber-400 hover:text-amber-600 flex-shrink-0">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {/* ── Sticky bottom bar: Add widget ── */}
                      <div className="flex-shrink-0 pt-2 mt-1 border-t border-gray-100">
                        {compositeWidgets.length === 0 ? null : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => { setAddingContainerWidget(true); setLinkFieldSearch(''); setWidgetChooserTab('create') }}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-[12px] font-medium hover:bg-gray-800 transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add widget
                            </button>
                            <button
                              onClick={() => { setAddingContainerWidget(true); setLinkFieldSearch(''); setWidgetChooserTab('reuse') }}
                              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-[12px] font-medium hover:bg-gray-50 transition-colors"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                              Reuse field
                            </button>
                          </div>
                        )}
                      </div>

                      {/* ── Widget chooser overlay ── */}
                      {addingContainerWidget && (
                        <div className="absolute inset-0 bg-white z-10 flex flex-col rounded-lg border border-gray-200 shadow-lg">
                          {/* Header with tabs */}
                          <div className="flex items-center border-b border-gray-200 flex-shrink-0">
                            <button
                              onClick={() => setWidgetChooserTab('reuse')}
                              className={clsx(
                                'flex-1 px-3 py-2 text-[12px] font-medium text-center transition-colors border-b-2',
                                widgetChooserTab === 'reuse'
                                  ? 'border-primary-500 text-primary-700'
                                  : 'border-transparent text-gray-500 hover:text-gray-700'
                              )}
                            >
                              Reuse existing field
                            </button>
                            <button
                              onClick={() => setWidgetChooserTab('create')}
                              className={clsx(
                                'flex-1 px-3 py-2 text-[12px] font-medium text-center transition-colors border-b-2',
                                widgetChooserTab === 'create'
                                  ? 'border-primary-500 text-primary-700'
                                  : 'border-transparent text-gray-500 hover:text-gray-700'
                              )}
                            >
                              Create new widget
                            </button>
                            <button
                              onClick={() => setAddingContainerWidget(false)}
                              className="p-1.5 mr-1 text-gray-400 hover:text-gray-600 rounded transition-colors flex-shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Tab content */}
                          <div className="flex-1 overflow-y-auto p-3">
                            {widgetChooserTab === 'reuse' ? (
                              /* ── Reuse existing field tab ── */
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  value={linkFieldSearch}
                                  onChange={(e) => setLinkFieldSearch(e.target.value)}
                                  placeholder="Search fields..."
                                  className="w-full text-[12px] px-2.5 py-1.5 rounded-md border border-gray-200 focus:border-primary-400 focus:ring-0 focus:outline-none"
                                  autoFocus
                                />
                                {/* System fields */}
                                {systemLinkable.length > 0 && (
                                  <div>
                                    <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                      <Shield className="w-3 h-3" /> System fields
                                    </h4>
                                    <div className="space-y-0.5">
                                      {systemLinkable.slice(0, 8).map(f => {
                                        const alreadyLinked = linkedFieldIds.has(f.id)
                                        const colors = WIDGET_TYPE_COLORS[f.fieldType] ?? DEFAULT_WIDGET_COLORS
                                        return (
                                          <button
                                            key={f.id}
                                            onClick={() => { handleAddLinkedWidget(f.id, f.name, f.fieldType, f.config); setAddingContainerWidget(false); setLinkFieldSearch('') }}
                                            disabled={alreadyLinked}
                                            className={clsx(
                                              'w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left transition-colors text-[12px]',
                                              alreadyLinked ? 'opacity-40 cursor-not-allowed' : 'hover:bg-primary-50'
                                            )}
                                          >
                                            <FieldTypeIcon type={f.fieldType} className={clsx('w-3.5 h-3.5 flex-shrink-0', colors.accent)} />
                                            <span className="truncate flex-1 text-gray-700">{f.name}</span>
                                            {alreadyLinked && <span className="text-[9px] text-gray-400 flex-shrink-0">added</span>}
                                            <span className={clsx('text-[9px] px-1 py-0.5 rounded flex-shrink-0', colors.bg, colors.accent)}>
                                              {WIDGET_GALLERY_MAP[f.fieldType]?.label ?? f.fieldType}
                                            </span>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                                {/* Custom fields */}
                                {customLinkable.length > 0 && (
                                  <div>
                                    <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                      <User className="w-3 h-3" /> Custom fields
                                    </h4>
                                    <div className="space-y-0.5">
                                      {customLinkable.slice(0, 8).map(f => {
                                        const alreadyLinked = linkedFieldIds.has(f.id)
                                        const colors = WIDGET_TYPE_COLORS[f.fieldType] ?? DEFAULT_WIDGET_COLORS
                                        return (
                                          <button
                                            key={f.id}
                                            onClick={() => { handleAddLinkedWidget(f.id, f.name, f.fieldType, f.config); setAddingContainerWidget(false); setLinkFieldSearch('') }}
                                            disabled={alreadyLinked}
                                            className={clsx(
                                              'w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left transition-colors text-[12px]',
                                              alreadyLinked ? 'opacity-40 cursor-not-allowed' : 'hover:bg-primary-50'
                                            )}
                                          >
                                            <FieldTypeIcon type={f.fieldType} className={clsx('w-3.5 h-3.5 flex-shrink-0', colors.accent)} />
                                            <span className="truncate flex-1 text-gray-700">{f.name}</span>
                                            {alreadyLinked && <span className="text-[9px] text-gray-400 flex-shrink-0">added</span>}
                                            <span className={clsx('text-[9px] px-1 py-0.5 rounded flex-shrink-0', colors.bg, colors.accent)}>
                                              {WIDGET_GALLERY_MAP[f.fieldType]?.label ?? f.fieldType}
                                            </span>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                                {systemLinkable.length === 0 && customLinkable.length === 0 && (
                                  <p className="text-sm text-gray-400 text-center py-4">No matching fields found.</p>
                                )}
                              </div>
                            ) : (
                              /* ── Create new widget tab ── */
                              <div className="space-y-2">
                                {/* Common types */}
                                <div>
                                  <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Common</h4>
                                  <div className="grid grid-cols-2 gap-1">
                                    {['rich_text', 'numeric', 'single_select', 'boolean', 'percentage', 'currency'].map(typeValue => {
                                      const item = WIDGET_GALLERY_MAP[typeValue]
                                      if (!item) return null
                                      return (
                                        <button
                                          key={typeValue}
                                          onClick={() => { handleAddCompositeWidget(typeValue); setAddingContainerWidget(false) }}
                                          className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-left transition-all"
                                        >
                                          <FieldTypeIcon type={typeValue} className="w-3.5 h-3.5 text-gray-400" />
                                          <span className="text-[11px] font-medium text-gray-700 truncate">{item.label}</span>
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                                {/* All types by category */}
                                {WIDGET_GALLERY.map(category => (
                                  <div key={category.key}>
                                    <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{category.label}</h4>
                                    <div className="grid grid-cols-2 gap-1">
                                      {category.items.map(item => (
                                        <button
                                          key={item.value}
                                          onClick={() => { handleAddCompositeWidget(item.value); setAddingContainerWidget(false) }}
                                          className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-left transition-all"
                                        >
                                          <FieldTypeIcon type={item.value} className="w-3.5 h-3.5 text-gray-400" />
                                          <span className="text-[11px] font-medium text-gray-700 truncate">{item.label}</span>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>}

                    {/* ══ VERTICAL DIVIDER ══ */}
                    {!previewExpanded && <div className="w-px bg-gray-200 flex-shrink-0" />}

                    {/* ══ CENTER: Grid Canvas Preview ══ */}
                    <div className={clsx(
                      'flex-shrink-0 flex flex-col min-h-0 px-3 overflow-hidden',
                      previewExpanded ? 'flex-1' : 'w-[340px]'
                    )}>
                      <div className="flex items-center justify-between mb-1 flex-shrink-0">
                        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Layout Preview</span>
                        <button
                          onClick={() => setPreviewExpanded(!previewExpanded)}
                          className="p-0.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
                          title={previewExpanded ? 'Collapse preview' : 'Expand preview'}
                        >
                          {previewExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <style dangerouslySetInnerHTML={{ __html: BUILDER_GRID_STYLES }} />
                      <div
                        ref={gridContainerRef}
                        className="flex-1 min-h-0 rounded-lg border border-gray-200 overflow-y-auto overflow-x-hidden"
                        style={{
                          backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent calc(100%/12 - 1px), rgba(0,0,0,0.015) calc(100%/12 - 1px), rgba(0,0,0,0.015) calc(100%/12))`,
                          backgroundColor: '#fafbfc',
                        }}
                      >
                        {compositeWidgets.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-center py-8">
                            <LayoutGrid className="w-8 h-8 text-gray-200 mb-2" />
                            <p className="text-xs text-gray-400 max-w-[200px]">
                              Widgets will appear here as you add them.
                            </p>
                          </div>
                        ) : gridWidth > 0 ? (
                          <ResponsiveGridLayout
                            className="builder-grid"
                            layouts={{ lg: compositeLayout.map(l => ({ ...l, minW: 2, minH: 1 })) }}
                            breakpoints={{ lg: 0 }}
                            cols={{ lg: 12 }}
                            rowHeight={56}
                            width={gridWidth}
                            isDraggable={!containerAutoLayout}
                            isResizable={!containerAutoLayout}
                            compactType="vertical"
                            margin={[6, 6]}
                            containerPadding={[6, 6]}
                            onDragStop={(layout) => {
                              setCompositeLayout(layout.map(l => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })))
                            }}
                            onResizeStop={(layout) => {
                              setCompositeLayout(layout.map(l => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })))
                            }}
                          >
                            {compositeWidgets.map(widget => {
                              const wli = compositeLayout.find(l => l.i === widget.id)
                              return (
                                <div key={widget.id} className="h-full">
                                  <BuilderWidgetCell
                                    widget={widget}
                                    isSelected={selectedWidgetId === widget.id}
                                    isHovered={hoveredWidgetId === widget.id}
                                    onSelect={() => setSelectedWidgetId(selectedWidgetId === widget.id ? null : widget.id)}
                                    onRemove={() => handleRemoveCompositeWidget(widget.id)}
                                    layoutItem={wli ? { w: wli.w, h: wli.h } : undefined}
                                  />
                                </div>
                              )
                            })}
                          </ResponsiveGridLayout>
                        ) : null}
                      </div>
                      {compositeWidgets.length > 0 && (
                        <div className="flex items-center justify-between mt-1 px-1 flex-shrink-0">
                          <span className="text-[10px] text-gray-400">
                            {containerAutoLayout
                              ? `Auto layout \u00b7 ${containerCols === 1 ? '1 column' : '2 columns'}`
                              : 'Drag to position \u00b7 Resize corners'
                            }
                          </span>
                          <span className="text-[10px] text-gray-400">{compositeWidgets.length} widget{compositeWidgets.length !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </div>

                    {/* ══ VERTICAL DIVIDER ══ */}
                    <div className="w-px bg-gray-200 flex-shrink-0" />

                    {/* ══ RIGHT: Widget Inspector ══ */}
                    <div className="w-56 flex-shrink-0 flex flex-col min-h-0 pl-3 overflow-y-auto">
                      {selectedWidget ? (
                        <div className="space-y-3">
                          {/* D1: Header — editable label + badges */}
                          {(() => {
                            const gi = WIDGET_GALLERY_MAP[selectedWidget.type]
                            const colors = WIDGET_TYPE_COLORS[selectedWidget.type] ?? DEFAULT_WIDGET_COLORS
                            return (
                              <div className="pb-2 border-b border-gray-100">
                                {editingWidgetLabel === selectedWidget.id ? (
                                  <input
                                    autoFocus
                                    defaultValue={selectedWidget.label}
                                    className="w-full text-sm font-semibold text-gray-900 bg-white border border-primary-300 rounded px-1.5 py-1 mb-1.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
                                    onBlur={(e) => {
                                      const val = e.target.value.trim()
                                      if (val && val !== selectedWidget.label) {
                                        setCompositeWidgets(prev => prev.map(w => w.id === selectedWidget.id ? { ...w, label: val } : w))
                                      }
                                      setEditingWidgetLabel(null)
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                      if (e.key === 'Escape') setEditingWidgetLabel(null)
                                    }}
                                  />
                                ) : (
                                  <div className="flex items-center gap-1.5 mb-1.5">
                                    <FieldTypeIcon type={selectedWidget.type} className={clsx('w-4 h-4 flex-shrink-0', colors.accent)} />
                                    <span
                                      className="text-sm font-semibold text-gray-900 truncate flex-1 cursor-text hover:text-primary-700 transition-colors"
                                      onClick={() => setEditingWidgetLabel(selectedWidget.id)}
                                      title="Click to rename"
                                    >
                                      {selectedWidget.label}
                                    </span>
                                    <button
                                      onClick={() => setEditingWidgetLabel(selectedWidget.id)}
                                      className="p-0.5 text-gray-300 hover:text-gray-600 rounded transition-colors flex-shrink-0"
                                      title="Rename"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={clsx('text-[9px] px-1.5 py-0.5 rounded', colors.bg, colors.accent)}>
                                    {gi?.label ?? selectedWidget.type}
                                  </span>
                                  <span className={clsx(
                                    'text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5',
                                    selectedIsLinked ? 'bg-primary-50 text-primary-600' : 'bg-gray-100 text-gray-500'
                                  )}>
                                    {selectedIsLinked ? <><Link2 className="w-2.5 h-2.5" /> Linked</> : 'Standalone'}
                                  </span>
                                </div>
                              </div>
                            )
                          })()}

                          {/* Similarity warning */}
                          {widgetSimilarityWarnings.has(selectedWidget.id) && (() => {
                            const matches = widgetSimilarityWarnings.get(selectedWidget.id)!
                            return (
                              <div className="px-2.5 py-2 rounded-lg bg-amber-50 border border-amber-200">
                                <div className="flex items-start gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] text-amber-800 font-medium mb-1">Similar field{matches.length > 1 ? 's' : ''} already exist{matches.length === 1 ? 's' : ''}</p>
                                    <div className="space-y-0.5">
                                      {matches.slice(0, 3).map(m => (
                                        <button
                                          key={m.id}
                                          onClick={() => {
                                            handleRemoveCompositeWidget(selectedWidget.id)
                                            handleAddLinkedWidget(m.id, m.name, m.type)
                                          }}
                                          className="w-full flex items-center gap-1.5 text-[11px] text-amber-700 hover:text-amber-900 text-left"
                                        >
                                          <FieldTypeIcon type={m.type} className="w-3 h-3 flex-shrink-0" />
                                          <span className="truncate">{m.name}</span>
                                          <span className="text-[9px] text-amber-500 flex-shrink-0 ml-auto">use this</span>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          })()}

                          {/* D2: Configuration section */}
                          <div>
                            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Configuration</label>
                            {selectedIsLinked ? (
                              <p className="text-[11px] text-gray-400 leading-relaxed">
                                Inherited from the linked field. Edit the source field to change configuration.
                              </p>
                            ) : isConfigurableFieldType(selectedWidget.type) ? (
                              <FieldConfigEditor
                                fieldType={selectedWidget.type}
                                config={selectedWidget.config}
                                onChange={(cfg) => handleUpdateWidgetConfig(selectedWidget.id, cfg)}
                              />
                            ) : (
                              <p className="text-[11px] text-gray-400">No configuration required.</p>
                            )}
                          </div>

                          {/* D3: Layout section */}
                          <div>
                            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Layout</label>
                            {containerAutoLayout ? (
                              <p className="text-[11px] text-gray-400">
                                Managed by Auto layout ({containerCols === 1 ? '1 column' : '2 columns'}).
                              </p>
                            ) : (() => {
                              const li = compositeLayout.find(l => l.i === selectedWidget.id)
                              if (!li) return <p className="text-[11px] text-gray-400">No layout data.</p>
                              return (
                                <div className="space-y-1.5">
                                  <div>
                                    <span className="text-[10px] text-gray-500 block mb-1">Width</span>
                                    <div className="flex gap-1">
                                      {[3, 4, 6, 12].map(w => (
                                        <button
                                          key={w}
                                          onClick={() => setCompositeLayout(prev => prev.map(l => l.i === selectedWidget.id ? { ...l, w } : l))}
                                          className={clsx(
                                            'px-2 py-0.5 text-[10px] rounded border transition-colors',
                                            li.w === w
                                              ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium'
                                              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                          )}
                                        >
                                          {w}/12
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                                    <span>Position: ({li.x}, {li.y})</span>
                                    <span className="text-gray-300">&middot;</span>
                                    <span>Height: {li.h}</span>
                                  </div>
                                </div>
                              )
                            })()}
                          </div>

                          {/* D4: Widget Preview */}
                          <div>
                            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Widget Preview</label>
                            <div className="rounded-lg border border-gray-200 p-2.5 bg-gray-50/50">
                              <FieldTypePreview type={selectedWidget.type} />
                            </div>
                          </div>

                          {/* D5: Actions */}
                          <div className="flex items-center gap-1 pt-2 border-t border-gray-100">
                            <button
                              onClick={() => handleDuplicateWidget(selectedWidget.id)}
                              className="flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500 hover:text-gray-700 rounded hover:bg-gray-100 transition-colors"
                            >
                              <Copy className="w-3 h-3" /> Duplicate
                            </button>
                            <div className="flex-1" />
                            <button
                              onClick={() => {
                                if (compositeWidgets.length === 1) {
                                  setConfirmDialogState({
                                    isOpen: true,
                                    title: 'Remove last widget?',
                                    message: 'This is the only widget in the container. Removing it will leave the container empty.',
                                    confirmText: 'Remove widget',
                                    variant: 'danger',
                                    onConfirm: () => {
                                      handleRemoveCompositeWidget(selectedWidget.id)
                                      setSelectedWidgetId(null)
                                      setConfirmDialogState(prev => ({ ...prev, isOpen: false }))
                                    },
                                  })
                                  return
                                }
                                handleRemoveCompositeWidget(selectedWidget.id)
                                setSelectedWidgetId(null)
                              }}
                              className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-500 hover:text-red-700 rounded hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" /> Remove
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center py-6">
                          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mb-2">
                            <Eye className="w-4 h-4 text-gray-300" />
                          </div>
                          <p className="text-[12px] font-medium text-gray-500 mb-0.5">Inspector</p>
                          <p className="text-[11px] text-gray-400 max-w-[160px]">Select a widget to view its configuration and preview.</p>
                        </div>
                      )}
                    </div>
                  </div>
                  )
                })()
              )}

              {/* ── Sticky footer ── */}
              <div className="flex-shrink-0 pt-3 pb-4 border-t border-gray-200 bg-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {createStep > 1 ? (
                      <button
                        onClick={() => setCreateStep((createStep - 1) as 1 | 2)}
                        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        Back
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (customName.trim() || compositeWidgets.length > 0) {
                            setConfirmDialogState({
                              isOpen: true,
                              title: 'Discard changes?',
                              message: 'You have unsaved work in this custom field. Going back will discard all progress.',
                              confirmText: 'Discard',
                              variant: 'warning',
                              onConfirm: () => {
                                setConfirmDialogState(prev => ({ ...prev, isOpen: false }))
                                switchToUseExisting()
                              },
                            })
                            return
                          }
                          switchToUseExisting()
                        }}
                        className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    {createStep === 1 && (
                      <div className="flex items-center gap-2">
                        {!customName.trim() && (
                          <span className="text-xs text-gray-400">Enter a field name to continue.</span>
                        )}
                        <Button
                          onClick={() => { setNameBlurred(true); if (customName.trim()) setCreateStep(2) }}
                          disabled={!customName.trim() || exactMatch || (similarFields.length > 0 && !createAnywayConfirmed)}
                        >
                          Next
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    )}
                    {createStep === 2 && (
                      <Button
                        onClick={() => { if (fieldKind) setCreateStep(3) }}
                        disabled={!fieldKind}
                      >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    )}
                    {createStep === 3 && fieldKind === 'single' && (
                      <Button
                        onClick={handleAddCustom}
                        disabled={!customType}
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        {!customType ? 'Select a type' : 'Create Field'}
                      </Button>
                    )}
                    {createStep === 3 && fieldKind === 'multi' && (
                      <div className="flex items-center gap-2">
                        {compositeWidgets.length === 0 ? (
                          <span className="text-xs text-gray-400">Add at least one widget to continue.</span>
                        ) : containerNameDuplicate ? (
                          <span className="text-xs text-red-500">A field with this name already exists.</span>
                        ) : null}
                        <Button
                          onClick={() => {
                            if (compositeWidgets.length === 0) {
                              setError('Add at least one widget')
                              return
                            }
                            handleAddContainer()
                          }}
                          disabled={!customName.trim() || compositeWidgets.length === 0 || containerNameDuplicate}
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          {compositeWidgets.length === 0
                            ? 'Create Field'
                            : `Create Field (${compositeWidgets.length} widget${compositeWidgets.length !== 1 ? 's' : ''})`
                          }
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

        </div>
      </div>

      {/* Confirmation dialog for destructive actions */}
      <ConfirmDialog
        isOpen={confirmDialogState.isOpen}
        onClose={() => setConfirmDialogState(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialogState.onConfirm}
        title={confirmDialogState.title}
        message={confirmDialogState.message}
        confirmText={confirmDialogState.confirmText}
        variant={confirmDialogState.variant}
      />
    </div>
  )
}

// ============================================================================
// NEW LAYOUT MODAL
// ============================================================================

interface NewLayoutModalProps {
  isOpen: boolean
  onClose: () => void
  onStartBlank: () => void
  onCopyFrom: (layout: SavedLayout) => void
  existingLayouts: SavedLayout[]
  systemDefaultLayout: SavedLayout
}

function NewLayoutModal({ isOpen, onClose, onStartBlank, onCopyFrom, existingLayouts, systemDefaultLayout }: NewLayoutModalProps) {
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null)

  if (!isOpen) return null

  const allLayouts = [systemDefaultLayout, ...existingLayouts]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Create New Layout</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Option 1: Start Blank */}
          <button
            onClick={onStartBlank}
            className="w-full p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-400 hover:bg-primary-50/50 transition-colors text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gray-100 group-hover:bg-primary-100 flex items-center justify-center">
                <Plus className="w-5 h-5 text-gray-500 group-hover:text-primary-600" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900">Start from scratch</h4>
                <p className="text-sm text-gray-500">Begin with a blank canvas and add sections and fields</p>
              </div>
            </div>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 uppercase">or copy from</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Option 2: Copy from existing */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {allLayouts.map(layout => {
              const isSelected = selectedLayoutId === layout.id
              const fieldCount = layout.field_config?.length || 0
              const visibleCount = layout.field_config?.filter(f => f.is_visible).length || 0

              return (
                <button
                  key={layout.id}
                  onClick={() => setSelectedLayoutId(layout.id)}
                  className={clsx(
                    'w-full p-3 border rounded-lg text-left transition-colors',
                    isSelected
                      ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-200'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={clsx(
                        'w-8 h-8 rounded-lg flex items-center justify-center',
                        isSelected ? 'bg-primary-100' : 'bg-gray-100'
                      )}>
                        <Copy className={clsx('w-4 h-4', isSelected ? 'text-primary-600' : 'text-gray-500')} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{layout.name}</span>
                          {layout.id === 'system-default' && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">System</span>
                          )}
                          {layout.is_default && layout.id !== 'system-default' && (
                            <Star className="w-3 h-3 text-amber-500 fill-current" />
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          {visibleCount} of {fieldCount} fields visible
                        </p>
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-5 h-5 text-primary-600" />
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => {
                const layout = allLayouts.find(l => l.id === selectedLayoutId)
                if (layout) onCopyFrom(layout)
              }}
              disabled={!selectedLayoutId}
            >
              <Copy className="w-4 h-4 mr-1" />
              Copy Layout
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// LAYOUT EDITOR (ENHANCED)
// ============================================================================

type InitialMode = 'blank' | 'copy' | 'edit'

interface LayoutEditorProps {
  layout: SavedLayout | null
  isEditingSystemDefault?: boolean
  readOnly?: boolean
  initialMode?: InitialMode
  availableFields: FieldWithPreference[]
  fieldsBySection: { section_id: string; section_name: string; section_slug: string; section_display_order: number; fields: FieldWithPreference[] }[]
  onSave: (name: string, description: string, fieldConfig: FieldConfigItem[], sectionOrder: string[]) => Promise<void>
  onCancel: () => void
  onCreateCopy?: () => void
  isSaving: boolean
}

function LayoutEditor({
  layout,
  isEditingSystemDefault = false,
  readOnly = false,
  initialMode = 'edit',
  availableFields,
  fieldsBySection,
  onSave,
  onCancel,
  onCreateCopy,
  isSaving
}: LayoutEditorProps) {
  const { user } = useAuth()
  const { createField } = useResearchFields()

  // Layout metadata
  const [name, setName] = useState(() => {
    if (layout) return layout.name
    if (isEditingSystemDefault) return 'My Default'
    return ''
  })
  const [description, setDescription] = useState(layout?.description || '')
  const [isDefault, setIsDefault] = useState(() => {
    if (layout) return layout.is_default
    if (isEditingSystemDefault) return true
    return false
  })

  // Section and field configuration
  const [sections, setSections] = useState<SectionConfig[]>(() => {
    // Blank mode: start with empty sections
    if (initialMode === 'blank') {
      return []
    }

    // If we have a saved layout with field_config, reconstruct from that
    if (layout?.field_config && layout.field_config.length > 0) {
      // Build a map of field details from availableFields
      const fieldDetailsMap = new Map(
        availableFields.map(f => [f.field_id, f])
      )

      // Also create a map by slug for matching preset fields with timestamps
      // e.g., "preset-competitive_landscape-1768168549905" should match field with slug "competitive_landscape"
      const fieldBySlugMap = new Map(
        availableFields.map(f => [f.field_slug, f])
      )

      // Helper to find a field by ID, with fallback to slug matching for preset IDs.
      // Handles: direct UUID match, canonical preset IDs (preset-slug),
      // and timestamped preset IDs (preset-slug-123456789).
      const findFieldDetails = (fieldId: string) => {
        // First try direct ID match
        const directMatch = fieldDetailsMap.get(fieldId)
        if (directMatch) return directMatch

        // If it's a preset ID, extract the slug and try slug-based matching
        if (fieldId.startsWith('preset-')) {
          const parts = fieldId.split('-')

          let slug: string
          if (parts.length >= 3) {
            const lastPart = parts[parts.length - 1]
            // If last part is all digits (timestamp), strip it
            slug = /^\d+$/.test(lastPart)
              ? parts.slice(1, -1).join('-')
              : parts.slice(1).join('-')
          } else {
            // Canonical preset ID: "preset-slug" (2 parts)
            slug = parts.slice(1).join('-')
          }

          // Try slug-based match (catches preset→real field migrations)
          const slugMatch = fieldBySlugMap.get(slug)
          if (slugMatch) return slugMatch

          // Also try matching canonical preset ID in the map
          const presetIdCanonical = `preset-${slug}`
          const presetMatch = fieldDetailsMap.get(presetIdCanonical)
          if (presetMatch) return presetMatch
        }

        return undefined
      }

      // Build a map of section details from fieldsBySection
      const sectionDetailsMap = new Map(
        fieldsBySection.map(s => [s.section_id, { name: s.section_name, slug: s.section_slug }])
      )

      // Group saved fields by section_id
      const fieldsBySection_saved = new Map<string, typeof layout.field_config>()

      // Sort by display_order first to maintain order
      const sortedConfig = [...layout.field_config].sort((a, b) =>
        (a.display_order ?? 0) - (b.display_order ?? 0)
      )

      for (const fc of sortedConfig) {
        // Use section_id from config - fields are independent of sections
        const sectionId = (fc as any).section_id
        if (!sectionId) continue

        if (!fieldsBySection_saved.has(sectionId)) {
          fieldsBySection_saved.set(sectionId, [])
        }
        fieldsBySection_saved.get(sectionId)!.push(fc)
      }

      // Build sections array preserving order
      const sectionsArray: SectionConfig[] = []
      const seenSections = new Set<string>()

      for (const fc of sortedConfig) {
        const sectionId = (fc as any).section_id
        if (!sectionId || seenSections.has(sectionId)) continue
        seenSections.add(sectionId)

        const sectionDetails = sectionDetailsMap.get(sectionId)
        const fieldConfigs = fieldsBySection_saved.get(sectionId) || []

        sectionsArray.push({
          section_id: sectionId,
          section_name: sectionDetails?.name || 'Unknown Section',
          section_slug: sectionDetails?.slug || 'unknown',
          display_order: sectionsArray.length,
          is_system: true,
          fields: fieldConfigs.map((fc, idx) => {
            const fieldDetail = findFieldDetails(fc.field_id)
            return {
              field_id: fc.field_id,
              field_name: fieldDetail?.field_name || 'Unknown Field',
              field_slug: fieldDetail?.field_slug || 'unknown',
              field_type: fieldDetail?.field_type || 'rich_text',
              is_visible: fc.is_visible,
              display_order: idx,
              is_system: fieldDetail?.is_system ?? true
            }
          })
        })
      }

      return sectionsArray
    }

    // Default/copy mode: Initialize from fieldsBySection (all available fields)
    return fieldsBySection.map((s, idx) => ({
      section_id: s.section_id,
      section_name: s.section_name,
      section_slug: s.section_slug,
      display_order: s.section_display_order ?? idx,
      is_system: true,
      fields: s.fields.map((f, fidx) => ({
        field_id: f.field_id,
        field_name: f.field_name,
        field_slug: f.field_slug,
        field_type: f.field_type,
        is_visible: true,
        display_order: f.default_display_order ?? fidx,
        is_system: f.is_system
      }))
    })).sort((a, b) => a.display_order - b.display_order)
  })

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(sections.map(s => s.section_id))
  )

  // Modals
  const [showAddSection, setShowAddSection] = useState(false)
  const [showAddField, setShowAddField] = useState<string | null>(null) // section_id or null

  // Toggle section expanded state
  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  // Toggle field visibility
  const toggleFieldVisibility = (sectionId: string, fieldId: string) => {
    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      return {
        ...s,
        fields: s.fields.map(f => {
          if (f.field_id !== fieldId) return f
          return { ...f, is_visible: !f.is_visible }
        })
      }
    }))
  }

  // Add new custom section
  const handleAddCustomSection = async (sectionName: string) => {
    // Create section in database
    const slug = sectionName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

    // For now, add locally - we'll create it on save
    const newSection: SectionConfig = {
      section_id: `new-${Date.now()}`,
      section_name: sectionName,
      section_slug: slug,
      display_order: sections.length,
      is_system: false,
      fields: []
    }

    setSections(prev => [...prev, newSection])
    setExpandedSections(prev => new Set([...prev, newSection.section_id]))
  }

  // Add section from library (with its fields)
  const handleAddSectionFromLibrary = (section: SystemSection) => {
    const newSection: SectionConfig = {
      section_id: section.section_id,
      section_name: section.section_name,
      section_slug: section.section_slug,
      display_order: sections.length,
      is_system: true,
      fields: section.fields.map((f, idx) => ({
        field_id: f.field_id,
        field_name: f.field_name,
        field_slug: f.field_slug,
        field_type: f.field_type,
        is_visible: true,
        display_order: idx,
        is_system: f.is_system
      }))
    }

    setSections(prev => [...prev, newSection])
    setExpandedSections(prev => new Set([...prev, newSection.section_id]))
  }

  // Build available sections from fieldsBySection for the library
  const availableSectionsForLibrary: SystemSection[] = fieldsBySection.map(s => ({
    section_id: s.section_id,
    section_name: s.section_name,
    section_slug: s.section_slug,
    fields: s.fields.map(f => ({
      field_id: f.field_id,
      field_name: f.field_name,
      field_slug: f.field_slug,
      field_type: f.field_type,
      is_system: f.is_system
    }))
  }))

  // Build list of all system fields from fieldsBySection for the Add Field modal
  const allSystemFields: SystemField[] = fieldsBySection.flatMap(s =>
    s.fields
      .filter(f => f.is_system)
      .map(f => ({
        id: f.field_id,
        name: f.field_name,
        slug: f.field_slug,
        type: f.field_type,
        description: f.field_description || undefined
      }))
  )

  // Add system field to section (does not close modal - caller handles that)
  const handleAddSystemField = (field: SystemField) => {
    if (!showAddField) return
    const sectionId = showAddField
    const section = sections.find(s => s.section_id === sectionId)
    if (!section) return

    // Check if field is already in section
    if (section.fields.some(f => f.field_id === field.id)) return

    const newField: FieldConfig = {
      field_id: field.id,
      field_name: field.name,
      field_slug: field.slug,
      field_type: field.type,
      is_visible: true,
      display_order: section.fields.length,
      is_system: true
    }

    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      return { ...s, fields: [...s.fields, newField] }
    }))
  }

  // Add existing custom field to section (does not close modal - caller handles that)
  const handleAddExistingCustomField = (field: CustomFieldWithAuthor) => {
    if (!showAddField) return
    const sectionId = showAddField
    const section = sections.find(s => s.section_id === sectionId)
    if (!section) return

    // Check if field is already in section
    if (section.fields.some(f => f.field_id === field.id)) return

    const newField: FieldConfig = {
      field_id: field.id,
      field_name: field.name,
      field_slug: field.slug,
      field_type: field.field_type,
      is_visible: true,
      display_order: section.fields.length,
      is_system: false // Custom field
    }

    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      return { ...s, fields: [...s.fields, newField] }
    }))
  }

  // Add field to section from preset library (does not close modal - caller handles that)
  const handleAddFieldFromLibrary = (preset: PresetFieldData) => {
    if (!showAddField) return
    const sectionId = showAddField
    const section = sections.find(s => s.section_id === sectionId)
    if (!section) return

    // Check if field is already in section
    if (section.fields.some(f => f.field_slug === preset.slug)) return

    // Canonical preset ID — no timestamp suffix
    const fieldId = `preset-${preset.slug}`

    const newField: FieldConfig = {
      field_id: fieldId,
      field_name: preset.name,
      field_slug: preset.slug,
      field_type: preset.field_type,
      is_visible: true,
      display_order: section.fields.length,
      is_system: true // Preset fields are standard system fields available to all users
    }

    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      return { ...s, fields: [...s.fields, newField] }
    }))
  }

  const handleAddCustomField = async (fieldName: string, fieldType: string, config?: Record<string, unknown>) => {
    if (!showAddField || !user?.id) return

    let sectionId = showAddField
    const section = sections.find(s => s.section_id === sectionId)
    if (!section) return

    try {
      // If this is a new section, create it in the database first
      if (sectionId.startsWith('new-')) {
        // Get user's organization
        const { data: orgMembership } = await supabase
          .from('organization_memberships')
          .select('organization_id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .single()

        if (!orgMembership) {
          console.error('No organization found for user')
          return
        }

        // Create the section in the database
        const { data: newSection, error: sectionError } = await supabase
          .from('research_sections')
          .insert({
            organization_id: orgMembership.organization_id,
            name: section.section_name,
            slug: section.section_slug,
            display_order: section.display_order,
            is_system: false
          })
          .select()
          .single()

        if (sectionError) {
          console.error('Failed to create section:', sectionError)
          return
        }

        // Update local state to use the real section ID
        const oldSectionId = sectionId
        sectionId = newSection.id

        setSections(prev => prev.map(s => {
          if (s.section_id !== oldSectionId) return s
          return { ...s, section_id: newSection.id }
        }))

        // Update expanded sections set
        setExpandedSections(prev => {
          const next = new Set(prev)
          next.delete(oldSectionId)
          next.add(newSection.id)
          return next
        })
      }

      // Create field in database
      const slug = fieldName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

      const result = await createField.mutateAsync({
        name: fieldName,
        slug,
        section_id: sectionId,
        field_type: fieldType as any,
        config: config || undefined,
        is_universal: false
      })

      // Add to local state
      const newField: FieldConfig = {
        field_id: result.id,
        field_name: fieldName,
        field_slug: slug,
        field_type: fieldType,
        is_visible: true,
        display_order: section.fields.length,
        is_system: false
      }

      setSections(prev => prev.map(s => {
        if (s.section_id !== sectionId) return s
        return { ...s, fields: [...s.fields, newField] }
      }))
    } catch (error) {
      console.error('Failed to create field:', error)
    }

    setShowAddField(null)
  }

  // Remove section from layout (works for all sections)
  const removeSection = (sectionId: string) => {
    const section = sections.find(s => s.section_id === sectionId)
    if (!section) return
    if (!confirm(`Remove "${section.section_name}" from this layout?`)) return
    setSections(prev => prev.filter(s => s.section_id !== sectionId))
  }

  // Rename section
  const renameSection = (sectionId: string, newName: string) => {
    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      const newSlug = newName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      return {
        ...s,
        section_name: newName,
        section_slug: newSlug
      }
    }))
  }

  // Remove field from section
  const removeField = (sectionId: string, fieldId: string) => {
    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      return {
        ...s,
        fields: s.fields.filter(f => f.field_id !== fieldId)
      }
    }))
  }

  // Track active section being dragged
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)

  // Drag-and-drop sensors - reduced distance for quicker response
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Handle section drag start
  const handleSectionDragStart = (event: DragStartEvent) => {
    setActiveSectionId(event.active.id as string)
  }

  // Handle section drag end
  const handleSectionDragEnd = (event: DragEndEvent) => {
    setActiveSectionId(null)
    const { active, over } = event
    if (over && active.id !== over.id) {
      setSections(prev => {
        const oldIndex = prev.findIndex(s => s.section_id === active.id)
        const newIndex = prev.findIndex(s => s.section_id === over.id)
        return arrayMove(prev, oldIndex, newIndex).map((s, i) => ({ ...s, display_order: i }))
      })
    }
  }

  // Get active section for drag overlay
  const activeSection = activeSectionId ? sections.find(s => s.section_id === activeSectionId) : null

  // Handle field drag end within a section
  const handleFieldDragEnd = (sectionId: string, activeId: string, overId: string) => {
    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      const oldIndex = s.fields.findIndex(f => f.field_id === activeId)
      const newIndex = s.fields.findIndex(f => f.field_id === overId)
      return {
        ...s,
        fields: arrayMove(s.fields, oldIndex, newIndex).map((f, i) => ({ ...f, display_order: i }))
      }
    }))
  }

  // Save layout
  const handleSave = async () => {
    if (!name.trim()) return

    // Map to track temp section IDs -> real database IDs
    const sectionIdMap = new Map<string, string>()

    // First, create any new sections in the database
    for (const section of sections) {
      if (section.section_id.startsWith('new-')) {
        try {
          // Get user's organization
          const { data: userData } = await supabase.auth.getUser()
          if (!userData.user) continue

          const { data: orgMembership } = await supabase
            .from('organization_memberships')
            .select('organization_id')
            .eq('user_id', userData.user.id)
            .eq('status', 'active')
            .single()

          if (!orgMembership) continue

          // Create the section in the database
          const { data: newSection, error } = await supabase
            .from('research_sections')
            .insert({
              name: section.section_name,
              slug: section.section_slug,
              display_order: section.display_order,
              is_system: false,
              organization_id: orgMembership.organization_id
            })
            .select('id')
            .single()

          if (!error && newSection) {
            sectionIdMap.set(section.section_id, newSection.id)
          }
        } catch (err) {
          console.error('Error creating section:', err)
        }
      }
    }

    // Build field config with normalized IDs (uses centralized normalizer)
    const fieldConfig: FieldConfigItem[] = sections.flatMap((s, sectionIndex) =>
      s.fields.map((f, fieldIndex) => ({
        field_id: normalizePresetFieldId(f.field_id),
        section_id: sectionIdMap.get(s.section_id) || s.section_id, // Use real ID if we created it
        is_visible: f.is_visible,
        display_order: sectionIndex * 1000 + fieldIndex, // Preserve section and field order
        is_collapsed: false
      }))
    )

    // Get section order with normalized IDs
    const sectionOrder = sections.map(s => sectionIdMap.get(s.section_id) || s.section_id)

    // Update local state with new section IDs
    if (sectionIdMap.size > 0) {
      setSections(prev => prev.map(s => {
        const newId = sectionIdMap.get(s.section_id)
        return newId ? { ...s, section_id: newId } : s
      }))
    }

    await onSave(name.trim(), description.trim(), fieldConfig, sectionOrder)
  }

  // Stats
  const totalFields = sections.reduce((sum, s) => sum + s.fields.length, 0)
  const visibleFields = sections.reduce((sum, s) => sum + s.fields.filter(f => f.is_visible).length, 0)
  const hiddenFields = totalFields - visibleFields
  const sectionCount = sections.length

  // Show/hide hidden fields toggle
  const [showHiddenFields, setShowHiddenFields] = useState(true)

  // Track unsaved changes
  const [showDiscardModal, setShowDiscardModal] = useState(false)
  const [initialState] = useState(() => JSON.stringify({ name, description, isDefault, sections }))

  const hasUnsavedChanges = () => {
    const currentState = JSON.stringify({ name, description, isDefault, sections })
    return currentState !== initialState
  }

  const handleBackClick = () => {
    if (readOnly) {
      onCancel()
      return
    }
    if (hasUnsavedChanges()) {
      setShowDiscardModal(true)
    } else {
      onCancel()
    }
  }

  // Read-only context
  const readOnlyContextLine = readOnly
    ? getSpecContextLine('system', layout?.is_default ?? false)
    : null

  return (
    <div className="space-y-4">
      {/* Discard Changes Modal — only in edit mode */}
      {!readOnly && showDiscardModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-100 rounded-full">
                <Trash2 className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Discard changes?</h3>
            </div>
            <p className="text-gray-600 mb-6">
              You have unsaved changes to this layout. Are you sure you want to discard them?
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowDiscardModal(false)}>
                Keep Editing
              </Button>
              <Button
                onClick={() => {
                  setShowDiscardModal(false)
                  onCancel()
                }}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Discard Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Read-only banner */}
      {readOnly && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
          <Lock className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <span className="text-sm font-medium text-gray-500">
            System template &middot; Read-only
          </span>
          <span className="text-xs text-gray-400 ml-auto">
            {readOnlyContextLine}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleBackClick}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-gray-900 tracking-tight">
            {readOnly ? layout?.name || 'System Default' : layout ? 'Edit Layout' : 'Create New Layout'}
          </h2>
          <p className="text-[13px] text-gray-500 mt-0.5">
            {readOnly
              ? `${visibleFields} field${visibleFields !== 1 ? 's' : ''} across ${sectionCount} section${sectionCount !== 1 ? 's' : ''}`
              : `${visibleFields} visible \u00b7 ${hiddenFields} hidden \u00b7 ${sectionCount} section${sectionCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        {/* Action zone */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {readOnly ? (
            onCreateCopy && (
              <Button onClick={onCreateCopy}>
                <Copy className="w-4 h-4 mr-1.5" />
                Create Editable Copy
              </Button>
            )
          ) : (
            <>
              <button
                onClick={() => setIsDefault(!isDefault)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border',
                  isDefault
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                )}
              >
                <Star className={clsx('w-3.5 h-3.5', isDefault && 'fill-current')} />
                {isDefault ? 'Default' : 'Set as default'}
              </button>
              <Button
                onClick={handleSave}
                disabled={!name.trim() || isSaving}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <Save className="w-4 h-4 mr-1" />
                )}
                Save Layout
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Layout Details */}
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
        {readOnly ? (
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-base font-semibold text-gray-900">{name}</h3>
              {isDefault && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary-50 text-primary-600">
                  Default for me
                </span>
              )}
            </div>
            {description && (
              <p className="text-sm text-gray-500 mt-1">{description}</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Layout name"
              className="w-full text-base font-semibold text-gray-900 bg-transparent border-0 border-b border-gray-200 focus:border-primary-500 focus:ring-0 px-0 py-1 placeholder:text-gray-400"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description (optional)"
              className="w-full text-sm text-gray-500 bg-transparent border-0 focus:ring-0 px-0 py-1.5 placeholder:text-gray-400"
            />
          </div>
        )}
      </div>

      {/* Sections and Fields */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between pb-1 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sections & Fields</h3>
          <div className="flex items-center gap-3">
            {/* Show hidden toggle — only when there are hidden fields */}
            {!readOnly && hiddenFields > 0 && (
              <button
                onClick={() => setShowHiddenFields(!showHiddenFields)}
                className={clsx(
                  'flex items-center gap-1.5 text-xs font-medium transition-colors',
                  showHiddenFields ? 'text-gray-500 hover:text-gray-700' : 'text-primary-600 hover:text-primary-700'
                )}
              >
                <Eye className="w-3.5 h-3.5" />
                {showHiddenFields ? 'Hide disabled' : `Show ${hiddenFields} hidden`}
              </button>
            )}
            {!readOnly && (
              <Button variant="outline" size="sm" onClick={() => setShowAddSection(true)}>
                <FolderPlus className="w-4 h-4 mr-1" />
                Add Section
              </Button>
            )}
          </div>
        </div>

        {/* Empty state for blank layouts — only in edit mode */}
        {!readOnly && sections.length === 0 && (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <FolderPlus className="w-10 h-10 text-gray-400 mx-auto mb-3" />
            <h4 className="font-medium text-gray-900 mb-1">No sections yet</h4>
            <p className="text-sm text-gray-500 mb-4">
              Add sections from the library or create custom ones to build your layout
            </p>
            <Button onClick={() => setShowAddSection(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Add Your First Section
            </Button>
          </div>
        )}

        {readOnly ? (
          /* Read-only: plain list, no DnD wrapper */
          sections.map(section => (
            <SortableSection
              key={section.section_id}
              section={section}
              isExpanded={expandedSections.has(section.section_id)}
              readOnly
              onToggleExpand={() => toggleSection(section.section_id)}
              onToggleFieldVisibility={() => {}}
              onRemoveField={() => {}}
              onRemoveSection={() => {}}
              onRenameSection={() => {}}
              onAddField={() => {}}
              onFieldDragEnd={() => {}}
            />
          ))
        ) : (
          /* Edit mode: full DnD */
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleSectionDragStart}
            onDragEnd={handleSectionDragEnd}
            modifiers={[restrictToVerticalAxis]}
          >
            <SortableContext
              items={sections.map(s => s.section_id)}
              strategy={verticalListSortingStrategy}
            >
              {sections.map(section => (
                <SortableSection
                  key={section.section_id}
                  section={section}
                  isExpanded={expandedSections.has(section.section_id)}
                  showHiddenFields={showHiddenFields}
                  onToggleExpand={() => toggleSection(section.section_id)}
                  onToggleFieldVisibility={(fieldId) => toggleFieldVisibility(section.section_id, fieldId)}
                  onRemoveField={(fieldId) => removeField(section.section_id, fieldId)}
                  onRemoveSection={() => removeSection(section.section_id)}
                  onRenameSection={(newName) => renameSection(section.section_id, newName)}
                  onAddField={() => setShowAddField(section.section_id)}
                  onFieldDragEnd={(activeId, overId) => handleFieldDragEnd(section.section_id, activeId, overId)}
                />
              ))}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeSection ? <SectionDragOverlay section={activeSection} /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* Add Section Modal — edit mode only */}
      {!readOnly && (
        <AddSectionModal
          isOpen={showAddSection}
          onClose={() => setShowAddSection(false)}
          onAddCustom={handleAddCustomSection}
          onAddFromLibrary={handleAddSectionFromLibrary}
          existingSectionIds={sections.map(s => s.section_id)}
          availableSections={availableSectionsForLibrary}
        />
      )}

      {/* Add Field Modal — edit mode only */}
      {!readOnly && (
        <AddFieldModal
          isOpen={!!showAddField}
          onClose={() => setShowAddField(null)}
          onAddFromLibrary={handleAddFieldFromLibrary}
          onAddCustom={handleAddCustomField}
          onAddSystemField={handleAddSystemField}
          onAddExistingCustomField={handleAddExistingCustomField}
          existingFieldSlugs={sections.flatMap(s => s.fields.map(f => f.field_slug))}
          systemFields={allSystemFields}
          sectionName={showAddField ? sections.find(s => s.section_id === showAddField)?.section_name : undefined}
        />
      )}
    </div>
  )
}

// ============================================================================
// VIRTUAL DEFAULT LAYOUT
// ============================================================================

function createVirtualDefaultLayout(fields: FieldWithPreference[]): SavedLayout {
  // Only include the curated system default fields
  const defaultFields = fields.filter(f => SYSTEM_DEFAULT_FIELD_SLUGS.has(f.field_slug))

  return {
    id: 'system-default',
    user_id: '',
    name: 'Default',
    description: 'Standard research layout with thesis, forecasts, catalysts & documents',
    is_default: true,
    field_config: defaultFields.map((f, idx) => ({
      field_id: f.field_id,
      section_id: f.section_id,
      is_visible: true,
      display_order: idx,
      is_collapsed: false
    })),
    created_at: '',
    updated_at: ''
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ResearchFieldsManager() {
  const {
    fieldsWithPreferences,
    fieldsBySection,
    isLoading: fieldsLoading
  } = useUserAssetPagePreferences()

  const {
    layouts,
    defaultLayout,
    saveLayout,
    updateLayout,
    deleteLayout,
    isLoading: layoutsLoading,
    isSaving
  } = useUserAssetPageLayouts()

  const { data: usageData } = useLayoutUsageMetrics()
  const { data: collabSummaries } = useLayoutCollabSummaries()

  const [editingLayout, setEditingLayout] = useState<SavedLayout | null>(null)
  const [isEditingSystemDefault, setIsEditingSystemDefault] = useState(false)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [showNewLayoutModal, setShowNewLayoutModal] = useState(false)
  const [newLayoutMode, setNewLayoutMode] = useState<'blank' | 'copy' | 'edit'>('edit')
  const [showHelp, setShowHelp] = useState(false)

  const [layoutToDelete, setLayoutToDelete] = useState<SavedLayout | null>(null)
  const [shareLayoutId, setShareLayoutId] = useState<string | null>(null)
  const [drawerKind, setDrawerKind] = useState<DrawerKind | null>(null)
  const [drawerLayoutId, setDrawerLayoutId] = useState<string | null>(null)
  const [drawerLayoutName, setDrawerLayoutName] = useState<string | null>(null)
  const [filters, setFilters] = useState<CardFilterState>(DEFAULT_FILTER_STATE)
  const [sortKey, setSortKey] = useState<CardSortKey>('name')
  const { user } = useAuth()

  // Create a virtual system default
  const systemDefaultLayout = createVirtualDefaultLayout(fieldsWithPreferences)

  // Build card models
  const allLayoutInputs = useMemo(() => {
    const raw = (layouts || []) as LayoutWithSharing[]
    const ownLayouts = raw.filter(l => !l.is_shared_with_me)
    const userDefaultFromOwn = ownLayouts.find(l => l.is_default)
    // Always include system default in the card list
    const includeSystemDefault = !userDefaultFromOwn
    const list = includeSystemDefault ? [systemDefaultLayout, ...raw] : raw
    return list
  }, [layouts, systemDefaultLayout])

  const currentUserName = useMemo(() => {
    if (!user) return null
    const u = user as any
    return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || null
  }, [user])

  const cardModels = useMemo(() => {
    if (!user?.id) return []
    return mapLayoutCards({
      layouts: allLayoutInputs,
      currentUserId: user.id,
      currentUserName,
      usageMetrics: usageData?.perLayout || [],
      collabSummaries: collabSummaries || [],
    })
  }, [allLayoutInputs, user?.id, currentUserName, usageData, collabSummaries])

  const usageSummary = useMemo(() => {
    return buildUsageSummary(cardModels, usageData?.globalOverrideCount || 0)
  }, [cardModels, usageData])

  const filteredCards = useMemo(() => {
    return filterCards(cardModels, filters)
  }, [cardModels, filters])

  const scopeGroups = useMemo(() => {
    return groupCardsByScope(filteredCards, sortKey)
  }, [filteredCards, sortKey])

  // Layout to share (for modal)
  const shareLayout = shareLayoutId
    ? (layouts || []).find(l => l.id === shareLayoutId) || null
    : null

  // Delete impact — usage count for the layout being deleted
  const deleteImpact = useMemo(() => {
    if (!layoutToDelete) return { assetsAffected: 0, fallbackName: 'System Default' }
    const card = cardModels.find(c => c.id === layoutToDelete.id)
    const userDefault = cardModels.find(c => c.isMyDefault)
    return {
      assetsAffected: card?.usedByAssetsCount || 0,
      fallbackName: userDefault && userDefault.id !== layoutToDelete.id
        ? userDefault.name
        : 'System Default'
    }
  }, [layoutToDelete, cardModels])

  const handleSaveLayout = async (
    name: string,
    description: string,
    fieldConfig: FieldConfigItem[],
    sectionOrder: string[]
  ) => {
    if (editingLayout && editingLayout.id !== 'system-default') {
      await updateLayout.mutateAsync({
        layoutId: editingLayout.id,
        name,
        description: description || undefined,
        fieldConfig,
        isDefault: editingLayout.is_default
      })
    } else {
      await saveLayout.mutateAsync({
        name,
        description: description || undefined,
        fieldConfig,
        isDefault: isEditingSystemDefault
      })
    }
    setEditingLayout(null)
    setIsEditingSystemDefault(false)
    setIsCreatingNew(false)
    setNewLayoutMode('edit')
  }

  const handleStartBlank = () => {
    setShowNewLayoutModal(false)
    setNewLayoutMode('blank')
    setEditingLayout(null)
    setIsCreatingNew(true)
  }

  const handleCopyFrom = (sourceLayout: SavedLayout) => {
    setShowNewLayoutModal(false)
    setNewLayoutMode('copy')
    const copiedLayout: SavedLayout = {
      ...sourceLayout,
      id: '',
      name: `${sourceLayout.name} (Copy)`,
      is_default: false
    }
    setEditingLayout(copiedLayout)
    setIsCreatingNew(true)
  }

  const handleDeleteLayout = (layout: SavedLayout) => {
    if (layout.id === 'system-default') return
    setLayoutToDelete(layout)
  }

  const confirmDeleteLayout = async () => {
    if (!layoutToDelete) return
    await deleteLayout.mutateAsync(layoutToDelete.id)
    setLayoutToDelete(null)
  }

  const handleDuplicateLayout = async (layout: SavedLayout) => {
    const fieldConfig = layout.id === 'system-default'
      ? fieldsWithPreferences
          .filter(f => SYSTEM_DEFAULT_FIELD_SLUGS.has(f.field_slug))
          .map((f, idx) => ({
            field_id: f.field_id,
            section_id: f.section_id,
            is_visible: true,
            display_order: idx,
            is_collapsed: false
          }))
      : layout.field_config

    await saveLayout.mutateAsync({
      name: `${layout.name} (Copy)`,
      description: layout.description || undefined,
      fieldConfig,
      isDefault: false
    })
  }

  const handleSetDefault = async (layoutId: string) => {
    if (layoutId === 'system-default') return
    await updateLayout.mutateAsync({
      layoutId,
      isDefault: true
    })
  }

  const handleEditLayout = (layout: SavedLayout) => {
    if (layout.id === 'system-default') {
      setIsEditingSystemDefault(true)
      setEditingLayout(layout)
    } else {
      setEditingLayout(layout)
    }
  }

  // Map card ID back to SavedLayout for action handlers
  const getLayoutById = (id: string): SavedLayout => {
    if (id === 'system-default') return systemDefaultLayout
    return (layouts || []).find(l => l.id === id) || systemDefaultLayout
  }

  const handleOpenAsset = useCallback((assetId: string, symbol: string) => {
    setDrawerKind(null)
    setDrawerLayoutId(null)
    setDrawerLayoutName(null)
    window.dispatchEvent(new CustomEvent('navigate-to', {
      detail: { id: assetId, title: symbol, type: 'asset', data: { id: assetId } }
    }))
  }, [])

  const handleOpenUsedByDrawer = useCallback((layoutId: string, layoutName: string) => {
    setDrawerLayoutId(layoutId)
    setDrawerLayoutName(layoutName)
    setDrawerKind('by_layout')
  }, [])

  const isLoading = fieldsLoading || layoutsLoading

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </Card>
    )
  }

  // Show editor/spec view if editing or creating
  if (editingLayout || isCreatingNew) {
    return (
      <LayoutEditor
        layout={isEditingSystemDefault ? systemDefaultLayout : editingLayout}
        isEditingSystemDefault={isEditingSystemDefault}
        readOnly={isEditingSystemDefault}
        initialMode={newLayoutMode}
        availableFields={fieldsWithPreferences}
        fieldsBySection={fieldsBySection}
        onSave={handleSaveLayout}
        onCancel={() => {
          setEditingLayout(null)
          setIsEditingSystemDefault(false)
          setIsCreatingNew(false)
          setNewLayoutMode('edit')
        }}
        onCreateCopy={isEditingSystemDefault ? () => {
          handleDuplicateLayout(systemDefaultLayout)
          setEditingLayout(null)
          setIsEditingSystemDefault(false)
        } : undefined}
        isSaving={isSaving}
      />
    )
  }

  const ownLayouts = (layouts || []).filter(l => !l.is_shared_with_me)
  const activeFilterCount =
    (filters.search ? 1 : 0) +
    (filters.scopeFilter !== 'all' ? 1 : 0) +
    (filters.usedByAssetsOnly ? 1 : 0) +
    (sortKey !== 'name' ? 1 : 0)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Research Layouts</h2>
          <button
            onClick={() => setShowHelp(!showHelp)}
            className={clsx(
              'p-1 rounded-full transition-colors',
              showHelp
                ? 'text-blue-600 bg-blue-100'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            )}
            title="How layouts work"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
        <Button onClick={() => setShowNewLayoutModal(true)}>
          <Plus className="w-4 h-4 mr-1" />
          New Layout
        </Button>
      </div>

      {/* Help text */}
      {showHelp && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-900 mb-1">How layouts work</h4>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Your <strong>default layout</strong> is automatically applied to all research pages</li>
            <li>• Create <strong>Personal</strong> layouts for your own workflows</li>
            <li>• Share layouts with your <strong>Team</strong> or entire <strong>Organization</strong></li>
            <li>• Per-asset overrides let you customize individual research pages on top of any layout</li>
          </ul>
        </div>
      )}

      {/* Status Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-left cursor-pointer hover:border-gray-300 hover:shadow-sm transition-all group"
          onClick={() => {
            // Filter to show only the default template
            const defaultCard = cardModels.find(c => c.isMyDefault)
            if (defaultCard) {
              setFilters(f => ({ ...f, search: defaultCard.name }))
            }
          }}
          title="Click to find your default template"
        >
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">My Default</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">{usageSummary.defaultTemplateName}</p>
        </button>
        <button
          className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-left cursor-pointer hover:border-gray-300 hover:shadow-sm transition-all group"
          onClick={() => setDrawerKind('custom_layouts')}
        >
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Assets Using Custom Layouts</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">
            {usageSummary.assetsUsingCustomTemplates} asset{usageSummary.assetsUsingCustomTemplates !== 1 ? 's' : ''}
          </p>
        </button>
        <button
          className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-left cursor-pointer hover:border-gray-300 hover:shadow-sm transition-all group"
          onClick={() => setDrawerKind('overrides')}
          title="Overrides are asset-level layout changes layered on top of the assigned template"
        >
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Assets with Overrides</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">
            {usageSummary.assetsWithOverrides} asset{usageSummary.assetsWithOverrides !== 1 ? 's' : ''}
          </p>
        </button>
        <button
          className={clsx(
            'bg-white border rounded-lg px-4 py-3 text-left cursor-pointer hover:shadow-sm transition-all group',
            filters.usedByAssetsOnly && sortKey === 'most_used'
              ? 'border-primary-300 bg-primary-50/30'
              : 'border-gray-200 hover:border-gray-300'
          )}
          onClick={() => {
            if (filters.usedByAssetsOnly && sortKey === 'most_used') {
              // Toggle off
              setFilters(f => ({ ...f, usedByAssetsOnly: false }))
              setSortKey('name')
            } else {
              setFilters(f => ({ ...f, usedByAssetsOnly: true }))
              setSortKey('most_used')
            }
          }}
        >
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Templates in Use</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">
            {usageSummary.templatesInUseCount} template{usageSummary.templatesInUseCount !== 1 ? 's' : ''}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Affecting {usageSummary.totalAffectedAssets} asset{usageSummary.totalAffectedAssets !== 1 ? 's' : ''}
          </p>
        </button>
      </div>

      {/* Search + Filters Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search layouts..."
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400"
          />
        </div>

        {/* Scope filter */}
        <div className="flex items-center gap-2">
          <select
            value={filters.scopeFilter}
            onChange={e => setFilters(f => ({ ...f, scopeFilter: e.target.value as ScopeFilter }))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400"
          >
            <option value="all">All scopes</option>
            <option value="personal">Personal</option>
            <option value="team">Team</option>
            <option value="org">Organization</option>
            <option value="system">System</option>
          </select>

          {/* Sort */}
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as CardSortKey)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400"
          >
            <option value="name">Sort: Name</option>
            <option value="recently_updated">Sort: Recent</option>
            <option value="most_used">Sort: Most used</option>
          </select>

          {/* Used by assets toggle */}
          <button
            onClick={() => setFilters(f => ({ ...f, usedByAssetsOnly: !f.usedByAssetsOnly }))}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors',
              filters.usedByAssetsOnly
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            )}
          >
            <Layers className="w-3.5 h-3.5" />
            In use
          </button>

          {/* Clear filters */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setFilters(DEFAULT_FILTER_STATE); setSortKey('name') }}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
            >
              Clear ({activeFilterCount})
            </button>
          )}
        </div>

        {/* Count */}
        <span className="text-xs text-gray-400 ml-auto">
          {filteredCards.length} of {cardModels.length} layout{cardModels.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Card Grid — grouped by scope */}
      {scopeGroups.length > 0 ? (
        <div className="space-y-6">
          {scopeGroups.map(group => (
            <div key={group.scope}>
              {/* Group header */}
              <div className="mb-3">
                <div className="flex items-center gap-2">
                  <ScopeBadge scope={group.scope} />
                  <h3 className="text-sm font-semibold text-gray-700">
                    {group.label} ({group.cards.length})
                  </h3>
                </div>
                {group.sublabel && (
                  <p className="text-xs text-gray-400 mt-1 ml-0.5">{group.sublabel}</p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.cards.map(card => (
                  <LayoutCard
                    key={card.id}
                    card={card}
                    onEdit={() => handleEditLayout(getLayoutById(card.id))}
                    onView={!card.canEdit ? () => handleEditLayout(getLayoutById(card.id)) : undefined}
                    onDelete={() => handleDeleteLayout(getLayoutById(card.id))}
                    onSetDefault={!card.isMyDefault && !card.isSystemDefault
                      ? () => handleSetDefault(card.id)
                      : undefined}
                    onDuplicate={() => handleDuplicateLayout(getLayoutById(card.id))}
                    onShare={() => setShareLayoutId(card.id)}
                    onUsedByClick={card.usedByAssetsCount > 0
                      ? () => handleOpenUsedByDrawer(card.id, card.name)
                      : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-lg">
          <Layers className="w-8 h-8 mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">
            {activeFilterCount > 0
              ? 'No layouts match your filters.'
              : 'No layouts yet. Create one to get started.'}
          </p>
          {activeFilterCount > 0 && (
            <button
              onClick={() => setFilters(DEFAULT_FILTER_STATE)}
              className="mt-2 text-sm text-primary-600 hover:text-primary-700"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* New Layout Modal */}
      <NewLayoutModal
        isOpen={showNewLayoutModal}
        onClose={() => setShowNewLayoutModal(false)}
        onStartBlank={handleStartBlank}
        onCopyFrom={handleCopyFrom}
        existingLayouts={ownLayouts}
        systemDefaultLayout={systemDefaultLayout}
      />

      {/* Share Modal */}
      {shareLayout && (
        <LayoutSharingModal
          layout={shareLayout}
          onClose={() => setShareLayoutId(null)}
        />
      )}

      {/* Delete Confirmation Modal — with impact awareness */}
      {layoutToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Delete &ldquo;{layoutToDelete.name}&rdquo;?
                  </h3>
                  {deleteImpact.assetsAffected > 0 ? (
                    <>
                      <div className="mt-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-amber-800">
                          <p className="font-medium">
                            Used by {deleteImpact.assetsAffected} asset{deleteImpact.assetsAffected !== 1 ? 's' : ''}
                          </p>
                          <p className="mt-0.5 text-amber-700">
                            Those assets will fall back to your default layout: <span className="font-medium">{deleteImpact.fallbackName}</span>.
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-gray-600">
                      This layout is not used by any assets. It can be safely deleted.
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setLayoutToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDeleteLayout}
                className="bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700"
              >
                Delete Layout
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Affected Assets Drawer */}
      {drawerKind && (
        <AffectedAssetsDrawer
          kind={drawerKind}
          layoutId={drawerLayoutId}
          layoutName={drawerLayoutName}
          onClose={() => { setDrawerKind(null); setDrawerLayoutId(null); setDrawerLayoutName(null) }}
          onOpenAsset={handleOpenAsset}
        />
      )}
    </div>
  )
}
