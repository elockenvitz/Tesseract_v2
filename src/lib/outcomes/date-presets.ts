/**
 * Outcomes date-range presets, shared by the desktop filter bar and the phone
 * range control so both set and recognise exactly the same windows.
 *
 * Lifted unchanged from `FilterBar` in DecisionAccountabilityPage.
 */

import { subDays } from 'date-fns'
import type { AccountabilityFilters } from '../../types/decision-accountability'

export type DatePreset = '7d' | '30d' | '90d' | 'QTD' | 'YTD' | '1Y' | '2Y' | 'ALL' | 'custom'

/** The presets offered as buttons, in order. */
export const DATE_PRESET_BUTTONS: DatePreset[] = ['7d', '30d', '90d', 'QTD', 'YTD', '1Y', 'ALL']

/** The range a preset selects, ending now; `start: null` is all time. */
export function presetRange(preset: Exclude<DatePreset, 'custom'>, now = new Date()): NonNullable<AccountabilityFilters['dateRange']> {
  let start: Date | null = null
  switch (preset) {
    case '7d': start = subDays(now, 7); break
    case '30d': start = subDays(now, 30); break
    case '90d': start = subDays(now, 90); break
    case 'QTD': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3
      start = new Date(now.getFullYear(), qMonth, 1)
      break
    }
    case 'YTD': start = new Date(now.getFullYear(), 0, 1); break
    case '1Y': start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break
    case '2Y': start = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()); break
    case 'ALL': start = null; break
  }
  return { start: start ? start.toISOString() : null, end: now.toISOString() }
}

/** A custom range from two `yyyy-MM-dd` inputs; the end is inclusive. */
export function customRange(startDay: string, endDay: string, now = new Date()): NonNullable<AccountabilityFilters['dateRange']> {
  return {
    start: new Date(startDay).toISOString(),
    end: endDay ? new Date(endDay + 'T23:59:59').toISOString() : now.toISOString(),
  }
}

/** Which preset a stored range reads as. */
export function activePresetFor(start: string | null | undefined, now = new Date()): DatePreset {
  if (!start) return 'ALL'
  const startDate = new Date(start)
  const diff = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  const qMonth = Math.floor(now.getMonth() / 3) * 3
  const qtdStart = new Date(now.getFullYear(), qMonth, 1)
  if (Math.abs(startDate.getTime() - qtdStart.getTime()) < 86400000) return 'QTD'
  const ytdStart = new Date(now.getFullYear(), 0, 1)
  if (Math.abs(startDate.getTime() - ytdStart.getTime()) < 86400000) return 'YTD'
  if (diff < 10) return '7d'
  if (diff < 40) return '30d'
  if (diff < 100) return '90d'
  if (diff < 400) return '1Y'
  if (diff < 800) return '2Y'
  return 'custom'
}
