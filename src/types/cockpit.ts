/**
 * Cockpit types — Stacked decision surface model.
 *
 * Replaces flat DashboardItem rows with ranked ActionStackCards
 * grouped into three bands: DECIDE, ADVANCE, AWARE.
 */

import type { DashboardItem } from './dashboard-item'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type CockpitBand = 'DECIDE' | 'ADVANCE' | 'AWARE' | 'INVESTIGATE'

export type CockpitStackKind =
  | 'proposal'
  | 'execution'
  | 'simulation'
  | 'thesis'
  | 'deliverable'
  | 'rating'
  | 'signal'
  | 'project'
  | 'prompt'
  | 'flag'
  | 'other'

// ---------------------------------------------------------------------------
// Stack model
// ---------------------------------------------------------------------------

export interface CockpitStack {
  stackKey: string
  band: CockpitBand
  kind: CockpitStackKind
  title: string
  subtitle: string
  attentionScore: number
  count: number
  itemsPreview: DashboardItem[]
  itemsAll: DashboardItem[]
  portfolioBreakdown: { id: string; name: string; count: number }[]
  tickerBreakdown: { ticker: string; count: number }[]
  oldestAgeDays: number
  medianAgeDays: number
  primaryCTA: { label: string; onClick: () => void }
  secondaryCTA?: { label: string; onClick: () => void }
  icon: string
  accentColor: string
}

// ---------------------------------------------------------------------------
// Band model
// ---------------------------------------------------------------------------

export interface CockpitBandData {
  band: CockpitBand
  title: string
  subtitle: string
  stacks: CockpitStack[]
  totalItems: number
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export interface CockpitSummary {
  decisions: number
  work: number
  signals: number
  investigate: number
  oldestDays: number
}

export interface CockpitViewModel {
  decide: CockpitBandData
  advance: CockpitBandData
  aware: CockpitBandData
  investigate: CockpitBandData
  summary: CockpitSummary
}
