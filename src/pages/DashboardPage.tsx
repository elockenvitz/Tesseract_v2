import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { Layout } from '../components/layout/Layout'
import type { Tab } from '../components/layout/TabManager'
import {
  TabStateManager, CANONICAL_HOME_TAB, LEGACY_DASHBOARD_ID,
} from '../lib/tabStateManager'
import { AssetTab } from '../components/tabs/AssetTab'
import { IdeasApp } from '../components/ideas-app/IdeasApp'
import { DashboardShell } from '../components/dashboard/DashboardShell'
import { MobileAssetPage } from '../components/mobile/asset/MobileAssetPage'
import { MobilePipeline } from '../components/mobile/MobilePipeline'
import { MobileCoverage } from '../components/mobile/MobileCoverage'
import { AssetsListPage } from './AssetsListPage'
import { ThemesListPage } from './ThemesListPage'
import { PortfoliosListPage } from './PortfoliosListPage'
import { NotesListPage } from './NotesListPage'
import { ListsPage } from './ListsPage'
import { NoteEditor } from '../components/notes/NoteEditorUnified'
import { PortfolioNoteEditor } from '../components/notes/PortfolioNoteEditorUnified'
import { ThemeNoteEditor } from '../components/notes/ThemeNoteEditorUnified'
import { ThemeTab } from '../components/tabs/ThemeTab'
import { PortfolioTab } from '../components/tabs/PortfolioTab'
import { ListTab } from '../components/tabs/ListTab'
import { BlankTab } from '../components/tabs/BlankTab.tsx'
import { DesktopOnlyCard } from '../components/mobile/DesktopOnlyCard'
import { MobileDashboard } from '../components/mobile/MobileDashboard'
import { MobilePilotHome } from '../components/mobile/MobilePilotHome'
import { isDesktopOnly } from '../lib/mobile/mobile-surfaces'
import { canonicalTabTarget } from '../lib/tabs/legacy-tab-aliases'
import { useIsMobile } from '../hooks/useMediaQuery'
const WorkflowsPage = lazy(() => import('./WorkflowsPage').then(m => ({ default: m.WorkflowsPage })))
import { ProjectsPage } from './ProjectsPage'
import { ProjectDetailTab } from '../components/tabs/ProjectDetailTab'
// Project widgets removed - content now in Command Center carousel
import { TradeQueuePage } from './TradeQueuePage'
import { AddTradeIdeaModal } from '../components/trading/AddTradeIdeaModal'
const DecisionAccountabilityPage = lazy(() => import('./DecisionAccountabilityPage').then(m => ({ default: m.DecisionAccountabilityPage })))
import { FilesPage } from './FilesPage'
import { useSessionTracking } from '../hooks/useSessionTracking'
const ChartingPage = lazy(() => import('./ChartingPage').then(m => ({ default: m.ChartingPage })))
const SimulationPage = lazy(() => import('./SimulationPage').then(m => ({ default: m.SimulationPage })))
const TradeBookPage = lazy(() => import('./TradeBookPage').then(m => ({ default: m.TradeBookPage })))
import { AssetAllocationPage } from './AssetAllocationPage'
import { TDFListPage } from './TDFListPage'
import { TDFTab } from '../components/tabs/TDFTab'
import { UserTab } from '../components/tabs/UserTab'
import { TemplatesTab } from '../components/tabs/TemplatesTab'
const CalendarPage = lazy(() => import('./CalendarPage').then(m => ({ default: m.CalendarPage })))
const CoveragePage = lazy(() => import('./CoveragePage').then(m => ({ default: m.CoveragePage })))
import { OrganizationPage } from './OrganizationPage'
import { AuditExplorerPage } from './AuditExplorerPage'
import { AdminConsolePage } from './AdminConsolePage'
import { ASSET_REFERENCE_SELECT } from '../lib/assets/asset-columns'
import { useAuth } from '../hooks/useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { PilotWelcomeBanner } from '../components/dashboard/PilotWelcomeBanner'
import { FirstSessionCoveragePrompt } from '../components/coverage/FirstSessionCoveragePrompt'
import { CoverageSummaryBanner } from '../components/coverage/CoverageSummaryBanner'
import { PilotHomeSkeleton } from '../components/pilot/PilotHomeSkeletons'
import { usePilotMode } from '../hooks/usePilotMode'
import { usePilotSeeding } from '../hooks/usePilotSeeding'
import { usePilotEntry } from '../hooks/usePilotEntry'
import { TAB_TYPE_TO_PILOT_FEATURE, PILOT_ACCESS_DEFAULTS } from '../lib/pilot/pilot-access'
import { shouldHoldForPilotDecision, dashboardTabTypeForRender } from '../lib/pilot/tab-gate'
import { PilotTeaserModal } from '../components/pilot/PilotTeaserModal'
import { PilotGraduationModal } from '../components/pilot/PilotGraduationModal'
import { PilotTradeBookPreview } from '../components/pilot/PilotTradeBookPreview'
import { PilotOutcomesPreview } from '../components/pilot/PilotOutcomesPreview'
import { hideBootLoader, showBootLoader } from '../lib/boot-loader'
import { useToast } from '../components/common/Toast'
import { PageLoader } from '../components/ui/PageLoader'

/** Suspense fallback for lazy-loaded tabs (Outcomes, Trade Book,
 *  Trade Lab, etc.). Visually matches every other in-app spinner so
 *  switching to a lazy tab doesn't introduce a different style. */
function AssetLoadingState() {
  return (
    <PageLoader loading className="bg-gray-50 dark:bg-gray-900" />
  )
}

// Synchronous pilot hint (reads localStorage the same way usePilotMode does)
// so we can pick the correct landing tab on the very first render — no flash.
// Also honours a one-shot `org_switch_target_pilot` sessionStorage flag
// written by switchOrg right before the reload. That flag wins on the very
// first render after an org switch: it carries the freshly-fetched pilot_mode
// of the target org regardless of whether the user record id has fully
// settled in useAuth's cached state.
function readPilotHintSync(userId?: string): boolean {
  try {
    const switchFlag = sessionStorage.getItem('org_switch_target_pilot')
    if (switchFlag === '1') return true
    if (switchFlag === '0') return false
  } catch {
    // ignore
  }
  if (!userId) return false
  try {
    return localStorage.getItem(`was_pilot_${userId}`) === '1'
  } catch {
    return false
  }
}

// Clear the one-shot switch flag after the first mount has consumed it, so
// subsequent reloads / org-list refetches don't get stuck in pilot mode.
function consumePilotSwitchFlag(): void {
  try {
    sessionStorage.removeItem('org_switch_target_pilot')
  } catch {
    // ignore
  }
}

/**
 * Where a session with nothing to restore begins.
 *
 * The canonical Dashboard is the Today implementation: the finite, ranked,
 * editorial morning surface. It kept its internal id and type so every event
 * contract, deep link and saved tab that refers to `today` still resolves --
 * only the title the user reads is the product name.
 *
 * The pre-Today dashboard is still built, still routed and still reachable
 * from the launcher's MORE group. It is simply no longer where the door opens,
 * because two surfaces both called Dashboard cannot both be the entrance.
 */
const CANONICAL_HOME = { id: 'today', title: 'Dashboard', type: 'today' as const }

// Helper to get initial tab state synchronously (avoids flash on refresh).
// For pilots, this shortcuts to Trade Lab as the initial active tab so the
// first render never puts the Dashboard tab (a pilot-hidden surface) in
// the active slot — eliminating the dashboard-then-trade-lab flip that
// otherwise occurs the first time the route-guard effect gets a chance
// to run.
export function getInitialTabState(userId?: string, orgId?: string): { tabs: Tab[]; activeTabId: string } {
  const isPilotHint = readPilotHintSync(userId)
  const savedState = TabStateManager.loadMainTabState(userId, orgId)
  if (savedState && savedState.tabs && savedState.tabs.length > 0) {
    // Dedupe any duplicate-id tabs that earlier bugs may have written into
    // sessionStorage. Without this, a hard-refresh briefly renders the
    // same tab twice before the pilot guard / navigate flow consolidates.
    const seen = new Set<string>()
    const dedupedTabs: Tab[] = []
    for (const tab of savedState.tabs as Tab[]) {
      if (!tab?.id || seen.has(tab.id)) continue
      seen.add(tab.id)
      dedupedTabs.push(tab)
    }
    // Ensure the canonical Dashboard is always present, so there is somewhere
    // to return to and so the pilot landing rule below always has a target.
    // Restored tabs are otherwise untouched: this adds one, it removes none
    // and it does not change which one is active.
    if (!dedupedTabs.some(tab => tab.id === CANONICAL_HOME.id)) {
      dedupedTabs.unshift({ ...CANONICAL_HOME, isActive: false })
    }
    // Pilot: always land on the Dashboard on initial mount. Pilots are
    // starter users — the Dashboard is their command center, and an
    // accidentally-active tab from a prior session (or a legacy
    // session-storage entry that pre-dated the current code) was
    // landing them on Trade Lab on org switch. This doesn't delete other
    // open tabs; it just resets which one is active.
    //
    // Non-pilots keep whatever they were last on: a deliberately persisted
    // workspace is a choice, and forcing the Dashboard over it on every
    // reload would throw that choice away.
    let activeTabId = savedState.activeTabId
    if (isPilotHint) {
      activeTabId = CANONICAL_HOME.id
    }

    /*
     * A restored legacy Dashboard is residue, not a workspace choice.
     *
     * ── What this used to do, and why it is no longer enough ─────────────
     *
     * The legacy tab was KEPT and renamed to "Dashboard (legacy)", so that two
     * tabs could not both present themselves as "Dashboard" and the older one
     * could not take the home slot. That was right while the surface still
     * existed and was still offered from the launcher's More group.
     *
     * It no longer exists for a normal reader. The non-pilot desktop workbench
     * is gone and both launcher entries with it, so a renamed legacy tab would
     * be a tab whose only remaining content is the pilot branch — offered to
     * a reader who is not a pilot. Keeping it reachable was the point of the
     * rename; nothing is left to reach.
     *
     * So it is migrated rather than renamed. `migrateLegacyTabs` in
     * `TabStateManager.loadMainTabState` has already rewritten the type AND
     * the id, collapsed a session holding both onto one, and carried the
     * active id across — see `legacy-tab-aliases` for why one rewrite is
     * correct on both desktop and phone. Nothing about that is device
     * specific, and nothing here needs to repeat it.
     *
     * A persisted workspace is still a choice: someone who left on an Asset
     * tab, Trade Lab or Research comes back to it, exactly as before.
     */
    return {
      tabs: dedupedTabs.map(tab => ({
        ...tab,
        isActive: tab.id === activeTabId,
        // Migrate old tab titles
        ...(tab.type === 'workflows' && tab.title !== 'Process' ? { title: 'Process' } : {}),
      })),
      activeTabId
    }
  }
  // Default state — everyone lands on the canonical Dashboard. Pilots no
  // longer get a pre-seeded Trade Lab tab; the dashboard CTA or the "+"
  // menu opens Trade Lab (and the other pilot surfaces) on demand.
  return {
    tabs: [{ ...CANONICAL_HOME, isActive: true }],
    activeTabId: CANONICAL_HOME.id
  }
}

export function DashboardPage() {
  // Auth & org
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  // Initialize state from org-scoped sessionStorage
  const [initialState] = useState(() => getInitialTabState(user?.id, currentOrgId ?? undefined))
  const [tabs, setTabs] = useState<Tab[]>(initialState.tabs)
  const [activeTabId, setActiveTabId] = useState(initialState.activeTabId)
  const [isInitialized, setIsInitialized] = useState(true)

  // One-shot consume of the org-switch pilot hint — after the first mount
  // has used it to land on Trade Lab, clear it so subsequent renders use
  // the persistent localStorage hint managed by usePilotMode.
  useEffect(() => {
    consumePilotSwitchFlag()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ref mirror of activeTabId — used inside handlers that are captured by
  // long-lived event listeners (registered with [] deps). Reading the ref
  // inside the handler avoids stale-closure bugs where the handler sees the
  // first render's activeTabId forever.
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  // Session tracking (heartbeat-based)
  useSessionTracking()

  // Gates the desktop-only fallback in renderTabContent.
  const isMobile = useIsMobile()

  // ─── Pilot Mode gating ───────────────────────────────────────────────
  const pilotMode = usePilotMode()

  /*
   * A pilot's workspace is seeded from here because this is the one component
   * both shells render, whatever tab is open. It used to be seeded by a hook
   * inside Trade Lab, so a fresh pilot who went coverage → capture → Idea
   * Pipeline arrived at an empty board that nothing had ever written to.
   * No-ops for everyone who is not a pilot. See `usePilotSeeding`.
   */
  usePilotSeeding()

  /* Coverage setup, then the five-step mission. See the `today` branch. */
  const pilotEntry = usePilotEntry()
  const [pilotTeaser, setPilotTeaser] = useState<{ featureLabel: string; reason: 'preview' | 'hidden' } | null>(null)

  // Pilot users never see tabs backed by a pilot-hidden feature. Filtering
  // here removes them from the tab bar entirely rather than redirecting on
  // click. `effectiveIsPilot` + the resolved `access` map are both cache-
  // aware, so a cold refresh uses last session's pilot hint (and the default
  // access map) until the real values resolve — no flash of the Dashboard
  // tab or other pilot-hidden surfaces.
  const visibleTabs = useMemo(() => {
    if (!pilotMode.effectiveIsPilot) return tabs
    const accessFor = pilotMode.isLoading
      ? (f: keyof typeof PILOT_ACCESS_DEFAULTS) => PILOT_ACCESS_DEFAULTS[f]
      : pilotMode.accessFor
    return tabs.filter(tab => {
      const feature = TAB_TYPE_TO_PILOT_FEATURE[tab.type]
      if (!feature) return true
      return accessFor(feature) !== 'hidden'
    })
  }, [tabs, pilotMode.effectiveIsPilot, pilotMode.isLoading, pilotMode.access])

  const openPilotTradeLab = useCallback(() => {
    // Fire via the existing openTradeLab event — the listener below handles it.
    window.dispatchEvent(new CustomEvent('openTradeLab', { detail: {} }))
    setPilotTeaser(null)
  }, [])

  // Listen for "show me a pilot teaser" events from nav clicks in the Header.
  useEffect(() => {
    const handler = (event: CustomEvent) => {
      const { featureLabel, reason } = event.detail || {}
      if (!featureLabel) return
      setPilotTeaser({ featureLabel, reason: reason === 'hidden' ? 'hidden' : 'preview' })
    }
    window.addEventListener('pilot-teaser', handler as EventListener)
    return () => window.removeEventListener('pilot-teaser', handler as EventListener)
  }, [])

  // Pilot route guard: when a pilot user lands on (or is already
  // looking at) a tab whose type is gated as 'hidden' for pilots,
  // snap them back to Dashboard. Trade Lab is no longer auto-seeded
  // or pinned — pilots open it on demand from the Dashboard CTA or
  // the "+" picker, and can close it like any other tab. 'preview'
  // tabs stay — we substitute the rendered content with a preview
  // component further below.
  useEffect(() => {
    // Use effectiveIsPilot (not isPilot) so a graduated user — whose
    // org is still flagged pilot but who's earned the full app — isn't
    // bounced off a tab the pilot access map happens to mark 'hidden'.
    // Without this, clicking expand-chart from the Ideas tab opened the
    // charting tab and then immediately redirected to the dashboard.
    if (pilotMode.isLoading || !pilotMode.effectiveIsPilot) return

    const active = tabs.find(t => t.id === activeTabId)
    const activeFeature = active ? TAB_TYPE_TO_PILOT_FEATURE[active.type] : null
    const activeAccess = activeFeature ? pilotMode.accessFor(activeFeature) : 'full'

    if (activeAccess === 'hidden') {
      /*
       * The canonical home, by its own identity.
       *
       * This looked for a tab with the literal id `dashboard`. That was the
       * legacy home, and the session migration now rewrites it to `today`
       * before this ever runs — so the guard was about to start looking for a
       * tab that cannot exist, and a pilot on a gated surface would have been
       * left there with nothing to snap back to.
       *
       * `CANONICAL_HOME_TAB.id` is the same constant the restore path and the
       * default session use, which is what keeps the three from drifting.
       */
      const home = tabs.find(t => t.id === CANONICAL_HOME_TAB.id)
      if (home && home.id !== activeTabId) {
        setActiveTabId(home.id)
        setTabs(prev => prev.map(t => ({ ...t, isActive: t.id === home.id })))
      }
    }
  }, [pilotMode.isPilot, pilotMode.isLoading, pilotMode.access, tabs, activeTabId])

  // Reset tabs when org changes (switch org → load that org's saved tabs or
  // default). Also flip `isOrgTransitioning` so the page renders a loading
  // state until pilot detection resolves — without the gate, we'd paint the
  // new org's tabs before the pilot filter/route-guard effects run, causing
  // a visible Dashboard→Trade Lab flash on non-pilot→pilot switches.
  const prevOrgRef = useRef(currentOrgId)
  const [isOrgTransitioning, setIsOrgTransitioning] = useState(false)
  useEffect(() => {
    if (currentOrgId && currentOrgId !== prevOrgRef.current) {
      const wasRealSwitch = prevOrgRef.current !== null
      prevOrgRef.current = currentOrgId
      if (wasRealSwitch) setIsOrgTransitioning(true)
      const saved = TabStateManager.loadMainTabState(user?.id, currentOrgId)
      if (saved) {
        setTabs(saved.tabs as Tab[])
        setActiveTabId(saved.activeTabId)
      } else {
        // A book this user has never opened is a new session for them.
        const defaultTabs = [{ ...CANONICAL_HOME, isActive: true }]
        setTabs(defaultTabs as Tab[])
        setActiveTabId(CANONICAL_HOME.id)
      }
    }
  }, [currentOrgId, user?.id])

  // Clear the transition flag once pilot detection finishes. At that point
  // both visibleTabs filtering and the pilot route guard have had a chance
  // to run, so the first post-transition paint is already correct.
  useEffect(() => {
    if (isOrgTransitioning && !pilotMode.isLoading) {
      setIsOrgTransitioning(false)
    }
  }, [isOrgTransitioning, pilotMode.isLoading])

  // Safety timeout — never leave the user stuck on the "Switching workspace"
  // overlay. If pilot detection stalls (e.g. a query never resolves), we'd
  // otherwise hold the loader forever. 4s is long enough for every normal
  // fetch to finish and short enough that a hang recovers quickly.
  useEffect(() => {
    if (!isOrgTransitioning) return
    const timer = setTimeout(() => setIsOrgTransitioning(false), 4000)
    return () => clearTimeout(timer)
  }, [isOrgTransitioning])

  // Save tab state whenever tabs or activeTabId changes
  useEffect(() => {
    if (isInitialized && user?.id && currentOrgId) {
      const currentState = TabStateManager.loadMainTabState(user.id, currentOrgId)
      const existingTabStates = currentState?.tabStates || {}
      TabStateManager.saveMainTabState(tabs, activeTabId, existingTabStates, user.id, currentOrgId)
    }
  }, [tabs, activeTabId, isInitialized, user?.id, currentOrgId])

  // The blocking SetupWizard used to live here.
  //
  // A brand-new non-pilot user landed on the dashboard and got a full-screen
  // five-step modal before they could touch anything — including
  // CoverageQuickStart, which was rendering correctly underneath it. Found in
  // real authenticated testing on staging: the intended first session
  // ("workspace -> what do you follow? -> Ideas") was unreachable without first
  // completing or exiting a wizard.
  //
  // Nothing downstream needed it. `user_onboarding_status.wizard_completed` has
  // exactly one consumer — the gate that decided whether to show the wizard, so
  // it existed to satisfy itself. `team_access_requests`, the only row the
  // Teams step writes, has no reader anywhere in the app. Every remaining
  // answer lives in `user_profile_extended`, which ProfilePage already renders
  // and edits in full, and which CoverageQuickStart now reads for suggestions.
  //
  // So the questions are not deleted, they are deferred to where they were
  // already answerable. The wizard itself stays reachable on demand from
  // ProfilePage in its existing non-blocking `workspace_customization` mode.
  //
  // Nothing replaces it here. CoverageQuickStart is the first-session prompt,
  // and it is not a gate: it renders when the user has no coverage and is
  // skippable.

  const toast = useToast()

  // Listen for org auto-join event (dispatched from useAuth when domain routing auto-joins)
  useEffect(() => {
    const handler = (e: Event) => {
      const { orgName } = (e as CustomEvent).detail ?? {}
      if (orgName) toast.success('Joined organization', orgName)
    }
    window.addEventListener('org-auto-joined', handler)
    return () => window.removeEventListener('org-auto-joined', handler)
  }, [])

  /*
   * The scope bar, its portfolio list and the cockpit feed went with the
   * workbench they served. `useDashboardScope` and `useCockpitFeed` are left
   * in the tree with no caller here: the lens shell may yet want the same
   * material, and deleting a data hook is a separate decision from retiring
   * the page that used it.
   */
  // "New Trade Idea" modal — opened via decision-engine-action event from asset page
  const [tradeIdeaModal, setTradeIdeaModal] = useState<{ open: boolean; assetId?: string; portfolioId?: string }>({ open: false })

  // Stable navigate ref — handleSearchResult is defined below but onClick closures
  // only fire on user interaction (never during render), so a ref is safe.
  const navigateRef = useRef<(detail: any) => void>(() => {})
  const handleSearchResult = async (result: any) => {
    // For asset type, if we don't have an ID but have a symbol, fetch the asset by symbol
    if (result.type === 'asset' && !result.data?.id && result.data?.symbol) {
      const { data: assetData, error } = await supabase
        .from('assets')
        .select(ASSET_REFERENCE_SELECT)
        .eq('symbol', result.data.symbol)
        .single()

      if (!error && assetData) {
        // Merge the fetched asset data with the navigation data
        result.data = { ...assetData, ...result.data }
        result.id = assetData.id
      } else {
        console.error('❌ DashboardPage: Failed to fetch asset by symbol:', error)
      }
    }

    // Handle 'page' type results - convert to the actual page type
    if (result.type === 'page' && result.data?.pageType) {
      result = {
        ...result,
        type: result.data.pageType,
        id: result.data.pageType // Use pageType as ID for singleton pages
      }
    }

    /*
     * A retired tab type becomes the surface that answers for it now.
     *
     * Before the id is read, because everything below keys on it: the
     * existing-tab lookup, the active id and the tab that gets created. An
     * alias applied after that point would open a second tab for the same
     * application, which is the duplicate this prevents.
     *
     * At the funnel rather than at the senders. A legacy descriptor can
     * arrive from a banner, a search result, an event, a launcher tile or a
     * saved session, and the list of senders anybody can enumerate is never
     * all of them.
     */
    result = canonicalTabTarget(result)

    // For portfolios, prefer mnemonic (portfolio_id) as tab title
    const tabTitle = result.type === 'portfolio' && result.data?.portfolio_id
      ? result.data.portfolio_id
      : result.title

    // Compute the target active id from the CURRENT tabs state up
    // front so we can call setActiveTabId without depending on the
    // setTabs updater having run. React 18 may defer functional
    // updaters, which previously caused finalActiveId to read null
    // when called from synthetic-event chains (e.g. dispatching
    // navigate-to-asset from a modal click). The updater below
    // also writes finalActiveId as a fallback for any cases where
    // the precomputed match misses (shouldn't happen in practice).
    const findExistingTab = (tabsList: Tab[]) => tabsList.find(tab => {
      if (tab.id === result.id) return true
      if (result.type === 'asset' && result.data?.symbol && tab.data?.symbol === result.data.symbol) return true
      if (result.type === 'asset' && result.data?.symbol && tab.id === result.data.symbol) return true
      if (result.type === 'coverage' && tab.type === 'coverage') return true
      if (result.type === 'trade-lab' && tab.type === 'trade-lab') return true
      if (result.type === 'trade-queue' && tab.type === 'trade-queue') return true
      if (result.type === 'trade-book' && tab.type === 'trade-book') return true
      if (result.type === 'workflows' && tab.type === 'workflows') return true
      return false
    })
    const precomputedExisting = findExistingTab(tabs)
    const precomputedActiveId = precomputedExisting
      ? precomputedExisting.id
      : (tabs.find(t => t.id === activeTabIdRef.current)?.isBlank ? activeTabIdRef.current : result.id)

    let finalActiveId: string | null = precomputedActiveId
    setTabs(prev => {
      const existingTab = findExistingTab(prev)

      if (existingTab) {
        finalActiveId = existingTab.id
        return prev.map(tab => ({
          ...tab,
          isActive: tab.id === existingTab.id,
          ...(tab.id === existingTab.id ? {
            title: result.title || tab.title,
            ...(result.data ? {
              data: {
                ...tab.data,
                ...result.data,
                // For trade-lab tabs, explicitly reset shareId when the new
                // navigation target doesn't carry one. Without this, opening
                // your own trade lab after viewing a shared one would inherit
                // the old shareId and put the page into read-only mode.
                ...(result.type === 'trade-lab'
                  ? { shareId: result.data?.shareId ?? null }
                  : {})
              }
            } : {})
          } : {})
        }))
      }

      // Read latest activeTabId via ref (not closure) so this is safe under
      // stale-closure invocation and post-await races.
      const currentActiveId = activeTabIdRef.current
      const activeTab = prev.find(tab => tab.id === currentActiveId)

      // If we're in a blank tab, replace it instead of creating a new one
      if (activeTab?.isBlank) {
        finalActiveId = result.id
        return prev.map(tab =>
          tab.id === currentActiveId
            ? { id: result.id, title: tabTitle, type: result.type, data: result.data, isActive: true }
            : { ...tab, isActive: false }
        )
      }

      // Append new tab and switch to it
      finalActiveId = result.id
      return [
        ...prev.map(tab => ({ ...tab, isActive: false })),
        { id: result.id, title: tabTitle, type: result.type, data: result.data, isActive: true },
      ]
    })
    if (finalActiveId) setActiveTabId(finalActiveId)
  }

  // Keep navigate ref in sync with latest handleSearchResult
  navigateRef.current = handleSearchResult

  // Auto-enrich asset tabs that have only symbol/id but no full asset data.
  // This happens when navigating from Ideas feed, signals, etc.
  useEffect(() => {
    const assetTabsToEnrich = tabs.filter(
      t => t.type === 'asset' && t.data && !t.data.company_name && (t.data.symbol || t.id)
    )
    if (assetTabsToEnrich.length === 0) return

    for (const tab of assetTabsToEnrich) {
      const fetchAsset = async () => {
        const { data: asset } = await supabase
          .from('assets')
          .select(ASSET_REFERENCE_SELECT)
          .eq('id', tab.id)
          .single()
        if (asset) {
          setTabs(prev => prev.map(t =>
            t.id === tab.id ? { ...t, data: { ...t.data, ...asset }, title: asset.symbol || t.title } : t
          ))
        }
      }
      fetchAsset()
    }
  }, [tabs.map(t => t.id).join(',')])

  // Decision engine action dispatch → tab navigation
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      // Intercept new-trade-idea to open the AddTradeIdeaModal
      if (detail.type === 'new-trade-idea') {
        setTradeIdeaModal({
          open: true,
          assetId: detail.data?.assetId,
          portfolioId: detail.data?.portfolioId,
        })
        return
      }
      navigateRef.current(detail)
    }
    window.addEventListener('decision-engine-action', handler)
    return () => window.removeEventListener('decision-engine-action', handler)
  }, [])

  const handleTabChange = (tabId: string) => {
    // If tab doesn't exist yet (e.g. synthetic parent from grouped tabs), create it directly
    const exists = tabs.some(tab => tab.id === tabId)
    if (!exists) {
      const parentTypes: Record<string, { type: Tab['type']; title: string }> = {
        'assets-list': { type: 'assets-list', title: 'Assets' },
        'portfolios-list': { type: 'portfolios-list', title: 'Portfolios' },
        'themes-list': { type: 'themes-list', title: 'Themes' },
        'notes-list': { type: 'notes-list', title: 'Notes' },
        'lists': { type: 'lists', title: 'Lists' },
        'projects-list': { type: 'projects-list', title: 'Projects' },
        'tdf-list': { type: 'tdf-list', title: 'TDFs' },
      }
      const info = parentTypes[tabId]
      if (info) {
        setTabs(prev => [
          ...prev.map(t => ({ ...t, isActive: false })),
          { id: tabId, title: info.title, type: info.type, isActive: true }
        ])
        setActiveTabId(tabId)
        return
      }
    }
    setTabs(currentTabs => currentTabs.map(tab => ({ ...tab, isActive: tab.id === tabId })))
    setActiveTabId(tabId)
  }

  const handleTabClose = (tabId: string) => {
    if (tabId === 'dashboard') return // Can't close dashboard tab

    // Clean up empty notes when closing a note tab
    const closingTab = tabs.find(t => t.id === tabId)
    if (closingTab?.type === 'note' && closingTab.data?.id && user) {
      const noteTableMap: Record<string, string> = {
        asset: 'asset_notes',
        portfolio: 'portfolio_notes',
        theme: 'theme_notes',
      }
      const entityType = closingTab.data.entityType || 'asset'
      const tableName = noteTableMap[entityType]
      if (tableName) {
        // Fire-and-forget: check if note is empty and soft-delete it
        supabase
          .from(tableName)
          .select('id, title, content')
          .eq('id', closingTab.data.id)
          .eq('created_by', user.id)
          .single()
          .then(({ data: note }) => {
            if (!note) return
            const titleEmpty = !note.title || note.title === 'Untitled'
            const contentEmpty = !note.content || !note.content.replace(/<[^>]*>/g, '').trim()
            if (titleEmpty && contentEmpty) {
              supabase
                .from(tableName)
                .update({ is_deleted: true, updated_by: user.id, updated_at: new Date().toISOString() })
                .eq('id', note.id)
                .then(() => {
                  queryClient.invalidateQueries({ queryKey: ['all-notes-with-users'] })
                  queryClient.invalidateQueries({ queryKey: ['recent-notes'] })
                })
            }
          })
      }
    }

    // Remove the tab's stored state
    TabStateManager.removeTabState(tabId, user?.id, currentOrgId ?? undefined)

    // Use functional update to handle multiple closes in succession
    setTabs(currentTabs => {
      const tabIndex = currentTabs.findIndex(tab => tab.id === tabId)
      const newTabs = currentTabs.filter(tab => tab.id !== tabId)

      // If closing active tab, switch to dashboard or previous tab
      if (activeTabId === tabId) {
        const newActiveTab = newTabs.length > 0 ? newTabs[Math.max(0, tabIndex - 1)] : newTabs[0]
        if (newActiveTab) {
          setActiveTabId(newActiveTab.id)
          return newTabs.map(tab => ({ ...tab, isActive: tab.id === newActiveTab.id }))
        }
      }
      return newTabs
    })
  }

  /*
    Phones cap the open tab set.

    The nav drawer lists the five most recent, so without this the sixth tab and
    beyond stay open, holding their queries and their editor state, while being
    invisible and unreachable from the drawer. Closing them keeps what is listed
    and what exists in agreement.

    Routed through handleTabClose rather than setTabs so the empty-note cleanup
    and active-tab reassignment it owns still run. The active tab is exempt so a
    tab cannot be closed out from under the person looking at it.

    ── The home tab is exempt, and had to be told so twice ──────────────────
    The exemption named `'dashboard'`, which was the home id when this was
    written. The canonical home is `today`, so the home tab was closable — and
    because it is the FIRST tab of a session it sits at the front of `tabs`,
    which is exactly where `slice(0, …)` takes from. So opening a sixth tab
    closed the home tab first, and the drawer's Home section, which rendered
    only when that tab existed, vanished with it.

    Both ids are exempt now: the canonical one, and the legacy one for a
    restored session that still carries it.
  */
  const MOBILE_TAB_LIMIT = 5
  const HOME_TAB_IDS = new Set<string>([CANONICAL_HOME_TAB.id, LEGACY_DASHBOARD_ID])
  useEffect(() => {
    if (!isMobile) return
    const closable = tabs.filter(t => !HOME_TAB_IDS.has(t.id) && !t.isBlank)
    if (closable.length <= MOBILE_TAB_LIMIT) return
    const excess = closable.slice(0, closable.length - MOBILE_TAB_LIMIT)
    for (const tab of excess) {
      if (tab.id === activeTabId) continue
      handleTabClose(tab.id)
    }
  }, [isMobile, tabs, activeTabId])


  const handleCloseTabs = (tabIds: string[]) => {
    const idsToClose = new Set(tabIds.filter(id => id !== 'dashboard'))
    if (idsToClose.size === 0) return

    // Per-tab cleanup (note cleanup, state removal)
    for (const tabId of idsToClose) {
      const closingTab = tabs.find(t => t.id === tabId)
      if (closingTab?.type === 'note' && closingTab.data?.id && user) {
        const noteTableMap: Record<string, string> = {
          asset: 'asset_notes',
          portfolio: 'portfolio_notes',
          theme: 'theme_notes',
        }
        const entityType = closingTab.data.entityType || 'asset'
        const tableName = noteTableMap[entityType]
        if (tableName) {
          supabase
            .from(tableName)
            .select('id, title, content')
            .eq('id', closingTab.data.id)
            .eq('created_by', user.id)
            .single()
            .then(({ data: note }) => {
              if (!note) return
              const titleEmpty = !note.title || note.title === 'Untitled'
              const contentEmpty = !note.content || !note.content.replace(/<[^>]*>/g, '').trim()
              if (titleEmpty && contentEmpty) {
                supabase
                  .from(tableName)
                  .update({ is_deleted: true, updated_by: user.id, updated_at: new Date().toISOString() })
                  .eq('id', note.id)
                  .then(() => {
                    queryClient.invalidateQueries({ queryKey: ['all-notes-with-users'] })
                    queryClient.invalidateQueries({ queryKey: ['recent-notes'] })
                  })
              }
            })
        }
      }
      TabStateManager.removeTabState(tabId, user?.id, currentOrgId ?? undefined)
    }

    // Single state update to remove all tabs at once
    setTabs(currentTabs => {
      const newTabs = currentTabs.filter(tab => !idsToClose.has(tab.id))
      const activeStillExists = newTabs.some(tab => tab.id === activeTabId)
      if (!activeStillExists) {
        const fallback = newTabs.find(t => t.id === 'dashboard') || newTabs[0]
        if (fallback) {
          setActiveTabId(fallback.id)
          return newTabs.map(tab => ({ ...tab, isActive: tab.id === fallback.id }))
        }
      }
      return newTabs
    })
  }

  const handleNewTab = () => {
    // Pilot "+" opens a scoped picker (Trade Lab / Idea Pipeline /
    // Trade Book / Outcomes) instead of a blank tab. Non-pilots get
    // the default blank tab behaviour below.
    if (pilotMode.effectiveIsPilot) {
      setPilotNewTabPickerOpen(true)
      return
    }
    const newTabId = `blank-${Date.now()}`
    const newTab: Tab = {
      id: newTabId,
      title: 'New Tab',
      type: 'dashboard',
      isActive: false,
      isBlank: true
    }
    const updatedTabs = tabs.map(tab => ({ ...tab, isActive: false }))
    updatedTabs.push({ ...newTab, isActive: true })
    setTabs(updatedTabs)
    setActiveTabId(newTabId)
  }

  // Pilot-scoped tab picker state — shown when a pilot clicks "+".
  const [pilotNewTabPickerOpen, setPilotNewTabPickerOpen] = useState(false)

  const handleTabReorder = (fromIndex: number, toIndex: number) => {
    // TabManager's indices reference the `visibleTabs` subset. In pilot mode
    // (or any other filter) visibleTabs ⊊ tabs, so we must translate to the
    // full-tabs indices before arrayMove — otherwise we'd move hidden tabs
    // that the user can't see.
    const fromVisible = visibleTabs[fromIndex]
    const toVisible = visibleTabs[toIndex]
    if (!fromVisible || !toVisible) return
    const fromFull = tabs.findIndex(t => t.id === fromVisible.id)
    const toFull = tabs.findIndex(t => t.id === toVisible.id)
    if (fromFull === -1 || toFull === -1 || fromFull === toFull) return
    setTabs(arrayMove(tabs, fromFull, toFull))
  }

  const handleTabsReorder = (newVisibleTabs: Tab[]) => {
    // newVisibleTabs is the reordered visible subset from TabManager. Splice
    // it back into the full tabs array, preserving hidden tabs in their
    // original positions. Without this, pilot mode would drop hidden tabs
    // (e.g. Dashboard) on any group drag.
    const visibleIds = new Set(visibleTabs.map(t => t.id))
    const iter = [...newVisibleTabs]
    const merged: Tab[] = []
    for (const tab of tabs) {
      if (visibleIds.has(tab.id)) {
        const next = iter.shift()
        if (next) merged.push(next)
      } else {
        merged.push(tab)
      }
    }
    setTabs(merged)
  }

  const handleFocusSearch = () => {
    // Focus search functionality would be implemented here
  }

  // Listen for custom event to open Trade Lab with specific portfolio
  useEffect(() => {
    const handleOpenTradeLab = (event: CustomEvent) => {
      const { labId, labName, portfolioId, tradeQueueItemId } = event.detail || {}
      // Navigate to trade-lab tab with the portfolio/lab ID
      // Always use "Trade Lab" as the tab title for consistency
      navigateRef.current({
        id: labId || 'trade-lab',
        title: 'Trade Lab',
        type: 'trade-lab',
        // The idea is carried only when a caller named one, so every existing
        // dispatch produces exactly the tab data it did before.
        data: { id: labId, portfolioId, ...(tradeQueueItemId ? { tradeQueueItemId } : {}) }
      })
      // Tell a cancelable dispatch that the navigation happened. A no-op for
      // the non-cancelable ones. See `lib/trade-lab/open-trade-lab`.
      event.preventDefault()
    }

    window.addEventListener('openTradeLab', handleOpenTradeLab as EventListener)
    return () => window.removeEventListener('openTradeLab', handleOpenTradeLab as EventListener)
  }, [])

  // Listen for custom event to open a portfolio tab
  useEffect(() => {
    const handleOpenPortfolio = (event: CustomEvent) => {
      const { id, name } = event.detail || {}
      if (!id) return
      navigateRef.current({
        id,
        title: name || 'Portfolio',
        type: 'portfolio',
        data: { id, name },
      })
    }
    window.addEventListener('open-portfolio', handleOpenPortfolio as EventListener)
    return () => window.removeEventListener('open-portfolio', handleOpenPortfolio as EventListener)
  }, [])

  // Listen for a request to open the "all portfolios" list tab.
  useEffect(() => {
    const handleOpenPortfoliosList = () => {
      handleTabChange('portfolios-list')
    }
    window.addEventListener('open-portfolios-list', handleOpenPortfoliosList as EventListener)
    return () => window.removeEventListener('open-portfolios-list', handleOpenPortfoliosList as EventListener)
    // handleTabChange is stable enough for this simple navigation bridge
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen for custom event to open a shared simulation
  useEffect(() => {
    const handleOpenSharedSimulation = (event: CustomEvent) => {
      const { share } = event.detail || {}
      if (!share) return
      navigateRef.current({
        id: `shared-${share.share_id}`,
        title: `Shared: ${share.name}`,
        type: 'trade-lab',
        data: { shareId: share.share_id }
      })
    }
    window.addEventListener('open-shared-simulation', handleOpenSharedSimulation as EventListener)
    return () => window.removeEventListener('open-shared-simulation', handleOpenSharedSimulation as EventListener)
  }, [])

  // Listen for programmatic tab close requests (e.g., after deleting the object the tab represents)
  useEffect(() => {
    const handleCloseTab = (event: CustomEvent) => {
      const { tabId } = event.detail || {}
      if (tabId) handleTabClose(tabId)
    }
    window.addEventListener('close-tab', handleCloseTab as EventListener)
    return () => window.removeEventListener('close-tab', handleCloseTab as EventListener)
  }, [])

  // Listen for custom event to open Ideas tab with filters (e.g., from "View all" in sidebar)
  useEffect(() => {
    const handleOpenIdeasTab = (event: CustomEvent) => {
      /*
       * The filters go no further.
       *
       * They were `IdeasInitialFilters` — the retired generator's scope, view,
       * time range and sort — and the standalone app has no counterpart for
       * any of them. Translating them into something that looks equivalent
       * would put the reader in a state they never chose, so the event now
       * carries only what still means something: open Ideas.
       */
      navigateRef.current({ id: 'ideas', title: 'Ideas', type: 'ideas', data: null })
    }

    window.addEventListener('openIdeasTab', handleOpenIdeasTab as EventListener)
    return () => window.removeEventListener('openIdeasTab', handleOpenIdeasTab as EventListener)
  }, [])

  // Listen for custom event to navigate to an asset (e.g., from coverage matrix)
  useEffect(() => {
    const handleNavigateToAsset = (event: CustomEvent) => {
      navigateRef.current(event.detail)
    }
    window.addEventListener('navigate-to-asset', handleNavigateToAsset as EventListener)
    return () => window.removeEventListener('navigate-to-asset', handleNavigateToAsset as EventListener)
  }, [])

  // Listen for custom event to navigate to a project (e.g., from theme → related projects)
  useEffect(() => {
    const handleNavigateToProject = async (event: CustomEvent) => {
      const { projectId } = event.detail || {}
      if (!projectId) return
      const { data: project } = await supabase
        .from('projects')
        .select('id, name')
        .eq('id', projectId)
        .maybeSingle()
      navigateRef.current({
        id: projectId,
        title: project?.name || 'Project',
        type: 'project',
        data: project ?? { id: projectId },
      })
    }
    window.addEventListener('navigate-to-project', handleNavigateToProject as EventListener)
    return () => window.removeEventListener('navigate-to-project', handleNavigateToProject as EventListener)
  }, [])

  /*
    Open a list or a theme the reader just filed something into.

    The mobile capture sheet confirms with a toast carrying "View list" /
    "View theme", and it cannot reach `handleSearchResult` — it is rendered
    deep inside MobileDashboard, which this lane does not touch. The event is
    the seam the surrounding code already uses for exactly this, alongside
    `navigate-to-asset` and `navigate-to-project` above.

    The name travels with the event, so the tab opens titled correctly without
    a round trip; the id alone would show "List" until a fetch landed.
  */
  useEffect(() => {
    const openFiled = (type: 'list' | 'theme') => (event: Event) => {
      const { id, name } = (event as CustomEvent).detail || {}
      if (!id) return
      navigateRef.current({
        id,
        title: name || (type === 'list' ? 'List' : 'Theme'),
        type,
        data: { id, name },
      })
    }
    const onList = openFiled('list')
    const onTheme = openFiled('theme')
    window.addEventListener('navigate-to-list', onList)
    window.addEventListener('navigate-to-theme', onTheme)
    return () => {
      window.removeEventListener('navigate-to-list', onList)
      window.removeEventListener('navigate-to-theme', onTheme)
    }
  }, [])

  // Listen for custom event to open Trade Queue (e.g., from toast action after creating trade idea)
  useEffect(() => {
    const handleOpenTradeQueue = (event: CustomEvent) => {
      const { selectedTradeId, openDecisionDrawer } = event.detail || {}

      navigateRef.current({
        id: 'trade-queue',
        title: 'Idea Pipeline',
        type: 'trade-queue',
        data: { selectedTradeId, openDecisionDrawer }
      })
    }

    window.addEventListener('openTradeQueue', handleOpenTradeQueue as EventListener)
    return () => window.removeEventListener('openTradeQueue', handleOpenTradeQueue as EventListener)
  }, [])

  // Memoize active tab to prevent unnecessary recalculations
  const activeTab = useMemo(() =>
    tabs.find(tab => tab.id === activeTabId),
    [tabs, activeTabId]
  )

  const renderTabContent = () => {
    if (!activeTab) {
      return renderDashboardContent()
    }

    if (activeTab.isBlank) {
      return <BlankTab onSearchResult={handleSearchResult} />
    }

    // A restored or deep-linked Dashboard lens tab is the pilot home until the
    // pilot graduates. See `dashboardTabTypeForRender`.
    const tabType = dashboardTabTypeForRender(activeTab.type, pilotMode.effectiveIsPilot, CANONICAL_HOME_TAB.type)

    // Surfaces with no phone treatment get an honest explanation rather than a
    // desktop layout crushed into 390px. What is and isn't supported lives in
    // lib/mobile/mobile-surfaces.ts — unregistered types default to desktop-only.
    if (isMobile && isDesktopOnly(tabType)) {
      return (
        <DesktopOnlyCard
          type={activeTab.type}
          title={activeTab.title}
          onOpenSurface={handleSearchResult}
        />
      )
    }

    // Pilot mode substitution: render read-only preview components for
    // 'preview' surfaces, instead of the full operational page. Uses the
    // cache-aware `effectiveIsPilot` so a cold refresh doesn't flash the
    // full operational Trade Book / Outcomes before pilot detection resolves.
    if (pilotMode.effectiveIsPilot) {
      const feature = TAB_TYPE_TO_PILOT_FEATURE[activeTab.type]
      if (feature && pilotMode.accessFor(feature) === 'preview') {
        // Cold-load guard: when the access decision isn't trustworthy
        // yet (queries pending, no localStorage cache to fall back on)
        // we'd otherwise default to 'preview' and flash the locked
        // teaser before the queries land and reveal the user actually
        // has full access. Render an empty container until the decision
        // resolves — a brief blank is less jarring than the locked-then-
        // unlocked flicker.
        if (!pilotMode.accessIsReady) {
          return <div className="h-full w-full" aria-busy="true" />
        }
        if (activeTab.type === 'trade-book') return <PilotTradeBookPreview onGoToTradeLab={openPilotTradeLab} />
        if (activeTab.type === 'outcomes')   return <PilotOutcomesPreview onGoToTradeLab={openPilotTradeLab} />
      }
    }

    // Both home types render the phone ideas feed.
    //
    // `dashboard` is the legacy home; `today` is the canonical one the default
    // session and `/dashboard` land on. Only the legacy type was routed here,
    // so on a phone the canonical home fell through to the desktop-only guard
    // above and served a "Dashboard is desktop only" card instead of the feed.
    //
    // Desktop is deliberately untouched: `today` still falls through to the
    // `case 'today'` DashboardShell below.
    if (activeTab.type === 'dashboard' || (isMobile && tabType === 'today')) {
      return renderDashboardContent()
    }

    switch (tabType) {
      case 'asset':
        if (!activeTab.data) return <AssetLoadingState />
        // Phones get a purpose-built asset page. AssetTab is 4,300 lines of
        // four sub-pages, view filters and analyst panels built for a wide
        // screen; see MobileAssetPage.
        if (isMobile) return <MobileAssetPage asset={activeTab.data} onNavigate={handleSearchResult} />
        // AssetTab is the canonical deep asset workspace, and stays that way.
        //
        // Stage 2D2 briefly made a new, reduced workspace the default here.
        // That was the wrong call: the convergence goal was to stop Research
        // and Portfolio growing DUPLICATE deep surfaces, not to replace the
        // page that already holds workflow, lists, estimates, consensus,
        // projects and activity. Those lenses now route here (carrying focus,
        // book and issue in tab data); the replacement workspace is parked.
        return <AssetTab asset={activeTab.data} onNavigate={handleSearchResult} />
      case 'assets-list':
        return <AssetsListPage onAssetSelect={handleSearchResult} />
      case 'portfolios-list':
        return <PortfoliosListPage onPortfolioSelect={handleSearchResult} />
      case 'themes-list':
        return <ThemesListPage onThemeSelect={handleSearchResult} />
      case 'notes-list':
        return <NotesListPage onNoteSelect={handleSearchResult} />
      case 'lists':
        return <ListsPage onListSelect={handleSearchResult} />
      case 'list':
        return <ListTab list={activeTab.data} onAssetSelect={handleSearchResult} />
      case 'workflows':
        return <WorkflowsPage onNavigate={handleSearchResult} />
      case 'projects-list':
        return <ProjectsPage onProjectSelect={handleSearchResult} />
      case 'project':
        return activeTab.data ? <ProjectDetailTab project={activeTab.data} onNavigate={handleSearchResult} /> : <div>Loading project...</div>
      case 'trade-queue':
        // The desktop board moves cards with native HTML5 drag, which never
        // fires on touch — the kanban is inert on a phone, not just cramped.
        // MobilePipeline shows one stage at a time and makes moving explicit.
        return isMobile ? (
          <MobilePipeline
            focusIdeaId={activeTab.data?.focusIdeaId ?? activeTab.data?.selectedTradeId ?? null}
            onFocusConsumed={() => setTabs(prev => prev.map(t => {
              if (t.type !== 'trade-queue') return t
              if (!t.data?.focusIdeaId && !t.data?.selectedTradeId) return t
              const data = { ...t.data }
              delete data.focusIdeaId
              delete data.selectedTradeId
              return { ...t, data }
            }))}
          />
        ) : (
          <TradeQueuePage
            /* Two payload names, one meaning: bring this card into view.
               `focusIdeaId` is the pilot mission's; `selectedTradeId` is what
               the dashboard attention items, the asset strips, the prioritiser
               and the decision engine have always sent -- about eleven
               producers, none of which this page read. They are coalesced here
               rather than given a second mechanism, because the scroll, the
               flash and the one-shot consume are already correct. */
            focusIdeaId={activeTab.data?.focusIdeaId ?? activeTab.data?.selectedTradeId ?? null}
            /* One arrival, one scroll — the rule the Outcomes focus and the
               Trade Book highlight both follow. */
            onFocusConsumed={() => setTabs(prev => prev.map(t => {
              if (t.type !== 'trade-queue') return t
              if (!t.data?.focusIdeaId && !t.data?.selectedTradeId) return t
              // Both spellings, or the one that was not cleared would win on
              // the next visit and re-scroll to the same card forever.
              const data = { ...t.data }
              delete data.focusIdeaId
              delete data.selectedTradeId
              return { ...t, data }
            }))}
            /* Read as a payload rather than raced as an event — the dispatch
               happens on the click that opens this tab, so a listener inside
               it registers too late. */
            openDecisionDrawer={!!activeTab.data?.openDecisionDrawer}
            onDrawerConsumed={() => setTabs(prev => prev.map(t => {
              if (t.type !== 'trade-queue' || !t.data?.openDecisionDrawer) return t
              const data = { ...t.data }
              delete data.openDecisionDrawer
              return { ...t, data }
            }))}
          />
        )
      case 'trade-lab':
        return <SimulationPage simulationId={activeTab.data?.id} tabId={activeTab.id} initialPortfolioId={activeTab.data?.portfolioId} shareId={activeTab.data?.shareId} />
      case 'trade-book':
        return (
          <TradeBookPage
            initialPortfolioId={activeTab.data?.portfolioId}
            highlightTradeIds={activeTab.data?.highlightTradeIds}
            highlightBatchId={activeTab.data?.highlightBatchId}
            /* One arrival, one highlight — the same rule Outcomes' focus id
               follows. The ids otherwise stay on the tab and in its persisted
               state, so every later visit re-opened whichever batch the
               Decision Recorded modal last handed over. */
            onHighlightConsumed={() => setTabs(prev => prev.map(t => {
              if (t.type !== 'trade-book') return t
              if (!t.data?.highlightTradeIds && !t.data?.highlightBatchId) return t
              const data = { ...t.data }
              delete data.highlightTradeIds
              delete data.highlightBatchId
              return { ...t, data }
            }))}
          />
        )
      case 'asset-allocation':
        return <AssetAllocationPage />
      case 'tdf-list':
        return <TDFListPage onTDFSelect={(tdf) => handleSearchResult({
          id: tdf.id,
          title: tdf.name,
          type: 'tdf',
          data: tdf
        })} />
      case 'tdf':
        return activeTab.data ? <TDFTab tdf={activeTab.data} onNavigate={handleSearchResult} /> : <div>Loading TDF...</div>
      case 'allocation-period':
        return <AssetAllocationPage initialPeriodId={activeTab.data?.id} />
      case 'note': {
        // Handle notes from different sources: asset, portfolio, theme
        const entityType = activeTab.data?.entityType || 'asset' // Default to asset for backwards compatibility
        // Use data.id for the selected note. Only fall back to activeTab.id if it looks like a UUID
        // (not a synthetic tab ID like "notes-{assetId}", "note-{entityType}-{entityId}", or "research-...").
        // The 'note-' prefix matters: NotesListPage groups all notes for the same entity under
        // a single synthetic tab ID — passing that string as a UUID 400s the content query and
        // leaves the editor stuck on its loading spinner.
        const rawNoteId = activeTab.data?.isNew ? undefined : activeTab.data?.id
        const noteId = rawNoteId || (
          activeTab.id
          && !activeTab.id.startsWith('notes-')
          && !activeTab.id.startsWith('note-')
          && !activeTab.id.startsWith('research-')
          ? activeTab.id : undefined
        )

        const handleNoteSelect = (newNoteId: string) => {
          // Update the tab's data.id to the new note (but keep the stable tab ID)
          if (newNoteId && newNoteId !== activeTab.data?.id) {
            setTabs(prev => prev.map(tab =>
              tab.id === activeTab.id
                ? { ...tab, data: { ...tab.data, id: newNoteId, isNew: false } }
                : tab
            ))
          }
        }

        // Render the appropriate editor based on entity type
        if (entityType === 'portfolio') {
          const portfolioId = activeTab.data?.portfolioId || activeTab.data?.entityId
          const portfolioName = activeTab.data?.portfolioName || activeTab.data?.entityName || 'Portfolio'
          return portfolioId ? (
            <PortfolioNoteEditor
              portfolioId={portfolioId}
              portfolioName={portfolioName}
              selectedNoteId={noteId}
              onNoteSelect={handleNoteSelect}
            />
          ) : <div className="p-4 text-gray-500 dark:text-gray-400">Portfolio note data not available</div>
        }

        if (entityType === 'theme') {
          const themeId = activeTab.data?.themeId || activeTab.data?.entityId
          const themeName = activeTab.data?.themeName || activeTab.data?.entityName || 'Theme'
          return themeId ? (
            <ThemeNoteEditor
              themeId={themeId}
              themeName={themeName}
              selectedNoteId={noteId}
              onNoteSelect={handleNoteSelect}
            />
          ) : <div className="p-4 text-gray-500 dark:text-gray-400">Theme note data not available</div>
        }

        // Default: asset notes (handle both formats from AssetTab and search)
        const noteAssetId = activeTab.data?.assetId || activeTab.data?.asset_id || activeTab.data?.entityId
        const noteAssetSymbol = activeTab.data?.assetSymbol || activeTab.data?.assets?.symbol || activeTab.data?.entityName || 'Note'

        return noteAssetId ? (
          <NoteEditor
            assetId={noteAssetId}
            assetSymbol={noteAssetSymbol}
            selectedNoteId={noteId}
            onNoteSelect={handleNoteSelect}
          />
        ) : <div className="p-4 text-gray-500 dark:text-gray-400">Note data not available</div>
      }
      case 'theme':
        return <ThemeTab theme={activeTab.data} />
      case 'portfolio':
        return <PortfolioTab portfolio={activeTab.data} onNavigate={handleSearchResult} />
      case 'calendar':
        return <CalendarPage onItemSelect={handleSearchResult} />
      /*
        The Dashboard, and its five lenses.

        Today, Ideas, Research, Portfolio and Decisions are five questions
        about one investment process, not five applications. They share one
        shell with a lens bar; each keeps its own composition.

        The four v2 tab types are NOT removed. A session saved before this
        change still holds `ideas-v2` / `research-v2` / `portfolio-v2` /
        `decisions-v2` tabs, and each now mounts the same shell on its own
        lens -- so those sessions open exactly where they left off and simply
        gain the lens bar. No migration runs, nothing is rewritten on load,
        and the irreversible collapse stays a separate decision.
      */
      case 'today':
        /*
         * Pilot onboarding LAYERS onto the canonical Dashboard.
         *
         * Both of these lived above the retired legacy workbench, and moving
         * them onto the pilot branch of `renderDashboardContent` put them
         * somewhere a pilot cannot reach: nothing creates a `dashboard` tab
         * any more, and a restored one is migrated to `today` before it
         * renders. So a desktop pilot had no Get Started checklist and no
         * first-session coverage prompt at all.
         *
         * The components and their persisted state are reused exactly as they
         * are — `FirstSessionCoveragePrompt` still owns its own latched
         * show/dismiss decision and `PilotWelcomeBanner` its own progress, so
         * a pilot who has finished or dismissed either still sees neither.
         *
         * Layered, not substituted: the shell below is the same element a
         * non-pilot gets, unchanged, and the lens content is untouched. The
         * point is that a pilot learns the real product with guidance on top
         * of it, rather than a separate surface that disappears later.
         */
        return pilotMode.effectiveIsPilot ? (
          /*
           * An incomplete pilot gets the first run INSTEAD of the Dashboard,
           * not on top of it.
           *
           * Layering the mission above the lens shell defeated the point: the
           * lens bar and a full analytics surface sat under the guidance, so
           * the reader was offered five ordered steps and a whole product at
           * once. It also mounted every lens query for somebody who cannot
           * use the answers yet — which is why this is a branch and not
           * `hidden`. Nothing behind it is rendered, so nothing behind it is
           * fetched.
           *
           * The tab is still `today` and still the home. What changes is what
           * is inside it.
           */
          <div className="h-full overflow-y-auto">
            {/* Wider than the Dashboard's reading column because the coverage
                card is the whole screen here, and the same width holds after
                the mission appears so nothing reflows on save. */}
            <div className="mx-auto w-full max-w-4xl space-y-2.5 p-4">
              {/*
                Setup precedes the mission, and then gets out of its way.

                These two rendered together, so a pilot's first screen asked
                two unrelated things at once — tell us what you follow, and
                also capture an investment idea. Coverage is what makes the
                mission's destinations worth visiting, so it goes first and
                alone; the mission appears the moment coverage is saved.
                Sequence, not a sixth step — nothing about the five steps or
                about graduation changes. `usePilotEntry` decides.

                Afterwards the full card does NOT stay. A search box, a
                suggestion list and a save button for a question already
                answered was the largest thing on a screen whose subject is
                the mission. One line says what they follow and opens the
                Coverage app, which is reachable for them now.
              */}
              {/* The coverage read decides which of the two below this is.
                  Holding the room keeps the swap from moving the page. */}
              {pilotEntry.stage === 'loading' && <PilotHomeSkeleton />}
              {pilotEntry.stage === 'coverage' && (
                <FirstSessionCoveragePrompt
                  variant="page"
                  dismissible={false}
                  /* The mission appearing IS the confirmation here. */
                  confirmOnSave={false}
                />
              )}
              {pilotEntry.stage === 'mission' && (
                <>
                  <PilotWelcomeBanner onNavigate={handleSearchResult} />
                  <CoverageSummaryBanner
                    onOpen={() => handleSearchResult({
                      id: 'coverage', title: 'Coverage', type: 'coverage',
                      data: { initialView: 'active' },
                    })}
                  />
                </>
              )}
            </div>
          </div>
        ) : (
          /*
           * Everyone else, including a graduated pilot. `effectiveIsPilot` is
           * already `hasGraduated ? false : isPilot`, and completing the five
           * steps writes `graduated` through an optimistic mutation — so the
           * full Dashboard appears on the same tick the mission finishes, with
           * no reload.
           */
          <DashboardShell initialLens="today" />
        )
      /*
       * Ideas — the standalone application.
       *
       * A phone already HAS the Ideas experience this app exists to bring to
       * desktop: `renderDashboardContent()` returns MobileDashboard, which is
       * the feed the whole convergence is modelled on. So `ideas` resolves
       * there on a phone rather than mounting a desktop shell at 390px, which
       * is the same thing `dashboard` and `today` already do.
       */
      /*
       * `idea-generator` is a COMPATIBILITY tab type, not an application.
       *
       * It WAS the standalone desktop ideas app, so the standalone ideas app
       * is what it meant, and it falls through to exactly the canonical
       * render below — the smallest alias there is. Both the navigation
       * funnel and the session restore rewrite it before it reaches here, so
       * this arm should be unreachable in practice; it exists so a descriptor
       * from a route nobody has thought of still lands somewhere real rather
       * than on the blank default.
       */
      case 'idea-generator':
      case 'ideas':
        return isMobile ? renderDashboardContent() : <IdeasApp selectedIdeaId={activeTab.data?.selectedIdeaId ?? null} />
      /*
       * `ideas-v2` is a COMPATIBILITY tab type now, not an application. Its
       * launcher entry is gone, but saved sessions and deep links still carry
       * it and it still means what it always meant: the Dashboard's Ideas
       * lens. Deliberately NOT aliased to the standalone app — that state
       * represented a lens, and silently reinterpreting it as a different
       * application would move readers somewhere they never chose.
       */
      case 'ideas-v2':
        return (
          <DashboardShell
            initialLens="ideas"
            selectedIdeaId={activeTab.data?.selectedIdeaId ?? null}
            focus={activeTab.data?.focus ?? null}
            issue={activeTab.data?.issue ?? null}
            /* One arrival, one opening — and the id leaves the tab, so the AI
               subject chip cannot stay bound to it weeks later. */
            onFocusConsumed={() => setTabs(prev => prev.map(t => {
              if (t.type !== 'ideas-v2' || !t.data?.selectedIdeaId) return t
              const data = { ...t.data }
              delete data.selectedIdeaId
              delete data.focus
              delete data.issue
              return { ...t, data }
            }))}
          />
        )
      case 'research-v2':
        return (
          <DashboardShell
            initialLens="research"
            selectedAssetId={activeTab.data?.selectedAssetId ?? null}
            issue={activeTab.data?.issue ?? null}
            origin={activeTab.data?.origin ?? null}
            onFocusConsumed={() => setTabs(prev => prev.map(t => {
              if (t.type !== 'research-v2' || !t.data?.selectedAssetId) return t
              const data = { ...t.data }
              delete data.selectedAssetId
              delete data.issue
              delete data.origin
              return { ...t, data }
            }))}
          />
        )
      case 'portfolio-v2':
        return (
          <DashboardShell
            initialLens="portfolio"
            selectedPortfolioId={activeTab.data?.selectedPortfolioId ?? null}
            selectedAssetId={activeTab.data?.selectedAssetId ?? null}
          />
        )
      case 'decisions-v2':
        return (
          <DashboardShell
            initialLens="decisions"
            selectedPortfolioId={activeTab.data?.selectedPortfolioId ?? null}
            selectedDecisionId={activeTab.data?.selectedDecisionId ?? null}
          />
        )
      case 'coverage':
        // The matrix genuinely has no phone layout — a grid whose axes are both
        // unbounded cannot be shown honestly at 390px. But the matrix is a
        // presentation, not the question: who owns this name, what does this
        // person own, what does nobody own. Those are three lists.
        return isMobile
          ? <MobileCoverage onAssetSelect={handleSearchResult} />
          : <CoveragePage initialView={activeTab.data?.initialView} />
      case 'organization':
        return <OrganizationPage onUserClick={(user) => handleSearchResult({
          id: user.id,
          title: user.full_name,
          type: 'user',
          data: user
        })} />
      case 'outcomes':
        return (
          <DecisionAccountabilityPage
            onItemSelect={handleSearchResult}
            /* Carried by the pilot mission's "Review outcome" so the decision
               being reviewed is the one on screen. Absent otherwise. */
            focusDecisionId={activeTab.data?.tradeQueueItemId ?? null}
            /* One arrival, one opening. The id otherwise stays on the tab
               (and in its persisted state) and reopens that decision on
               every return to Outcomes. */
            onFocusConsumed={() => setTabs(prev => prev.map(t => {
              if (t.type !== 'outcomes' || !t.data?.tradeQueueItemId) return t
              const data = { ...t.data }
              delete data.tradeQueueItemId
              return { ...t, data }
            }))}
          />
        )
      case 'files':
        return <FilesPage onItemSelect={handleSearchResult} />
      case 'charting':
        return <ChartingPage onItemSelect={handleSearchResult} initialSymbol={activeTab.data?.symbol} />
      case 'audit':
        return <AuditExplorerPage onNavigate={handleSearchResult} />
      case 'admin-console':
        return <AdminConsolePage />
      case 'user':
        /* A person opens as its own tab, and the tab strip is desktop-only —
           so on a phone this was a dead end. `handleTabClose` already closes
           the tab and activates the one before it, which is where the person
           was opened from, so Back is exactly that. */
        return activeTab.data ? (
          <UserTab
            user={activeTab.data}
            onNavigate={handleSearchResult}
            onBack={isMobile ? () => handleTabClose(activeTab.id) : undefined}
          />
        ) : <div>Loading user...</div>
      case 'templates':
        return <TemplatesTab />
      case 'workflow':
        // Individual workflow - navigate to workflows page focused on this workflow
        return <WorkflowsPage initialWorkflowId={activeTab.data?.id} initialBranchId={activeTab.data?.branchId} onNavigate={handleSearchResult} />
      case 'workflow-template':
        // Workflow template - navigate to workflows page to create from template
        return <WorkflowsPage initialTemplateId={activeTab.data?.id} onNavigate={handleSearchResult} />
      case 'notebook':
        // Custom notebook - open the notes editor for this notebook
        return activeTab.data ? (
          <NotesListPage
            onNoteSelect={handleSearchResult}
            initialNotebookId={activeTab.data.id}
          />
        ) : <div>Loading notebook...</div>
      case 'model-template':
        // Model template - go to templates tab focused on models
        return <TemplatesTab initialTab="models" initialTemplateId={activeTab.data?.id} />
      case 'model-file': {
        // A model file belongs to an asset, and the owning asset is where one
        // is actually readable: `ModelFilesViewer` renders it inside the
        // asset's estimates section, off `model_files`.
        //
        // The phone branch used to send this to Files instead, on the reading
        // that Files was "the same content on a surface that already has a
        // mobile treatment". Files has no data source at all — no `files`
        // table exists anywhere — so every model a phone found in search
        // dead-ended on an empty state. It also passed `initialFileId`, a
        // prop FilesPage does not accept and silently dropped.
        //
        // Both viewports now go to the owning asset through the shell the
        // `asset` case already uses: MobileAssetPage on a phone, AssetTab on
        // a desktop, where `initialSection` opens the models section.
        //
        // `model_files.asset_id` is NOT NULL, so a search result always
        // carries the identity this needs; the guard is for a tab restored
        // from an older shape.
        const modelAssetId = activeTab.data?.assetId
        if (!modelAssetId) return <AssetLoadingState />
        const modelAsset = {
          id: modelAssetId,
          // `useObjectSearch` spreads the search row flat, so the symbol is on
          // `data` — this previously read `data.assets.symbol`, which never
          // existed, and handed AssetTab an undefined symbol every time.
          symbol: activeTab.data?.symbol ?? activeTab.data?.assets?.symbol ?? '',
          company_name: activeTab.data?.company_name ?? null,
        }
        return isMobile
          ? <MobileAssetPage asset={modelAsset} onNavigate={handleSearchResult} />
          : <AssetTab asset={modelAsset} onNavigate={handleSearchResult} initialSection="models" />
      }
      case 'text-template':
        // Text template - go to templates tab
        return <TemplatesTab initialTab="text" initialTemplateId={activeTab.data?.id} />
      case 'team':
        // Team - go to organization page with access view filtered by team
        return <OrganizationPage
          initialTab="access"
          initialAccessSubTab="manage"
          initialAccessFilter={{ teamNodeId: activeTab.data?.id }}
          onUserClick={(user) => handleSearchResult({
            id: user.id,
            title: user.full_name,
            type: 'user',
            data: user
          })}
        />
      case 'calendar-event':
        // Calendar event - open calendar focused on this event
        return <CalendarPage onItemSelect={handleSearchResult} initialEventId={activeTab.data?.id} />
      case 'capture':
        // Capture - navigate to the entity it belongs to, or show in context
        if (activeTab.data?.entity_type && activeTab.data?.entity_id) {
          // Navigate to the parent entity
          handleSearchResult({
            id: activeTab.data.entity_id,
            title: activeTab.data.entity_display || 'Entity',
            type: activeTab.data.entity_type,
            data: { id: activeTab.data.entity_id, captureId: activeTab.data.id }
          })
          return <div>Navigating to capture context...</div>
        }
        return <FilesPage onItemSelect={handleSearchResult} />
      default:
        return renderDashboardContent()
    }
  }

  const handleOpenTradeQueue = (filter?: string) => {
    handleSearchResult({
      id: 'trade-queue',
      title: 'Idea Pipeline',
      type: 'trade-queue',
      data: filter ? { stageFilter: filter } : undefined,
    })
  }

  const renderDashboardContent = () => {
    // First-time login window: we don't yet know whether the user
    // is a pilot (no cached hint, real query in flight). Picking
    // either dashboard now would flash the other once the query
    // resolves. Render a neutral skeleton until pilot status is
    // known (cached or fresh).
    if (pilotMode.isInitialResolve) {
      return (
        <PageLoader loading text="Loading your workspace…" />
      )
    }

    // Phones get a purpose-built feed dashboard. The desktop surfaces are wide
    // multi-column workbenches; reflowed onto 390px they produce cramped cards
    // and horizontal overflow that breakpoints do not fix. See MobileDashboard.
    if (isMobile) {
      /*
       * An incomplete pilot gets the pilot home INSTEAD of the feed.
       *
       * Same rule as desktop and the same seam: `effectiveIsPilot` is already
       * `hasGraduated ? false : isPilot`, so the ordinary dashboard returns on
       * its own once the mission completes. Nothing of the feed renders
       * underneath, so none of it is fetched and none of its seeded sample
       * content competes with the one thing the reader is being asked to do.
       */
      if (pilotMode.effectiveIsPilot) {
        return <MobilePilotHome onNavigate={handleSearchResult} />
      }
      return (
        // No full-chart handler: Charting is desktop-only, so offering it here
        // just routes to a "desktop only" card. ReelsChartPanel hides its
        // expand affordance when no handler is supplied.
        <MobileDashboard onNavigate={handleSearchResult} />
      )
    }

    /*
     * There is no desktop surface left on this type, for anybody.
     *
     * The non-pilot workbench went first — a scope bar over a decision,
     * research or portfolio pane, replaced by the lens shell. The pilot action
     * dashboard followed it: three routing cards whose destinations the pilot
     * tab picker already offers, no access control of its own, no setup state,
     * no walkthrough and no telemetry. A pilot now learns the real Dashboard
     * with the mission module on it, which is the whole point.
     *
     * `today` rather than a blank: the callers of this function include the
     * no-active-tab and unknown-type fallbacks, and a fallback that renders
     * nothing is how a reader lands on an empty page after a bad deep link.
     */
    return <DashboardShell initialLens="today" />
  }

  // Hold a minimal loading state during an org switch until pilot detection
  // settles. Without this, the new org's tabs paint before pilot filtering
  // runs — a non-pilot→pilot switch would flash Dashboard before the pilot
  // route guard swaps to Trade Lab.
  //
  // Same treatment on a cold first mount: if we can't yet decide whether
  // this is a pilot session AND the active tab is one that would be hidden
  // for pilots (e.g. Dashboard), hold the loader. "Can't yet decide" means:
  //   - currentOrgId isn't resolved from the cached user yet, OR
  //   - the org-pilot-flags query is still in flight.
  // The second check alone wasn't enough — during the first render after a
  // reload `currentOrgId` is briefly null, which disables the pilot-flags
  // query (`enabled: !!currentOrgId`) and makes `isLoading` read as false.
  // Dashboard paints for that one frame, then the query wakes up and the
  // route guard swaps to Trade Lab — that was the visible flash.
  const activeTabForGate = tabs.find(t => t.id === activeTabId)
  const activeTabFeatureForGate = activeTabForGate ? TAB_TYPE_TO_PILOT_FEATURE[activeTabForGate.type] : null
  /*
   * The rule itself lives in `lib/pilot/tab-gate`, because it is a decision
   * with a failure mode — reading the static defaults where the resolved map
   * belonged held the Coverage tab on a loader forever — and a decision worth
   * a test is worth being a function.
   */
  const awaitingPilotDecision = shouldHoldForPilotDecision({
    orgKnown: !!currentOrgId,
    pilotLoading: pilotMode.isLoading,
    isPilot: pilotMode.effectiveIsPilot,
    hiddenByDefaults: activeTabFeatureForGate
      ? PILOT_ACCESS_DEFAULTS[activeTabFeatureForGate] === 'hidden'
      : false,
    hiddenForThisPilot: activeTabFeatureForGate
      ? pilotMode.accessFor(activeTabFeatureForGate) === 'hidden'
      : false,
  })

  // Boot-loader handoff. The persistent #tesseract-boot-loader paints
  // the cold-boot sequence (auth → org → pilot decision) without any
  // remount, so the rotation animation runs continuously instead of
  // resetting per gate. Once gates pass for the first time we mark
  // boot complete; subsequent in-session refetches that briefly flip
  // a gate back to "loading" do NOT re-show the boot loader (which
  // would feel like a full-screen reload). Only an explicit org
  // switch (`isOrgTransitioning`, set right before reload) re-paints
  // the loader because a reload IS imminent.
  const stillBlocking = isOrgTransitioning || awaitingPilotDecision
  const bootCompletedRef = useRef(false)
  useEffect(() => {
    if (!stillBlocking) {
      hideBootLoader()
      bootCompletedRef.current = true
      return
    }
    // Gate is blocking. Show boot loader only when it makes sense:
    //   - boot is still in its initial window (loader hasn't faded yet), OR
    //   - the user explicitly triggered an org switch
    if (!bootCompletedRef.current || isOrgTransitioning) {
      showBootLoader(isOrgTransitioning ? 'Switching workspace…' : 'Loading…')
    }
  }, [stillBlocking, isOrgTransitioning])

  // Gates still blocking. During the cold-boot window the boot loader
  // covers the screen; after first paint we render an in-flow spinner
  // so the rest of the app chrome stays visible (header, tabs).
  if (stillBlocking) {
    if (!bootCompletedRef.current || isOrgTransitioning) {
      return null
    }
    return (
      <PageLoader loading className="h-screen bg-gray-50 dark:bg-gray-900" />
    )
  }

  return (
    <>
    <Layout
      tabs={visibleTabs}
      activeTabId={activeTabId}
      onTabReorder={handleTabReorder}
      onTabsReorder={handleTabsReorder}
      onTabChange={handleTabChange}
      onTabClose={handleTabClose}
      onCloseTabs={handleCloseTabs}
      onNewTab={handleNewTab}
      onSearchResult={handleSearchResult}
      onFocusSearch={handleFocusSearch}
    >
      <>
        <Suspense fallback={<AssetLoadingState />}>
          {renderTabContent()}
        </Suspense>

        {/* New Trade Idea modal — shared across all tabs via decision-engine-action event */}
        <AddTradeIdeaModal
          isOpen={tradeIdeaModal.open}
          onClose={() => setTradeIdeaModal({ open: false })}
          onSuccess={() => {
            setTradeIdeaModal({ open: false })
            queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
          }}
          preselectedAssetId={tradeIdeaModal.assetId}
          preselectedPortfolioId={tradeIdeaModal.portfolioId}
        />
      </>
    </Layout>
    {/* FeedbackWidget moved into Header (next to search) so it
        doesn't float over the page. */}
    {pilotTeaser && (
      <PilotTeaserModal
        isOpen={!!pilotTeaser}
        featureLabel={pilotTeaser.featureLabel}
        reason={pilotTeaser.reason}
        onClose={() => setPilotTeaser(null)}
        onGoToTradeLab={openPilotTradeLab}
      />
    )}
    {/* Pilot graduation modal — global so it survives the tab
        navigation that step 3 of the Outcomes Get Started checklist
        triggers (Update Research opens the asset tab and unmounts
        Outcomes). Reads its trigger state from localStorage so it
        pops on the destination page, not the page being left. */}
    <PilotGraduationModal
      userId={user?.id}
      orgId={currentOrgId}
      onOpenDashboard={() => {
        // Graduating opens the Dashboard the product now means.
        window.dispatchEvent(new CustomEvent('decision-engine-action', {
          detail: { ...CANONICAL_HOME, data: null },
        }))
      }}
      onOpenAppLauncher={() => {
        window.dispatchEvent(new CustomEvent('open-app-launcher'))
      }}
    />
    {/* Pilot tab picker — scoped menu shown when a pilot clicks "+".
        Only exposes the four pilot surfaces; each item reuses the
        existing handleSearchResult routing so tab-open behaviour
        stays identical to any other nav path. */}
    {pilotNewTabPickerOpen && (
      <div
        className="fixed inset-0 z-[100] bg-black/30 flex items-start justify-center pt-24"
        onClick={() => setPilotNewTabPickerOpen(false)}
      >
        <div
          className="w-[360px] bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <div className="text-[13px] font-semibold text-gray-900 dark:text-white">Open a tab</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">Pilot surfaces available to your workspace.</div>
          </div>
          <div className="p-2 grid grid-cols-2 gap-1">
            {[
              { id: 'trade-queue', title: 'Idea Pipeline', color: 'text-amber-700 bg-amber-50 border-amber-200' },
              { id: 'trade-lab',   title: 'Trade Lab',     color: 'text-primary-700 bg-primary-50 border-primary-200' },
              { id: 'trade-book',  title: 'Trade Book',    color: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
              { id: 'outcomes',    title: 'Outcomes',      color: 'text-teal-700 bg-teal-50 border-teal-200' },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setPilotNewTabPickerOpen(false)
                  handleSearchResult({ id: t.id, title: t.title, type: t.id as any, data: null })
                }}
                className={`px-3 py-3 rounded-md border text-[12px] font-semibold transition-colors hover:brightness-95 ${t.color}`}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    )}
    </>
  )
}
