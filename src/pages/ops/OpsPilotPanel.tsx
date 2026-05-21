/**
 * OpsPilotPanel — ops-portal surface for managing pilot mode on a client org.
 *
 * - Toggle org pilot_mode (writes organizations.settings.pilot_mode)
 * - List / create / archive pilot_scenarios
 * - Set per-org pilot_access feature map (JSONB override)
 *
 * Pilot-ness is org-scoped: every active member of an org with
 * pilot_mode=true is a pilot. There is no per-user pilot flag.
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Sparkles, Plus, Check, Trash2, Archive, ArchiveRestore, Star, X,
  AlertTriangle, RefreshCw, RotateCcw,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/common/Toast'
import { useAuth } from '../../hooks/useAuth'
import {
  usePilotScenariosForOrg,
  usePilotScenarioMutations,
  usePilotUserScenarios,
  type PilotScenario,
} from '../../hooks/usePilotScenario'
import { PILOT_ACCESS_DEFAULTS, mergePilotAccess, type PilotAccessConfig, type PilotAccessLevel } from '../../lib/pilot/pilot-access'

/** Per-(user, org) localStorage keys written by the Get Started
 *  banners. Centralized here so the Reset button below can wipe
 *  them in one place when an ops user resets themselves. Kept in
 *  sync with the keys defined in TradeQueuePage / PilotTradeLabIntroBanner
 *  / PilotTradeBookGetStarted. */
function pilotBannerLocalStorageKeys(userId: string, orgId: string): string[] {
  return [
    // Idea Pipeline banner (TradeQueuePage)
    `pilot_pipeline_banner_dismissed_${userId}_${orgId}`,
    `pilot_pipeline_step_moved_${userId}_${orgId}`,
    `pilot_pipeline_step_inbox_${userId}_${orgId}`,
    `pilot_pipeline_step_tradelab_${userId}_${orgId}`,
    // Trade Lab intro banner
    `pilot_tradelab_intro_dismissed_${userId}_${orgId}`,
    `pilot_tradelab_intro_rec_reviewed_${userId}_${orgId}`,
    `pilot_tradelab_intro_rec_sized_${userId}_${orgId}`,
    `pilot_tradelab_intro_executed_${userId}_${orgId}`,
    // Trade Book Get Started banner
    `pilot_tradebook_intro_dismissed_${userId}_${orgId}`,
    `pilot_tradebook_intro_reviewed_${userId}_${orgId}`,
    `pilot_tradebook_intro_rationale_${userId}_${orgId}`,
    `pilot_tradebook_intro_outcomes_${userId}_${orgId}`,
    // PilotWelcomeBanner / cached pilot hints
    `pilot-banner-dismissed-${orgId}`,
    `pilot-banner-expanded-${orgId}`,
    `pilot_graduated_${userId}_${orgId}`,
  ]
}

interface OpsPilotPanelProps {
  orgId: string
  members: Array<{ user_id: string; email: string | null; first_name: string | null; last_name: string | null }>
}

export function OpsPilotPanel({ orgId, members }: OpsPilotPanelProps) {
  const { success, error: showError } = useToast()
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()

  // ─── Org settings (pilot_mode + pilot_access) ──────────────────────
  const { data: org } = useQuery({
    queryKey: ['ops-pilot-org', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, settings')
        .eq('id', orgId)
        .maybeSingle()
      if (error) throw error
      return data as { id: string; name: string; settings: Record<string, any> } | null
    }
  })

  const pilotMode = !!org?.settings?.pilot_mode
  const pilotAccess = useMemo(
    () => mergePilotAccess(org?.settings?.pilot_access ?? null),
    [org?.settings?.pilot_access]
  )

  const updateOrgSettings = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      const next = { ...(org?.settings ?? {}), ...patch }
      const { error } = await supabase.from('organizations').update({ settings: next }).eq('id', orgId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-pilot-org', orgId] })
      queryClient.invalidateQueries({ queryKey: ['org-pilot-flags'] }) // user-facing cache
      success('Saved')
    },
    onError: (e: any) => showError(e.message || 'Save failed'),
  })

  // ─── Scenarios ─────────────────────────────────────────────────────
  const { data: scenarios = [], isLoading: scenariosLoading } = usePilotScenariosForOrg(orgId)
  const { create, update, remove, seedForUser, isCreating, isSeeding } = usePilotScenarioMutations(orgId)
  const { data: userScenarioMap = {} } = usePilotUserScenarios(orgId)
  const [showForm, setShowForm] = useState(false)

  // Pilot progress: what stage has each user unlocked? Drives the little
  // "tb" / "oc" chips in the member row.
  const { data: progressRows = [] } = useQuery({
    queryKey: ['ops-pilot-user-progress', orgId, members.map(m => m.user_id).join(',')],
    enabled: members.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('users')
        .select('id, pilot_progress')
        .in('id', members.map(m => m.user_id))
      return (data || []) as Array<{ id: string; pilot_progress: Record<string, any> | null }>
    },
  })
  const progressMap = new Map(progressRows.map(r => [r.id, r.pilot_progress ?? {}]))

  // Reset pilot progress for a member — clears the unlock flags from
  // `users.pilot_progress` (trade_book_unlocked_at, outcomes_unlocked_at,
  // and the per-org graduated_at_<orgId>) so the Get Started flow can
  // be re-tested without dropping into SQL. If the ops user is resetting
  // themselves, the localStorage banner step flags are also cleared so
  // the in-page Get Started banners reappear from step 1 on next mount.
  // (We can't reach another user's browser storage, so resetting someone
  // else only clears server-side progress; they'll still need to clear
  // their own banner state if they want a fresh in-page experience.)
  const resetProgress = useMutation({
    mutationFn: async (params: { userId: string }) => {
      const { data: row, error: readErr } = await supabase
        .from('users')
        .select('pilot_progress')
        .eq('id', params.userId)
        .maybeSingle()
      if (readErr) throw readErr
      const progress = { ...((row?.pilot_progress ?? {}) as Record<string, any>) }
      // Per-org unlock keys (the values usePilotProgress actually reads).
      delete progress[`trade_book_unlocked_at_${orgId}`]
      delete progress[`outcomes_unlocked_at_${orgId}`]
      delete progress[`graduated_at_${orgId}`]
      // Legacy user-level keys — no longer read by app code, but wipe
      // defensively so stale data doesn't linger on the row.
      delete progress.trade_book_unlocked_at
      delete progress.outcomes_unlocked_at
      delete progress.graduated_at
      const { error: writeErr } = await supabase
        .from('users')
        .update({ pilot_progress: progress })
        .eq('id', params.userId)
      if (writeErr) throw writeErr
      return { userId: params.userId }
    },
    onSuccess: ({ userId }) => {
      if (currentUser?.id === userId) {
        try {
          for (const key of pilotBannerLocalStorageKeys(userId, orgId)) {
            localStorage.removeItem(key)
          }
          // Force the user-facing pilot-mode hook to re-evaluate from scratch.
          localStorage.removeItem(`was_pilot_${userId}`)
        } catch { /* ignore */ }
      }
      queryClient.invalidateQueries({ queryKey: ['ops-pilot-user-progress', orgId] })
      queryClient.invalidateQueries({ queryKey: ['pilot-progress'] })
      success('Pilot progress reset')
    },
    onError: (e: any) => showError(e.message || 'Reset failed'),
  })

  return (
    <div className="space-y-5">
      {/* Org pilot mode toggle */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-primary-500" />
              <h3 className="text-sm font-semibold text-gray-900">Pilot mode (org-wide)</h3>
            </div>
            <p className="text-xs text-gray-500">
              When on, every active member of {org?.name || 'this org'} sees the focused pilot experience.
              Switching this off instantly restores the full app for everyone in the org.
            </p>
          </div>
          <Button
            size="sm"
            variant={pilotMode ? 'primary' : 'outline'}
            onClick={() => updateOrgSettings.mutate({ pilot_mode: !pilotMode })}
          >
            {pilotMode ? 'On' : 'Off'}
          </Button>
        </div>
      </div>

      {/* Feature access matrix */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Pilot feature access</h3>
            <p className="text-xs text-gray-500">Flip these to roll out new pilot stages without code changes.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => updateOrgSettings.mutate({ pilot_access: null })}
            title="Clear override — use platform defaults"
          >
            Reset to defaults
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(pilotAccess) as (keyof PilotAccessConfig)[]).map(key => (
            <AccessPicker
              key={key}
              label={key}
              value={pilotAccess[key]}
              defaultValue={PILOT_ACCESS_DEFAULTS[key]}
              onChange={(next) => {
                const current = org?.settings?.pilot_access ?? {}
                updateOrgSettings.mutate({
                  pilot_access: { ...current, [key]: next },
                })
              }}
            />
          ))}
        </div>
      </div>

      {/* Per-member scenario state + seeding actions */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Pilot members</h3>
            <p className="text-xs text-gray-500">Staged scenario and seeding actions for each member. Pilot mode applies org-wide when the toggle above is on.</p>
          </div>
        </div>
        {members.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No members yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {members.map(m => {
              const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.email?.split('@')[0] || 'Unknown'
              const scenario = userScenarioMap[m.user_id]
              const progress = progressMap.get(m.user_id) ?? {}
              // Per-org keys — match what usePilotProgress reads in the
              // app. The previous code looked at user-level fields
              // (`progress.trade_book_unlocked`) that don't exist on
              // the JSONB shape, so the chips always read "preview".
              const tradeBookUnlocked = !!progress[`trade_book_unlocked_at_${orgId}`]
              const outcomesUnlocked = !!progress[`outcomes_unlocked_at_${orgId}`]

              return (
                <li key={m.user_id} className="px-4 py-3 space-y-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{name}</div>
                    {m.email && <div className="text-xs text-gray-500 truncate">{m.email}</div>}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap text-[11px]">
                    <StatusChip
                      label="Scenario"
                      ok={!!scenario}
                      detail={scenario?.title || 'none'}
                    />
                    <StatusChip
                      label="Recommendation"
                      ok={!!scenario?.trade_queue_item_id}
                      detail={scenario?.trade_queue_item_id ? 'linked' : 'not linked'}
                    />
                    <StatusChip
                      label="Portfolio"
                      ok={!!scenario?.portfolio_id}
                      detail={scenario?.portfolio?.name || 'unassigned'}
                    />
                    <StatusChip
                      label="Trade Book"
                      ok={tradeBookUnlocked}
                      detail={tradeBookUnlocked ? 'unlocked' : 'preview'}
                    />
                    <StatusChip
                      label="Outcomes"
                      ok={outcomesUnlocked}
                      detail={outcomesUnlocked ? 'unlocked' : 'preview'}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSeeding || !pilotMode}
                      onClick={async () => {
                        try {
                          const result = await seedForUser({ userId: m.user_id, reset: false })
                          if (result.seeded) success(`Seeded scenario for ${name}`)
                          else success(`Already had a scenario (${result.reason ?? 'ok'})`)
                        } catch (e: any) {
                          showError(e.message || 'Seed failed')
                        }
                      }}
                      title={pilotMode ? 'Ensure this user has an active scenario' : 'Enable pilot mode to seed'}
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      Seed
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSeeding || !pilotMode || !scenario}
                      onClick={async () => {
                        if (!confirm(`Reset and re-seed the pilot scenario for ${name}? The current queue item and recommendation will be archived.`)) return
                        try {
                          const result = await seedForUser({ userId: m.user_id, reset: true })
                          if (result.seeded) success(`Reset scenario for ${name}`)
                          else showError(`Reset skipped: ${result.reason ?? 'unknown'}`)
                        } catch (e: any) {
                          showError(e.message || 'Reset failed')
                        }
                      }}
                      title={scenario ? 'Archive and re-create the scenario from template / defaults' : 'Nothing to reset'}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Reset &amp; seed
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resetProgress.isPending}
                      onClick={() => {
                        const isSelf = currentUser?.id === m.user_id
                        const msg = isSelf
                          ? `Reset ${name}'s pilot progress? Clears Trade Book / Outcomes unlocks, graduation for this org, AND your local Get Started banner state so the full onboarding flow reappears.`
                          : `Reset ${name}'s pilot progress? Clears Trade Book / Outcomes unlocks and graduation for this org. They'll still need to clear their own browser's banner state if they want banners to reappear from step 1.`
                        if (!confirm(msg)) return
                        resetProgress.mutate({ userId: m.user_id })
                      }}
                      title="Clear trade_book_unlocked_at, outcomes_unlocked_at, and graduated_at_<org> so the Get Started flow can be re-tested"
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Reset progress
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Pilot scenarios */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Staged pilot scenarios</h3>
            <p className="text-xs text-gray-500">
              <b>Templates</b> (org-wide) are cloned into each pilot user's first-login scenario.
              <b> User-assigned</b> rows are live instantiations that appear in that user's Trade Lab.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            Stage scenario
          </Button>
        </div>

        {scenariosLoading ? (
          <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
        ) : scenarios.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No scenarios staged yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {scenarios.map(s => (
              <ScenarioRow
                key={s.id}
                scenario={s}
                members={members}
                onUpdate={(patch) => update({ id: s.id, patch })}
                onRemove={() => remove(s.id)}
              />
            ))}
          </ul>
        )}

        {showForm && (
          <ScenarioCreateForm
            orgId={orgId}
            members={members}
            onClose={() => setShowForm(false)}
            onSubmit={async (payload) => {
              try {
                await create(payload)
                success('Scenario staged')
                setShowForm(false)
              } catch (e: any) {
                showError(e.message || 'Failed to stage scenario')
              }
            }}
            isSubmitting={isCreating}
          />
        )}
      </div>
    </div>
  )
}

// ─── Access-level picker tile ────────────────────────────────────────

function AccessPicker({ label, value, defaultValue, onChange }: {
  label: string
  value: PilotAccessLevel
  defaultValue: PilotAccessLevel
  onChange: (next: PilotAccessLevel) => void
}) {
  const changed = value !== defaultValue
  const NEXT: Record<PilotAccessLevel, PilotAccessLevel> = {
    full: 'preview',
    preview: 'hidden',
    hidden: 'full',
  }
  const color = value === 'full' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : value === 'preview' ? 'bg-amber-50 border-amber-200 text-amber-700'
    : 'bg-gray-50 border-gray-200 text-gray-500'
  return (
    <button
      onClick={() => onChange(NEXT[value])}
      className={clsx(
        'text-left px-3 py-2 rounded-lg border hover:shadow-sm transition-all',
        color,
        changed && 'ring-1 ring-primary-300'
      )}
    >
      <div className="text-[10px] uppercase tracking-wide font-semibold">{label}</div>
      <div className="text-sm font-medium capitalize">{value}</div>
      {changed && <div className="text-[9px] text-primary-600 mt-0.5">default: {defaultValue}</div>}
    </button>
  )
}

// ─── Scenario row ────────────────────────────────────────────────────

function ScenarioRow({ scenario, members, onUpdate, onRemove }: {
  scenario: PilotScenario
  members: OpsPilotPanelProps['members']
  onUpdate: (patch: Partial<PilotScenario>) => Promise<void> | void
  onRemove: () => Promise<void> | void
}) {
  const assignedUser = scenario.user_id ? members.find(m => m.user_id === scenario.user_id) : null
  const assignedName = assignedUser
    ? ([assignedUser.first_name, assignedUser.last_name].filter(Boolean).join(' ').trim() || assignedUser.email)
    : null

  return (
    <li className="flex items-center justify-between px-4 py-3 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={clsx(
          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
          scenario.is_template ? 'bg-amber-50 text-amber-600' :
          scenario.status === 'active' ? 'bg-primary-50 text-primary-600' :
          scenario.status === 'completed' ? 'bg-emerald-50 text-emerald-600' :
          'bg-gray-100 text-gray-400'
        )}>
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900 truncate">{scenario.title}</span>
            {scenario.is_template && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wide">
                Template
              </span>
            )}
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">
              {scenario.asset?.symbol || scenario.symbol || '—'}
            </span>
            {scenario.direction && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700 capitalize">
                {scenario.direction}
              </span>
            )}
            <span className={clsx(
              'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium capitalize',
              scenario.status === 'active' ? 'bg-emerald-50 text-emerald-700' :
              scenario.status === 'completed' ? 'bg-indigo-50 text-indigo-700' :
              'bg-gray-100 text-gray-600'
            )}>
              {scenario.status}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {scenario.is_template ? 'Org-wide template' : assignedName ? `Assigned to ${assignedName}` : 'Org-wide'}
            {scenario.portfolio?.name && ` · ${scenario.portfolio.name}`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onUpdate({ status: scenario.status === 'archived' ? 'active' : 'archived' })}
          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
          title={scenario.status === 'archived' ? 'Restore' : 'Archive'}
        >
          {scenario.status === 'archived' ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={onRemove}
          className="p-1.5 text-gray-400 hover:text-error-600 hover:bg-error-50 rounded"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  )
}

// ─── Scenario create form ────────────────────────────────────────────

function ScenarioCreateForm({ orgId, members, onClose, onSubmit, isSubmitting }: {
  orgId: string
  members: OpsPilotPanelProps['members']
  onClose: () => void
  onSubmit: (payload: any) => Promise<void>
  isSubmitting: boolean
}) {
  const [title, setTitle] = useState('')
  const [symbol, setSymbol] = useState('')
  const [direction, setDirection] = useState<string>('buy')
  const [thesis, setThesis] = useState('')
  const [whyNow, setWhyNow] = useState('')
  const [proposedAction, setProposedAction] = useState('')
  const [proposedSizing, setProposedSizing] = useState('')
  const [targetWeight, setTargetWeight] = useState<string>('2')
  const [userId, setUserId] = useState<string>('')
  const [isTemplate, setIsTemplate] = useState<boolean>(false)

  // Portfolio picker (filtered to this org)
  const { data: portfolios = [] } = useQuery({
    queryKey: ['ops-pilot-portfolios', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('portfolios')
        .select('id, name')
        .eq('organization_id', orgId)
        .order('name')
      return (data || []) as Array<{ id: string; name: string }>
    }
  })
  const [portfolioId, setPortfolioId] = useState<string>('')

  const canSubmit = !!title.trim() && !isSubmitting

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Stage pilot scenario</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-5 py-4 space-y-3 overflow-y-auto">
            <Field label="Title (required)">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. NVDA — add on weakness"
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white" autoFocus />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Symbol">
                <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="NVDA"
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white uppercase" />
              </Field>
              <Field label="Direction">
                <select value={direction} onChange={e => setDirection(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white">
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                  <option value="add">Add</option>
                  <option value="trim">Trim</option>
                  <option value="reduce">Reduce</option>
                  <option value="close">Close</option>
                  <option value="swap">Swap</option>
                </select>
              </Field>
              <Field label="Sizing input">
                <input value={proposedSizing} onChange={e => setProposedSizing(e.target.value)} placeholder="2.5 or +0.5"
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white" />
              </Field>
            </div>
            <Field label="Thesis">
              <textarea value={thesis} onChange={e => setThesis(e.target.value)} rows={2}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white resize-none" />
            </Field>
            <Field label="Why now">
              <textarea value={whyNow} onChange={e => setWhyNow(e.target.value)} rows={2}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white resize-none" />
            </Field>
            <Field label="Proposed action">
              <textarea value={proposedAction} onChange={e => setProposedAction(e.target.value)} rows={2}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white resize-none" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Portfolio">
                <select value={portfolioId} onChange={e => setPortfolioId(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white">
                  <option value="">(first available)</option>
                  {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Assigned to">
                <select value={userId} onChange={e => setUserId(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white">
                  <option value="">(all pilot users in org)</option>
                  {members.map(m => (
                    <option key={m.user_id} value={m.user_id}>
                      {[m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.email}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Target weight %">
              <input
                type="number"
                value={targetWeight}
                onChange={e => setTargetWeight(e.target.value)}
                placeholder="2"
                step="0.25"
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white"
              />
            </Field>

            <label className="flex items-start gap-2 text-xs text-gray-700 bg-amber-50/60 border border-amber-200 rounded px-2 py-2">
              <input
                type="checkbox"
                checked={isTemplate}
                onChange={e => {
                  setIsTemplate(e.target.checked)
                  if (e.target.checked) setUserId('')
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold text-amber-800">Save as org template.</span>{' '}
                Templates aren't shown to users directly — each pilot's first login clones this
                into a personal instantiation. Keep user assignment empty.
              </span>
            </label>

            {!portfolioId && portfolios.length > 0 && !isTemplate && (
              <div className="flex items-center gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                <AlertTriangle className="w-3 h-3" />
                No portfolio selected — pilot user will see their own portfolio list.
              </div>
            )}
          </div>
          <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={!canSubmit}
              onClick={() => onSubmit({
                title: title.trim(),
                symbol: symbol.trim() || null,
                direction: direction || null,
                thesis: thesis.trim() || null,
                why_now: whyNow.trim() || null,
                proposed_action: proposedAction.trim() || null,
                proposed_sizing_input: proposedSizing.trim() || null,
                target_weight_pct: targetWeight ? Number(targetWeight) : null,
                portfolio_id: portfolioId || null,
                user_id: isTemplate ? null : (userId || null),
                status: 'active',
                is_template: isTemplate,
              })}
            >
              <Check className="w-3.5 h-3.5 mr-1" />
              {isTemplate ? 'Save template' : 'Stage scenario'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-600 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  )
}

function StatusChip({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium',
        ok
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : 'bg-gray-50 border-gray-200 text-gray-500'
      )}
      title={detail}
    >
      <span className={clsx('w-1 h-1 rounded-full', ok ? 'bg-emerald-500' : 'bg-gray-300')} />
      <span>{label}</span>
      {detail && <span className="text-gray-400 font-normal truncate max-w-[96px]">· {detail}</span>}
    </span>
  )
}
