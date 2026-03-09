import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users, Plus, Edit, Trash2 } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { getUserDisplayName, getUserInitials, type TeamMember } from './portfolio-tab-types'
import { supabase } from '../../../lib/supabase'

// ---------------------------------------------------------------------------
// Role grouping
// ---------------------------------------------------------------------------

const ROLE_GROUP_ORDER = ['Portfolio Managers', 'Analysts', 'Traders']

function normalizeRoleGroup(role: string): string {
  const r = role.toLowerCase().trim()
  if (r.includes('manager') || r === 'pm' || r.includes('portfolio manager')) return 'Portfolio Managers'
  if (r.includes('analyst') || r.includes('research')) return 'Analysts'
  if (r.includes('trader') || r.includes('trading') || r.includes('execution')) return 'Traders'
  return role
}

const ROLE_BADGE_STYLE: Record<string, string> = {
  'Portfolio Managers': 'bg-violet-50 text-violet-700 border-violet-200/60',
  'Analysts':          'bg-blue-50 text-blue-700 border-blue-200/60',
  'Traders':           'bg-emerald-50 text-emerald-700 border-emerald-200/60',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TeamTabProps {
  portfolioId: string
  teamMembersByRole: Record<string, TeamMember[]>
  teamLoading: boolean
  teamError: any
  teamWithUsers: any[] | undefined
  onEditMember: (member: TeamMember, role: string) => void
  onDeleteMember: (member: TeamMember, role: string) => void
  onAddMember: () => void
}

// ---------------------------------------------------------------------------
// Metrics types
// ---------------------------------------------------------------------------

interface MemberMetrics {
  ideaCount: number
  tradeCount: number
  coveredAssets: { symbol: string; sector: string | null }[]
  coverageSectors: string[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeamTab({
  portfolioId,
  teamMembersByRole,
  teamLoading,
  teamError,
  teamWithUsers,
  onEditMember,
  onDeleteMember,
  onAddMember,
}: TeamTabProps) {

  // ── Supplementary data: coverage, ideas, trades ─────────

  const { data: metrics } = useQuery({
    queryKey: ['portfolio-team-metrics', portfolioId],
    enabled: !!portfolioId && !!teamWithUsers && teamWithUsers.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      // Phase 1: Parallel — holdings + ideas + trades
      const [holdingsRes, ideasRes, tradesRes] = await Promise.all([
        supabase
          .from('portfolio_holdings')
          .select('asset_id, assets(id, symbol, sector)')
          .eq('portfolio_id', portfolioId),

        supabase
          .from('trade_queue_items')
          .select('created_by')
          .eq('portfolio_id', portfolioId)
          .is('deleted_at', null)
          .or('visibility_tier.is.null,visibility_tier.eq.active'),

        supabase
          .from('lab_variants')
          .select('created_by')
          .eq('portfolio_id', portfolioId)
          .not('sizing_input', 'is', null)
          .is('deleted_at', null)
          .or('visibility_tier.is.null,visibility_tier.eq.active'),
      ])

      // Phase 2: Coverage for held assets
      const heldAssetIds = [...new Set((holdingsRes.data || []).map((h: any) => h.asset_id).filter(Boolean))]
      const coverageRes = heldAssetIds.length > 0
        ? await supabase
            .from('coverage')
            .select('user_id, asset_id')
            .eq('is_active', true)
            .in('asset_id', heldAssetIds)
        : { data: [] as any[] }

      // Build asset lookup from holdings
      const assetMap = new Map<string, { symbol: string; sector: string | null }>()
      for (const h of holdingsRes.data || []) {
        const a = (h as any).assets
        if (a) assetMap.set(a.id, { symbol: a.symbol, sector: a.sector })
      }

      // Idea counts per user
      const ideaCounts = new Map<string, number>()
      for (const r of ideasRes.data || []) {
        ideaCounts.set(r.created_by, (ideaCounts.get(r.created_by) || 0) + 1)
      }

      // Trade counts per user
      const tradeCounts = new Map<string, number>()
      for (const r of tradesRes.data || []) {
        tradeCounts.set(r.created_by, (tradeCounts.get(r.created_by) || 0) + 1)
      }

      // Coverage per user → asset symbols + sectors
      const userCoverage = new Map<string, { symbol: string; sector: string | null }[]>()
      for (const c of coverageRes.data || []) {
        const asset = assetMap.get(c.asset_id)
        if (!asset) continue
        if (!userCoverage.has(c.user_id)) userCoverage.set(c.user_id, [])
        const existing = userCoverage.get(c.user_id)!
        if (!existing.some(a => a.symbol === asset.symbol)) {
          existing.push(asset)
        }
      }

      return { ideaCounts, tradeCounts, userCoverage, assetMap }
    },
  })

  // ── Derive per-member metrics ─────────────────────────────

  const getMemberMetrics = (userId: string, focus: string[]): MemberMetrics => {
    if (!metrics) return { ideaCount: 0, tradeCount: 0, coveredAssets: [], coverageSectors: [] }

    const coveredAssets = metrics.userCoverage.get(userId) || []
    // Derive sectors from coverage; fall back to focus field
    const coverageSectors = coveredAssets.length > 0
      ? [...new Set(coveredAssets.map(a => a.sector).filter(Boolean) as string[])]
      : focus

    return {
      ideaCount: metrics.ideaCounts.get(userId) || 0,
      tradeCount: metrics.tradeCounts.get(userId) || 0,
      coveredAssets,
      coverageSectors,
    }
  }

  // ── Regroup members by normalized role category ───────────

  const groupedByCategory = useMemo(() => {
    const groups = new Map<string, { role: string; members: TeamMember[] }[]>()

    for (const [role, members] of Object.entries(teamMembersByRole)) {
      const group = normalizeRoleGroup(role)
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group)!.push({ role, members })
    }

    // Sort by defined order, unknown roles go to end
    const sorted = [...groups.entries()].sort(([a], [b]) => {
      const ai = ROLE_GROUP_ORDER.indexOf(a)
      const bi = ROLE_GROUP_ORDER.indexOf(b)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })

    // Flatten: each group entry → flat member list with original role preserved
    return sorted.map(([groupLabel, roleEntries]) => ({
      groupLabel,
      members: roleEntries.flatMap(re => re.members.map(m => ({ ...m, _role: re.role }))),
    }))
  }, [teamMembersByRole])

  // ── Loading ───────────────────────────────────────────────

  if (teamLoading && !teamWithUsers) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Team</h2>
        </div>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <Card padding="sm">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gray-200 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-1/3" />
                    <div className="h-3 bg-gray-200 rounded w-2/3" />
                  </div>
                </div>
              </Card>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────

  if (teamError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Team</h2>
        </div>
        <div className="text-sm text-red-600">Error loading team: {(teamError as any)?.message || 'Unknown error'}</div>
      </div>
    )
  }

  // ── Empty state ───────────────────────────────────────────

  if (groupedByCategory.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Team</h2>
        </div>
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No team members yet</h3>
          <p className="text-gray-500 mb-4">Add team members to this portfolio.</p>
          <Button size="sm" onClick={onAddMember}>
            <Plus className="h-4 w-4 mr-2" />
            Add Member
          </Button>
        </div>
      </div>
    )
  }

  // ── Main view ─────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Team</h2>
        <Button size="sm" onClick={onAddMember}>
          <Plus className="h-4 w-4 mr-2" />
          Add Member
        </Button>
      </div>

      {groupedByCategory.map(({ groupLabel, members }) => {
        const badgeStyle = ROLE_BADGE_STYLE[groupLabel] || 'bg-gray-50 text-gray-700 border-gray-200/60'

        return (
          <div key={groupLabel}>
            {/* Group header */}
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-gray-400">{groupLabel}</h3>
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-[11px] text-gray-400 tabular-nums">{members.length}</span>
            </div>

            {/* Member cards */}
            <div className="space-y-1.5">
              {members.map((member: any, idx: number) => {
                const u = member.user
                const initials = getUserInitials(u)
                const displayName = getUserDisplayName(u)
                const m = getMemberMetrics(u.id, member.focus || [])

                return (
                  <Card key={`${member.id}-${idx}`} padding="none" className="group/member px-3 py-2">
                    <div className="flex items-start gap-2.5">
                      {/* Avatar */}
                      <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center shrink-0 mt-px">
                        <span className="text-primary-600 font-semibold text-[11px]">{initials}</span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Row 1: Name + role badge ··· edit/delete */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <h4 className="text-[13px] font-semibold text-gray-900 truncate">{displayName}</h4>
                            <span className={`inline-flex items-center px-1.5 py-px rounded text-[10px] font-semibold border shrink-0 ${badgeStyle}`}>
                              {member._role}
                            </span>
                          </div>
                          <div className="flex gap-0.5 opacity-0 group-hover/member:opacity-100 transition-opacity">
                            <button
                              onClick={() => onEditMember(member, member._role)}
                              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-primary-600 transition-colors"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => onDeleteMember(member, member._role)}
                              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Row 2: Coverage sectors */}
                        {m.coverageSectors.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider shrink-0">Coverage</span>
                            <div className="flex flex-wrap gap-1">
                              {m.coverageSectors.map((sector: string) => (
                                <span
                                  key={sector}
                                  className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium bg-gray-100 text-gray-600"
                                >
                                  {sector}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Row 3: Contribution metrics — always visible */}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700">
                            <span className="text-gray-400">Ideas</span> {m.ideaCount}
                          </span>
                          <span className="text-gray-200">|</span>
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-700">
                            <span className="text-gray-400">Assets Covered</span> {m.coveredAssets.length}
                          </span>
                          <span className="text-gray-200">|</span>
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                            <span className="text-gray-400">Trades</span> {m.tradeCount}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
