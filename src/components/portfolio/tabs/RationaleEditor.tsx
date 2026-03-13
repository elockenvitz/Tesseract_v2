import React, { useState, useEffect } from 'react'
import { X, Save, CheckCircle2, Link2, ChevronDown } from 'lucide-react'
import type {
  TradeEventWithDetails,
  TradeEventRationale,
  SaveRationaleParams,
  RationaleType,
  RationaleStatus,
  LinkedObjectRef,
} from '../../../types/trade-journal'
import { ACTION_CONFIG, STATUS_CONFIG } from '../../../types/trade-journal'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RationaleEditorProps {
  event: TradeEventWithDetails
  onSave: (params: SaveRationaleParams) => void
  onClose: () => void
  isSaving: boolean
}

// ---------------------------------------------------------------------------
// Rationale type options
// ---------------------------------------------------------------------------

const RATIONALE_TYPES: { value: RationaleType; label: string }[] = [
  { value: 'planned', label: 'Planned' },
  { value: 'reactive', label: 'Reactive' },
  { value: 'execution_adjustment', label: 'Execution Adjustment' },
  { value: 'risk_management', label: 'Risk Management' },
  { value: 'thesis_update', label: 'Thesis Update' },
  { value: 'other', label: 'Other' },
]

// ---------------------------------------------------------------------------
// Field configuration
// ---------------------------------------------------------------------------

interface FieldDef {
  key: keyof SaveRationaleParams
  label: string
  placeholder: string
  rows?: number
}

const RATIONALE_FIELDS: FieldDef[] = [
  { key: 'reason_for_action', label: 'Reason for Action', placeholder: 'Why was this trade made?', rows: 2 },
  { key: 'why_now', label: 'Why Now', placeholder: 'What triggered the timing of this trade?', rows: 2 },
  { key: 'what_changed', label: 'What Changed', placeholder: 'What information or circumstances changed?', rows: 2 },
  { key: 'thesis_context', label: 'Thesis / Context', placeholder: 'Investment thesis or broader context for this position...', rows: 3 },
  { key: 'catalyst_trigger', label: 'Catalyst / Trigger', placeholder: 'Specific catalyst or event that prompted action...', rows: 2 },
  { key: 'sizing_logic', label: 'Sizing Logic', placeholder: 'How was the size determined? Target weight, notional, risk budget...', rows: 2 },
  { key: 'risk_context', label: 'Risk / Portfolio Context', placeholder: 'Portfolio-level risk considerations, concentration, hedging...', rows: 2 },
  { key: 'execution_context', label: 'Execution Context', placeholder: 'Execution details, timing, market conditions...', rows: 2 },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RationaleEditor({ event, onSave, onClose, isSaving }: RationaleEditorProps) {
  const existing = event.latest_rationale
  const actionCfg = ACTION_CONFIG[event.action_type]

  // Local form state
  const [rationaleType, setRationaleType] = useState<RationaleType>(existing?.rationale_type || 'other')
  const [fields, setFields] = useState<Record<string, string>>({
    reason_for_action: existing?.reason_for_action || '',
    why_now: existing?.why_now || '',
    what_changed: existing?.what_changed || '',
    thesis_context: existing?.thesis_context || '',
    catalyst_trigger: existing?.catalyst_trigger || '',
    sizing_logic: existing?.sizing_logic || '',
    risk_context: existing?.risk_context || '',
    execution_context: existing?.execution_context || '',
  })
  const [divergenceFromPlan, setDivergenceFromPlan] = useState(existing?.divergence_from_plan || false)
  const [divergenceExplanation, setDivergenceExplanation] = useState(existing?.divergence_explanation || '')
  const [linkedRefs] = useState<LinkedObjectRef[]>(existing?.linked_object_refs || [])

  // Detect if upstream trade idea exists
  const hasUpstreamIdea = !!event.linked_trade_idea_id && !!event.linked_trade_idea

  // Reset form when event changes
  useEffect(() => {
    const r = event.latest_rationale
    setRationaleType(r?.rationale_type || 'other')
    setFields({
      reason_for_action: r?.reason_for_action || '',
      why_now: r?.why_now || '',
      what_changed: r?.what_changed || '',
      thesis_context: r?.thesis_context || '',
      catalyst_trigger: r?.catalyst_trigger || '',
      sizing_logic: r?.sizing_logic || '',
      risk_context: r?.risk_context || '',
      execution_context: r?.execution_context || '',
    })
    setDivergenceFromPlan(r?.divergence_from_plan || false)
    setDivergenceExplanation(r?.divergence_explanation || '')
  }, [event.id])

  const updateField = (key: string, value: string) => {
    setFields(prev => ({ ...prev, [key]: value }))
  }

  const hasContent = Object.values(fields).some(v => v.trim().length > 0)

  const handleSave = (status: RationaleStatus) => {
    onSave({
      trade_event_id: event.id,
      rationale_type: rationaleType,
      reason_for_action: fields.reason_for_action || null,
      why_now: fields.why_now || null,
      what_changed: fields.what_changed || null,
      thesis_context: fields.thesis_context || null,
      catalyst_trigger: fields.catalyst_trigger || null,
      sizing_logic: fields.sizing_logic || null,
      risk_context: fields.risk_context || null,
      execution_context: fields.execution_context || null,
      divergence_from_plan: divergenceFromPlan,
      divergence_explanation: divergenceFromPlan ? divergenceExplanation : null,
      linked_object_refs: linkedRefs,
      status,
    })
  }

  // Format deltas for display
  const fmtDelta = (v: number | null, suffix = '') => {
    if (v == null) return '\u2014'
    const sign = v > 0 ? '+' : ''
    return `${sign}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`
  }

  return (
    <div className="border-l border-gray-200 bg-white flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50/50 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${actionCfg.color} ${actionCfg.bgColor}`}>
            {actionCfg.label}
          </span>
          <span className="text-[13px] font-semibold text-gray-900 truncate">
            {event.asset?.symbol || 'Unknown'}
          </span>
          <span className="text-[11px] text-gray-400">
            {new Date(event.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded transition-colors">
          <X className="w-3.5 h-3.5 text-gray-400" />
        </button>
      </div>

      {/* Trade Facts Summary */}
      <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/30 shrink-0">
        <div className="grid grid-cols-3 gap-3 text-[10px]">
          <div>
            <span className="text-gray-400 uppercase font-medium">Shares</span>
            <p className="text-gray-700 font-semibold tabular-nums mt-px">
              {fmtDelta(event.quantity_delta)}
              {event.quantity_before != null && (
                <span className="text-gray-400 font-normal ml-1">
                  ({Number(event.quantity_before).toLocaleString()} &rarr; {Number(event.quantity_after ?? 0).toLocaleString()})
                </span>
              )}
            </p>
          </div>
          <div>
            <span className="text-gray-400 uppercase font-medium">Weight</span>
            <p className="text-gray-700 font-semibold tabular-nums mt-px">{fmtDelta(event.weight_delta, '%')}</p>
          </div>
          <div>
            <span className="text-gray-400 uppercase font-medium">Source</span>
            <p className="text-gray-700 font-medium mt-px capitalize">{event.source_type.replace('_', ' ')}</p>
          </div>
        </div>
      </div>

      {/* Scrollable Form */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Upstream linkage notice */}
        {hasUpstreamIdea && (
          <div className="flex items-start gap-2 p-2 bg-blue-50 rounded text-[10px] text-blue-700">
            <Link2 className="w-3 h-3 mt-px shrink-0" />
            <div>
              <span className="font-semibold">Linked Trade Idea:</span>{' '}
              <span className="capitalize">{event.linked_trade_idea?.action}</span>
              {event.linked_trade_idea?.rationale && (
                <p className="text-blue-600 mt-0.5 line-clamp-2">{event.linked_trade_idea.rationale}</p>
              )}
            </div>
          </div>
        )}

        {/* Rationale Type */}
        <div>
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Trade Type</label>
          <div className="relative mt-1">
            <select
              value={rationaleType}
              onChange={e => setRationaleType(e.target.value as RationaleType)}
              className="w-full text-[12px] border border-gray-200 rounded px-2.5 py-1.5 bg-white text-gray-900 appearance-none pr-7 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
            >
              {RATIONALE_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Structured Fields */}
        {RATIONALE_FIELDS.map(field => (
          <div key={field.key}>
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              {field.label}
            </label>
            <textarea
              value={fields[field.key as string] || ''}
              onChange={e => updateField(field.key as string, e.target.value)}
              placeholder={field.placeholder}
              rows={field.rows || 2}
              className="w-full mt-1 text-[12px] border border-gray-200 rounded px-2.5 py-1.5 bg-white text-gray-900 placeholder:text-gray-300 resize-none focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
            />
          </div>
        ))}

        {/* Plan Divergence */}
        <div className="border border-gray-200 rounded p-2.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={divergenceFromPlan}
              onChange={e => setDivergenceFromPlan(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
            />
            <span className="text-[11px] font-medium text-gray-700">This trade diverged from prior plan</span>
          </label>
          {divergenceFromPlan && (
            <textarea
              value={divergenceExplanation}
              onChange={e => setDivergenceExplanation(e.target.value)}
              placeholder="What diverged and why?"
              rows={2}
              className="w-full mt-2 text-[12px] border border-gray-200 rounded px-2.5 py-1.5 bg-white text-gray-900 placeholder:text-gray-300 resize-none focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
            />
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-200 bg-gray-50/50 shrink-0">
        <div className="text-[9px] text-gray-400">
          {existing && (
            <span>
              Last saved {new Date(existing.updated_at).toLocaleDateString()} by{' '}
              {existing.authored_by ? 'author' : 'unknown'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSave('draft')}
            disabled={isSaving || !hasContent}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-gray-700 bg-white border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-3 h-3" />
            Save Draft
          </button>
          <button
            onClick={() => handleSave('complete')}
            disabled={isSaving || !hasContent}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <CheckCircle2 className="w-3 h-3" />
            Mark Complete
          </button>
        </div>
      </div>
    </div>
  )
}
