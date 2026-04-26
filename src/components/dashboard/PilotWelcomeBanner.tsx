/**
 * PilotWelcomeBanner — Guided getting-started checklist for pilot clients.
 *
 * Tracks progress across key platform workflows and guides new users
 * through the core features they need to learn for adoption.
 */

import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X, ChevronDown, ChevronRight, CheckCircle2,
  FileText, Lightbulb, Star,
  BookOpen, Sparkles, PenLine, Tag, List,
} from 'lucide-react'
import { SetupWizard } from '../onboarding/SetupWizard'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'

interface PilotWelcomeBannerProps {
  onNavigate: (result: any) => void
}

interface TutorialStep {
  id: string
  label: string
  description: string
  hint: string
  icon: typeof FileText
  done: boolean
  action: () => void
  category: 'research' | 'collaborate' | 'discover'
}

export function PilotWelcomeBanner({ onNavigate }: PilotWelcomeBannerProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(`pilot-banner-dismissed-${currentOrgId}`) === 'true' } catch { return false }
  })
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(`pilot-banner-expanded-${currentOrgId}`) !== 'false' } catch { return true }
  })

  // Local "has explored an asset page" signal. The DB-backed checks for
  // this step (notes/ratings/contributions) only fire after a user
  // actually edits something — opening the page itself doesn't leave a
  // trace. AssetTab fires `pilot-tutorial:asset-explored` on mount and
  // also writes a localStorage flag, so we hydrate from that and update
  // live via the event.
  // Per-(user, org) so opening an asset in one workspace doesn't
  // pre-tick this step in another workspace the same user joins
  // later. AssetTab writes to the same key on mount.
  const assetExploredKey = `pilot-tutorial-asset-explored-${user?.id || 'anon'}-${currentOrgId || 'no-org'}`
  const [hasExploredAsset, setHasExploredAsset] = useState(() => {
    if (!user?.id) return false
    try { return localStorage.getItem(assetExploredKey) === '1' } catch { return false }
  })
  useEffect(() => {
    if (!user?.id) return
    try {
      if (localStorage.getItem(assetExploredKey) === '1') {
        setHasExploredAsset(true)
      } else {
        setHasExploredAsset(false)
      }
    } catch { /* ignore */ }
    const handler = () => {
      try { localStorage.setItem(assetExploredKey, '1') } catch { /* ignore */ }
      setHasExploredAsset(true)
    }
    window.addEventListener('pilot-tutorial:asset-explored', handler)
    return () => window.removeEventListener('pilot-tutorial:asset-explored', handler)
  }, [user?.id, assetExploredKey])

  // "Customize your workspace" step — done when the user finishes
  // the SetupWizard end-to-end. Per-(user, org) so each workspace
  // tracks independently; the underlying user_onboarding_status row
  // is per-user globally and reusing it would pre-tick this step on
  // every new workspace whenever the user had completed the wizard
  // anywhere before.
  const customizeKey = `pilot-tutorial-customize-completed-${user?.id || 'anon'}-${currentOrgId || 'no-org'}`
  const [hasCustomized, setHasCustomized] = useState(() => {
    if (!user?.id) return false
    try { return localStorage.getItem(customizeKey) === '1' } catch { return false }
  })
  useEffect(() => {
    if (!user?.id) return
    try {
      if (localStorage.getItem(customizeKey) === '1') {
        setHasCustomized(true)
      } else {
        setHasCustomized(false)
      }
    } catch { /* ignore */ }
    const handler = () => {
      try { localStorage.setItem(customizeKey, '1') } catch { /* ignore */ }
      setHasCustomized(true)
    }
    window.addEventListener('setup-wizard:completed', handler)
    return () => window.removeEventListener('setup-wizard:completed', handler)
  }, [user?.id, customizeKey])

  // Modal-open state for the inline customization wizard. Step 1
  // ("Customize your workspace") opens this; the user can also reach
  // the wizard from the user menu permanently.
  const [showCustomizeWizard, setShowCustomizeWizard] = useState(false)

  // Track completion of tutorial steps — STRICTLY org-scoped.
  // The Get Started checklist is per-org: a graduated pilot landing
  // on their own workspace shouldn't see steps marked complete from
  // actions taken in OTHER orgs the same user belongs to (e.g. their
  // dev account in Tesseract). Tables with `organization_id` are
  // filtered directly; tables without it (asset_notes, quick_thoughts,
  // analyst_ratings, etc.) use `created_at >= org.created_at` as a
  // best-effort floor — anything done before this org existed can't
  // belong to it.
  const { data: progress } = useQuery({
    queryKey: ['pilot-tutorial-progress', currentOrgId, user?.id],
    queryFn: async () => {
      if (!user?.id || !currentOrgId) return null

      // Org's created_at — used as a recency floor for tables we
      // can't directly scope by organization_id.
      const { data: orgRow } = await supabase
        .from('organizations')
        .select('created_at')
        .eq('id', currentOrgId)
        .maybeSingle()
      const orgCreatedAt = (orgRow?.created_at as string | undefined) ?? new Date(0).toISOString()

      // Org's portfolio ids — used to scope asset_lists which has
      // portfolio_id (not organization_id directly).
      const { data: portfolioRows } = await supabase
        .from('portfolios')
        .select('id')
        .eq('organization_id', currentOrgId)
      const orgPortfolioIds = (portfolioRows || []).map((p: any) => p.id as string)

      const [
        assetNotesRes,
        thoughtsRes,
        promptsRes,
        promptThoughtsRes,
        ratingsRes,
        contributionsRes,
        themesRes,
        themeNotesRes,
        listsRes,
      ] = await Promise.all([
        // Has the user written a note on an asset? (no org_id column —
        // floor by org.created_at)
        supabase.from('asset_notes')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', user.id)
          .gte('created_at', orgCreatedAt),
        // Has the user posted a thought? (no org_id column — floor by
        // org.created_at)
        supabase.from('quick_thoughts')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', user.id)
          .gte('created_at', orgCreatedAt),
        // Has the user used a prompt? Two flows count:
        //   1. user_quick_prompt_history — template/saved prompt usage
        //   2. quick_thoughts with idea_type='prompt' — the "ask a colleague"
        //      flow from PromptModal (right-pane "Prompt" capture).
        // We run both and OR the results below. Both floored by org.
        supabase.from('user_quick_prompt_history')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('created_at', orgCreatedAt),
        supabase.from('quick_thoughts')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', user.id)
          .eq('idea_type', 'prompt')
          .gte('created_at', orgCreatedAt),
        // Has the user rated an asset? (no org_id — floor by org.created_at)
        supabase.from('analyst_ratings')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('created_at', orgCreatedAt),
        // Has the user made a contribution on an asset? Org-scoped
        // directly via the organization_id column.
        supabase.from('asset_contributions')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', user.id)
          .eq('organization_id', currentOrgId),
        // Has the user created a theme in this org?
        supabase.from('themes')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', user.id)
          .eq('organization_id', currentOrgId),
        // Has the user written a note on a theme owned by this org?
        // theme_notes has no org_id directly, but we floor by org
        // created_at for the same reason as above.
        supabase.from('theme_notes')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', user.id)
          .gte('created_at', orgCreatedAt),
        // Has the user built an asset list in this org? Lists are
        // scoped via portfolio_id → portfolios.organization_id. The
        // portfolio_id IN (...) filter handles that. Excludes the
        // two system-seeded default lists ("Investment Ideas" /
        // "Work in Process") that every user gets on signup.
        orgPortfolioIds.length > 0
          ? supabase.from('asset_lists')
              .select('id', { count: 'exact', head: true })
              .eq('created_by', user.id)
              .eq('is_default', false)
              .in('portfolio_id', orgPortfolioIds)
          : Promise.resolve({ count: 0, error: null, data: null } as any),
      ])

      return {
        hasNote: (assetNotesRes.count ?? 0) > 0,
        hasThought: (thoughtsRes.count ?? 0) > 0,
        hasPrompt: (promptsRes.count ?? 0) > 0 || (promptThoughtsRes.count ?? 0) > 0,
        hasRating: (ratingsRes.count ?? 0) > 0,
        hasContribution: (contributionsRes.count ?? 0) > 0,
        hasTheme: (themesRes.count ?? 0) > 0 || (themeNotesRes.count ?? 0) > 0,
        hasList: (listsRes.count ?? 0) > 0,
      }
    },
    enabled: !!currentOrgId && !!user?.id,
    // Short staleTime so the banner re-checks progress when the user
    // returns to the dashboard after taking an action (rating, note,
    // contribution, etc). With a 30s stale window the freshly-completed
    // step would stay un-crossed for half a minute. Refetch on focus is
    // already on by default, which catches tab-switching too.
    staleTime: 0,
  })

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    try { localStorage.setItem(`pilot-banner-dismissed-${currentOrgId}`, 'true') } catch {}
  }, [currentOrgId])

  const toggleExpanded = useCallback(() => {
    setExpanded(prev => {
      const next = !prev
      try { localStorage.setItem(`pilot-banner-expanded-${currentOrgId}`, String(next)) } catch {}
      return next
    })
  }, [currentOrgId])

  // Auto-dismiss the banner once every Get Started step is complete.
  // Computed inline (rather than from the `steps` array further down)
  // so this effect runs BEFORE the early-return guard — placing it
  // after would change the hook count between loading vs loaded
  // renders and trip "Rendered fewer hooks than expected".
  const allDoneForAutoDismiss = !!progress
    && hasCustomized
    && !!progress.hasContribution
    && !!progress.hasRating
    && !!progress.hasNote
    && !!progress.hasTheme
    && !!progress.hasThought
    && !!progress.hasPrompt
    && !!progress.hasList
  useEffect(() => {
    if (allDoneForAutoDismiss && !dismissed) {
      handleDismiss()
    }
  }, [allDoneForAutoDismiss, dismissed, handleDismiss])

  if (dismissed || !progress) return null

  // Navigate to AAPL (the tutorial target asset). `extraData` lets steps
  // deep-link to a specific view (e.g. "My View" + scroll to a section).
  const openAsset = (extraData: Record<string, any> = {}) => {
    onNavigate({
      type: 'asset',
      id: 'AAPL',
      title: 'AAPL',
      data: { symbol: 'AAPL', ...extraData },
    })
  }

  // Open AAPL on the user's own "My View" tab (researchViewFilter = userId).
  const openAaplMyView = (extraData: Record<string, any> = {}) => {
    if (!user?.id) { openAsset(extraData); return }
    openAsset({ researchViewFilter: user.id, ...extraData })
  }

  const steps: TutorialStep[] = [
    // Personalize first — this scopes the rest of the platform
    // (focus, coverage, integrations) to the way the user actually
    // works, so the Get Started flow that follows lands on a
    // workspace already shaped to them.
    {
      id: 'customize-workspace',
      label: 'Customize your workspace',
      description: 'Confirm your profile, focus, and coverage. About 5 min.',
      hint: 'Opens a 4-step wizard. Skip any section you don\'t care about.',
      icon: Sparkles,
      done: hasCustomized,
      action: () => setShowCustomizeWizard(true),
      category: 'research',
    },
    // Research workflow
    {
      id: 'explore-asset',
      label: 'Explore an asset page',
      description: 'Open any asset to see its research fields, workflow status, and history.',
      hint: 'Click below to open AAPL.',
      icon: BookOpen,
      done: (hasExploredAsset || progress.hasContribution || progress.hasNote || progress.hasRating),
      action: () => openAsset(),
      category: 'research',
    },
    {
      id: 'fill-research',
      label: 'Fill out a research field',
      description: 'Add your thesis, bull/bear case, or any research field on an asset page.',
      hint: 'On AAPL "My View", click any empty field to start typing.',
      icon: PenLine,
      done: progress.hasContribution,
      action: () => openAaplMyView(),
      category: 'research',
    },
    {
      id: 'rate-asset',
      label: 'Rate an asset',
      description: 'Set your conviction rating (e.g., Overweight / Neutral / Underweight).',
      hint: 'Opens AAPL "My View" and scrolls to the Rating section.',
      icon: Star,
      done: progress.hasRating,
      // scrollNonce ensures the AssetTab scroll effect re-fires on
      // repeat clicks even though scrollTo='rating' is unchanged.
      action: () => openAaplMyView({ scrollTo: 'rating', scrollNonce: Date.now() }),
      category: 'research',
    },
    {
      id: 'take-note',
      label: 'Write a note',
      description: 'Write a research note on an asset — capture your analysis and key takeaways.',
      hint: 'Open the All Notes page and click "New Note".',
      icon: FileText,
      done: progress.hasNote,
      action: () => onNavigate({ type: 'notes-list', id: 'notes-list', title: 'Notes', data: {} }),
      category: 'research',
    },
    {
      id: 'explore-theme',
      label: 'Explore a theme',
      description: 'Group ideas by sector or macro story across many assets at once.',
      hint: 'Open the All Themes page, then create or open a theme.',
      icon: Tag,
      done: progress.hasTheme,
      action: () => onNavigate({ type: 'themes-list', id: 'themes-list', title: 'Themes', data: {} }),
      category: 'research',
    },
    // Communicate & collaborate
    {
      id: 'post-thought',
      label: 'Post a thought',
      description: 'Share a quick insight or observation with your team via Thoughts.',
      hint: 'Opens the right-hand pane to capture a quick thought.',
      icon: Lightbulb,
      done: progress.hasThought,
      action: () => {
        try {
          // The right-pane sidebar's quick-capture form for thoughts is
          // keyed 'idea' in PendingCaptureType. ('thought' isn't a valid
          // value — the sidebar would open with no form auto-selected.)
          window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
            detail: { captureType: 'idea' },
          }))
        } catch { /* ignore */ }
      },
      category: 'collaborate',
    },
    {
      id: 'use-prompt',
      label: 'Use a prompt',
      description: 'Address a specific question or task using the prompt system.',
      hint: 'Opens the right-hand pane to compose a prompt.',
      icon: Sparkles,
      done: progress.hasPrompt,
      action: () => {
        try {
          window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
            detail: { captureType: 'prompt' },
          }))
        } catch { /* ignore */ }
      },
      category: 'collaborate',
    },
    // Discover & customize
    {
      id: 'build-list',
      label: 'Build a list',
      description: 'Group assets into watchlists, shortlists, or shared lists.',
      hint: 'Open Lists from the app menu, create a list, and add a few assets to it.',
      icon: List,
      done: progress.hasList,
      action: () => onNavigate({ type: 'lists', id: 'lists', title: 'Lists', data: {} }),
      category: 'discover',
    },
  ]

  const completedCount = steps.filter(s => s.done).length
  const allDone = completedCount === steps.length

  return (
    <>
    <div className="relative bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/20 rounded-xl border border-indigo-200/60 dark:border-indigo-800/40">
      {/* Header — always visible. Title + one-line "what this is" so the
          section's purpose is clear even when collapsed. */}
      <div className="flex items-start justify-between gap-3 px-4 py-2.5">
        <button onClick={toggleExpanded} className="flex items-start gap-2 text-left flex-1 min-w-0">
          {expanded
            ? <ChevronDown className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
            : <ChevronRight className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
          }
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-tight">
              Getting Started
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
              A quick tour of Tesseract — click any step to jump in. {allDone ? 'All done!' : `${completedCount} of ${steps.length} complete.`}
            </p>
          </div>
        </button>

        {/* Progress bar + dismiss */}
        <div className="flex items-center gap-3 mt-0.5 shrink-0">
          <div className="w-24 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${(completedCount / steps.length) * 100}%` }}
            />
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleDismiss() }}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded content — 2-column grid (3 on wide screens). Each card
          shows icon + label + one-line description so the user always
          knows what the step is. Compact rows (~36px) keep total height
          well below the original stacked layout. Category shown as a
          small colored bar on the left of each card instead of a
          standalone section header. */}
      {expanded && (
        <div className="px-4 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {steps.map(step => (
              <button
                key={step.id}
                onClick={step.action}
                title={step.hint}
                className={clsx(
                  'group relative flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-md border text-left transition-all overflow-hidden',
                  step.done
                    ? 'bg-white/40 border-green-200/70 dark:bg-gray-800/30 dark:border-green-800/40'
                    : 'bg-white/80 border-indigo-200/60 hover:bg-white hover:border-indigo-300 hover:shadow-sm dark:bg-gray-800/60 dark:border-indigo-800/40 dark:hover:bg-gray-800',
                )}
              >
                {/* Category accent bar */}
                <span
                  className={clsx(
                    'absolute left-0 top-0 bottom-0 w-1',
                    step.category === 'research' && 'bg-indigo-400/70',
                    step.category === 'collaborate' && 'bg-amber-400/70',
                    step.category === 'discover' && 'bg-emerald-400/70',
                  )}
                  aria-hidden
                />
                <div className="shrink-0">
                  {step.done
                    ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                    : <step.icon className="w-4 h-4 text-indigo-400 dark:text-indigo-500" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className={clsx(
                    'text-[12px] font-medium leading-tight truncate',
                    step.done ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-200',
                  )}>
                    {step.label}
                  </p>
                  <p className={clsx(
                    'text-[10.5px] leading-tight truncate',
                    step.done ? 'text-gray-300 dark:text-gray-600' : 'text-gray-500 dark:text-gray-400',
                  )}>
                    {step.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
          {/* Small legend so the colored bars are decipherable */}
          <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-indigo-400/70" /> Research</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-amber-400/70" /> Communicate</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-400/70" /> Discover</span>
          </div>
        </div>
      )}
    </div>

    {/* Customization wizard modal — opened from step 1
        ("Customize your workspace"). Uses the
        'workspace_customization' framing so copy reads as
        personalization, not initial setup. */}
    {showCustomizeWizard && (
      <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center">
        <div className="w-full max-w-3xl h-[90vh] overflow-hidden bg-white dark:bg-gray-800 rounded-2xl shadow-2xl">
          <SetupWizard
            mode="workspace_customization"
            onComplete={() => setShowCustomizeWizard(false)}
            onSkip={() => setShowCustomizeWizard(false)}
            isModal
          />
        </div>
      </div>
    )}
    </>
  )
}
