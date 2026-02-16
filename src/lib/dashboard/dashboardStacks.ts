/**
 * dashboardStacks — Pure stacking/ranking layer for the Decision Cockpit.
 *
 * Takes flat DashboardItem[] from useDashboardFeed and produces a
 * CockpitViewModel with stacked, ranked ActionStackCards in three bands.
 *
 * No React. No side effects. Pure functions only.
 */

import type { DashboardItem } from '../../types/dashboard-item'
import type {
  CockpitBand,
  CockpitStackKind,
  CockpitStack,
  CockpitBandData,
  CockpitViewModel,
  CockpitSummary,
} from '../../types/cockpit'
import type { NavigateFn } from './mapGdeToDashboardItems'

// ---------------------------------------------------------------------------
// Stack config — title, icon, accent, CTA label per kind
// ---------------------------------------------------------------------------

interface StackConfig {
  title: string
  icon: string
  accentColor: string
  ctaLabel: string
}

const STACK_CONFIG: Record<CockpitStackKind, StackConfig> = {
  proposal:    { title: 'Proposals Awaiting Decision', icon: 'Scale',          accentColor: 'red',   ctaLabel: 'Review All' },
  execution:   { title: 'Execution Confirmations',     icon: 'CheckCircle2',   accentColor: 'red',   ctaLabel: 'Confirm' },
  simulation:  { title: 'Ideas Being Worked On',        icon: 'FlaskConical',   accentColor: 'amber', ctaLabel: 'Open Trade Lab' },
  thesis:      { title: 'Stale Thesis',                icon: 'FileText',       accentColor: 'amber', ctaLabel: 'Review Assets' },
  deliverable: { title: 'Overdue Deliverables',        icon: 'ListTodo',       accentColor: 'amber', ctaLabel: 'Open Projects' },
  rating:      { title: 'Rating Changes',              icon: 'AlertTriangle',  accentColor: 'blue',  ctaLabel: 'Create Ideas' },
  signal:      { title: 'Intelligence Signals',        icon: 'Radar',          accentColor: 'blue',  ctaLabel: 'View' },
  project:     { title: 'Projects Needing Attention',  icon: 'FolderKanban',   accentColor: 'amber', ctaLabel: 'Open Projects' },
  prompt:      { title: 'Team Prompts',                icon: 'MessageSquare',  accentColor: 'violet', ctaLabel: 'Respond' },
  flag:        { title: 'System Flags',                icon: 'Flag',           accentColor: 'cyan',  ctaLabel: 'Review' },
  other:       { title: 'Other Items',                 icon: 'HelpCircle',     accentColor: 'gray',  ctaLabel: 'Open' },
}

// ---------------------------------------------------------------------------
// Band config
// ---------------------------------------------------------------------------

const BAND_CONFIG: Record<CockpitBand, { title: string; subtitle: string }> = {
  DECIDE:      { title: 'DECIDE \u2014 Requires Decision',   subtitle: 'Capital allocation and execution decisions' },
  ADVANCE:     { title: 'ADVANCE \u2014 Needs Progress',     subtitle: 'Research, modeling, and follow-up work' },
  AWARE:       { title: 'AWARE \u2014 Monitoring',            subtitle: 'Intelligence and coverage signals' },
  INVESTIGATE: { title: 'INVESTIGATE \u2014 Worth Looking Into', subtitle: 'System flags and team prompts to address' },
}

// ---------------------------------------------------------------------------
// Kind inference from DashboardItem
// ---------------------------------------------------------------------------

export function getStackKind(item: DashboardItem): CockpitStackKind {
  // Use item.id prefix for granularity (mirrors engine evaluator IDs)
  if (item.id.startsWith('a1-proposal')) return 'proposal'
  if (item.id.startsWith('a2-execution')) return 'execution'
  if (item.id.startsWith('a3-unsimulated')) return 'simulation'
  if (item.id.startsWith('a4-deliverable')) return 'deliverable'
  if (item.id.startsWith('thesis-stale')) return 'thesis'
  if (item.id.startsWith('i1-rating')) return 'rating'
  if (item.id.startsWith('i3-ev')) return 'signal'

  // Prompts from attention system
  if (item.id.startsWith('attn-') && item.title.toLowerCase().includes('prompt')) return 'prompt'

  // Fallback to DashboardItemType for attention-system items
  switch (item.type) {
    case 'DECISION': return 'proposal'
    case 'SIMULATION': return 'simulation'
    case 'PROJECT': return 'project'
    case 'THESIS': return 'thesis'
    case 'RATING': return 'rating'
    case 'SIGNAL': return 'signal'
    default: return 'other'
  }
}

// ---------------------------------------------------------------------------
// Band assignment for a stack
// ---------------------------------------------------------------------------

export function determineBandForStack(
  kind: CockpitStackKind,
  items: DashboardItem[],
): CockpitBand {
  // Deterministic kind→band mapping
  switch (kind) {
    case 'proposal':
    case 'execution':
      return 'DECIDE'

    case 'simulation':
    case 'thesis':
      return 'ADVANCE'

    case 'deliverable':
    case 'project':
      // Promote to DECIDE if ALL items are HIGH severity (blocking)
      if (items.length > 0 && items.every(i => i.severity === 'HIGH')) {
        return 'DECIDE'
      }
      return 'ADVANCE'

    case 'rating':
    case 'signal':
      return 'AWARE'

    case 'prompt':
    case 'flag':
      return 'INVESTIGATE'

    case 'other':
      return 'AWARE'

    default:
      return 'AWARE'
  }
}

// ---------------------------------------------------------------------------
// Attention score computation
// ---------------------------------------------------------------------------

export function computeAttentionScore(
  items: DashboardItem[],
  band: CockpitBand,
): number {
  let score = 0

  // Band bonus
  if (band === 'DECIDE') score += 50

  // Age: 2 points per day of oldest item
  const oldest = Math.max(0, ...items.map(i => i.ageDays ?? 0))
  score += oldest * 2

  // Portfolio spread: 10 points per unique portfolio
  const portfolios = new Set(items.map(i => i.portfolio?.id).filter(Boolean))
  score += portfolios.size * 10

  // Volume: 3 points per item
  score += items.length * 3

  // Severity bonuses
  for (const item of items) {
    if (item.severity === 'HIGH') score += 20
    else if (item.severity === 'MED') score += 5
  }

  return score
}

// ---------------------------------------------------------------------------
// Subtitle formatting
// ---------------------------------------------------------------------------

export function formatStackSubtitle(
  oldestDays: number,
  portfolioCount: number,
  band: CockpitBand,
  count: number,
): string {
  const parts: string[] = []

  if (band === 'DECIDE' && oldestDays >= 7) {
    parts.push(`${oldestDays}d stalling`)
  } else if (band === 'ADVANCE' && oldestDays >= 14) {
    parts.push(`${oldestDays}d since last review`)
  }

  if (portfolioCount > 0) {
    parts.push(`${portfolioCount} portfolio${portfolioCount !== 1 ? 's' : ''}`)
  }

  if (band === 'ADVANCE') {
    parts.push(`${count} item${count !== 1 ? 's' : ''} pending`)
  } else if (band === 'INVESTIGATE') {
    parts.push(`${count} to review`)
  } else {
    parts.push(`${count} signal${count !== 1 ? 's' : ''}`)
  }

  return parts.join(' \u00B7 ')
}

// ---------------------------------------------------------------------------
// CTA builder
// ---------------------------------------------------------------------------

export function getStackCTA(
  kind: CockpitStackKind,
  items: DashboardItem[],
  navigate: NavigateFn,
): { label: string; onClick: () => void } {
  const config = STACK_CONFIG[kind]

  // Single item: delegate to the item's own action
  if (items.length === 1) {
    return items[0].primaryAction
  }

  // Multi-item: kind-specific navigation
  switch (kind) {
    case 'proposal':
    case 'execution':
      return {
        label: config.ctaLabel,
        onClick: () => navigate({
          type: 'trade-queue',
          id: 'trade-queue',
          title: 'Trade Queue',
        }),
      }

    case 'simulation':
      return {
        label: config.ctaLabel,
        onClick: () => navigate({
          type: 'trade-lab',
          id: 'trade-lab',
          title: 'Trade Lab',
        }),
      }

    case 'deliverable':
    case 'project':
      return {
        label: config.ctaLabel,
        onClick: () => navigate({
          type: 'projects-list',
          id: 'projects-list',
          title: 'Projects',
        }),
      }

    case 'thesis':
      return {
        label: config.ctaLabel,
        onClick: () => navigate({
          type: 'lists',
          id: 'lists',
          title: 'Lists',
        }),
      }

    case 'rating':
    case 'signal':
    case 'other':
    default:
      return {
        label: config.ctaLabel,
        onClick: () => items[0]?.primaryAction.onClick(),
      }
  }
}

// ---------------------------------------------------------------------------
// Median helper
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.floor((sorted[mid - 1] + sorted[mid]) / 2)
}

// ---------------------------------------------------------------------------
// Portfolio & ticker breakdown
// ---------------------------------------------------------------------------

function buildPortfolioBreakdown(
  items: DashboardItem[],
): { id: string; name: string; count: number }[] {
  const map = new Map<string, { name: string; count: number }>()
  for (const item of items) {
    if (item.portfolio?.id) {
      const entry = map.get(item.portfolio.id)
      if (entry) {
        entry.count++
      } else {
        map.set(item.portfolio.id, { name: item.portfolio.name, count: 1 })
      }
    }
  }
  return Array.from(map.entries())
    .map(([id, { name, count }]) => ({ id, name, count }))
    .sort((a, b) => b.count - a.count)
}

function buildTickerBreakdown(
  items: DashboardItem[],
): { ticker: string; count: number }[] {
  const map = new Map<string, number>()
  for (const item of items) {
    if (item.asset?.ticker) {
      map.set(item.asset.ticker, (map.get(item.asset.ticker) ?? 0) + 1)
    }
  }
  return Array.from(map.entries())
    .map(([ticker, count]) => ({ ticker, count }))
    .sort((a, b) => b.count - a.count)
}

// ---------------------------------------------------------------------------
// Build a single CockpitStack
// ---------------------------------------------------------------------------

function buildStack(
  kind: CockpitStackKind,
  items: DashboardItem[],
  navigate: NavigateFn,
): CockpitStack {
  const config = STACK_CONFIG[kind]
  const band = determineBandForStack(kind, items)
  const ages = items.map(i => i.ageDays ?? 0)
  const oldestAgeDays = Math.max(0, ...ages)
  const medianAgeDays = median(ages)
  const portfolioBreakdown = buildPortfolioBreakdown(items)
  const tickerBreakdown = buildTickerBreakdown(items)
  const attentionScore = computeAttentionScore(items, band)

  // Sort items within stack: HIGH first, then by age desc
  const sevRank = { HIGH: 3, MED: 2, LOW: 1 } as const
  const sorted = [...items].sort((a, b) => {
    const sd = sevRank[b.severity] - sevRank[a.severity]
    if (sd !== 0) return sd
    return (b.ageDays ?? 0) - (a.ageDays ?? 0)
  })

  return {
    stackKey: kind,
    band,
    kind,
    title: config.title,
    subtitle: formatStackSubtitle(
      oldestAgeDays,
      portfolioBreakdown.length,
      band,
      items.length,
    ),
    attentionScore,
    count: items.length,
    itemsPreview: sorted.slice(0, 3),
    itemsAll: sorted,
    portfolioBreakdown,
    tickerBreakdown,
    oldestAgeDays,
    medianAgeDays,
    primaryCTA: getStackCTA(kind, items, navigate),
    icon: config.icon,
    accentColor: config.accentColor,
  }
}

// ---------------------------------------------------------------------------
// Build band data
// ---------------------------------------------------------------------------

function buildBandData(
  band: CockpitBand,
  stacks: CockpitStack[],
): CockpitBandData {
  const config = BAND_CONFIG[band]
  const sorted = [...stacks].sort((a, b) => b.attentionScore - a.attentionScore)
  const totalItems = sorted.reduce((sum, s) => sum + s.count, 0)

  return {
    band,
    title: config.title,
    subtitle: config.subtitle,
    stacks: sorted,
    totalItems,
  }
}

// ---------------------------------------------------------------------------
// Build summary
// ---------------------------------------------------------------------------

function buildSummary(
  decide: CockpitBandData,
  advance: CockpitBandData,
  aware: CockpitBandData,
  investigate: CockpitBandData,
): CockpitSummary {
  const allStacks = [...decide.stacks, ...advance.stacks, ...aware.stacks, ...investigate.stacks]
  const oldestDays = Math.max(0, ...allStacks.map(s => s.oldestAgeDays))

  return {
    decisions: decide.totalItems,
    work: advance.totalItems,
    signals: aware.totalItems,
    investigate: investigate.totalItems,
    oldestDays,
  }
}

// ---------------------------------------------------------------------------
// Orchestrator: DashboardItem[] → CockpitViewModel
// ---------------------------------------------------------------------------

export function buildCockpitViewModel(
  items: DashboardItem[],
  navigate: NavigateFn,
): CockpitViewModel {
  // 1. Group items by stack kind
  const groups = new Map<CockpitStackKind, DashboardItem[]>()
  for (const item of items) {
    const kind = getStackKind(item)
    if (!groups.has(kind)) groups.set(kind, [])
    groups.get(kind)!.push(item)
  }

  // 2. Build stacks
  const allStacks: CockpitStack[] = []
  for (const [kind, kindItems] of groups) {
    allStacks.push(buildStack(kind, kindItems, navigate))
  }

  // 3. Split stacks into bands
  const decideStacks: CockpitStack[] = []
  const advanceStacks: CockpitStack[] = []
  const awareStacks: CockpitStack[] = []
  const investigateStacks: CockpitStack[] = []

  for (const stack of allStacks) {
    switch (stack.band) {
      case 'DECIDE': decideStacks.push(stack); break
      case 'ADVANCE': advanceStacks.push(stack); break
      case 'AWARE': awareStacks.push(stack); break
      case 'INVESTIGATE': investigateStacks.push(stack); break
    }
  }

  // 4. Build band data
  const decide = buildBandData('DECIDE', decideStacks)
  const advance = buildBandData('ADVANCE', advanceStacks)
  const aware = buildBandData('AWARE', awareStacks)
  const investigate = buildBandData('INVESTIGATE', investigateStacks)

  // 5. Summary
  const summary = buildSummary(decide, advance, aware, investigate)

  return { decide, advance, aware, investigate, summary }
}
