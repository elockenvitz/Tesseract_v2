/**
 * OpsClientDetailPage — Single client organization detail view.
 * Shows members, portfolios, holdings status, and activity.
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Building2, Users, Briefcase, Database, Eye, Clock, Activity, CheckCircle2, TrendingUp, FileText, Target, MessageCircleQuestion, Ban, UserCheck, Sparkles, Mail, X } from 'lucide-react'
import { OpsPilotPanel } from './OpsPilotPanel'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useMorphSession } from '../../hooks/useMorphSession'
import { useToast } from '../../components/common/Toast'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'

type Tab = 'members' | 'portfolios' | 'holdings' | 'engagement' | 'onboarding' | 'pilot'

export function OpsClientDetailPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { success, error: showError } = useToast()
  const { startMorph, isMorphing } = useMorphSession()
  const [activeTab, setActiveTab] = useState<Tab>('members')
  const [morphTargetId, setMorphTargetId] = useState<string | null>(null)
  const [morphReason, setMorphReason] = useState('')

  // Member access mutations.
  // We don't delete the membership row — that would cascade and lose audit
  // links to the user's content (notes, theses, conversations, comments).
  // Instead we suspend access by flipping status → 'inactive' and stamping
  // suspended_at. The DB trigger `enforce_org_membership_status_transition`
  // only allows 'active' → 'inactive' (not the bogus 'removed' the prior
  // code used), and `notify_org_membership_changed` will tell the user.
  const removeMemberM = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('organization_memberships')
        .update({
          status:            'inactive',
          suspended_at:      new Date().toISOString(),
          suspension_reason: 'Access removed by ops admin',
        })
        .eq('user_id', userId)
        .eq('organization_id', orgId!)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-client-members', orgId] })
      success('Access suspended — content preserved')
    },
    onError: (err: any) => showError(err.message || 'Failed to suspend access'),
  })

  // Restore: flip status back to 'active' and clear the suspension stamp.
  // The transition trigger requires the caller to be an active org admin
  // of THIS org; ops users morph in to satisfy that when needed.
  const restoreMemberM = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('organization_memberships')
        .update({
          status:            'active',
          suspended_at:      null,
          suspended_by:      null,
          suspension_reason: null,
        })
        .eq('user_id', userId)
        .eq('organization_id', orgId!)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-client-members', orgId] })
      success('Access restored')
    },
    onError: (err: any) => showError(err.message || 'Failed to restore access'),
  })

  // App-native confirm modal state — replaces window.confirm.
  const [removePrompt, setRemovePrompt] = useState<{ userId: string; email: string } | null>(null)

  // Org details
  const { data: org } = useQuery({
    queryKey: ['ops-client-detail', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, slug, created_at, settings')
        .eq('id', orgId!)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!orgId,
  })

  // Members
  const { data: members = [] } = useQuery({
    queryKey: ['ops-client-members', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_members_v')
        .select('id, user_id, status, is_org_admin, user_email, user_full_name')
        .eq('organization_id', orgId!)
        .order('user_full_name')
      if (error) throw error
      return data || []
    },
    enabled: !!orgId,
  })

  // Pending invites — emails invited at provision time who haven't signed
  // up yet. They live in organization_invites (status='pending') until the
  // invitee creates their account, at which point a trigger converts the
  // invite into an organization_memberships row.
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ['ops-client-invites', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_invites')
        .select('id, email, invited_is_org_admin, created_at, invited_by')
        .eq('organization_id', orgId!)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!orgId,
  })

  const cancelInviteM = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from('organization_invites')
        .update({ status: 'cancelled' })
        .eq('id', inviteId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-client-invites', orgId] })
      success('Invite cancelled')
    },
    onError: (err: any) => showError(err.message),
  })

  // Portfolios
  const { data: portfolios = [] } = useQuery({
    queryKey: ['ops-client-portfolios', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name, is_active, created_at')
        .eq('organization_id', orgId!)
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!orgId,
  })

  // Holdings snapshots (latest per portfolio)
  const { data: holdingsStatus = [] } = useQuery({
    queryKey: ['ops-client-holdings-status', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings_snapshots')
        .select('portfolio_id, snapshot_date, source, total_positions')
        .eq('organization_id', orgId!)
        .order('snapshot_date', { ascending: false })
        .limit(100)
      if (error) throw error
      // Get latest per portfolio
      const latest = new Map<string, any>()
      for (const row of data || []) {
        if (!latest.has(row.portfolio_id)) latest.set(row.portfolio_id, row)
      }
      return Array.from(latest.values())
    },
    enabled: !!orgId,
  })

  // Engagement data
  const { data: engagement } = useQuery({
    queryKey: ['ops-client-engagement', orgId],
    queryFn: async () => {
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString()
      const memberIds = members.map((m: any) => m.user_id)
      if (memberIds.length === 0) return { ideas: 0, notes: 0, ratings: 0, tradeIdeas: 0, sessions: 0, avgDuration: 0 }

      const [ideasRes, notesRes, ratingsRes, tradeIdeasRes, sessionsRes] = await Promise.all([
        supabase.from('quick_thoughts').select('id', { count: 'exact', head: true }).in('created_by', memberIds).gte('created_at', monthAgo).eq('is_archived', false),
        supabase.from('asset_notes').select('id', { count: 'exact', head: true }).in('created_by', memberIds).gte('created_at', monthAgo),
        supabase.from('analyst_ratings').select('id', { count: 'exact', head: true }).in('user_id', memberIds).gte('updated_at', monthAgo),
        supabase.from('quick_thoughts').select('id', { count: 'exact', head: true }).in('created_by', memberIds).eq('idea_type', 'trade_idea').gte('created_at', monthAgo),
        supabase.from('user_sessions').select('duration_seconds').in('user_id', memberIds).gte('started_at', monthAgo).not('duration_seconds', 'is', null),
      ])

      const durations = (sessionsRes.data || []).map((s: any) => s.duration_seconds).filter(Boolean)
      const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0

      return {
        ideas: ideasRes.count || 0,
        notes: notesRes.count || 0,
        ratings: ratingsRes.count || 0,
        tradeIdeas: tradeIdeasRes.count || 0,
        sessions: durations.length,
        avgDuration,
      }
    },
    enabled: !!orgId && members.length > 0,
  })

  // Pilot Get Started funnel — mirrors the user-facing 3-banner sequential
  // journey (Idea Pipeline → Trade Lab → Trade Book → Outcomes). For each
  // step we count distinct members who completed it, sourced from:
  //   1. `pilot_telemetry_events` for the 9 in-banner steps
  //   2. `users.pilot_progress` per-org keys for the macro unlocks
  // The last step of Trade Lab and Trade Book have BOTH sources (the
  // step event AND the macro unlock key). We union them so older pilots
  // who hit the unlock before step-level telemetry existed still count.
  //
  // Replaced the legacy 7-item PilotWelcomeBanner checklist, which only
  // showed for NON-pilot users — a pilot could fully graduate while the
  // ops bar showed 0/7 because pilots never touch those surfaces.
  const { data: onboarding } = useQuery({
    queryKey: ['ops-client-pilot-funnel', orgId, members.length],
    enabled: !!orgId && !!org && members.length > 0,
    queryFn: async () => {
      const memberIds = (members as any[]).map((m) => m.user_id as string)
      if (memberIds.length === 0 || !orgId) return null

      const STEP_EVENTS = [
        // Idea Pipeline (3)
        'pilot_pipeline_step_idea_dragged',
        'pilot_pipeline_step_inbox_opened',
        'pilot_pipeline_step_tradelab_opened',
        // Trade Lab (3)
        'pilot_tradelab_step_rec_reviewed',
        'pilot_tradelab_step_rec_sized',
        'pilot_tradelab_step_executed',
        // Trade Book (3)
        'pilot_tradebook_step_trade_reviewed',
        'pilot_tradebook_step_rationale_added',
        'pilot_tradebook_step_opened_outcomes',
        // Outcomes — Finish the Loop (3)
        'pilot_outcomes_step_result_inspected',
        'pilot_outcomes_step_thesis_reviewed',
        'pilot_outcomes_step_performance_checked',
        // PilotWelcomeBanner localStorage-only items (2) — now server-tracked
        'pilot_postgrad_idea_feed_viewed',
        'pilot_postgrad_asset_explored',
        // Customization wizard (4)
        'pilot_customization_profile_completed',
        'pilot_customization_role_completed',
        'pilot_customization_integrations_completed',
        'pilot_customization_teams_completed',
      ] as const

      // Three reads in parallel:
      //   1. Telemetry events (distinct users per step event)
      //   2. pilot_progress per-org macro unlock keys
      //   3. trade_queue_items created by org members (drives the
      //      Capture stage "Created a trade idea" item — System Loop's
      //      Capture milestone, separate from the in-banner steps).
      //      Excludes seeded pilot_seed rows so the demo idea doesn't
      //      pre-tick the step.
      const [eventsRes, progressRes, capturedRes] = await Promise.all([
        supabase
          .from('pilot_telemetry_events')
          .select('event_type, user_id')
          .in('user_id', memberIds)
          .eq('organization_id', orgId)
          .in('event_type', STEP_EVENTS as unknown as string[]),
        supabase
          .from('users')
          .select('id, pilot_progress')
          .in('id', memberIds),
        supabase
          .from('trade_queue_items')
          .select('created_by, origin_metadata, portfolio:portfolios!inner(organization_id)')
          .in('created_by', memberIds)
          .eq('portfolio.organization_id', orgId),
      ])

      // Bucket telemetry rows into a "step → set-of-user-ids" map so
      // each step's count is distinct members, not raw event volume.
      const usersByStep = new Map<string, Set<string>>()
      for (const row of (eventsRes.data ?? []) as Array<{ event_type: string; user_id: string }>) {
        const set = usersByStep.get(row.event_type) ?? new Set<string>()
        set.add(row.user_id)
        usersByStep.set(row.event_type, set)
      }

      // Macro unlock keys live in users.pilot_progress under per-org
      // suffixed keys (see usePilotProgress refactor). Pulling these
      // covers older pilots whose unlock pre-dated step-level events.
      const tradeBookKey = `trade_book_unlocked_at_${orgId}`
      const outcomesKey = `outcomes_unlocked_at_${orgId}`
      const graduatedKey = `graduated_at_${orgId}`
      const tradeBookSet = new Set<string>()
      const outcomesSet = new Set<string>()
      const graduatedSet = new Set<string>()
      for (const row of (progressRes.data ?? []) as Array<{ id: string; pilot_progress: Record<string, any> | null }>) {
        const p = (row.pilot_progress ?? {}) as Record<string, any>
        if (p[tradeBookKey]) tradeBookSet.add(row.id)
        if (p[outcomesKey]) outcomesSet.add(row.id)
        if (p[graduatedKey]) graduatedSet.add(row.id)
      }

      const stepUsers = (key: typeof STEP_EVENTS[number]) =>
        usersByStep.get(key) ?? new Set<string>()
      const unionSize = (a: Set<string>, b: Set<string>) => {
        const u = new Set(a)
        b.forEach(x => u.add(x))
        return u.size
      }
      // Merge any number of user-id sets (telemetry + artifact signals).
      const mergeSets = (...sets: Array<Set<string>>) => {
        const u = new Set<string>()
        for (const s of sets) s.forEach(x => u.add(x))
        return u
      }

      // Post-graduation Get Started — PilotWelcomeBanner's 7 server-
      // trackable items. These ALSO ran in the previous ops page and
      // were dropped when the tab was rebuilt; restoring them here
      // means the ops view now reflects the full pilot journey (10
      // pilot-flow items + 7 post-graduation items).
      //
      // Mirrors the same scoping the user-facing banner uses:
      //   - `created_at >= org.created_at` for tables without an
      //     organization_id column (analyst_ratings, asset_notes,
      //     theme_notes, quick_thoughts, user_quick_prompt_history,
      //     asset_lists), preventing pre-org activity from pre-ticking.
      //   - Direct `organization_id = orgId` for the two tables that
      //     have it (asset_contributions, themes).
      //   - asset_lists excludes `is_default = true` (every user gets
      //     two system-seeded defaults on signup; we don't want them
      //     to pre-tick the "Built a list" step).
      const orgCreatedAt = (org?.created_at as string | undefined) ?? new Date(0).toISOString()
      const [
        contribRes, ratingRes, noteRes,
        themeRes, themeNoteRes,
        thoughtRes,
        promptHistoryRes, promptThoughtRes,
        listRes,
      ] = await Promise.all([
        supabase.from('asset_contributions').select('created_by').in('created_by', memberIds).eq('organization_id', orgId),
        supabase.from('analyst_ratings').select('user_id').in('user_id', memberIds).gte('created_at', orgCreatedAt),
        supabase.from('asset_notes').select('created_by').in('created_by', memberIds).gte('created_at', orgCreatedAt),
        supabase.from('themes').select('created_by').in('created_by', memberIds).eq('organization_id', orgId),
        supabase.from('theme_notes').select('created_by').in('created_by', memberIds).gte('created_at', orgCreatedAt),
        supabase.from('quick_thoughts').select('created_by').in('created_by', memberIds).gte('created_at', orgCreatedAt),
        supabase.from('user_quick_prompt_history').select('user_id').in('user_id', memberIds).gte('created_at', orgCreatedAt),
        supabase.from('quick_thoughts').select('created_by').in('created_by', memberIds).eq('idea_type', 'prompt').gte('created_at', orgCreatedAt),
        supabase.from('asset_lists').select('created_by').in('created_by', memberIds).eq('is_default', false).gte('created_at', orgCreatedAt),
      ])

      // ── Artifact-derived signals ───────────────────────────────────
      // The in-banner telemetry steps under-report real progress: those
      // events only fire while the Get Started banner is mounted and once
      // per browser (localStorage-gated), so a pilot who dismisses the
      // banner, switches devices, or completes a step the banner wasn't
      // listening for shows as stalled even though they did the work.
      // Where a step leaves a durable DB artifact we union that in — the
      // counts can only ever go UP, never regress a user telemetry already
      // captured. View-only steps (e.g. "Open the Decision Inbox") leave no
      // artifact and stay telemetry-only.
      const labVariantAnySet = new Set<string>()     // ≥1 lab variant → opened Trade Lab + added a rec
      const sizedArtifactSet = new Set<string>()      // actively edited sizing (not just the auto-seeded rec)
      const executedArtifactSet = new Set<string>()   // committed a trade → reached Trade Book
      const rationaleArtifactSet = new Set<string>()  // wrote a comment on a committed trade
      const orgPortfolioIds = (
        (await supabase.from('portfolios').select('id').eq('organization_id', orgId)).data ?? []
      ).map((p: any) => p.id as string)

      if (orgPortfolioIds.length > 0) {
        const [variantRes, acceptedRes] = await Promise.all([
          supabase.from('lab_variants')
            .select('created_by, created_at, updated_at, sizing_input')
            .in('created_by', memberIds)
            .in('portfolio_id', orgPortfolioIds)
            .is('deleted_at', null),
          supabase.from('accepted_trades')
            .select('id, accepted_by')
            .in('accepted_by', memberIds)
            .in('portfolio_id', orgPortfolioIds)
            .eq('is_active', true),
        ])

        for (const v of (variantRes.data ?? []) as Array<{ created_by: string; created_at: string; updated_at: string; sizing_input: string | null }>) {
          if (!v.created_by) continue
          labVariantAnySet.add(v.created_by)
          // "Sized" = the user changed the sizing AFTER the row was created.
          // The seeded recommendation is auto-imported with its sizing
          // already set (created_at === updated_at), so requiring a later
          // updated_at separates a real sizing action from merely landing
          // in the lab. 2s buffer absorbs autosave jitter.
          const sized = !!v.sizing_input && v.sizing_input.trim() !== ''
          const edited = new Date(v.updated_at).getTime() - new Date(v.created_at).getTime() > 2000
          if (sized && edited) sizedArtifactSet.add(v.created_by)
        }

        const acceptedTradeIds: string[] = []
        for (const t of (acceptedRes.data ?? []) as Array<{ id: string; accepted_by: string | null }>) {
          if (t.accepted_by) executedArtifactSet.add(t.accepted_by)
          acceptedTradeIds.push(t.id)
        }

        if (acceptedTradeIds.length > 0) {
          const commentRes = await supabase.from('accepted_trade_comments')
            .select('user_id')
            .in('user_id', memberIds)
            .in('accepted_trade_id', acceptedTradeIds)
          for (const c of (commentRes.data ?? []) as Array<{ user_id: string }>) {
            if (c.user_id) rationaleArtifactSet.add(c.user_id)
          }
        }
      }

      // Count distinct members per post-grad step.
      const distinctUsers = (rows: any[] | null | undefined, key: string) =>
        new Set((rows ?? []).map(r => r[key] as string)).size
      const contributionUsers   = distinctUsers(contribRes.data, 'created_by')
      const ratingUsers         = distinctUsers(ratingRes.data, 'user_id')
      const noteUsers           = distinctUsers(noteRes.data, 'created_by')
      // Theme step = theme created OR theme note written (union).
      const themeUserSet = new Set<string>([
        ...((themeRes.data ?? []).map((r: any) => r.created_by)),
        ...((themeNoteRes.data ?? []).map((r: any) => r.created_by)),
      ])
      // Prompt step = template/saved prompt used OR a prompt-type quick_thought (union).
      const promptUserSet = new Set<string>([
        ...((promptHistoryRes.data ?? []).map((r: any) => r.user_id)),
        ...((promptThoughtRes.data ?? []).map((r: any) => r.created_by)),
      ])
      const thoughtUsers        = distinctUsers(thoughtRes.data, 'created_by')
      const listUsers           = distinctUsers(listRes.data, 'created_by')

      // Capture stage — anyone in the org logged a non-seed idea?
      // Drops the pilot_seed rows so the auto-seeded demo doesn't
      // pre-tick the step.
      const capturedUsers = new Set<string>()
      for (const r of (capturedRes.data ?? []) as Array<{ created_by: string; origin_metadata: Record<string, unknown> | null }>) {
        if (!(r.origin_metadata as any)?.pilot_seed) capturedUsers.add(r.created_by)
      }

      return {
        totalMembers: memberIds.length,
        counts: {
          // Capture stage (1) — System Loop's first stage
          capturedIdea:    capturedUsers.size,
          // Idea Pipeline (3)
          ideaDragged:     stepUsers('pilot_pipeline_step_idea_dragged').size,
          inboxOpened:     stepUsers('pilot_pipeline_step_inbox_opened').size,
          // Opened Trade Lab = telemetry OR has a lab variant (can't have a
          // variant without opening the lab).
          tradelabOpened:  mergeSets(stepUsers('pilot_pipeline_step_tradelab_opened'), labVariantAnySet).size,
          // Trade Lab (3)
          // Reviewed/added the rec = telemetry OR a lab variant exists.
          recReviewed:     mergeSets(stepUsers('pilot_tradelab_step_rec_reviewed'), labVariantAnySet).size,
          // Sized = telemetry OR actively edited a variant's sizing.
          recSized:        mergeSets(stepUsers('pilot_tradelab_step_rec_sized'), sizedArtifactSet).size,
          // Executed = telemetry step OR macro unlock OR a committed trade.
          executed:        mergeSets(stepUsers('pilot_tradelab_step_executed'), tradeBookSet, executedArtifactSet).size,
          // Trade Book (3)
          tradeReviewed:   stepUsers('pilot_tradebook_step_trade_reviewed').size,
          // Rationale = telemetry OR a comment on a committed trade.
          rationaleAdded:  mergeSets(stepUsers('pilot_tradebook_step_rationale_added'), rationaleArtifactSet).size,
          // Opened Outcomes = telemetry step OR macro pilot_progress unlock.
          openedOutcomes:  unionSize(stepUsers('pilot_tradebook_step_opened_outcomes'), outcomesSet),
          // Outcomes — Finish the Loop (3). Falls back to the graduated_at
          // macro for the LAST step so pre-telemetry pilots still register
          // a Finish-the-Loop completion.
          inspectedResult:    stepUsers('pilot_outcomes_step_result_inspected').size,
          reviewedThesis:     stepUsers('pilot_outcomes_step_thesis_reviewed').size,
          checkedPerformance: unionSize(stepUsers('pilot_outcomes_step_performance_checked'), graduatedSet),
          // Graduated (headline metric, derived from pilot_progress) —
          // kept separate from the 3 Outcomes step items so the
          // top-of-tab "% graduated" bar still has a single source.
          graduated:          graduatedSet.size,
          // Post-graduation Get Started (9 = 7 DB-backed + 2 LS items
          // now exposed via telemetry events)
          filledResearch:    contributionUsers,
          rated:             ratingUsers,
          wroteNote:         noteUsers,
          exploredTheme:     themeUserSet.size,
          postedThought:     thoughtUsers,
          usedPrompt:        promptUserSet.size,
          builtList:         listUsers,
          ideaFeedViewed:    stepUsers('pilot_postgrad_idea_feed_viewed').size,
          assetExplored:     stepUsers('pilot_postgrad_asset_explored').size,
          // Customization wizard (4)
          profileConfirmed:    stepUsers('pilot_customization_profile_completed').size,
          roleDefined:         stepUsers('pilot_customization_role_completed').size,
          integrationsHooked:  stepUsers('pilot_customization_integrations_completed').size,
          teamsInvited:        stepUsers('pilot_customization_teams_completed').size,
        },
      }
    },
  })

  // 10-item pilot funnel — three banners' worth of steps plus the
  // terminal graduation milestone. `count` is distinct members who
  // completed the step; `total` is total active members. Item ordering
  // matches the user-facing sequential flow so the ops view reads as a
  // drop-off chart from top to bottom.
  type OnboardingItem = {
    stage: 'Capture' | 'Idea Pipeline' | 'Trade Lab' | 'Trade Book' | 'Outcomes' | 'Post-graduation' | 'Customization'
    label: string
    count: number
    total: number
  }
  const onboardingItems: OnboardingItem[] = onboarding ? [
    // ── Capture (1) — System Loop's first stage ────────────────────
    { stage: 'Capture',         label: 'Create a trade idea',               count: onboarding.counts.capturedIdea,     total: onboarding.totalMembers },
    // ── Initial pilot Get Started flow (9) ─────────────────────────
    { stage: 'Idea Pipeline',   label: 'Drag an idea through the pipeline', count: onboarding.counts.ideaDragged,      total: onboarding.totalMembers },
    { stage: 'Idea Pipeline',   label: 'Open the Decision Inbox',           count: onboarding.counts.inboxOpened,      total: onboarding.totalMembers },
    { stage: 'Idea Pipeline',   label: 'Open Trade Lab',                    count: onboarding.counts.tradelabOpened,   total: onboarding.totalMembers },
    { stage: 'Trade Lab',       label: 'Review and add the recommendation', count: onboarding.counts.recReviewed,      total: onboarding.totalMembers },
    { stage: 'Trade Lab',       label: 'Adjust sizing and select the trade',count: onboarding.counts.recSized,         total: onboarding.totalMembers },
    { stage: 'Trade Lab',       label: 'Execute the trade',                 count: onboarding.counts.executed,         total: onboarding.totalMembers },
    { stage: 'Trade Book',      label: 'Review the recorded decision',      count: onboarding.counts.tradeReviewed,    total: onboarding.totalMembers },
    { stage: 'Trade Book',      label: 'Capture rationale',                 count: onboarding.counts.rationaleAdded,   total: onboarding.totalMembers },
    { stage: 'Trade Book',      label: 'Open Outcomes',                     count: onboarding.counts.openedOutcomes,   total: onboarding.totalMembers },
    // ── Outcomes — Finish the Loop (3, replaces the prior single
    //     "graduate" item; graduation is implicit when step 3 fires) ──
    { stage: 'Outcomes',        label: 'Inspect the result',                count: onboarding.counts.inspectedResult,   total: onboarding.totalMembers },
    { stage: 'Outcomes',        label: 'Review the thesis',                 count: onboarding.counts.reviewedThesis,    total: onboarding.totalMembers },
    { stage: 'Outcomes',        label: 'Check how the trade is performing', count: onboarding.counts.checkedPerformance,total: onboarding.totalMembers },
    // ── Post-graduation Get Started (9 — PilotWelcomeBanner) ───────
    { stage: 'Post-graduation', label: 'View the idea feed',                count: onboarding.counts.ideaFeedViewed,    total: onboarding.totalMembers },
    { stage: 'Post-graduation', label: 'Explore an asset page',             count: onboarding.counts.assetExplored,     total: onboarding.totalMembers },
    { stage: 'Post-graduation', label: 'Fill out a research field',         count: onboarding.counts.filledResearch,    total: onboarding.totalMembers },
    { stage: 'Post-graduation', label: 'Rate an asset',                     count: onboarding.counts.rated,             total: onboarding.totalMembers },
    { stage: 'Post-graduation', label: 'Write a note',                      count: onboarding.counts.wroteNote,         total: onboarding.totalMembers },
    { stage: 'Post-graduation', label: 'Explore a theme',                   count: onboarding.counts.exploredTheme,     total: onboarding.totalMembers },
    { stage: 'Post-graduation', label: 'Post a thought',                    count: onboarding.counts.postedThought,     total: onboarding.totalMembers },
    { stage: 'Post-graduation', label: 'Use a prompt',                      count: onboarding.counts.usedPrompt,        total: onboarding.totalMembers },
    { stage: 'Post-graduation', label: 'Build a list',                      count: onboarding.counts.builtList,         total: onboarding.totalMembers },
    // ── Customization wizard (4) ───────────────────────────────────
    { stage: 'Customization',   label: 'Confirm your profile',              count: onboarding.counts.profileConfirmed,  total: onboarding.totalMembers },
    { stage: 'Customization',   label: 'Define your focus / coverage',      count: onboarding.counts.roleDefined,       total: onboarding.totalMembers },
    { stage: 'Customization',   label: 'Connect your data sources',         count: onboarding.counts.integrationsHooked,total: onboarding.totalMembers },
    { stage: 'Customization',   label: 'Invite teammates / set access',     count: onboarding.counts.teamsInvited,      total: onboarding.totalMembers },
  ] : []
  const onboardingDone = onboardingItems.filter(i => i.count > 0).length

  const TABS: { key: Tab; label: string; icon: typeof Users; count?: number }[] = [
    { key: 'members', label: 'Members', icon: Users, count: members.length },
    { key: 'portfolios', label: 'Portfolios', icon: Briefcase, count: portfolios.length },
    { key: 'holdings', label: 'Holdings', icon: Database, count: holdingsStatus.length },
    { key: 'engagement', label: 'Engagement', icon: TrendingUp },
    { key: 'onboarding', label: 'Onboarding', icon: CheckCircle2, count: onboardingItems.length > 0 ? onboardingDone : undefined },
    { key: 'pilot', label: 'Pilot', icon: Sparkles },
  ]

  const handleMorph = async (userId: string) => {
    if (!morphReason.trim()) return
    try {
      await startMorph.mutateAsync({ targetUserId: userId, reason: morphReason.trim() })
      success('Morph session started')
      setMorphTargetId(null)
      setMorphReason('')
    } catch (err: any) {
      showError(err.message || 'Failed to start morph')
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Back + Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/ops/clients')} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600" />
            {org?.name || 'Loading...'}
          </h1>
          <p className="text-xs text-gray-400">{org?.slug} &middot; Created {org?.created_at ? new Date(org.created_at).toLocaleDateString() : ''}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              <span className="text-[10px] font-semibold bg-gray-100 text-gray-500 px-1.5 py-px rounded-full">{tab.count}</span>
            </button>
          )
        })}
      </div>

      {/* Members */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          {pendingInvites.length > 0 && (
            <div className="bg-amber-50/60 border border-amber-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-amber-200 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-amber-700" />
                <span className="text-xs font-semibold text-amber-900 uppercase tracking-wide">
                  Pending invites
                </span>
                <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                  {pendingInvites.length}
                </span>
                <span className="text-[11px] text-amber-700/80 ml-1">— invited but haven't signed up yet</span>
              </div>
              <div className="divide-y divide-amber-100">
                {pendingInvites.map((inv: any) => (
                  <div key={inv.id} className="px-5 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-amber-200/60 flex items-center justify-center flex-shrink-0">
                        <Mail className="w-3.5 h-3.5 text-amber-700" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{inv.email}</span>
                          {inv.invited_is_org_admin && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-700 rounded">Admin</span>
                          )}
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700">pending</span>
                        </div>
                        <p className="text-xs text-gray-500">
                          Invited {new Date(inv.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (confirm(`Cancel pending invite for ${inv.email}?`)) {
                          cancelInviteM.mutate(inv.id)
                        }
                      }}
                      disabled={cancelInviteM.isPending}
                      className="px-2 py-1 text-[10px] font-medium rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
          {members.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              {pendingInvites.length > 0
                ? 'No active members yet — pending invites listed above.'
                : 'No members'}
            </div>
          ) : members.map((m: any) => (
            <div key={m.id} className="px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0', m.is_org_admin ? 'bg-indigo-600' : 'bg-gray-500')}>
                  {(m.user_full_name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">{m.user_full_name}</span>
                    {m.is_org_admin && <span className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-700 rounded">Admin</span>}
                    <span className={clsx('px-1.5 py-0.5 text-[10px] rounded', m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>{m.status}</span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{m.user_email}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {m.status === 'active' ? (
                  <>
                    {morphTargetId === m.user_id ? (
                      <>
                        <input
                          type="text"
                          placeholder="Reason..."
                          value={morphReason}
                          onChange={(e) => setMorphReason(e.target.value)}
                          className="w-36 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-orange-500"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') handleMorph(m.user_id); if (e.key === 'Escape') { setMorphTargetId(null); setMorphReason('') } }}
                        />
                        <button onClick={() => handleMorph(m.user_id)} disabled={!morphReason.trim() || startMorph.isPending} className="px-2 py-1 text-xs font-medium rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50">Go</button>
                        <button onClick={() => { setMorphTargetId(null); setMorphReason('') }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setMorphTargetId(m.user_id)}
                          disabled={isMorphing}
                          className="px-2 py-1 text-[10px] font-medium rounded border border-orange-200 text-orange-600 hover:bg-orange-50 disabled:opacity-40 transition-colors flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          Morph
                        </button>
                        <button
                          onClick={() => setRemovePrompt({ userId: m.user_id, email: m.user_email })}
                          disabled={removeMemberM.isPending}
                          className="px-2 py-1 text-[10px] font-medium rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors flex items-center gap-1"
                          title="Suspend the user's access without deleting their content"
                        >
                          <Ban className="w-3 h-3" />
                          Suspend
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => restoreMemberM.mutate(m.user_id)}
                    disabled={restoreMemberM.isPending}
                    className="px-2 py-1 text-[10px] font-medium rounded border border-green-200 text-green-600 hover:bg-green-50 transition-colors flex items-center gap-1"
                  >
                    <UserCheck className="w-3 h-3" />
                    Restore
                  </button>
                )}
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {/* Portfolios */}
      {activeTab === 'portfolios' && (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
          {portfolios.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">No portfolios</div>
          ) : portfolios.map((p: any) => {
            const hs = holdingsStatus.find((h: any) => h.portfolio_id === p.id)
            return (
              <div key={p.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.is_active ? 'Active' : 'Inactive'}</p>
                </div>
                <div className="text-xs text-right">
                  {hs ? (
                    <>
                      <p className="text-gray-600">{hs.total_positions} positions</p>
                      <p className="text-gray-400">Last: {hs.snapshot_date} ({hs.source})</p>
                    </>
                  ) : (
                    <p className="text-gray-400">No holdings uploaded</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Holdings */}
      {activeTab === 'holdings' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          {holdingsStatus.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">No holdings data uploaded for this client yet.</div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700">Latest Holdings Snapshots</h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Portfolio</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Source</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Positions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {holdingsStatus.map((hs: any) => {
                      const portfolio = portfolios.find((p: any) => p.id === hs.portfolio_id)
                      return (
                        <tr key={hs.portfolio_id}>
                          <td className="px-3 py-2 text-gray-900 font-medium">{portfolio?.name || 'Unknown'}</td>
                          <td className="px-3 py-2 text-gray-600">{hs.snapshot_date}</td>
                          <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]">{hs.source}</span></td>
                          <td className="px-3 py-2 text-right text-gray-600">{hs.total_positions}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Engagement */}
      {activeTab === 'engagement' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <EngagementCard icon={MessageCircleQuestion} label="Ideas & Thoughts" value={engagement?.ideas || 0} period="Last 30 days" />
            <EngagementCard icon={Target} label="Trade Ideas" value={engagement?.tradeIdeas || 0} period="Last 30 days" />
            <EngagementCard icon={FileText} label="Notes" value={engagement?.notes || 0} period="Last 30 days" />
            <EngagementCard icon={TrendingUp} label="Ratings Updated" value={engagement?.ratings || 0} period="Last 30 days" />
            <EngagementCard icon={Activity} label="Sessions" value={engagement?.sessions || 0} period="Last 30 days" />
            <EngagementCard icon={Clock} label="Avg Session" value={engagement?.avgDuration ? `${Math.round(engagement.avgDuration / 60)}m` : '—'} period="Duration" />
          </div>
        </div>
      )}

      {/* Onboarding — Pilot Get Started funnel.
          Each row is a step in the sequential Get Started flow; the
          mini-bar shows distinct members who completed it (out of
          totalMembers). Reading top-to-bottom is a drop-off chart —
          where the bars get short is where pilots stalled. */}
      {activeTab === 'onboarding' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Pilot Get Started funnel</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Distinct members who completed each step. Signals union
                <code className="mx-1 px-1 py-0.5 rounded bg-gray-100 text-[10px]">pilot_telemetry_events</code>
                with durable artifacts (lab variants, committed trades, rationale comments) and
                <code className="mx-1 px-1 py-0.5 rounded bg-gray-100 text-[10px]">users.pilot_progress</code>
                macro keys — so action steps reflect what's in the DB, not just whether the banner was open. View-only steps stay telemetry-based.
              </p>
            </div>
            <span className="text-xs text-gray-400">
              {onboardingDone} of {onboardingItems.length} steps started
            </span>
          </div>
          {onboardingItems.length === 0 ? (
            <div className="text-sm text-gray-400 py-6 text-center">No pilot members yet.</div>
          ) : (
            (() => {
              const total = onboarding?.totalMembers ?? 0
              const graduated = onboarding?.counts.graduated ?? 0
              const overallPct = total > 0 ? Math.round((graduated / total) * 100) : 0
              const stages = ['Capture', 'Idea Pipeline', 'Trade Lab', 'Trade Book', 'Outcomes', 'Post-graduation', 'Customization'] as const
              const stageAccent: Record<typeof stages[number], string> = {
                'Capture':         'bg-sky-500',
                'Idea Pipeline':   'bg-amber-500',
                'Trade Lab':       'bg-primary-500',
                'Trade Book':      'bg-violet-500',
                'Outcomes':        'bg-emerald-500',
                'Post-graduation': 'bg-teal-500',
                'Customization':   'bg-indigo-500',
              }
              return (
                <>
                  {/* Headline — % of members who walked the full loop */}
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-xs font-medium text-gray-700">Graduated</span>
                      <span className="text-xs text-gray-500 tabular-nums">{graduated} of {total} member{total === 1 ? '' : 's'} · {overallPct}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={clsx('h-full rounded-full transition-all', graduated === total && total > 0 ? 'bg-green-500' : 'bg-indigo-500')}
                        style={{ width: `${overallPct}%` }}
                      />
                    </div>
                  </div>
                  {/* Per-stage funnel */}
                  {stages.map(stage => {
                    const items = onboardingItems.filter(i => i.stage === stage)
                    if (items.length === 0) return null
                    return (
                      <div key={stage} className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className={clsx('w-1.5 h-1.5 rounded-full', stageAccent[stage])} />
                          <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500">{stage}</span>
                        </div>
                        {items.map((item, i) => {
                          const pct = item.total > 0 ? (item.count / item.total) * 100 : 0
                          const allDone = item.count === item.total && item.total > 0
                          return (
                            <div key={`${stage}-${i}`} className="flex items-center gap-3 py-1.5 pl-3 border-l-2 border-gray-100">
                              <div className={clsx(
                                'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0',
                                allDone ? 'bg-green-100' : item.count > 0 ? 'bg-indigo-50' : 'bg-gray-100',
                              )}>
                                {allDone
                                  ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                                  : <span className={clsx('w-2 h-2 rounded-full', item.count > 0 ? 'bg-indigo-400' : 'bg-gray-300')} />
                                }
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className={clsx('text-sm font-medium truncate', item.count > 0 ? 'text-gray-900' : 'text-gray-500')}>
                                    {item.label}
                                  </p>
                                  <span className="text-[11px] text-gray-500 tabular-nums shrink-0">
                                    {item.count}/{item.total}
                                  </span>
                                </div>
                                <div className="mt-1 w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className={clsx('h-full rounded-full', allDone ? 'bg-green-500' : item.count > 0 ? stageAccent[stage] : 'bg-gray-200')}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </>
              )
            })()
          )}
        </div>
      )}

      {/* Pilot */}
      {activeTab === 'pilot' && orgId && (
        <OpsPilotPanel
          orgId={orgId}
          members={members.map((m: any) => {
            const fullName = (m.user_full_name || '').trim()
            const [first, ...rest] = fullName.split(' ')
            return {
              user_id: m.user_id,
              email: m.user_email ?? null,
              first_name: first || null,
              last_name: rest.length > 0 ? rest.join(' ') : null,
            }
          })}
        />
      )}

      <ConfirmDialog
        isOpen={!!removePrompt}
        onClose={() => setRemovePrompt(null)}
        onConfirm={() => {
          if (removePrompt) removeMemberM.mutate(removePrompt.userId)
          setRemovePrompt(null)
        }}
        title="Suspend access"
        message={
          removePrompt
            ? `${removePrompt.email} will lose access to ${org?.name || 'this org'}. Their notes, theses, and other content stay intact and visible to remaining members. You can restore access at any time.`
            : ''
        }
        confirmText="Suspend"
        cancelText="Cancel"
        variant="danger"
        isLoading={removeMemberM.isPending}
      />
    </div>
  )
}

function EngagementCard({ icon: Icon, label, value, period }: { icon: typeof Activity; label: string; value: number | string; period: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-indigo-500" />
        <p className="text-xs text-gray-500">{label}</p>
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{period}</p>
    </div>
  )
}
