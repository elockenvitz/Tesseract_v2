import React, { useEffect, useState } from 'react'
import {
  Plus, X, Filter, Check, Pencil, Save, Camera, FolderPlus
} from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '../ui/Button'
import {
  SCREENABLE_FIELDS, OPERATOR_LABELS, getField
} from '../../lib/lists/screen-fields'
import type { ScreenableField } from '../../lib/lists/screen-fields'
import type {
  ScreenCriteria, ScreenGroup, ScreenRule, ScreenOperator
} from '../../lib/lists/screen-types'
import {
  emptyScreenCriteria, isScreenGroup,
  updateRuleInTree, removeNodeFromTree, addNodeToGroup,
  setGroupCombinator, newSubGroup
} from '../../lib/lists/screen-types'

interface ScreenCriteriaPanelProps {
  criteria: ScreenCriteria | null
  canEdit: boolean
  matchCount: number
  universeCount: number
  isLoading: boolean
  onSave: (next: ScreenCriteria) => void
  isSaving?: boolean
  /** Snapshot the current matches into a new manual list. */
  onSnapshot?: () => void
  isSnapshotting?: boolean
}

const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

const newRule = (): ScreenRule => {
  const first = SCREENABLE_FIELDS[0]
  return {
    id: uuid(),
    field: first.key,
    op: first.operators[0],
    value: defaultValueForOp(first, first.operators[0])
  }
}

const totalRuleCount = (g: ScreenGroup): number =>
  g.rules.reduce((acc, n) => acc + (isScreenGroup(n) ? totalRuleCount(n) : 1), 0)

export function ScreenCriteriaPanel({
  criteria, canEdit, matchCount, universeCount, isLoading, onSave, isSaving,
  onSnapshot, isSnapshotting
}: ScreenCriteriaPanelProps) {
  const [isEditing, setIsEditing] = useState(!criteria)
  const [draft, setDraft] = useState<ScreenCriteria>(
    criteria ?? emptyScreenCriteria()
  )

  useEffect(() => {
    if (!isEditing) setDraft(criteria ?? emptyScreenCriteria())
  }, [criteria, isEditing])

  const savedCount = criteria ? totalRuleCount(criteria) : 0

  // ── Tree mutation helpers (operate on draft) ────────────────
  const updateRule = (ruleId: string, patch: Partial<ScreenRule>) =>
    setDraft(d => updateRuleInTree(d, ruleId, patch))

  const removeNode = (nodeId: string) =>
    setDraft(d => removeNodeFromTree(d, nodeId))

  const addRuleToGroup = (groupId: string) =>
    setDraft(d => addNodeToGroup(d, groupId, newRule()))

  const addGroupToGroup = (groupId: string) =>
    setDraft(d => addNodeToGroup(d, groupId, newSubGroup('AND')))

  const toggleCombinator = (groupId: string, next: 'AND' | 'OR') =>
    setDraft(d => setGroupCombinator(d, groupId, next))

  const handleSave = () => {
    onSave(draft)
    setIsEditing(false)
  }

  const handleCancel = () => {
    setDraft(criteria ?? emptyScreenCriteria())
    setIsEditing(false)
  }

  // ── Saved view (read-only summary) ──────────────────────────
  if (!isEditing) {
    return (
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50/60 dark:bg-gray-900/40 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0 flex-1 flex-wrap">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex-shrink-0 pt-0.5">
              <Filter className="h-3 w-3" />
              Criteria
            </div>
            {savedCount === 0 ? (
              <span className="text-xs italic text-gray-400 pt-0.5">
                No criteria — matches all assets
              </span>
            ) : (
              <div className="flex items-center gap-1 flex-wrap">
                <GroupSummary group={criteria!} depth={0} />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <MatchCountBadge
              matchCount={matchCount}
              universeCount={universeCount}
              isLoading={isLoading}
            />
            {onSnapshot && matchCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSnapshot}
                disabled={isSnapshotting}
                title="Create a manual list from the current matches"
              >
                <Camera className="h-3.5 w-3.5 mr-1" />
                {isSnapshotting ? 'Snapshotting…' : 'Snapshot'}
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Editing view ────────────────────────────────────────────
  return (
    <div className="border border-primary-300 dark:border-primary-700 rounded-lg bg-primary-50/30 dark:bg-primary-900/10 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary-700 dark:text-primary-300">
          <Filter className="h-3 w-3" />
          Edit criteria
        </div>
        <MatchCountBadge
          matchCount={matchCount}
          universeCount={universeCount}
          isLoading={isLoading}
        />
      </div>

      <GroupEditor
        group={draft}
        depth={0}
        isRoot
        onUpdateRule={updateRule}
        onRemoveNode={removeNode}
        onAddRule={addRuleToGroup}
        onAddGroup={addGroupToGroup}
        onToggleCombinator={toggleCombinator}
      />

      <div className="flex items-center justify-end gap-1 pt-1 border-t border-primary-200 dark:border-primary-800">
        <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving}>
          <Save className="h-3.5 w-3.5 mr-1" />
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Editing — recursive group editor
// ══════════════════════════════════════════════════════════════════════

interface GroupEditorProps {
  group: ScreenGroup
  depth: number
  isRoot?: boolean
  onUpdateRule: (ruleId: string, patch: Partial<ScreenRule>) => void
  onRemoveNode: (nodeId: string) => void
  onAddRule: (groupId: string) => void
  onAddGroup: (groupId: string) => void
  onToggleCombinator: (groupId: string, next: 'AND' | 'OR') => void
}

function GroupEditor({
  group, depth, isRoot,
  onUpdateRule, onRemoveNode, onAddRule, onAddGroup, onToggleCombinator
}: GroupEditorProps) {
  const empty = group.rules.length === 0

  return (
    <div
      className={clsx(
        depth > 0 && 'border-l-2 border-primary-300 dark:border-primary-700 pl-3 ml-1',
        'space-y-1.5'
      )}
    >
      {/* Group header — combinator + actions */}
      <div className="flex items-center gap-2">
        {!isRoot && (
          <button
            onClick={() => onRemoveNode(group.id)}
            className="p-0.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
            title="Remove group"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <CombinatorToggle
          value={group.combinator}
          onChange={(v) => onToggleCombinator(group.id, v)}
        />
        <span className="text-[10px] uppercase tracking-wider text-gray-400">
          {empty ? 'no criteria' : `${group.rules.length} ${group.rules.length === 1 ? 'item' : 'items'}`}
        </span>
      </div>

      {/* Children */}
      {empty ? (
        isRoot ? (
          <div className="text-xs text-gray-500 dark:text-gray-400 italic py-1">
            No criteria yet — a screen with no rules matches every asset.
          </div>
        ) : null
      ) : (
        <div className="space-y-1.5">
          {group.rules.map((node) => (
            isScreenGroup(node) ? (
              <GroupEditor
                key={node.id}
                group={node}
                depth={depth + 1}
                onUpdateRule={onUpdateRule}
                onRemoveNode={onRemoveNode}
                onAddRule={onAddRule}
                onAddGroup={onAddGroup}
                onToggleCombinator={onToggleCombinator}
              />
            ) : (
              <RuleRow
                key={node.id}
                rule={node}
                onUpdate={(patch) => onUpdateRule(node.id, patch)}
                onRemove={() => onRemoveNode(node.id)}
              />
            )
          ))}
        </div>
      )}

      {/* Add buttons */}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={() => onAddRule(group.id)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-700 dark:text-primary-300 hover:text-primary-800 dark:hover:text-primary-200"
        >
          <Plus className="h-3 w-3" />
          Add criterion
        </button>
        <button
          onClick={() => onAddGroup(group.id)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <FolderPlus className="h-3 w-3" />
          Add group
        </button>
      </div>
    </div>
  )
}

function CombinatorToggle({
  value, onChange
}: {
  value: 'AND' | 'OR'
  onChange: (v: 'AND' | 'OR') => void
}) {
  return (
    <div className="inline-flex items-center rounded border border-primary-300 dark:border-primary-700 overflow-hidden text-[10px] font-semibold">
      {(['AND', 'OR'] as const).map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={clsx(
            'px-1.5 py-0.5 transition-colors',
            value === opt
              ? 'bg-primary-500 text-white'
              : 'text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40'
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Editing — rule row
// ══════════════════════════════════════════════════════════════════════

function RuleRow({
  rule, onUpdate, onRemove
}: {
  rule: ScreenRule
  onUpdate: (patch: Partial<ScreenRule>) => void
  onRemove: () => void
}) {
  const field = getField(rule.field) ?? SCREENABLE_FIELDS[0]

  const handleFieldChange = (nextKey: string) => {
    const next = getField(nextKey) ?? SCREENABLE_FIELDS[0]
    const nextOp = next.operators.includes(rule.op) ? rule.op : next.operators[0]
    onUpdate({ field: nextKey, op: nextOp, value: defaultValueForOp(next, nextOp) })
  }

  const handleOpChange = (nextOp: ScreenOperator) => {
    onUpdate({ op: nextOp, value: defaultValueForOp(field, nextOp) })
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <select
        value={rule.field}
        onChange={(e) => handleFieldChange(e.target.value)}
        className="text-xs bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-gray-800 dark:text-gray-200"
      >
        {SCREENABLE_FIELDS.map(f => (
          <option key={f.key} value={f.key}>{f.label}</option>
        ))}
      </select>

      <select
        value={rule.op}
        onChange={(e) => handleOpChange(e.target.value as ScreenOperator)}
        className="text-xs bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-gray-800 dark:text-gray-200"
      >
        {field.operators.map(op => (
          <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
        ))}
      </select>

      <ValueEditor rule={rule} field={field} onChange={(value) => onUpdate({ value })} />

      <button
        onClick={onRemove}
        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded flex-shrink-0 ml-auto"
        title="Remove criterion"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function ValueEditor({
  rule, field, onChange
}: {
  rule: ScreenRule
  field: ScreenableField
  onChange: (value: unknown) => void
}) {
  if (isPresenceOp(rule.op)) return null

  if (field.options && (rule.op === 'is' || rule.op === 'is_not')) {
    return (
      <select
        value={String(rule.value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-gray-800 dark:text-gray-200"
      >
        <option value="">— choose —</option>
        {field.options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }

  if (field.options && (rule.op === 'in' || rule.op === 'not_in')) {
    const current = Array.isArray(rule.value) ? (rule.value as string[]) : []
    const toggle = (v: string) => {
      const next = current.includes(v) ? current.filter(x => x !== v) : [...current, v]
      onChange(next)
    }
    return (
      <div className="flex items-center gap-0.5 flex-wrap">
        {field.options.map(o => {
          const on = current.includes(o.value)
          return (
            <button
              key={o.value}
              onClick={() => toggle(o.value)}
              className={clsx(
                'px-1.5 py-0.5 text-[11px] rounded border transition-colors',
                on
                  ? 'bg-primary-100 border-primary-400 text-primary-800 dark:bg-primary-900/40 dark:border-primary-600 dark:text-primary-200'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-400'
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    )
  }

  if (rule.op === 'between') {
    const [lo, hi] = Array.isArray(rule.value) ? rule.value : [null, null]
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={lo == null ? '' : String(lo)}
          onChange={(e) => onChange([e.target.value === '' ? null : Number(e.target.value), hi])}
          placeholder="min"
          className="text-xs w-20 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-gray-800 dark:text-gray-200"
        />
        <span className="text-gray-400 text-xs">–</span>
        <input
          type="number"
          value={hi == null ? '' : String(hi)}
          onChange={(e) => onChange([lo, e.target.value === '' ? null : Number(e.target.value)])}
          placeholder="max"
          className="text-xs w-20 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-gray-800 dark:text-gray-200"
        />
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={rule.value == null ? '' : String(rule.value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        placeholder="value"
        className="text-xs w-28 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-gray-800 dark:text-gray-200"
      />
    )
  }

  if (field.type === 'date') {
    if (rule.op === 'within_last_days') {
      return (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="1"
            value={rule.value == null ? '' : String(rule.value)}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            placeholder="30"
            className="text-xs w-20 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-gray-800 dark:text-gray-200"
          />
          <span className="text-xs text-gray-500">days</span>
        </div>
      )
    }
    return (
      <input
        type="date"
        value={rule.value == null ? '' : String(rule.value).slice(0, 10)}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-gray-800 dark:text-gray-200"
      />
    )
  }

  return (
    <input
      type="text"
      value={rule.value == null ? '' : String(rule.value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder="value"
      className="text-xs flex-1 min-w-[8rem] bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-gray-800 dark:text-gray-200"
    />
  )
}

// ══════════════════════════════════════════════════════════════════════
// Read-only summary
// ══════════════════════════════════════════════════════════════════════

function GroupSummary({ group, depth }: { group: ScreenGroup; depth: number }) {
  if (group.rules.length === 0) {
    return <span className="text-xs italic text-gray-400">(empty)</span>
  }

  const connector = group.combinator === 'AND' ? 'and' : 'or'

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {depth > 0 && <span className="text-gray-400 text-[11px]">(</span>}
      {group.rules.map((node, i) => (
        <React.Fragment key={node.id}>
          {i > 0 && (
            <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 px-0.5">
              {connector}
            </span>
          )}
          {isScreenGroup(node) ? (
            <GroupSummary group={node} depth={depth + 1} />
          ) : (
            <RulePill rule={node} />
          )}
        </React.Fragment>
      ))}
      {depth > 0 && <span className="text-gray-400 text-[11px]">)</span>}
    </span>
  )
}

function RulePill({ rule }: { rule: ScreenRule }) {
  const field = getField(rule.field)
  if (!field) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded border border-red-200 bg-red-50 text-red-700">
        Unknown: {rule.field}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded-full border border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
      <span className="font-semibold">{field.label}</span>
      <span className="text-gray-500">{OPERATOR_LABELS[rule.op]}</span>
      {!isPresenceOp(rule.op) && (
        <span className="font-mono text-gray-800 dark:text-gray-100">
          {formatValue(rule, field)}
        </span>
      )}
    </span>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Match count badge
// ══════════════════════════════════════════════════════════════════════

function MatchCountBadge({
  matchCount, universeCount, isLoading
}: {
  matchCount: number
  universeCount: number
  isLoading: boolean
}) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 text-[11px] font-medium',
      isLoading ? 'text-gray-400' : 'text-gray-600 dark:text-gray-300'
    )}>
      <Check className="h-3 w-3" />
      {isLoading ? 'Loading…' : (
        <>
          <span className="tabular-nums font-semibold">{matchCount.toLocaleString()}</span>
          <span className="text-gray-400">/ {universeCount.toLocaleString()} match</span>
        </>
      )}
    </span>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════

function isPresenceOp(op: ScreenOperator): boolean {
  return op === 'is_empty' || op === 'is_not_empty'
}

function defaultValueForOp(field: ScreenableField, op: ScreenOperator): unknown {
  if (isPresenceOp(op)) return undefined
  if (op === 'between') return [null, null]
  if (op === 'in' || op === 'not_in') return []
  if (field.type === 'number' || op === 'within_last_days') return null
  return ''
}

function formatValue(rule: ScreenRule, field: ScreenableField): string {
  if (rule.op === 'between' && Array.isArray(rule.value)) {
    const [lo, hi] = rule.value as Array<number | null>
    return `${lo ?? '…'} – ${hi ?? '…'}`
  }
  if ((rule.op === 'in' || rule.op === 'not_in') && Array.isArray(rule.value)) {
    const vals = rule.value as string[]
    if (vals.length === 0) return '(empty)'
    if (field.options) {
      const labelOf = (v: string) => field.options!.find(o => o.value === v)?.label ?? v
      return vals.slice(0, 3).map(labelOf).join(', ') + (vals.length > 3 ? ` +${vals.length - 3}` : '')
    }
    return vals.slice(0, 3).join(', ') + (vals.length > 3 ? ` +${vals.length - 3}` : '')
  }
  if (rule.value == null || rule.value === '') return '(empty)'
  if (field.type === 'date') return String(rule.value).slice(0, 10)
  if (field.options) {
    return field.options.find(o => o.value === String(rule.value))?.label ?? String(rule.value)
  }
  return String(rule.value)
}
