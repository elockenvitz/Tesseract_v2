/**
 * Pure evaluator: does an asset satisfy a screen's criteria tree?
 * Used both by the client-side results hook and, potentially, by a
 * future server-side RPC.
 */

import type { ScreenCriteria, ScreenGroup, ScreenRule } from './screen-types'
import { isScreenGroup } from './screen-types'
import { getField } from './screen-fields'

export function evaluateCriteria(asset: any, criteria: ScreenCriteria | null | undefined): boolean {
  if (!criteria) return true
  return evaluateGroup(asset, criteria)
}

function evaluateGroup(asset: any, group: ScreenGroup): boolean {
  // An empty group matches everything — useful for half-built criteria
  // so the user can preview results incrementally.
  if (!group.rules || group.rules.length === 0) return true

  if (group.combinator === 'AND') {
    return group.rules.every(r => isScreenGroup(r) ? evaluateGroup(asset, r) : evaluateRule(asset, r))
  }
  // OR
  return group.rules.some(r => isScreenGroup(r) ? evaluateGroup(asset, r) : evaluateRule(asset, r))
}

function evaluateRule(asset: any, rule: ScreenRule): boolean {
  const field = getField(rule.field)
  if (!field) return false // unknown field → never matches
  const actual = field.getValue(asset)

  switch (rule.op) {
    // Presence (works across all types)
    case 'is_empty':
      return isEmpty(actual)
    case 'is_not_empty':
      return !isEmpty(actual)

    // Text
    case 'contains':
      return matchText(actual, rule.value, 'contains')
    case 'not_contains':
      return !matchText(actual, rule.value, 'contains')
    case 'equals':
      return matchText(actual, rule.value, 'equals')
    case 'not_equals':
      return !matchText(actual, rule.value, 'equals')

    // Enum
    case 'is':
      return matchExact(actual, rule.value)
    case 'is_not':
      return !matchExact(actual, rule.value)
    case 'in': {
      const arr = asArray(rule.value)
      return arr.includes(String(actual))
    }
    case 'not_in': {
      const arr = asArray(rule.value)
      return !arr.includes(String(actual))
    }

    // Number
    case 'gt':  return compareNumber(actual, rule.value, (a, b) => a > b)
    case 'gte': return compareNumber(actual, rule.value, (a, b) => a >= b)
    case 'lt':  return compareNumber(actual, rule.value, (a, b) => a < b)
    case 'lte': return compareNumber(actual, rule.value, (a, b) => a <= b)
    case 'between': {
      const n = toNumber(actual)
      if (n == null) return false
      const [lo, hi] = Array.isArray(rule.value) ? rule.value : [undefined, undefined]
      const loN = toNumber(lo)
      const hiN = toNumber(hi)
      if (loN == null || hiN == null) return false
      return n >= loN && n <= hiN
    }

    // Date
    case 'before': {
      const a = toDate(actual); const b = toDate(rule.value)
      return a != null && b != null && a.getTime() < b.getTime()
    }
    case 'after': {
      const a = toDate(actual); const b = toDate(rule.value)
      return a != null && b != null && a.getTime() > b.getTime()
    }
    case 'within_last_days': {
      const a = toDate(actual)
      const days = toNumber(rule.value)
      if (a == null || days == null) return false
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      return a.getTime() >= cutoff
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function isEmpty(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (v == null) return []
  return [String(v)]
}

function matchText(actual: unknown, expected: unknown, mode: 'contains' | 'equals'): boolean {
  if (actual == null || expected == null) return false
  const a = String(actual).toLowerCase().trim()
  const b = String(expected).toLowerCase().trim()
  if (!b) return false
  return mode === 'contains' ? a.includes(b) : a === b
}

function matchExact(actual: unknown, expected: unknown): boolean {
  if (actual == null) return expected == null
  return String(actual) === String(expected)
}

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

function compareNumber(actual: unknown, expected: unknown, cmp: (a: number, b: number) => boolean): boolean {
  const a = toNumber(actual)
  const b = toNumber(expected)
  if (a == null || b == null) return false
  return cmp(a, b)
}

function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}
