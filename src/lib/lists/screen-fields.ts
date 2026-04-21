/**
 * SCREENABLE_FIELDS — registry of asset fields that can appear in a
 * screen's criteria, along with their type and valid operators.
 *
 * Adding a new field:
 *   1. Add an entry here
 *   2. Make sure the asset object has the field (or extend the
 *      enriched-asset shape in useScreenResults)
 *   3. The evaluator dispatches on `type`, so no evaluator change is
 *      needed unless you add a new type.
 */

import type { ScreenFieldType, ScreenOperator } from './screen-types'

export interface ScreenableField {
  key: string
  label: string
  type: ScreenFieldType
  /** Operators allowed for this field, in display order. */
  operators: ScreenOperator[]
  /** For enum types: the fixed option list. Omitted for free-form text. */
  options?: Array<{ value: string; label: string }>
  /**
   * Resolver: given an asset, return the comparable value.
   * Handles type coercion (e.g. market_cap string → number).
   */
  getValue: (asset: any) => unknown
}

// Shared operator bundles
const TEXT_OPS: ScreenOperator[]   = ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty']
const ENUM_OPS: ScreenOperator[]   = ['is', 'is_not', 'in', 'not_in', 'is_empty', 'is_not_empty']
const NUMBER_OPS: ScreenOperator[] = ['gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty']
const DATE_OPS: ScreenOperator[]   = ['before', 'after', 'within_last_days', 'is_empty', 'is_not_empty']

const parseNumeric = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

export const SCREENABLE_FIELDS: ScreenableField[] = [
  // ── Identifiers ─────────────────────────────────────────────
  { key: 'symbol',        label: 'Symbol',        type: 'text', operators: TEXT_OPS, getValue: a => a?.symbol ?? '' },
  { key: 'company_name',  label: 'Company',       type: 'text', operators: TEXT_OPS, getValue: a => a?.company_name ?? '' },

  // ── Classification ──────────────────────────────────────────
  { key: 'sector',        label: 'Sector',        type: 'text', operators: TEXT_OPS, getValue: a => a?.sector ?? null },
  { key: 'industry',      label: 'Industry',      type: 'text', operators: TEXT_OPS, getValue: a => a?.industry ?? null },
  { key: 'country',       label: 'Country',       type: 'text', operators: TEXT_OPS, getValue: a => a?.country ?? null },
  { key: 'exchange',      label: 'Exchange',      type: 'text', operators: TEXT_OPS, getValue: a => a?.exchange ?? null },
  {
    key: 'priority',      label: 'Priority',      type: 'enum', operators: ENUM_OPS,
    options: [
      { value: 'high',   label: 'High'   },
      { value: 'medium', label: 'Medium' },
      { value: 'low',    label: 'Low'    }
    ],
    getValue: a => a?.priority ?? null
  },
  {
    key: 'process_stage', label: 'Process stage', type: 'enum', operators: ENUM_OPS,
    options: [
      { value: 'none',        label: 'None'         },
      { value: 'monitor',     label: 'Monitor'      },
      { value: 'prioritized', label: 'Prioritized'  },
      { value: 'initiated',   label: 'Initiated'    },
      { value: 'in_progress', label: 'In progress'  },
      { value: 'research',    label: 'Research'     },
      { value: 'analysis',    label: 'Analysis'     },
      { value: 'monitoring',  label: 'Monitoring'   },
      { value: 'review',      label: 'Review'       },
      { value: 'recommend',   label: 'Recommend'    },
      { value: 'action',      label: 'Action'       },
      { value: 'archived',    label: 'Archived'     },
      { value: 'outdated',    label: 'Outdated'     }
    ],
    getValue: a => a?.process_stage ?? null
  },

  // ── Market data ─────────────────────────────────────────────
  { key: 'current_price', label: 'Price',         type: 'number', operators: NUMBER_OPS, getValue: a => parseNumeric(a?.current_price) },
  { key: 'market_cap',    label: 'Market cap',    type: 'number', operators: NUMBER_OPS, getValue: a => parseNumeric(a?.market_cap) },

  // ── Research content (presence is the useful dimension) ─────
  { key: 'thesis',          label: 'Thesis',           type: 'text', operators: TEXT_OPS, getValue: a => a?.thesis ?? null },
  { key: 'where_different', label: 'Where different',  type: 'text', operators: TEXT_OPS, getValue: a => a?.where_different ?? null },
  { key: 'risks_to_thesis', label: 'Risks to thesis',  type: 'text', operators: TEXT_OPS, getValue: a => a?.risks_to_thesis ?? null },
  { key: 'quick_note',      label: 'Quick note',       type: 'text', operators: TEXT_OPS, getValue: a => a?.quick_note ?? null },
  { key: 'completeness',    label: 'Completeness (%)', type: 'number', operators: NUMBER_OPS, getValue: a => parseNumeric(a?.completeness) },

  // ── Timestamps ──────────────────────────────────────────────
  { key: 'created_at', label: 'Created',       type: 'date', operators: DATE_OPS, getValue: a => a?.created_at ?? null },
  { key: 'updated_at', label: 'Last updated',  type: 'date', operators: DATE_OPS, getValue: a => a?.updated_at ?? null },

  // ── Price targets (from useScreenResults joins) ─────────────
  // Presence fields return 'yes' when present, null otherwise —
  // users filter with is_empty / is_not_empty.
  { key: 'has_any_target',  label: 'Has any price target',  type: 'text', operators: ['is_empty', 'is_not_empty'], getValue: a => a?._hasAnyTarget ?? null },
  { key: 'has_bull_target', label: 'Has bull target',       type: 'text', operators: ['is_empty', 'is_not_empty'], getValue: a => a?._hasBullTarget ?? null },
  { key: 'has_base_target', label: 'Has base target',       type: 'text', operators: ['is_empty', 'is_not_empty'], getValue: a => a?._hasBaseTarget ?? null },
  { key: 'has_bear_target', label: 'Has bear target',       type: 'text', operators: ['is_empty', 'is_not_empty'], getValue: a => a?._hasBearTarget ?? null },
  { key: 'base_target_price', label: 'Base target ($)',     type: 'number', operators: NUMBER_OPS, getValue: a => parseNumeric(a?._baseTargetPrice) },
  { key: 'bull_target_price', label: 'Bull target ($)',     type: 'number', operators: NUMBER_OPS, getValue: a => parseNumeric(a?._bullTargetPrice) },
  { key: 'bear_target_price', label: 'Bear target ($)',     type: 'number', operators: NUMBER_OPS, getValue: a => parseNumeric(a?._bearTargetPrice) },
  { key: 'base_upside_pct',   label: 'Base upside (%)',     type: 'number', operators: NUMBER_OPS, getValue: a => parseNumeric(a?._baseUpsidePct) },
  { key: 'bull_upside_pct',   label: 'Bull upside (%)',     type: 'number', operators: NUMBER_OPS, getValue: a => parseNumeric(a?._bullUpsidePct) },
  { key: 'bear_upside_pct',   label: 'Bear upside (%)',     type: 'number', operators: NUMBER_OPS, getValue: a => parseNumeric(a?._bearUpsidePct) },

  // ── Coverage ────────────────────────────────────────────────
  { key: 'has_coverage',   label: 'Has coverage',   type: 'text',   operators: ['is_empty', 'is_not_empty'], getValue: a => a?._hasCoverage ?? null },
  { key: 'analyst_name',   label: 'Analyst',        type: 'text',   operators: TEXT_OPS, getValue: a => a?._analystNames ?? null },
  { key: 'coverage_count', label: 'Analyst count',  type: 'number', operators: NUMBER_OPS, getValue: a => parseNumeric(a?._coverageCount) }
]

export const FIELDS_BY_KEY = new Map(SCREENABLE_FIELDS.map(f => [f.key, f]))

export function getField(key: string): ScreenableField | undefined {
  return FIELDS_BY_KEY.get(key)
}

// ── Human labels for operators ────────────────────────────────

export const OPERATOR_LABELS: Record<ScreenOperator, string> = {
  contains:         'contains',
  not_contains:     'does not contain',
  equals:           'equals',
  not_equals:       'does not equal',
  is:               'is',
  is_not:           'is not',
  in:               'is one of',
  not_in:           'is none of',
  gt:               '>',
  gte:              '≥',
  lt:               '<',
  lte:              '≤',
  between:          'between',
  before:           'before',
  after:            'after',
  within_last_days: 'in the last (days)',
  is_empty:         'is empty',
  is_not_empty:     'is not empty'
}
