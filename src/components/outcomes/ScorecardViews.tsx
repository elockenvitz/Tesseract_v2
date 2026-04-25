/**
 * ScorecardViews — Decision Quality Evaluation System
 *
 * 5-layer architecture:
 *   A — Executive Judgment Header
 *   B — Process Breakdown + Outcome Snapshot
 *   C — Diagnostic Pillars
 *   D — Behavior Insights
 *   E — Team Comparison with ranking
 */

import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  ArrowUp, ArrowDown, Users, Briefcase,
} from 'lucide-react'
import {
  interpretAnalystScorecard, interpretPMScorecard,
  buildAnalystPillars, buildPMPillars,
  buildAnalystOutcomeSnapshot, buildPMOutcomeSnapshot,
  buildAnalystProcessBreakdown, buildPMProcessBreakdown,
  buildAnalystInsights, buildPMInsights,
  buildAnalystRosterEntry, buildPMRosterEntry,
  rankRosterEntries,
  VERDICT_CONFIG, CONFIDENCE_CONFIG,
  type ScorecardVerdict, type ScorecardFlag, type DiagnosticPillar,
  type OutcomeSnapshot, type ProcessBreakdown, type ProcessStage,
  type BehaviorInsight, type RosterEntry,
} from '../../lib/scorecard-engine'
import {
  useAnalystScorecard, usePMScorecard,
  useScorecardVisibility, useTeamMembers,
} from '../../hooks/useScorecards'
import { useAuth } from '../../hooks/useAuth'

// ════════════════════════════════════════════════════════════════
// LAYER A — Executive Judgment Header
// ════════════════════════════════════════════════════════════════

function ExecutiveHeader({ verdict: v, mode }: { verdict: ScorecardVerdict; mode: 'analyst' | 'pm' }) {
  const cfg = VERDICT_CONFIG[v.verdict]
  const confCfg = CONFIDENCE_CONFIG[v.confidence]
  const isCritical = v.verdict === 'critical'
  const isWeak = v.verdict === 'weak'
  const isSevere = isCritical || isWeak

  return (
    <div className={clsx('rounded-lg border', cfg.borderColor, cfg.bgColor, isCritical && 'border-l-4')}>
      <div className="flex items-start gap-4 p-4 pb-2.5">
        {/* Score */}
        <div className="shrink-0">
          <div className="relative w-[60px] h-[60px]">
            <svg className="w-[60px] h-[60px] transform -rotate-90">
              <circle cx="30" cy="30" r="25" stroke="currentColor" strokeWidth="4" fill="none" className="text-white/60" />
              <circle cx="30" cy="30" r="25" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"
                strokeDasharray={157} strokeDashoffset={157 - (Math.min(v.score, 100) / 100) * 157}
                className={clsx('transition-all duration-700', cfg.ringColor)} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={clsx('text-[18px] font-bold leading-none tabular-nums', v.verdict === 'insufficient' ? 'text-gray-400' : 'text-gray-900')}>
                {v.verdict === 'insufficient' ? '—' : v.score.toFixed(0)}
              </span>
            </div>
          </div>
        </div>

        {/* Judgment */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className={clsx('text-[14px] font-bold', cfg.color)}>{cfg.label}</span>
            <span className={clsx('text-[10px]', confCfg.color)}>{confCfg.label}</span>
          </div>
          <p className={clsx('text-[12px] font-semibold leading-snug', isSevere ? 'text-gray-900' : v.verdict === 'insufficient' ? 'text-gray-500' : 'text-gray-800')}>
            {v.headline}
          </p>
          <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">{v.interpretation}</p>
        </div>

        {/* Focus */}
        {v.focus.length > 0 && (
          <div className="shrink-0 max-w-[260px] pl-4 border-l border-black/5">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Focus</div>
            {v.focus.map((f, i) => (
              <p key={i} className="text-[10px] text-gray-600 leading-relaxed flex items-start gap-1.5">
                <span className="text-gray-300 mt-px shrink-0">›</span>{f}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Flags */}
      {v.flags.length > 0 && (
        <div className="px-4 pb-2.5 flex flex-wrap gap-1.5">
          {v.flags.map((f, i) => <FlagBadge key={i} flag={f} />)}
        </div>
      )}

      <div className="px-4 py-1.5 border-t border-black/5 text-[9px] text-gray-400">
        {mode === 'analyst'
          ? 'Scored on directional quality, target accuracy, recommendation outcomes, and conviction calibration.'
          : 'Scored on decision quality, execution discipline, timing, and portfolio follow-through.'}
        {v.confidence === 'low' && ' Confidence limited by small sample.'}
        {v.confidence === 'insufficient' && ' Not enough resolved data for scoring.'}
      </div>
    </div>
  )
}

function FlagBadge({ flag }: { flag: ScorecardFlag }) {
  const styles = {
    strength: 'bg-emerald-100/80 text-emerald-800 border-emerald-300/50',
    weakness: 'bg-red-100/80 text-red-800 border-red-300/50',
    warning: 'bg-amber-100/80 text-amber-800 border-amber-300/50',
    info: 'bg-gray-100 text-gray-600 border-gray-200',
  }
  return <span className={clsx('text-[9px] font-semibold px-2 py-0.5 rounded border', styles[flag.type])}>{flag.label}</span>
}

// ════════════════════════════════════════════════════════════════
// LAYER B — Process Breakdown + Outcome Snapshot
// ════════════════════════════════════════════════════════════════

function ProcessBreakdownStrip({ breakdown, snapshot }: { breakdown: ProcessBreakdown; snapshot: OutcomeSnapshot }) {
  const resolved = snapshot.winners + snapshot.losers

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Process pipeline */}
      {breakdown.stages.length > 0 && (
        <div className="px-4 py-2.5 border-b border-gray-100">
          <div className="flex items-center gap-1">
            {breakdown.stages.map((stage, i) => (
              <div key={stage.id} className="flex items-center gap-1 flex-1 min-w-0">
                <div className={clsx(
                  'flex-1 rounded py-1.5 px-2 text-center transition-all',
                  stage.status === 'strong' ? 'bg-emerald-50 border border-emerald-200' :
                  stage.status === 'adequate' ? 'bg-blue-50 border border-blue-200' :
                  stage.status === 'weak' ? 'bg-amber-50 border border-amber-300' :
                  stage.status === 'failing' ? 'bg-red-50 border border-red-300 ring-1 ring-red-200' :
                  'bg-gray-50 border border-gray-100'
                )}>
                  <div className={clsx('text-[9px] font-bold uppercase tracking-wide',
                    stage.status === 'strong' ? 'text-emerald-700' :
                    stage.status === 'adequate' ? 'text-blue-700' :
                    stage.status === 'weak' ? 'text-amber-700' :
                    stage.status === 'failing' ? 'text-red-700' :
                    'text-gray-400'
                  )}>{stage.label}</div>
                  {stage.score != null && (
                    <div className={clsx('text-[10px] font-semibold tabular-nums',
                      stage.status === 'strong' ? 'text-emerald-600' :
                      stage.status === 'adequate' ? 'text-blue-600' :
                      stage.status === 'weak' ? 'text-amber-600' :
                      stage.status === 'failing' ? 'text-red-600' :
                      'text-gray-300'
                    )}>{stage.score.toFixed(0)}</div>
                  )}
                </div>
                {i < breakdown.stages.length - 1 && (
                  <span className="text-gray-300 text-[10px] shrink-0">→</span>
                )}
              </div>
            ))}
          </div>
          {breakdown.failurePoint && (
            <p className="text-[10px] text-gray-500 mt-1.5">
              <span className="font-semibold text-red-600">Primary breakdown: {breakdown.failurePoint}.</span>
              {breakdown.failureSummary && ` ${breakdown.failureSummary}`}
            </p>
          )}
        </div>
      )}

      {/* Outcome stats */}
      <div className="flex items-stretch divide-x divide-gray-100">
        <StatCell
          value={resolved > 0 ? <><span className="text-emerald-600">{snapshot.winners}</span><span className="text-gray-300 mx-0.5">/</span><span className="text-red-600">{snapshot.losers}</span></> : '—'}
          label="won / lost"
          muted={resolved === 0}
        />
        <StatCell
          value={snapshot.winRate != null ? `${snapshot.winRate.toFixed(0)}%` : '—'}
          label="win rate"
          color={snapshot.winRate != null ? (snapshot.winRate >= 55 ? 'text-emerald-600' : snapshot.winRate < 45 ? 'text-red-600' : 'text-gray-700') : undefined}
          muted={snapshot.winRate == null}
        />
        <StatCell
          value={<>{snapshot.executedDecisions}<span className="text-gray-300">/{snapshot.totalDecisions}</span></>}
          label="executed"
          muted={snapshot.totalDecisions === 0}
        />
        {snapshot.pendingDecisions > 0 && (
          <StatCell value={snapshot.pendingDecisions} label="pending" color="text-amber-600" />
        )}
        {snapshot.avgDelayCostBps != null && Math.abs(snapshot.avgDelayCostBps) > 1 && (
          <StatCell
            value={`${snapshot.avgDelayCostBps > 0 ? '+' : ''}${snapshot.avgDelayCostBps.toFixed(0)}`}
            label="delay bps"
            color={snapshot.avgDelayCostBps > 10 ? 'text-red-600' : 'text-gray-700'}
          />
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-gray-100">
        <p className="text-[10px] text-gray-500">{snapshot.summaryText}</p>
      </div>
    </div>
  )
}

function StatCell({ value, label, color, muted }: { value: React.ReactNode; label: string; color?: string; muted?: boolean }) {
  return (
    <div className="flex-1 px-3 py-2 text-center">
      <div className={clsx('text-[15px] font-bold tabular-nums leading-none', muted ? 'text-gray-300' : color || 'text-gray-700')}>
        {value}
      </div>
      <div className="text-[8px] text-gray-400 mt-0.5">{label}</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// LAYER C — Diagnostic Pillars
// ════════════════════════════════════════════════════════════════

function DiagnosticPillarsSection({ pillars }: { pillars: DiagnosticPillar[] }) {
  if (pillars.length === 0) return null
  const anyMeasurable = pillars.some(p => p.measurable)
  const sorted = [...pillars].sort((a, b) => (b.measurable ? 1 : 0) - (a.measurable ? 1 : 0))

  return (
    <div>
      {!anyMeasurable && (
        <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
          Diagnostic pillars · Preview
        </div>
      )}
      <div className={clsx('grid gap-2', sorted.length <= 3 ? 'grid-cols-3' : 'grid-cols-2 xl:grid-cols-4')}>
        {sorted.map(p => <PillarCard key={p.id} pillar={p} />)}
      </div>
    </div>
  )
}

function PillarCard({ pillar }: { pillar: DiagnosticPillar }) {
  const strengthColor = {
    'Strong': 'text-emerald-700', 'Adequate': 'text-blue-700', 'Weak': 'text-amber-700',
    'Critical': 'text-red-700', 'Not yet measurable': 'text-gray-400',
  }[pillar.strength]

  return (
    <div className={clsx('rounded-lg border bg-white p-3',
      pillar.measurable ? 'border-gray-200' : 'border-gray-100 bg-gray-50/40')}>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className={clsx('text-[10px] font-bold uppercase tracking-wide', pillar.measurable ? 'text-gray-800' : 'text-gray-400')}>
          {pillar.title}
        </h4>
        <span className={clsx('text-[9px] font-semibold', strengthColor)}>{pillar.strength}</span>
      </div>

      {pillar.score != null ? (
        <div className="mb-1.5">
          <span className="text-[18px] font-bold text-gray-900 tabular-nums leading-none">{pillar.score.toFixed(0)}</span>
          <span className="text-[9px] text-gray-300 ml-0.5">/ 100</span>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden mt-1">
            <div className={clsx('h-full rounded-full',
              pillar.score >= 70 ? 'bg-emerald-500' : pillar.score >= 50 ? 'bg-blue-500' : pillar.score >= 30 ? 'bg-amber-500' : 'bg-red-500'
            )} style={{ width: `${Math.min(pillar.score, 100)}%` }} />
          </div>
        </div>
      ) : (
        <div className="text-[14px] font-semibold text-gray-300 mb-1.5 leading-none">—</div>
      )}

      <div className="space-y-0.5 mb-1.5">
        {pillar.metrics.map((m, i) => (
          <div key={i} className="flex items-center justify-between text-[10px]">
            <span className="text-gray-400">{m.label}</span>
            <span className={clsx('font-medium tabular-nums', pillar.measurable ? 'text-gray-700' : 'text-gray-400')}>{m.value}</span>
          </div>
        ))}
      </div>

      <p className={clsx('text-[9px] leading-relaxed', pillar.measurable ? 'text-gray-500' : 'text-gray-400')}>{pillar.takeaway}</p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// LAYER D — Behavior Insights
// ════════════════════════════════════════════════════════════════

function BehaviorInsightsSection({ insights }: { insights: BehaviorInsight[] }) {
  if (insights.length === 0) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-2.5">
      <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Observations</div>
      <div className="space-y-1">
        {insights.map((ins, i) => (
          <div key={i} className="flex items-start gap-2 text-[10px]">
            <span className={clsx('mt-0.5 shrink-0 font-bold',
              ins.severity === 'positive' ? 'text-emerald-500' : ins.severity === 'negative' ? 'text-red-400' : 'text-gray-300'
            )}>
              {ins.severity === 'positive' ? '↑' : ins.severity === 'negative' ? '↓' : '·'}
            </span>
            <span className="text-gray-600 leading-relaxed">{ins.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// LAYER E — Team Comparison
// ════════════════════════════════════════════════════════════════

type RosterSort = 'score' | 'name' | 'data' | 'weakest'

function TeamRoster({ entries, onSelect }: { entries: RosterEntry[]; onSelect: (id: string) => void }) {
  const [sortBy, setSortBy] = useState<RosterSort>('score')
  const [sortDesc, setSortDesc] = useState(true)

  const sorted = useMemo(() => {
    const arr = [...entries]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'score': cmp = a.score - b.score; break
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'data': cmp = a.metrics.reduce((s, m) => s + (parseInt(m.value) || 0), 0) - b.metrics.reduce((s, m) => s + (parseInt(m.value) || 0), 0); break
        case 'weakest': cmp = (a.weakest ? 0 : 1) - (b.weakest ? 0 : 1) || a.score - b.score; break
      }
      return sortDesc ? -cmp : cmp
    })
    return arr
  }, [entries, sortBy, sortDesc])

  if (entries.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mr-1">Sort</span>
        {(['score', 'name', 'data', 'weakest'] as RosterSort[]).map(s => (
          <button key={s} onClick={() => { if (sortBy === s) setSortDesc(!sortDesc); else { setSortBy(s); setSortDesc(true) } }}
            className={clsx('px-2 py-0.5 text-[10px] font-medium rounded transition-colors',
              sortBy === s ? 'bg-gray-200 text-gray-800' : 'text-gray-400 hover:text-gray-600'
            )}>
            {s === 'data' ? 'Most data' : s === 'weakest' ? 'Needs work' : s.charAt(0).toUpperCase() + s.slice(1)}
            {sortBy === s && <span className="ml-0.5">{sortDesc ? '↓' : '↑'}</span>}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        {sorted.map(e => <RosterRow key={e.userId} entry={e} onClick={() => onSelect(e.userId)} />)}
      </div>
    </div>
  )
}

function RosterRow({ entry, onClick }: { entry: RosterEntry; onClick: () => void }) {
  const cfg = VERDICT_CONFIG[entry.verdict]
  const noData = entry.verdict === 'insufficient'

  return (
    <div onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm cursor-pointer transition-all">
      {/* Score */}
      <div className="shrink-0 w-8 text-center">
        <span className={clsx('text-[14px] font-bold tabular-nums', noData ? 'text-gray-300' : 'text-gray-900')}>
          {noData ? '—' : entry.score.toFixed(0)}
        </span>
      </div>

      {/* Name + verdict + context */}
      <div className="w-44 shrink-0">
        <div className="text-[11px] font-semibold text-gray-900 truncate">{entry.name}</div>
        <div className="flex items-center gap-1.5">
          <span className={clsx('text-[9px] font-semibold', cfg.color)}>{cfg.label}</span>
          {entry.teamContext && (
            <span className="text-[8px] text-gray-400">· {entry.teamContext}</span>
          )}
        </div>
      </div>

      {/* Strongest / Weakest / Insight */}
      <div className="flex-1 min-w-0">
        {entry.strongest || entry.weakest ? (
          <div className="flex items-center gap-3">
            {entry.strongest && (
              <div className="flex items-center gap-1 text-[10px]">
                <ArrowUp className="w-3 h-3 text-emerald-500 shrink-0" />
                <span className="text-gray-500 truncate">{entry.strongest}</span>
              </div>
            )}
            {entry.weakest && (
              <div className="flex items-center gap-1 text-[10px]">
                <ArrowDown className="w-3 h-3 text-red-400 shrink-0" />
                <span className="text-gray-500 truncate">{entry.weakest}</span>
              </div>
            )}
          </div>
        ) : entry.insight ? (
          <p className="text-[10px] text-gray-400 truncate">{entry.insight}</p>
        ) : null}
      </div>

      {/* Metrics */}
      <div className="flex items-center gap-2.5 shrink-0">
        {entry.metrics.map((m, i) => (
          <div key={i} className="text-center min-w-[32px]">
            <div className={clsx('text-[10px] font-semibold tabular-nums', noData ? 'text-gray-300' : 'text-gray-700')}>{m.value}</div>
            <div className="text-[7px] text-gray-400">{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Detail Views
// ════════════════════════════════════════════════════════════════

function AnalystDetailView({ userId, onBack }: { userId: string; onBack: () => void }) {
  const { data, isLoading } = useAnalystScorecard({ userId })
  if (isLoading) return <LoadingSkeleton />
  const verdict = interpretAnalystScorecard(data ?? null)
  const pillars = buildAnalystPillars(data ?? null)
  const snapshot = buildAnalystOutcomeSnapshot(data ?? null)
  const breakdown = buildAnalystProcessBreakdown(data ?? null)
  const insights = buildAnalystInsights(data ?? null)
  return (
    <div className="space-y-2.5">
      <button onClick={onBack} className="text-[11px] text-gray-500 hover:text-gray-700">← Back to team</button>
      <ExecutiveHeader verdict={verdict} mode="analyst" />
      <ProcessBreakdownStrip breakdown={breakdown} snapshot={snapshot} />
      <DiagnosticPillarsSection pillars={pillars} />
      <BehaviorInsightsSection insights={insights} />
    </div>
  )
}

function PMDetailView({ userId, onBack }: { userId: string; onBack: () => void }) {
  const { data, isLoading } = usePMScorecard({ userId })
  if (isLoading) return <LoadingSkeleton />
  const verdict = interpretPMScorecard(data ?? null)
  const pillars = buildPMPillars(data ?? null)
  const snapshot = buildPMOutcomeSnapshot(data ?? null)
  const breakdown = buildPMProcessBreakdown(data ?? null)
  const insights = buildPMInsights(data ?? null)
  return (
    <div className="space-y-2.5">
      <button onClick={onBack} className="text-[11px] text-gray-500 hover:text-gray-700">← Back to team</button>
      <ExecutiveHeader verdict={verdict} mode="pm" />
      <ProcessBreakdownStrip breakdown={breakdown} snapshot={snapshot} />
      <DiagnosticPillarsSection pillars={pillars} />
      <BehaviorInsightsSection insights={insights} />
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2.5 animate-pulse">
      <div className="h-24 bg-gray-100 rounded-lg" />
      <div className="h-16 bg-gray-50 rounded-lg" />
      <div className="grid grid-cols-4 gap-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-gray-50 rounded-lg" />)}</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════════════

export function AnalystScorecardsView({ portfolioId }: { portfolioId?: string | null }) {
  const { user } = useAuth()
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const access = useScorecardVisibility()
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers()
  const analysts = useMemo(() => teamMembers.filter(m => m.role === 'analyst' || m.role === 'both'), [teamMembers])

  const { data: myScorecard, isLoading: myLoading } = useAnalystScorecard({ userId: user?.id || '' })

  // Build roster entries from team member data (without per-member hooks to avoid Rules of Hooks violation)
  const rosterEntries = useMemo(() => {
    const raw = analysts
      .filter(a => a.userId !== user?.id)
      .map(a => buildAnalystRosterEntry(a.userId, a.fullName, null))
    return rankRosterEntries(raw)
  }, [analysts, user?.id])

  if (access.isLoading || membersLoading) return <LoadingSkeleton />
  if (selectedUserId) return <AnalystDetailView userId={selectedUserId} onBack={() => setSelectedUserId(null)} />

  const verdict = interpretAnalystScorecard(myScorecard ?? null)
  const pillars = buildAnalystPillars(myScorecard ?? null)
  const snapshot = buildAnalystOutcomeSnapshot(myScorecard ?? null)
  const breakdown = buildAnalystProcessBreakdown(myScorecard ?? null)
  const insights = buildAnalystInsights(myScorecard ?? null)

  return (
    <div className="space-y-2.5">
      {myLoading ? <LoadingSkeleton /> : (
        <>
          <ExecutiveHeader verdict={verdict} mode="analyst" />
          <ProcessBreakdownStrip breakdown={breakdown} snapshot={snapshot} />
          <DiagnosticPillarsSection pillars={pillars} />
          <BehaviorInsightsSection insights={insights} />
        </>
      )}
      {access.canViewLeaderboard && rosterEntries.length > 0 && (
        <div>
          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
            Team · {rosterEntries.length} analyst{rosterEntries.length !== 1 ? 's' : ''}
          </div>
          <TeamRoster entries={rosterEntries} onSelect={setSelectedUserId} />
        </div>
      )}
      {!access.canViewLeaderboard && access.visibility !== 'open' && (
        <p className="text-[10px] text-gray-400 text-center py-3">Team comparison available to portfolio managers.</p>
      )}
    </div>
  )
}

export function PMScorecardsView({ portfolioId }: { portfolioId?: string | null }) {
  const { user } = useAuth()
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const access = useScorecardVisibility()
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers()
  const pms = useMemo(() => teamMembers.filter(m => m.role === 'pm' || m.role === 'both'), [teamMembers])
  const currentMember = teamMembers.find(m => m.userId === user?.id)
  const isPM = currentMember?.role === 'pm' || currentMember?.role === 'both'

  const { data: myScorecard, isLoading: myLoading } = usePMScorecard({ userId: user?.id || '', portfolioId: portfolioId || undefined })

  const rosterEntries = useMemo(() => {
    const raw = pms
      .filter(p => p.userId !== user?.id)
      .map(p => buildPMRosterEntry(p.userId, p.fullName, null))
    return rankRosterEntries(raw)
  }, [pms, user?.id])

  if (access.isLoading || membersLoading) return <LoadingSkeleton />
  if (selectedUserId) return <PMDetailView userId={selectedUserId} onBack={() => setSelectedUserId(null)} />

  const verdict = interpretPMScorecard(myScorecard ?? null)
  const pillars = buildPMPillars(myScorecard ?? null)
  const snapshot = buildPMOutcomeSnapshot(myScorecard ?? null)
  const breakdown = buildPMProcessBreakdown(myScorecard ?? null)
  const insights = buildPMInsights(myScorecard ?? null)

  if (!isPM) {
    return (
      <div className="space-y-2.5">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-[11px] text-gray-600">PM scorecards evaluate decision quality, execution discipline, and timing. You are not assigned as a portfolio manager — the format below is a preview.</p>
        </div>
        {myLoading ? <LoadingSkeleton /> : (
          <>
            <ExecutiveHeader verdict={verdict} mode="pm" />
            <ProcessBreakdownStrip breakdown={breakdown} snapshot={snapshot} />
            <DiagnosticPillarsSection pillars={pillars} />
            <BehaviorInsightsSection insights={insights} />
          </>
        )}
        {(access.canViewLeaderboard || access.visibility === 'open') && rosterEntries.length > 0 && (
          <div>
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Portfolio Managers · {rosterEntries.length}</div>
            <TeamRoster entries={rosterEntries} onSelect={setSelectedUserId} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {myLoading ? <LoadingSkeleton /> : (
        <>
          <ExecutiveHeader verdict={verdict} mode="pm" />
          <ProcessBreakdownStrip breakdown={breakdown} snapshot={snapshot} />
          <DiagnosticPillarsSection pillars={pillars} />
          <BehaviorInsightsSection insights={insights} />
        </>
      )}
      {(access.canViewLeaderboard || access.visibility === 'open') && rosterEntries.length > 0 && (
        <div>
          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Portfolio Managers · {rosterEntries.length}</div>
          <TeamRoster entries={rosterEntries} onSelect={setSelectedUserId} />
        </div>
      )}
    </div>
  )
}
