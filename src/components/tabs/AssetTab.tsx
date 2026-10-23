import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Target, FileText, Plus, Calendar, User, Users, Activity, ChevronDown, ChevronUp, AlertTriangle, Zap, Copy, Download, Trash2, ExternalLink, Sparkles, Star, History, Layers, Lock, Share2, Link2, File, X, Check, FileSpreadsheet, Globe, Building2, FolderTree, Briefcase, Settings2, LayoutDashboard, Edit3, GitBranch, CheckCircle2, RotateCcw, Play } from 'lucide-react'
import { clsx } from 'clsx'
import {
  buildAudienceOptions,
  effectiveMemberCounts,
  type AudienceNode,
} from '../../lib/contributions/audience-reach'
import { AudiencePicker } from '../contributions/AudiencePicker'
import {
  /* `stageColor` went with the Open Items rows that used it; the idea
     surface imports it where the chip now lives. */
  stageLabel, toIdeaStage,
  IDEA_STAGES, IDEA_STAGE_CONFIG, type IdeaStage,
} from '../../lib/ideas/stage-model'
import { fetchSignedUrl } from '../../lib/storage/signed-url'
import { WORKFLOW_TEMPLATES_BUCKET, workflowTemplatePath } from '../../lib/storage/buckets'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchOneAssetResearch,
  fetchThesisReferences,
  saveThesisReferences,
} from '../../lib/research/asset-research'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useAssetModels } from '../../hooks/useAssetModels'
import { TabStateManager } from '../../lib/tabStateManager'
import { requestUnsavedNavigation } from '../../lib/contributions/unsaved-edits-guard'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
/* `Badge` went with the Themes card, its last reader on this page. */
// PriorityBadge and BadgeSelect removed — priority selector replaced by state chips
import { EditableSectionWithHistory, type EditableSectionWithHistoryRef } from '../ui/EditableSectionWithHistory'
import { InvestmentTimeline } from '../ui/InvestmentTimeline'
import { QuickStageSwitcher } from '../ui/QuickStageSwitcher'
// AssetWorkflowSelector and WorkflowSelector removed — header workflow dropdown replaced by state chips
import { AssetDecisionView } from '../asset/AssetDecisionView'
import { DecisionTimeline } from '../asset/DecisionTimeline'
import { useAssetDecisionTimeline } from '../../hooks/useAssetDecisionTimeline'
import { ResearchToolbarMenu } from '../asset/ResearchToolbarMenu'
/*
 * `AssetWorkPane` — the orientation band — is gone, along with its tests.
 * The navigator carries the attention split, the ideas and the process
 * summary; the context strip carries the lists. `WorkAttentionItem` moved to
 * `lib/asset-work/attention`, beside the function that produces it.
 */
import { useAssetWorkAttention } from '../../hooks/useAssetWorkAttention'
import { useAssetProcessSummary } from '../../hooks/useAssetProcessSummary'
import { BookFilter } from '../shared/BookFilter'
import { WorkflowManager } from '../ui/WorkflowManager'
import { CaseCard } from '../ui/CaseCard'
import { AddToListButton } from '../lists/AddToListButton'
import { AddToThemeButton } from '../lists/AddToThemeButton'
/* `AddToQueueButton` is gone with the Portfolios card that carried it. Its
   label was "New Trade Idea", which is not a portfolio relationship; the
   control lives on the sidebar's In Progress header. */
import { useAssetTradeIdeas } from '../../hooks/useAssetTradeIdeas'
import { AssetTimelineView } from '../ui/AssetTimelineView'
import { FinancialNews } from '../financial/FinancialNews'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { InvestmentSnapshot } from '../asset/InvestmentSnapshot'
import { AssetWorkspaceHeader } from '../asset/AssetWorkspaceHeader'
import '../asset/asset-ux2.css'
// The component itself renders on the Snapshot now; this tab still derives
// the FIELD list from the org's template and passes it down, so the two
// surfaces cannot disagree about which sections exist.
import { OurViewSummary, type OurViewField } from '../asset/OurViewSummary'
import { contributionSectionsForSlug } from '../../lib/research/contribution-sections'
// DocumentLibrarySection removed — consolidated into KeyReferencesSection
import { RelatedProjects } from '../projects/RelatedProjects'
import { AddToProjectButton } from '../projects/AddToProjectButton'
import { ContributionSection, ThesisUnifiedSummary, ThesisHistoryView, ThesisContainer, KeyReferencesSection, ModelVersionHistory } from '../contributions'
import type { WorkspaceDestination, SignalFocus } from '../../lib/asset-workspace/context'
import { attentionTarget } from '../../lib/asset-workspace/attention-target'
import {
  ASSET_MODES, MODE_LABEL, MODE_LANDING, WORK_SECTION_ID,
  modeOf, workSectionId,
  type AssetMode, type AssetSubPage,
} from '../../lib/asset-workspace/modes'
import { scrollToSection } from '../../lib/asset-workspace/scroll-to-section'
import { focusIntentKey, shouldApplyFocus } from '../../lib/asset-workspace/arrival-focus'
import { useAssetListMemberships } from '../../hooks/lists/useAssetListMemberships'
import { useAssetConversations } from '../../hooks/ai/useAssetConversations'
import { askAI } from '../../lib/engagement'
import {
  buildWorkItems, resolveSelection, type WorkItem,
  /* Aliased: `workItemKey` is also the name of this component's selection
     state, and the two must not shadow each other. */
  workItemKey as workItemKeyFor,
} from '../../lib/asset-work/work-items'
import { WorkActionsMenu } from '../asset/work/WorkActionsMenu'
import { ProcessSwitcher } from '../asset/work/ProcessSwitcher'
import { groupProcesses, type SwitcherRunRow } from '../../lib/asset-work/process-switcher'
import { ProcessHistory } from '../asset/work/ProcessHistory'
import { ProcessDocuments } from '../asset/work/ProcessDocuments'
import {
  contextualKey, contextualSelection, backTarget,
} from '../../lib/asset-work/contextual-destination'
import { WorkNavigator } from '../asset/work/WorkNavigator'
import { IdeaWorkSurface } from '../asset/work/IdeaWorkSurface'
import { ListWorkSurface } from '../asset/work/ListWorkSurface'
import { PortfolioWorkSurface } from '../asset/work/PortfolioWorkSurface'
import { AssetWorkSidebar } from '../asset/work/AssetWorkSidebar'
import { WorkSidebarToggle } from '../asset/work/WorkSidebarToggle'
import { openIdeaDetail } from '../../lib/navigation/open-idea'

/* The nav's icons, beside the labels the model owns. Kept here rather than in
   the model so the model stays free of React imports. */
const MODE_ICON: Record<AssetMode, typeof FileText> = {
  overview: LayoutDashboard,
  research: FileText,
  work: Briefcase,
  history: History,
}
import { useContributions, type ContributionVisibility } from '../../hooks/useContributions'
import { useKeyReferences } from '../../hooks/useKeyReferences'
import { useUserAssetPriority, type Priority } from '../../hooks/useUserAssetPriority'
import { useUserAssetPagePreferences } from '../../hooks/useUserAssetPagePreferences'
import { useAssetHeaderContext } from '../../hooks/useAssetHeaderContext'
import { OutcomesContainer, AnalystRatingsSection, AnalystEstimatesSection, FirmConsensusPanel, PriceTargetsSummary, ViewWarningIndicator } from '../outcomes'
import type { ViewScope } from '../../hooks/useExpectedValue'
import { useViewWarnings } from '../../hooks/useViewWarnings'
import { UserWidgetRenderer, AssetPageFieldCustomizer, InvestmentCaseBuilder } from '../research'
import {
  ChecklistField,
  MetricField,
  TimelineField,
  NumericField,
  DateField
} from '../research/FieldTypeRenderers'
import { useUserAssetWidgets, type WidgetType } from '../../hooks/useUserAssetWidgets'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { calculateAssetCompleteness } from '../../utils/assetCompleteness'
// `discuss` and `canDiscuss` are no longer imported here: the generic
// asset-level entry point is withdrawn (see the note at its old site). Both
// remain exported and in use from seven other surfaces.
import { currentRows, buildBook, type HoldingRow, type Book } from '../../lib/portfolio/holdings'
import { ASSET_REFERENCE_SELECT } from '../../lib/assets/asset-columns'

// Visibility options for thesis sections
const VISIBILITY_OPTIONS: { value: ContributionVisibility; label: string; icon: React.ElementType; description: string }[] = [
  { value: 'firm', label: 'Firm-wide', icon: Globe, description: 'Everyone in the firm can see this' },
  { value: 'division', label: 'Division', icon: Building2, description: 'Visible to your division' },
  { value: 'department', label: 'Department', icon: FolderTree, description: 'Visible to your department' },
  { value: 'team', label: 'Team', icon: Users, description: 'Visible to your team' },
  { value: 'portfolio', label: 'Portfolio', icon: Briefcase, description: 'Only your portfolio can see this' }
]

const VISIBILITY_CONFIG: Record<ContributionVisibility, { icon: React.ElementType; label: string; color: string; bgColor: string }> = {
  portfolio: { icon: Briefcase, label: 'Portfolio', color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
  team: { icon: Users, label: 'Team', color: 'text-blue-600', bgColor: 'bg-blue-50' },
  department: { icon: FolderTree, label: 'Dept', color: 'text-cyan-600', bgColor: 'bg-cyan-50' },
  division: { icon: Building2, label: 'Division', color: 'text-purple-600', bgColor: 'bg-purple-50' },
  firm: { icon: Globe, label: 'Firm', color: 'text-green-600', bgColor: 'bg-green-50' }
}

/**
 * Helper function to get stages for a workflow
 * - For workflow branches: fetches from workflow_template_versions.stages
 * - For workflow templates: fetches from workflow_stages table
 */
async function getWorkflowStages(workflowId: string) {
  // First, check if this is a branch by getting the workflow's template_version_id
  const { data: workflow } = await supabase
    .from('workflows')
    .select('template_version_id, parent_workflow_id')
    .eq('id', workflowId)
    .single()

  // If it's a branch (has parent_workflow_id), get stages from template version
  if (workflow?.parent_workflow_id && workflow?.template_version_id) {
    const { data: templateVersion, error } = await supabase
      .from('workflow_template_versions')
      .select('stages')
      .eq('id', workflow.template_version_id)
      .single()

    if (error) {
      console.error('Error fetching template version stages:', error)
      return { data: [], error }
    }

    // Convert template version stages to the format expected by the code
    const stages = (templateVersion.stages || []).map((stage: any) => ({
      stage_key: stage.stage_key
    }))

    return { data: stages, error: null }
  }

  // Otherwise, it's a template - get stages from workflow_stages table
  const { data, error } = await supabase
    .from('workflow_stages')
    .select('stage_key')
    .eq('workflow_id', workflowId)
    .order('sort_order')

  return { data: data || [], error }
}

/**
 * Template field types that are NOT analyst prose.
 *
 * Each of these has a dedicated surface that owns its logic — price targets
 * and ratings through `PriceTargetsSummary` and `FirmConsensusPanel`, key
 * references through the References view. Our View and the aggregated document
 * both skip them, and they share this list so the summary can never claim to
 * cover a field the document renders, or vice versa.
 */
const NON_PROSE_FIELD_TYPES = [
  'checklist', 'metric', 'timeline', 'numeric', 'date',
  'rating', 'estimates', 'price_target', 'key_references',
]

interface AssetTabProps {
  asset: any
  onCite?: (content: string, fieldName?: string) => void
  onNavigate?: (tab: { id: string, title: string, type: string, data?: any }) => void
  isFocusMode?: boolean
}

// Inline Key References wrapper for AssetTab supporting_docs section
function AssetTabKeyReferencesInline({
  assetId,
  isCollapsed,
  onToggle,
  notes,
  onCreateNote,
  onNoteClick,
  isEmbedded
}: {
  assetId: string
  isCollapsed: boolean
  onToggle: () => void
  notes?: any[]
  onCreateNote?: () => void
  onNoteClick?: (noteId: string) => void
  isEmbedded?: boolean
}) {
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const { models: mdls } = useAssetModels(assetId)
  const selModel = selectedModelId ? mdls.find(m => m.id === selectedModelId) : null

  return (
    <>
      <KeyReferencesSection
        assetId={assetId}
        isExpanded={!isCollapsed}
        onToggleExpanded={onToggle}
        onViewModelHistory={(modelId) => { setSelectedModelId(modelId); setShowVersionHistory(true) }}
        onCreateNote={onCreateNote}
        onNoteClick={onNoteClick}
        notes={notes}
        isEmbedded={isEmbedded}
      />
      {selModel && (
        <ModelVersionHistory
          isOpen={showVersionHistory}
          onClose={() => { setShowVersionHistory(false); setSelectedModelId(null) }}
          modelId={selModel.id}
          assetId={assetId}
          modelName={selModel.name}
          currentVersion={selModel.version}
        />
      )}
    </>
  )
}

export function AssetTab({ asset, onCite, onNavigate, isFocusMode = false }: AssetTabProps) {
  const { user } = useAuth()

  // Mark the "Explore an asset page" step in PilotWelcomeBanner complete
  // on first visit, keyed per (user, org) so opening an asset in one
  // workspace doesn't pre-tick this step in another. The DB-backed
  // signals (hasNote/hasRating/hasContribution) only fire after the
  // user actually does something on the page, but the step itself
  // reads "explore" — opening the page should be enough.
  const { currentOrgId: assetExploredOrgId } = useOrganization()
  useEffect(() => {
    if (!user?.id || !assetExploredOrgId) return
    const key = `pilot-tutorial-asset-explored-${user.id}-${assetExploredOrgId}`
    try { localStorage.setItem(key, '1') } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent('pilot-tutorial:asset-explored')) } catch { /* ignore */ }
  }, [user?.id, assetExploredOrgId])

  // Per-user priority system
  const {
    myPriority,
    allPriorities,
    setPriority: setUserPriority,
    isSaving: isPrioritySaving
  } = useUserAssetPriority(asset.id)

  // Get other users' priorities (excluding current user)
  const otherPriorities = allPriorities.filter(p => p.user_id !== user?.id)

  const [workflowPriorityState, setWorkflowPriorityState] = useState('none')

  // Extract navigation data if it was passed from notification
  const navigationWorkflowId = asset.data?.workflowId
  const navigationStageId = asset.data?.stageId
  const navigationTaskId = asset.data?.taskId

  // Query to fetch task details if we have taskId but missing workflow/stage data
  const { data: taskDetails } = useQuery({
    queryKey: ['task-details', navigationTaskId],
    queryFn: async () => {
      if (!navigationTaskId) return null

      const { data, error } = await supabase
        .from('asset_checklist_items')
        .select('workflow_id, stage_id')
        .eq('id', navigationTaskId)
        .single()

      if (error) {
        console.error('❌ Error fetching task details:', error)
        return null
      }

      return data
    },
    enabled: !!navigationTaskId && (!navigationWorkflowId || !navigationStageId)
  })

  // Handle component citation in focus mode
  const handleComponentClick = useCallback((content: string, fieldName: string) => {
    if (isFocusMode && onCite) {
      onCite(content, fieldName)
    }
  }, [isFocusMode, onCite])

  // Timeline stages mapping for backward compatibility
  const stageMapping = {
    // Legacy mappings
    'research': 'prioritized',
    'analysis': 'prioritized',
    'monitoring': 'monitor', // Updated to map to new monitor stage
    'archived': 'action',
    // Current system mappings (these should pass through as-is)
    'outdated': 'outdated',
    'prioritized': 'prioritized',
    'in_progress': 'in_progress',
    'recommend': 'recommend',
    'review': 'review',
    'action': 'action',
    'monitor': 'monitor'
  }

  // Map old stage values to new timeline stages
  const mapToTimelineStage = (oldStage: string | null): string => {
    if (!oldStage) return 'outdated'
    return stageMapping[oldStage as keyof typeof stageMapping] || oldStage
  }

  const [stage, setStage] = useState(mapToTimelineStage(asset.process_stage))

  // Collapsible section states
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.collapsedSections || {}
  })

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  /*
   * Which piece of work the reader was on, restored from the same tab state
   * that restores the sub-page.
   *
   * Declared HERE, beside the other restored state, because the save effect
   * a few hundred lines below lists it as a dependency — and a dependency
   * array is evaluated on every render, so declaring it further down threw
   * "Cannot access 'workItemKey' before initialization" and took the whole
   * Asset page to the error boundary. The items it resolves against are
   * built much later, once every source hook has run; only the KEY lives up
   * here, which is all the save effect needs.
   */
  const [workItemKey, setWorkItemKey] = useState<string | null>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.activeWorkItem ?? null
  })

  /*
   * Active sub-page selector (Snapshot, Research, Workflow, Decisions, Lists).
   *
   * `snapshot` is the default landing for a general arrival. The four deeper
   * workspaces are unchanged and keep their own entry points — Snapshot is a
   * fifth destination, not a replacement for any of them.
   *
   * A SAVED sub-page still wins. Someone who left this tab on Process comes
   * back to Process: the default answers "where does an asset open", not
   * "where must you be". `loadTabState` is per-asset and per-session.
   */
  const [activeSubPage, setActiveSubPage] = useState<AssetSubPage>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.activeSubPage || 'snapshot'
  })
  /*
   * The arrival focus this tab has already acted on.
   *
   * Held in state only so the save effect below keeps writing it —
   * `saveTabState` REPLACES a tab's record rather than merging into it, so a
   * key left out of `stateToSave` is dropped on the next save and the focus
   * becomes replayable again. The effect that consumes it reads storage
   * directly; see the arrival-focus effect.
   */
  const [consumedFocusIntent, setConsumedFocusIntent] = useState<string | null>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.consumedFocusIntent ?? null
  })
  /*
   * ── The four modes ─────────────────────────────────────────────────────
   *
   * The nav shows Overview / Research / Work / History; the sub-page is still
   * the destination underneath, because tab state, `asset.focus` and every
   * existing handoff are keyed on it. In Work the three work sub-pages render
   * together on one surface, and the sub-page picks the section to scroll to
   * rather than the content to show.
   */
  const activeMode: AssetMode = modeOf(activeSubPage)
  /*
   * Set only by an explicit handoff ("show me the Lists", "open the
   * process"), never by entering Work — entering a mode should land at the
   * top of it.
   *
   * It carries a NONCE, the same way `attentionAnchor` below does, because a
   * bare id made every second click dead: if the scroll frame was cancelled
   * the id was never cleared, and setting state to the value it already holds
   * is a no-op in React, so the next identical request never re-ran the
   * effect. Two clicks on "go to the process", one scroll.
   */
  const [workAnchor, setWorkAnchor] = useState<{ id: string; nonce: number } | null>(null)
  const focusWorkSection = useCallback((id: string | null) => {
    setWorkAnchor(id ? { id, nonce: Date.now() } : null)
  }, [])
  // UX2 Phase 1 — whether the context strip is collapsed to a compact working
  // header. Per-viewer convenience only (localStorage), wrapped so a blocked or
  // private store never throws.
  const [headerCollapsed, setHeaderCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('ux2-asset-header-collapsed') === '1' } catch { return false }
  })
  const toggleHeaderCollapsed = useCallback(() => {
    setHeaderCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('ux2-asset-header-collapsed', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  /*
   * Whether the Work sidebar is hidden, so the working surface gets its
   * 296px.
   *
   * localStorage and not the tab state: the tab state is per-asset and
   * per-session, and this is neither. A reader who hides the sidebar to
   * write a model means it for AAPL, for MSFT, for tomorrow — so the key
   * carries the user and nothing else. Wrapped, because a private window
   * or blocked site data throws on access and a layout preference must
   * never be what takes the page down.
   */
  const workSidebarPrefKey = `tesseract:work-sidebar-collapsed:${user?.id ?? 'anon'}`
  const [workSidebarCollapsed, setWorkSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(`tesseract:work-sidebar-collapsed:${user?.id ?? 'anon'}`) === '1' } catch { return false }
  })
  const toggleWorkSidebar = useCallback(() => {
    setWorkSidebarCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(workSidebarPrefKey, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [workSidebarPrefKey])
  /*
   * Which book the Decision Memory narrative is scoped to. `null` is
   * organization-wide and is the default — the asset page's own context is
   * the org, and a reader arriving from a lens should see every decision
   * they are authorized to see before narrowing.
   *
   * Persisted with the rest of the tab state so returning to the asset
   * restores the scope the reader left it in, which is the "return context
   * preserved" requirement. Arriving WITH a portfolio in the request seeds
   * it, so a click from a portfolio lens lands already scoped to that book.
   */
  const [decisionBookId, setDecisionBookId] = useState<string | null>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.decisionBookId ?? asset.portfolioId ?? null
  })
  /*
   * Research view filter: 'aggregated' (Our View), a specific user_id, or
   * UNRESOLVED.
   *
   * ── Why there is a third state ───────────────────────────────────────
   *
   * This used to initialise to 'aggregated', which made the firm summary the
   * default full-length research document for everyone. An analyst opening a
   * name they cover landed on a combined pane rather than their own work.
   *
   * The right default is "my own detailed view, if I have one" — but
   * `researchAnalysts` is derived from `coverage` and `thesisContributions`,
   * both async, so it is EMPTY on first render. Defaulting at initialisation
   * is therefore impossible; the choice has to be made once that data lands.
   *
   * UNRESOLVED is that "not yet decided" state. It renders as Our View (the
   * safe, attributable fallback) and is replaced exactly once, by the effect
   * below, and never over a choice the reader or a navigation already made.
   */
  const [researchViewFilter, setResearchViewFilter] = useState<'aggregated' | string>(() => {
    /*
     * UX2 Phase 1 — My Research is the default on a fresh Asset Page visit,
     * even when no personal case exists. A persisted perspective is deliberately
     * NOT restored: a stale "Firm" preference must never strand the reader on a
     * read-only view. Only an arriving navigation intent (asset.data) wins here;
     * otherwise the resolver below settles it on the reader's own view. Within a
     * mounted session the choice persists in React state (sub-tab switches do
     * not remount), so a deliberate Organization switch is kept while navigating.
     *
     * The sentinel starts at 'aggregated' because fifteen downstream consumers
     * treat any non-'aggregated' value as a user id; the "not yet decided" fact
     * lives in `researchDefaultDecided` instead.
     */
    if (asset.data?.researchViewFilter) return asset.data.researchViewFilter
    return 'aggregated'
  })

  /**
   * Whether the research view was CHOSEN, as opposed to merely defaulted.
   *
   * Distinguishing these is the whole mechanism: "nobody has picked yet" and
   * "somebody picked Our View" look identical in the filter value, and
   * conflating them is what made the firm summary everyone's default
   * full-length research document.
   *
   * Seeded true when a saved or arriving choice exists, so the resolver below
   * leaves those alone.
   */
  const [researchDefaultDecided, setResearchDefaultDecided] = useState<boolean>(() => {
    // UX2 Phase 1: only an arriving navigation intent pre-decides the view; a
    // persisted perspective no longer seeds this, so the resolver runs on a
    // fresh visit and lands on My Research.
    return !!asset.data?.researchViewFilter
  })

  /**
   * Whether the current view was CHOSEN, rather than resolved by default.
   *
   * Only a chosen view is persisted. A default that happened to land on
   * another analyst's view must not be saved as if the reader picked it --
   * that would keep sending them there even after they write their own
   * research, which is the exact outcome the new default exists to produce.
   */
  const [researchViewChosen, setResearchViewChosen] = useState<boolean>(() => {
    // UX2 Phase 1: a persisted perspective is not treated as a fresh-visit
    // choice; only an arriving intent is.
    return !!asset.data?.researchViewFilter
  })

  /**
   * Any explicit pick — by the reader or by a navigation — settles it. Guarded
   * (UX1c-2b): switching the Firm/personal perspective unmounts the editable
   * section, so pause for unsaved research first.
   */
  const chooseResearchView = useCallback((next: string) => {
    requestUnsavedNavigation(() => {
      setResearchDefaultDecided(true)
      setResearchViewChosen(true)
      setResearchViewFilter(next)
    })
  }, [])
  // Guarded in-tab navigation (UX1c-2b): switching the Asset Page sub-tab or the
  // Research read-mode also unmounts an open inline editor, so route the user
  // controls through the unsaved-research guard. Clean editors pass through
  // synchronously, so behaviour is unchanged when nothing is being edited.
  const goToSubPage = useCallback((next: AssetSubPage) => {
    requestUnsavedNavigation(() => {
      setActiveSubPage(next)
      /* A Work destination asked for explicitly is a scroll, because all
         three already render. Anything else clears a stale anchor. */
      focusWorkSection(workSectionId(next))
    })
  }, [focusWorkSection])
  /* The nav. Picking a mode lands on that mode's destination and never sets
     an anchor, so Work opens at the top. */
  const goToMode = useCallback((mode: AssetMode) => {
    requestUnsavedNavigation(() => {
      setActiveSubPage(MODE_LANDING[mode])
      focusWorkSection(null)
    })
  }, [focusWorkSection])
  // Thesis view mode: 'all' shows 3 sections, 'summary' shows unified narrative, 'history' shows timeline
  const [thesisViewMode, setThesisViewMode] = useState<'all' | 'summary' | 'history' | 'references'>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.thesisViewMode || 'all'
  })
  const goToThesisMode = useCallback((next: typeof thesisViewMode) => {
    requestUnsavedNavigation(() => setThesisViewMode(next))
  }, [])
  // Attention band → research-section deep link: anchor to scroll to, with a
  // nonce so re-clicking the same signal re-fires.
  const [attentionAnchor, setAttentionAnchor] = useState<
    { anchor: 'thesis' | 'risks' | 'targets' | 'rating' | 'case'; nonce: number } | null
  >(null)
  // Research layout mode: 'classic' uses hardcoded sections, 'dynamic' uses configurable fields
  // User asset widgets
  const [showFieldCustomizer, setShowFieldCustomizer] = useState(false)
  const [showCaseBuilder, setShowCaseBuilder] = useState(false)
  const [widgetCollapsedState, setWidgetCollapsedState] = useState<Record<string, boolean>>({})
  // Shared visibility state for all thesis sections
  const [sharedThesisVisibility, setSharedThesisVisibility] = useState<ContributionVisibility>('firm')
  const [sharedThesisTargetIds, setSharedThesisTargetIds] = useState<string[]>([])
  const [hasInitializedVisibility, setHasInitializedVisibility] = useState(false)
  /** The visibility level the shared picker was last LOADED with. */
  const rehydratedVisibilityRef = useRef<ContributionVisibility | null>(null)
  /**
   * The audience as SAVED on the contribution, kept apart from the live
   * selection so the picker can always show what exists today — including
   * nodes the author could not pick again.
   */
  const [savedAudience, setSavedAudience] =
    useState<{ visibility: ContributionVisibility; targetIds: string[] } | null>(null)
  const [currentlyEditing, setCurrentlyEditing] = useState<string | null>(null)
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const [showCoverageManager, setShowCoverageManager] = useState(false)
  const [viewingStageId, setViewingStageId] = useState<string | null>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.viewingStageId || null
  })
  /* The requirement inside that stage, restored the same way. An
     `asset_checklist_items.id`; null is "none selected", which is what a
     first visit should be. */
  const [viewingRequirementId, setViewingRequirementId] = useState<string | null>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.viewingRequirementId || null
  })
  const [pendingWorkflowSwitch, setPendingWorkflowSwitch] = useState<{workflowId: string, stageId: string | null} | null>(null)
  const [showTimelineView, setShowTimelineView] = useState(false)
  const [showTemplatesView, setShowTemplatesView] = useState(false)
  const [isTabStateInitialized, setIsTabStateInitialized] = useState(false)
  const [showWorkflowManager, setShowWorkflowManager] = useState(false)
  // showAssetPriorityDropdown removed — priority selector replaced by state chips
  const [showWorkflowPriorityDropdown, setShowWorkflowPriorityDropdown] = useState(false)
  /*
   * The within-Work scroll target the header's context chips set.
   *
   * It carries a nonce for the same reason `workAnchor` does: setting state to
   * the value it already holds is a React no-op, so a bare id made the SECOND
   * click on the same chip do nothing at all.
   */
  const [listsFocus, setListsFocus] = useState<{ id: string; nonce: number } | null>(null)
  const focusListsSection = useCallback((id: string | null) => {
    setListsFocus(id ? { id, nonce: Date.now() } : null)
  }, [])
  const [openItemsFilter, setOpenItemsFilter] = useState<'all' | IdeaStage>('all')
  const headerContext = useAssetHeaderContext(asset.id)
  const [addRefType, setAddRefType] = useState<'none' | 'note' | 'file' | 'model' | 'url'>('none')
  const [newRefUrl, setNewRefUrl] = useState('')
  const [newRefTitle, setNewRefTitle] = useState('')
  const queryClient = useQueryClient()

  // Fetch asset models (Excel files)
  const { models: assetModels = [] } = useAssetModels(asset.id)

  // Fetch active trade ideas for Open Items section
  /* `totalHint` went with the Open Items header that displayed it; the
     navigator states the count by listing the rows. */
  const { ideas: openItems, isLoading: openItemsLoading } = useAssetTradeIdeas({ assetId: asset.id })

  // Refs for EditableSectionWithHistory components
  const thesisRef = useRef<EditableSectionWithHistoryRef>(null)
  const whereDifferentRef = useRef<EditableSectionWithHistoryRef>(null)
  const risksRef = useRef<EditableSectionWithHistoryRef>(null)


  // Fetch full asset data if id or sector is missing
  const { data: fullAsset } = useQuery({
    queryKey: ['asset-full-data', asset.id, asset.symbol],
    queryFn: async () => {
      // Query by id if available, otherwise use symbol
      let query = supabase
        .from('assets')
        .select(ASSET_REFERENCE_SELECT)

      if (asset.id) {
        query = query.eq('id', asset.id)
      } else if (asset.symbol) {
        query = query.eq('symbol', asset.symbol)
      } else {
        throw new Error('No asset id or symbol available')
      }

      const { data, error } = await query.single()

      if (error) throw error
      return data
    },
    enabled: (!asset.id || !asset.sector) && (!!asset.id || !!asset.symbol)
  })

  // Create effective asset with full data merged in
  const effectiveAsset = fullAsset ? { ...asset, ...fullAsset } : asset

  // Fetch workflow-specific priority
  const { data: workflowPriority } = useQuery({
    queryKey: ['asset-workflow-priority', asset.id, asset.workflow_id],
    queryFn: async () => {
      if (!asset.workflow_id) return null

      const { data, error } = await supabase
        .from('asset_workflow_priorities')
        .select('priority')
        .eq('asset_id', asset.id)
        .eq('workflow_id', asset.workflow_id)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') throw error
      return data?.priority || null
    },
    enabled: !!asset.workflow_id
  })

  // Update workflow priority state when workflow priority is loaded
  useEffect(() => {
    setWorkflowPriorityState(workflowPriority || 'none')
  }, [workflowPriority])

  // Update local state when switching to a different asset
  useEffect(() => {
    if (asset.id) {
      setStage(mapToTimelineStage(asset.process_stage))

      // Tab state is already initialized in useState() from TabStateManager
      // No need to set it again here - the useState initializers handle this

      setHasLocalChanges(false) // Reset local changes flag when loading new asset
    }
  }, [asset.id])

  // Mark as initialized once asset is loaded (state is already initialized in useState)
  useEffect(() => {
    setIsTabStateInitialized(true)
  }, [asset.id])

  // Handle noteId from navigation (e.g., from dashboard note click)
  // Open note in its own tab when navigating from notification
  useEffect(() => {
    if (asset.noteId && asset.id) {
      // Find the note to get its title
      const note = notes?.find((n: any) => n.id === asset.noteId)
      onNavigate?.({
        id: asset.noteId,
        title: note?.title || 'Note',
        type: 'note',
        data: { id: asset.noteId, assetId: asset.id, assetSymbol: asset.symbol }
      })
    }
  }, [asset.id, asset.noteId])

  // Handle task assignment navigation from notifications
  useEffect(() => {
    // Use fetched task details as fallback if navigation data is missing
    const effectiveWorkflowId = navigationWorkflowId || taskDetails?.workflow_id
    const effectiveStageId = navigationStageId || taskDetails?.stage_id

    if (effectiveWorkflowId || navigationTaskId) {

      /* A task notification lands in Work and scrolls to the Process
         section, which is where the task lives now. */
      setActiveSubPage('workflow')
      focusWorkSection(WORK_SECTION_ID.workflow)

      // Only optimistically cache if this is from a fresh navigation (not stale session data)
      // The actual effectiveWorkflowId query will fetch fresh from DB and correct if needed

      // If the notification has a workflow ID and it's different from current asset workflow,
      // mark it for switching
      if (effectiveWorkflowId && asset.workflow_id !== effectiveWorkflowId) {
        setPendingWorkflowSwitch({ workflowId: effectiveWorkflowId, stageId: effectiveStageId || null })
      } else {
        // If workflow matches or no workflow specified, just set stage and switch tab
        if (effectiveStageId) {
          setViewingStageId(effectiveStageId)
        }
      }
    }
  }, [asset, navigationStageId, navigationWorkflowId, navigationTaskId, taskDetails])

  /**
   * Arrival focus, from the Research, Portfolio, Ideas and Decisions lenses.
   *
   * Land on the sub-page the sender's question belongs to. `openAsset` carries
   * `focus` in tab data (`lib/desktop-asset/navigate.ts`).
   *
   * An EXPLICIT focus always wins over the Snapshot default. A reader sent
   * here by Research to answer a research question must not be redirected to
   * an overview of everything — that is the sender's intent discarded, and it
   * is the main way a new default landing breaks existing navigation.
   *
   *   research   -> Research      (explicit, preserved)
   *   decisions  -> Decisions     (explicit, preserved)
   *   overview   -> Snapshot      NEW. This is what 'overview' always meant;
   *                               until now there was nothing for it to mean,
   *                               so it silently did nothing.
   *   position   -> Snapshot      Position is a Snapshot domain. Previously a
   *                               no-op, which landed a reader arriving from a
   *                               book on whatever page they last used.
   *   framework  -> unchanged     The framework lives in Research's outcomes;
   *                               it has no home of its own yet, and guessing
   *                               is worse than leaving the saved page alone.
   *
   * ── Consumed ONCE per request, not re-applied on every mount ────────────
   *
   * `focus` lives in tab DATA, which is durable — the shell merges it into
   * the open tab and keeps it. Only the active tab renders, so leaving for
   * another tab unmounts this component and coming back remounts it. This
   * effect then saw the same `focus` and applied it again, discarding
   * whatever the reader had navigated to since. Arriving from "Edit on the
   * asset" meant being returned to Research on every single return.
   *
   * `focusRequestId` is stamped per `openAsset` call, and the id we last
   * acted on is written to the SAME per-asset tab state that already restores
   * the sub-page. A component ref cannot do this job: the component is the
   * thing being unmounted.
   *
   * Consuming and landing are persisted together, immediately, rather than
   * left to the batched save effect below — a reader can leave the tab in the
   * same breath as arriving, and a consumption that had not reached storage
   * would replay exactly as before.
   *
   * A descriptor with no `focusRequestId` is a hand-built one from an older
   * sender (none of which set `focus` today). It falls back to a key derived
   * from the focus itself, so it is still applied once rather than forever;
   * what it gives up is re-requesting the SAME focus twice, which only
   * `openAsset` can express.
   */
  useEffect(() => {
    const focus = asset.focus
    if (!focus) return

    const target: AssetSubPage | null =
      focus === 'research' ? 'research'
      : focus === 'decisions' ? 'decisions'
      : (focus === 'overview' || focus === 'position') ? 'snapshot'
      : null
    /* `framework` and anything unrecognised still leave the saved page alone. */
    if (!target) return

    const intent = focusIntentKey(focus, asset.focusRequestId)
    /* Read through to storage rather than through state: this component may be
       reused for a different asset, and the saved record is asset-scoped. */
    const saved = TabStateManager.loadTabState(asset.id)
    if (!shouldApplyFocus(intent, saved?.consumedFocusIntent)) return

    setActiveSubPage(target)
    setConsumedFocusIntent(intent)
    TabStateManager.saveTabState(asset.id, {
      ...(saved ?? {}),
      activeSubPage: target,
      consumedFocusIntent: intent,
    })
  }, [asset.focus, asset.focusRequestId, asset.id])

  // Handle researchViewFilter from navigation data (e.g., Trade Queue linking to proposer's research view)
  useEffect(() => {
    if (asset.data?.researchViewFilter) {
      // An explicit navigation intent -- e.g. Trade Queue linking to the
      // proposer's view. It settles the default so the resolver stays out.
      setResearchDefaultDecided(true)
      setResearchViewChosen(true)
      setResearchViewFilter(asset.data.researchViewFilter)
      setActiveSubPage('research')
    }
  }, [asset.data?.researchViewFilter])

  // Handle `scrollTo` navigation hint — used by tutorial steps in
  // PilotWelcomeBanner to deep-link into a specific section of the asset
  // page. Effect re-runs on every (scrollTo, scrollNonce) change so a
  // second click of the same step also fires. The poll handles two
  // realities: (a) the layout/template query may still be loading, and
  // (b) the section containing the anchor may be collapsed so we
  // expand it first.
  useEffect(() => {
    const scrollTo = asset.data?.scrollTo
    if (!scrollTo) return
    const targetId = scrollTo === 'rating' ? 'asset-warning-anchor-rating'
      : scrollTo === 'targets' ? 'asset-warning-anchor-targets'
      : null
    if (!targetId) return
    setActiveSubPage('research')
    // The rating anchor only exists in the Individual "All" view branch
    // (thesisViewMode='all' + researchViewFilter !== 'aggregated'). If a
    // saved state restored 'summary' / 'history' / 'references', the
    // anchor isn't in the DOM at all. Force 'all' so the field renders.
    setThesisViewMode('all')
    // Rating + Price Targets live in the Forecasts section, keyed
    // 'outcomes' for collapsed state. Force-expand so the anchor
    // element is in the DOM.
    if (scrollTo === 'rating' || scrollTo === 'targets') {
      setCollapsedSections(prev => ({ ...prev, outcomes: false }))
    }
    let cancelled = false
    let attempts = 0
    const tick = () => {
      if (cancelled) return
      const el = document.getElementById(targetId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      // Retry for up to ~3s while the layout/template query resolves.
      if (attempts++ < 30) window.setTimeout(tick, 100)
    }
    const initial = window.setTimeout(tick, 200)
    return () => {
      cancelled = true
      window.clearTimeout(initial)
    }
    // scrollNonce is a millisecond timestamp set by the caller — used
    // so re-clicking the same banner step re-fires the scroll even
    // though `scrollTo` itself didn't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.data?.scrollTo, asset.data?.scrollNonce])

  // Attention band → an exact research anchor. Reuses the same approach as the
  // external scrollTo above (force Research + the All view, expand the section,
  // then poll until the anchor is in the DOM). The anchors already exist in the
  // render; this adds no new routing. 'case' has no anchor of its own — the
  // case begins at the thesis, which is the nearest truthful target.
  useEffect(() => {
    if (!attentionAnchor) return
    const map: Record<string, string> = {
      thesis: 'asset-anchor-thesis',
      case: 'asset-anchor-thesis',
      risks: 'asset-warning-anchor-risks',
      targets: 'asset-warning-anchor-targets',
      rating: 'asset-warning-anchor-rating',
    }
    const targetId = map[attentionAnchor.anchor]
    setActiveSubPage('research')
    setThesisViewMode('all')
    if (attentionAnchor.anchor === 'targets' || attentionAnchor.anchor === 'rating') {
      setCollapsedSections(prev => ({ ...prev, outcomes: false }))
    }
    let cancelled = false
    let attempts = 0
    const tick = () => {
      if (cancelled) return
      const el = document.getElementById(targetId)
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
      if (attempts++ < 30) window.setTimeout(tick, 100)
    }
    const initial = window.setTimeout(tick, 150)
    return () => { cancelled = true; window.clearTimeout(initial) }
  }, [attentionAnchor])

  /*
   * Where an attention signal takes the reader — the precise `focus` first,
   * the signal's own page as the truthful fallback. No silent redirect: a
   * signal with no exact target lands on the page it names, never elsewhere.
   */
  const handleAttentionFocus = useCallback((destination: WorkspaceDestination, focus?: SignalFocus) => {
    const t = attentionTarget(destination, focus)
    if (t.anchor) {
      // Per-section prose only renders in an individual research view. If the
      // reader is on the firm (aggregated) view there is no section to scroll
      // to, so switch to their own research — the nearest view that shows it.
      if (researchViewFilter === 'aggregated' && user?.id) setResearchViewFilter(user.id)
      // The anchor effect then forces Research + the All view, expands, scrolls.
      setAttentionAnchor({ anchor: t.anchor, nonce: Date.now() })
      return
    }
    // Scope the Decisions sub-page to the request's book so the specific
    // waiting requests are identifiable (null = every book).
    if (t.decisionsBook !== undefined) setDecisionBookId(t.decisionsBook ?? null)
    setActiveSubPage(t.subPage)
    focusWorkSection(workSectionId(t.subPage))
    if (t.researchMode) setThesisViewMode(t.researchMode)
    if (t.openItems) {
      /*
       * An attention signal about open items now SELECTS the work rather
       * than scrolling to a list of it.
       *
       * This used to poll for `decisions-open-items` and scroll there. That
       * section is gone — the navigator lists the same ideas and the surface
       * shows the one in hand — so clearing the saved selection hands the
       * choice to `resolveSelection`, whose first preference is precisely
       * the thing an attention signal is about: an item this reader is
       * empowered to act on. No second ranking rule, and no scroll to a
       * section that no longer exists.
       */
      setWorkItemKey(null)
    }
  }, [researchViewFilter, user?.id])

  // Save tab state whenever relevant state changes (but only after initialization)
  useEffect(() => {
    if (isTabStateInitialized) {
      const stateToSave = {
        activeSubPage,
        /*
         * Only a CHOSEN view is persisted. Saving a defaulted one would turn
         * it into an explicit choice on the next visit and freeze the reader
         * on whichever view the resolver happened to pick.
         */
        ...(researchViewChosen ? { researchViewFilter } : {}),
        thesisViewMode,
        collapsedSections,
        viewingStageId,
        viewingRequirementId,
        // Decision Memory's book scope, so leaving and returning to the asset
        // restores the narrative the reader was reading.
        decisionBookId,
        /*
         * Which piece of work the reader was on.
         *
         * Only the KEY is stored, never a resolved item: the item it names
         * may have completed or become unauthorized by the time the tab is
         * reopened, and `resolveSelection` is what decides what to do about
         * that. Persisting the item itself would resurrect work that is gone.
         */
        activeWorkItem: workItemKey,
        /* Carried on every save because `saveTabState` replaces the record;
           omitting it here would let the arrival focus replay. */
        consumedFocusIntent,
      }
      TabStateManager.saveTabState(asset.id, stateToSave)
    }
  }, [asset.id, activeSubPage, researchViewFilter, researchViewChosen, thesisViewMode, collapsedSections, viewingStageId, viewingRequirementId, decisionBookId, workItemKey, consumedFocusIntent, isTabStateInitialized])

  /*
   * The newest execution on this asset that the reader is authorized to see,
   * for the Last Action tile on Decisions.
   *
   * Called at component level, unconditionally — the Decisions block below is
   * an IIFE inside JSX, and a hook there would be a conditional hook.
   *
   * Same arguments as the DecisionTimeline render, so it shares that query's
   * cache key and costs no extra request. `enabled` keeps it off every other
   * sub-page. Executions are portfolio-team scoped by RLS; nothing here
   * widens that.
   */
  /*
   * Work-pane integration (prototype).
   *
   * Mounted ABOVE Open Items on the existing Decisions tab; nothing is
   * removed. The duplication that creates is deliberate and temporary — see
   * the comment at the render site.
   */
  const { attention: workAttention, isLoading: workAttentionLoading } =
    useAssetWorkAttention(asset.id, activeMode === 'work')

  const workIdeas = React.useMemo(
    () => openItems.map(i => ({
      id: i.id,
      action: i.action,
      stage: i.stage,
      rationale: i.rationale,
      portfolioName: i.portfolio?.name ?? null,
      creatorName: i.creator
        ? [i.creator.first_name, i.creator.last_name].filter(Boolean).join(' ') || null
        : null,
      updatedAgo: i.updated_at
        ? formatDistanceToNow(new Date(i.updated_at), { addSuffix: true })
        : null,
    })),
    [openItems],
  )


  const { events: decisionTimelineEvents } = useAssetDecisionTimeline({
    assetId: asset.id,
    portfolioId: decisionBookId,
    /* The timeline is History's content now. Work reads the same rows only
       through `useAssetWorkAttention`, which has its own gate. */
    enabled: activeMode === 'history',
  })
  const lastExecution = React.useMemo(
    () => decisionTimelineEvents.find(e => e.phase === 'execution') ?? null,
    [decisionTimelineEvents]
  )

  /*
   * ── Focus-scroll into a membership section ──────────────────────────────
   *
   * Set by the header's context chips (portfolios / lists / themes / projects).
   * Two defects lived in the three lines this replaces:
   *
   *  1. `setListsFocus(null)` ran in the EFFECT BODY. That re-renders at once,
   *     which changes this effect's deps and runs its cleanup — cancelling the
   *     frame that was about to scroll. The same self-cancelling frame the
   *     Work anchor had. The clear now happens inside the frame, after the
   *     scroll, and only if the target was actually found.
   *  2. With the clear repaired, a bare string id would then make every second
   *     click on the same chip a no-op, because React skips a state write that
   *     changes nothing. Hence the nonce.
   *
   * The scroll itself is the shared helper — `scrollIntoView` moves every
   * scrollable ancestor and overshoots this page's nested container.
   */
  useEffect(() => {
    if (!listsFocus || activeMode !== 'work') return
    // Expand the target section if collapsed
    setCollapsedSections(prev => ({ ...prev, [listsFocus.id]: false }))
    // Wait a tick for the expansion to land in the DOM, then scroll.
    const raf = requestAnimationFrame(() => {
      if (scrollToSection(`lists-section-${listsFocus.id}`)) setListsFocus(null)
    })
    return () => cancelAnimationFrame(raf)
  }, [listsFocus, activeMode])

  /*
   * ── Work handoffs scroll instead of switching ──────────────────────────
   *
   * Process, Ideas and Lists are sections of one surface now, so "open the
   * process" is a scroll, not a tab change. The anchor is cleared after one
   * scroll so re-rendering Work does not yank the reader back.
   */
  useEffect(() => {
    if (!workAnchor || activeMode !== 'work') return
    const raf = requestAnimationFrame(() => {
      /*
       * `scrollToSection`, not `scrollIntoView`. The sub-page body is a nested
       * scroll container under a sticky header, and scrollIntoView adjusts
       * every scrollable ancestor — it overshot by ~600px and left the Process
       * section above the viewport. The helper measures the rect delta against
       * the container that actually scrolls, and the membership chips use the
       * same one.
       *
       * Cleared INSIDE the frame, after the scroll. Clearing it in the effect
       * body instead re-renders immediately, which changes this effect's deps
       * and runs its cleanup — cancelling the very frame that was going to
       * scroll. Nothing moved, and nothing said so.
       */
      if (scrollToSection(workAnchor.id)) setWorkAnchor(null)
    })
    return () => cancelAnimationFrame(raf)
  }, [workAnchor, activeMode])

  // ---------- Queries ----------
  const { data: coverage } = useQuery({
    queryKey: ['coverage', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('*, portfolio:portfolios(name, portfolio_id)')
        .eq('asset_id', asset.id)
        .eq('is_active', true)
        .order('is_lead', { ascending: false })
        .order('role', { ascending: true })
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  // Fetch thesis contributions to check analyst thesis status
  const { data: thesisContributions } = useQuery({
    queryKey: ['thesis-contributions', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_contributions')
        .select('created_by, updated_at')
        .eq('asset_id', asset.id)
        .eq('section', 'thesis')
      if (error) throw error
      return data || []
    },
  })

  // Fetch profile info for thesis contributors
  const contributorIds = React.useMemo(() => {
    if (!thesisContributions) return []
    return [...new Set(thesisContributions.map(t => t.created_by).filter(Boolean))]
  }, [thesisContributions])

  const { data: contributorProfiles, isLoading: isLoadingContributorProfiles } = useQuery({
    queryKey: ['contributor-profiles', contributorIds],
    queryFn: async () => {
      if (contributorIds.length === 0) return []
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', contributorIds)
      if (error) throw error
      // Transform to include full_name for consistency
      return (data || []).map(u => ({
        id: u.id,
        full_name: u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : null,
        email: u.email
      }))
    },
    enabled: contributorIds.length > 0
  })

  // Get user's org chart context for visibility targets
  const { data: userOrgContext } = useQuery({
    queryKey: ['user-org-context', user?.id],
    queryFn: async () => {
      const { data: memberships } = await supabase
        .from('org_chart_node_members')
        .select('node_id, org_chart_nodes(id, name, color, node_type, parent_id)')
        .eq('user_id', user?.id)

      const empty = {
        portfolios: [], teams: [], departments: [], divisions: [],
        memberCounts: new Map<string, number>(),
        nodeById: new Map<string, AudienceNode>(),
      }
      if (!memberships) return empty

      const directNodes = memberships
        .map(m => m.org_chart_nodes as { id: string; name: string; color: string; node_type: string; parent_id: string | null })
        .filter(Boolean)

      const { data: allNodes } = await supabase
        .from('org_org_chart_nodes_v')
        .select('id, name, color, node_type, parent_id')

      if (!allNodes) return empty

      /*
       * EFFECTIVE member counts per node — distinct people the node reaches,
       * counting its own members and everyone in the groups beneath it.
       *
       * Membership is inherited upward, so sharing with a department reaches
       * its teams. The count has to say that, or the picker understates an
       * audience and an author shares more widely than the number implied.
       * `user_id` is selected because the rollup counts distinct PEOPLE: one
       * person in two teams under the same department is one reader, not two.
       * See src/lib/contributions/audience-reach.ts.
       */
      const { data: allMembers } = await supabase
        .from('org_chart_node_members')
        .select('node_id, user_id')

      const memberCounts = effectiveMemberCounts(
        allNodes as AudienceNode[],
        (allMembers ?? []) as { node_id: string; user_id: string }[],
      )
      // Every node by id, so a target the author can no longer pick can still
      // be shown by name instead of as a bare id.
      const nodeById = new Map<string, AudienceNode>(
        (allNodes as AudienceNode[]).map(n => [n.id, n])
      )

      const nodeMap = new Map(allNodes.map(n => [n.id, n]))
      const teamsSet = new Map<string, typeof allNodes[0]>()
      const departmentsSet = new Map<string, typeof allNodes[0]>()
      const divisionsSet = new Map<string, typeof allNodes[0]>()

      const traverseUp = (nodeId: string | null) => {
        if (!nodeId) return
        const node = nodeMap.get(nodeId)
        if (!node) return
        if (node.node_type === 'team') teamsSet.set(node.id, node)
        else if (node.node_type === 'department') departmentsSet.set(node.id, node)
        else if (node.node_type === 'division') divisionsSet.set(node.id, node)
        traverseUp(node.parent_id)
      }

      directNodes.forEach(node => {
        if (node.node_type === 'team') teamsSet.set(node.id, node)
        traverseUp(node.parent_id)
      })

      const portfolios = directNodes.filter(n => n.node_type === 'portfolio').sort((a, b) => a.name.localeCompare(b.name))
      const teams = Array.from(teamsSet.values()).sort((a, b) => a.name.localeCompare(b.name))
      const departments = Array.from(departmentsSet.values()).sort((a, b) => a.name.localeCompare(b.name))
      const divisions = Array.from(divisionsSet.values()).sort((a, b) => a.name.localeCompare(b.name))

      return { portfolios, teams, departments, divisions, memberCounts, nodeById }
    },
    enabled: !!user?.id
  })

  // Fetch ALL contributions for this asset (for unified summary view)
  const { contributions: allAssetContributions, isLoading: contributionsLoading, isFetching: contributionsFetching } = useContributions({ assetId: asset.id })

  // Legacy: Fetch specific section contributions for visibility initialization (deprecated - will be removed)
  const userThesisContributions = allAssetContributions.filter(c => c.section === 'thesis')
  const userWhereDiffContributions = allAssetContributions.filter(c => c.section === 'where_different')
  const userRisksContributions = allAssetContributions.filter(c => c.section === 'risks_to_thesis')

  // User-added widgets for this asset
  const {
    widgets: userWidgets,
    myWidgets,
    getWidgetValue,
    isMyWidget,
    createWidget,
    deleteWidget,
    saveWidgetValue,
    isCreating: isCreatingWidget
  } = useUserAssetWidgets(asset.id, researchViewFilter !== 'aggregated' ? researchViewFilter : undefined)

  // Get user's layout preferences for this asset (respects default layout + asset-specific overrides)
  const {
    fieldsWithPreferences,
    fieldsBySection,
    displayedFieldsBySection,
    activeLayout,
    isLoading: layoutLoading
  } = useUserAssetPagePreferences(asset.id)

  // Check if user is viewing their own tab - used to conditionally apply layout customizations
  // Layout/template customizations should ONLY apply when viewing "My View"
  const isViewingOwnTab = user && researchViewFilter === user.id
  const isAggregatedView = researchViewFilter === 'aggregated'

  /**
   * The prose fields Our View summarises, in the org's own template order.
   *
   * Derived from the template rather than listed, for the same reason the
   * aggregated document was: the organisation decides which fields exist, what
   * they are called and what order they read in. A hardcoded list inside the
   * summary would be a second research vocabulary that silently disagrees with
   * this one the first time an org adds or renames a field.
   *
   * The filter mirrors the aggregated document exactly — the same hidden
   * sections, the same Key References exclusion, the same non-prose field types
   * that have dedicated summary components (`PriceTargetsSummary`,
   * `FirmConsensusPanel`) above. So the summary reports on precisely the
   * sections the full document would have rendered.
   */
  const ourViewFields: OurViewField[] = React.useMemo(() => {
    const out: OurViewField[] = []
    for (const section of displayedFieldsBySection) {
      if (section.section_is_hidden) continue
      if (section.section_slug === 'supporting_docs') continue
      for (const field of section.fields) {
        if (!field.is_visible) continue
        if (NON_PROSE_FIELD_TYPES.includes(field.field_type)) continue
        out.push({
          slug: field.field_slug,
          label: field.field_name,
          sectionKeys: contributionSectionsForSlug(field.field_slug),
        })
      }
    }
    return out
  }, [displayedFieldsBySection])

  /**
   * The analysts formally covering this asset.
   *
   * Computed once rather than inline at each consumer. The `coverage` query
   * selects an embed, which the generated row type does not describe, so its
   * rows infer as `never` and every inline `coverage?.map(c => c.user_id)`
   * produced its own type error. One annotated read states the shape in a
   * single place; the annotation is narrow on purpose — `user_id` is all a
   * covering-set needs, so it cannot drift into a second description of a
   * coverage row.
   */
  const coveringAnalystIds = React.useMemo(() => {
    const rows = (coverage ?? []) as unknown as { user_id: string | null }[]
    return new Set(rows.map(c => c.user_id).filter((id): id is string => Boolean(id)))
  }, [coverage])

  // Get section info with overrides (name, visibility, etc.)
  const getSectionInfo = useCallback((sectionSlug: string) => {
    const section = fieldsBySection.find(s => s.section_slug === sectionSlug)
    // Section is hidden if: explicit section override OR no fields in the section are visible
    // Default to true (visible) while loading to avoid flash of hidden content
    const hasVisibleFields = section ? section.fields.some(f => f.is_visible) : true
    const result = {
      name: section?.section_name || null, // null indicates loading
      isHidden: section?.section_is_hidden || !hasVisibleFields,
      hasOverride: section?.section_has_override || false,
      isLoading: !section // true if section data hasn't loaded yet
    }
    // Debug log section visibility (disabled for performance)
    //   found: !!section,
    //   fieldCount: section?.fields.length ?? 0,
    //   visibleFieldCount: section?.fields.filter(f => f.is_visible).length ?? 0,
    //   hasVisibleFields,
    //   isHidden: result.isHidden,
    //   sectionIsHiddenOverride: section?.section_is_hidden
    // })
    return result
  }, [fieldsBySection])

  // Track if user has a custom layout configured
  const hasUserLayout = !!activeLayout

  // Get target options for selected visibility level
  const getTargetOptions = useCallback((visibility: ContributionVisibility) => {
    if (!userOrgContext) return []
    switch (visibility) {
      case 'firm': return []
      case 'division': return userOrgContext.divisions
      case 'department': return userOrgContext.departments
      case 'team': return userOrgContext.teams
      case 'portfolio': return userOrgContext.portfolios
      default: return []
    }
  }, [userOrgContext])

  /*
   * Building the option list — candidates, stored targets, reachability —
   * moved into AudiencePicker, which needs it per scope as the author browses
   * rather than only for the level currently applied. It still calls
   * `buildAudienceOptions` with the same inputs, so a saved group the author
   * can no longer pick stays listed and checked.
   */

  // Initialize visibility from user's existing contributions
  useEffect(() => {
    if (!hasInitializedVisibility && user?.id) {
      const userContribution = userThesisContributions.find(c => c.created_by === user.id)
        || userWhereDiffContributions.find(c => c.created_by === user.id)
        || userRisksContributions.find(c => c.created_by === user.id)

      if (userContribution) {
        const savedVisibility = userContribution.visibility as ContributionVisibility
        // Before the state, so the level-change effect below can tell this
        // transition was a load rather than a user choice.
        rehydratedVisibilityRef.current = savedVisibility
        setSharedThesisVisibility(savedVisibility)
        const targets = (userContribution as any).visibility_targets
        const savedIds: string[] = Array.isArray(targets)
          ? targets.map((t: any) => t.node_id).filter(Boolean)
          : []
        setSharedThesisTargetIds(savedIds)
        setSavedAudience({ visibility: savedVisibility, targetIds: savedIds })
        setHasInitializedVisibility(true)
      }
    }
  }, [user?.id, userThesisContributions, userWhereDiffContributions, userRisksContributions, hasInitializedVisibility])

  // Reset initialization when asset changes
  useEffect(() => {
    setHasInitializedVisibility(false)
    rehydratedVisibilityRef.current = null
    setSavedAudience(null)
    setSharedThesisVisibility('firm')
    setSharedThesisTargetIds([])
  }, [asset.id])

  /*
   * Reset target IDs when the visibility LEVEL changes — a team id is not a
   * department id, so the old selection cannot carry over.
   *
   * The ref is what stops this from undoing the rehydration above. That effect
   * sets the level and the targets together; this one then saw the level change
   * and wiped the targets it had just loaded, in the same render cycle. The
   * result was a save with `targetIds: []`, which deleted every
   * contribution_visibility_targets row for the section — the restriction
   * destroyed, the badge still showing a lock.
   */
  useEffect(() => {
    if (rehydratedVisibilityRef.current === sharedThesisVisibility) return
    setSharedThesisTargetIds([])
  }, [sharedThesisVisibility])

  /*
   * The dropdown's own click-outside handler, level selector and target
   * confirmation moved into AudiencePicker, which owns its draft, its
   * dismissal and its focus. What is left here is the page-level state the
   * picker commits into, and the save path that reads it.
   */

  /**
   * Commit the picker's draft.
   *
   * This STAGES the audience; it does not write. The only write path remains
   * `set_contribution_audience`, which `ContributionSection` calls when the
   * section is saved — unchanged by this lane, and the reason the picker can
   * be explored freely.
   *
   * It is async because the picker treats a rejection as "nothing changed" and
   * keeps the panel open; a future version that writes on Apply can slot in
   * here without the component learning anything new.
   */
  const handleAudienceApply = useCallback(async (next: { visibility: ContributionVisibility; targetIds: string[] }) => {
    /*
     * The ref is set to the INCOMING level before the state, so the
     * level-change effect below bails instead of clearing the targets this
     * call is setting. Without it the two setState calls batch, the effect
     * sees the level change, and wipes the ids — the same defect that once
     * saved `targetIds: []` and destroyed a restriction while still showing a
     * lock (see the comment on that effect).
     */
    rehydratedVisibilityRef.current = next.visibility
    setSharedThesisVisibility(next.visibility)
    setSharedThesisTargetIds(next.targetIds)
  }, [])

  // Check if user is viewing their own tab
  const isViewingOwnThesisTab = user && researchViewFilter === user.id

  // Derive view scope for rating divergence badges (accessibleUserIds derived after researchAnalysts below)
  const ratingViewScope: ViewScope | undefined = React.useMemo(() => {
    if (researchViewFilter === 'aggregated') return { type: 'firm' }
    return { type: 'user', userId: researchViewFilter }
  }, [researchViewFilter])

  // Build thesis status for each covering analyst
  const thesisStatuses = React.useMemo(() => {
    if (!coverage || !thesisContributions) return []
    const now = new Date()
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    return coverage
      .filter(c => c.user_id)
      .map(c => {
        const contribution = thesisContributions.find(t => t.created_by === c.user_id)
        const lastUpdated = contribution?.updated_at
        const isStale = lastUpdated ? new Date(lastUpdated) < ninetyDaysAgo : false

        return {
          userId: c.user_id!,
          hasThesis: !!contribution,
          lastUpdated,
          isStale
        }
      })
  }, [coverage, thesisContributions])

  // Helper to format name as "F. LastName"
  const formatShortName = (fullName: string | null | undefined): string => {
    if (!fullName) return 'Unknown'
    const parts = fullName.trim().split(/\s+/)
    if (parts.length === 1) return parts[0]
    const firstName = parts[0]
    const lastName = parts[parts.length - 1]
    return `${firstName.charAt(0)}. ${lastName}`
  }

  // Build unique analyst list for the research view filter
  // Includes both covering analysts AND contributors (thesis, price targets, etc.)
  const researchAnalysts = React.useMemo(() => {
    const uniqueAnalysts = new Map<string, { id: string; name: string; shortName: string; role: string | null; isCovering: boolean }>()

    // Add covering analysts first (they get role priority)
    coverage?.forEach(c => {
      if (c.user_id && !uniqueAnalysts.has(c.user_id)) {
        uniqueAnalysts.set(c.user_id, {
          id: c.user_id,
          name: c.analyst_name || 'Unknown',
          shortName: formatShortName(c.analyst_name),
          role: c.role,
          isCovering: true
        })
      }
    })

    // Add thesis contributors who aren't already in the list
    // Skip adding entries with "Unknown" name while contributor profiles are still loading
    thesisContributions?.forEach((t: any) => {
      if (t.created_by && !uniqueAnalysts.has(t.created_by)) {
        const profile = contributorProfiles?.find(p => p.id === t.created_by)

        // Try multiple sources for the name: profile, current user (if same ID), or email fallback
        let fullName = profile?.full_name
        if (!fullName && t.created_by === user?.id) {
          // Use current user's metadata if this is the logged-in user
          const firstName = (user as any)?.user_metadata?.first_name || (user as any)?.raw_user_meta_data?.first_name
          const lastName = (user as any)?.user_metadata?.last_name || (user as any)?.raw_user_meta_data?.last_name
          if (firstName && lastName) {
            fullName = `${firstName} ${lastName}`
          } else {
            fullName = user?.email?.split('@')[0]
          }
        }
        if (!fullName) {
          fullName = profile?.email?.split('@')[0]
        }

        // Don't add entries without a name while still loading profiles
        if (!fullName && isLoadingContributorProfiles) {
          return // Skip this entry, it will be added once profiles load
        }

        // Final fallback only after loading is complete
        if (!fullName) {
          fullName = 'Unknown'
        }

        uniqueAnalysts.set(t.created_by, {
          id: t.created_by,
          name: fullName,
          shortName: formatShortName(fullName),
          role: null, // Contributors without coverage don't have a role
          isCovering: false
        })
      }
    })

    // Ensure current user is always in the list so they can switch to their own view
    if (user?.id && !uniqueAnalysts.has(user.id)) {
      const firstName = (user as any)?.user_metadata?.first_name || (user as any)?.raw_user_meta_data?.first_name
      const lastName = (user as any)?.user_metadata?.last_name || (user as any)?.raw_user_meta_data?.last_name
      let fullName = firstName && lastName ? `${firstName} ${lastName}` : user.email?.split('@')[0] || 'Unknown'
      uniqueAnalysts.set(user.id, {
        id: user.id,
        name: fullName,
        shortName: formatShortName(fullName),
        role: null,
        isCovering: false
      })
    }

    // Sort: covering analysts by role first, then contributors
    return Array.from(uniqueAnalysts.values()).sort((a, b) => {
      // Covering analysts come before non-covering
      if (a.isCovering && !b.isCovering) return -1
      if (!a.isCovering && b.isCovering) return 1

      // Among covering analysts, sort by role
      if (a.isCovering && b.isCovering) {
        const roleOrder: Record<string, number> = { primary: 0, secondary: 1, tertiary: 2 }
        const aOrder = a.role ? (roleOrder[a.role] ?? 3) : 4
        const bOrder = b.role ? (roleOrder[b.role] ?? 3) : 4
        return aOrder - bOrder
      }

      // Among contributors, sort alphabetically
      return a.name.localeCompare(b.name)
    })
  }, [coverage, thesisContributions, contributorProfiles, isLoadingContributorProfiles, user])

  /**
   * Resolve the research default, once, when the analyst list arrives.
   *
   * ── The rule, in order ───────────────────────────────────────────────
   *
   *   1. The reader HAS their own research on this name  → their own view.
   *      This is the change: an analyst opening a name they cover lands on
   *      their own work, not on a combined firm pane.
   *   2. Otherwise, the primary covering analyst's view  → clearly labelled
   *      as that person's, because the pills show whose view is selected.
   *   3. Otherwise any covering analyst, then any contributor.
   *   4. Nobody has written anything                     → Our View, which
   *      is the honest landing state when there is no individual research to
   *      open.
   *
   * ── What it must never do ────────────────────────────────────────────
   *
   * It does NOT create a research record, claim ownership, or write anything.
   * Selecting a filter is a read. Case 2 and 3 open somebody ELSE's view, and
   * the selector makes whose it is explicit — the alternative, opening an
   * empty "own" view, would imply the reader has research they do not have.
   *
   * It runs only while UNRESOLVED, so an explicit choice, a restored choice,
   * or an arriving navigation intent is never overridden. Waiting for
   * `isLoadingContributorProfiles` avoids resolving against a half-loaded
   * list and then appearing to "jump" views.
   */
  useEffect(() => {
    if (researchDefaultDecided) return
    if (isLoadingContributorProfiles) return
    // Coverage is the other input; `undefined` means still loading.
    if (coverage === undefined || thesisContributions === undefined) return

    // Decided either way now, so this runs once.
    setResearchDefaultDecided(true)

    // UX2 Phase 1 — My Research is the default landing whenever there is a
    // signed-in reader, INCLUDING when they have not written a case yet (their
    // own view then shows the "Add your view" prompts). Edit is therefore always
    // reachable on arrival. Only with no user at all do we fall back to a
    // covering analyst's view, and finally to the firm (aggregated) summary.
    if (user?.id) {
      setResearchViewFilter(user.id)
      return
    }
    const primary = researchAnalysts.find(a => a.isCovering && a.role === 'primary')
    const covering = researchAnalysts.find(a => a.isCovering)
    const fallback = primary ?? covering ?? researchAnalysts[0]
    setResearchViewFilter(fallback ? fallback.id : 'aggregated')
  }, [
    researchDefaultDecided, isLoadingContributorProfiles, coverage,
    thesisContributions, researchAnalysts, user?.id,
  ])

  // Accessible analyst IDs for rating divergence badge filtering (must be after researchAnalysts)
  const ratingAccessibleUserIds: string[] | undefined = React.useMemo(() => {
    if (!researchAnalysts || researchAnalysts.length === 0) return undefined
    const ids = researchAnalysts.map((a: { id: string }) => a.id)
    if (user?.id && !ids.includes(user.id)) ids.push(user.id)
    return ids
  }, [researchAnalysts, user?.id])

  const { data: priceTargets } = useQuery({
    queryKey: ['price-targets', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_targets')
        .select('*')
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: notes } = useQuery({
    queryKey: ['asset-notes', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_notes')
        .select(`
          *,
          user:users!asset_notes_created_by_fkey(id, first_name, last_name, email)
        `)
        .eq('asset_id', asset.id)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  // Filter notes based on research view filter and sharing status
  const filteredNotes = React.useMemo(() => {
    if (!notes || !user) return []

    if (researchViewFilter === 'aggregated') {
      // "Our View": Show user's own notes + shared notes from others
      return notes.filter(note =>
        note.created_by === user.id || // User's own notes
        (note.created_by !== user.id && note.is_shared === true) // Others' shared notes
      )
    }

    if (researchViewFilter === user.id) {
      // Viewing own notes: show all (shared and unshared)
      return notes.filter(note => note.created_by === user.id)
    }

    // Viewing another user's notes: only show their shared notes
    return notes.filter(note =>
      note.created_by === researchViewFilter && note.is_shared === true
    )
  }, [notes, researchViewFilter, user])

  // Pagination state for notes
  const [notesDisplayCount, setNotesDisplayCount] = useState(5)
  const paginatedNotes = filteredNotes.slice(0, notesDisplayCount)
  const hasMoreNotes = filteredNotes.length > notesDisplayCount

  // Portfolio holdings query.
  //
  // This returned `data`, a name that does not exist in this scope, so the
  // query threw and every exposure block on this page silently rendered its
  // empty state. Repaired, and put on the shared snapshot semantics at the
  // same time: `portfolio_holdings` is dated, so a book uploaded three times
  // otherwise appears three times. See src/lib/portfolio/holdings.ts, which
  // Portfolio, Research, Ideas and the canonical Asset workspace all use.
  const { data: portfolioHoldings } = useQuery({
    queryKey: ['portfolio-holdings', asset.id],
    queryFn: async () => {
      const { data: holdingRows, error } = await supabase
        .from('portfolio_holdings')
        .select(`
          *,
          portfolios (
            id,
            name,
            portfolio_id
          )
        `)
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return currentRows((holdingRows ?? []) as unknown as HoldingRow[]) as any[]
    },
  })

  /*
   * ── One book per portfolio, so a weight divides by its own book ─────────
   *
   * This used to return a bare total per portfolio, built with
   * `latestSnapshotRows` — the portfolio's newest snapshot DATE. The
   * numerator, meanwhile, came from `portfolioHoldings` → `currentRows` —
   * the newest row PER ASSET. Those are two different books whenever an
   * asset's newest row predates the portfolio's newest upload, and the page
   * divided one by the other.
   *
   * On Vision Fund 10K that is not hypothetical. Its uploads are 2026-04-24
   * (2 rows, $2.07m), 2026-04-15 (1 row) and 2026-04-13 (26 rows, $95.4m).
   * AMZN appears only in the 2026-04-13 book, so its $3.95m was divided by
   * the $2.07m of a two-line upload it was never part of: 190.91%. Twenty-
   * seven weights were struck this way and twenty-five of them printed above
   * 100%; the remaining two were simply wrong and said nothing.
   *
   * `buildBook` is the fix because it does not have two books. It reduces
   * with `currentRows` and then takes its denominator from exactly the rows
   * it kept, so numerator and denominator cannot disagree, and it reports
   * the `asOf` of each line so a weight can say which upload it is from.
   * `scripts/holdings-collapse-audit.mjs` records why that reduction and
   * `latestSnapshotRows` are not interchangeable: this one keeps a position
   * that is absent from the latest upload instead of dropping it.
   *
   * Books, not totals, because every caller on this page needs the same
   * line — weight, market value, shares and as-of together — and deriving
   * them separately is how the two definitions arose in the first place.
   */
  const { data: portfolioBooks } = useQuery({
    queryKey: ['portfolio-books', portfolioHoldings?.map(h => h.portfolio_id)],
    queryFn: async () => {
      if (!portfolioHoldings || portfolioHoldings.length === 0) return {}

      const portfolioIds = [...new Set(portfolioHoldings.map(h => h.portfolio_id))]
      const books: Record<string, Book> = {}

      for (const portfolioId of portfolioIds) {
        /*
         * Every row of the book, not just this asset's: a weight is a ratio
         * and the denominator is the whole book. `asset_id` and the symbol
         * travel too — `buildBook` keys positions by asset and classifies
         * cash lines by symbol, and cash is a book line that belongs in the
         * denominator.
         */
        const { data: bookRows, error } = await supabase
          .from('portfolio_holdings')
          .select('portfolio_id, asset_id, shares, cost, price, date, assets ( symbol )')
          .eq('portfolio_id', portfolioId)

        if (error) throw error
        books[portfolioId] = buildBook(portfolioId, (bookRows ?? []) as unknown as HoldingRow[])
      }

      return books
    },
    enabled: !!portfolioHoldings && portfolioHoldings.length > 0,
  })

  /*
   * This asset's line in a given book, or null when there is no book yet.
   *
   * The one accessor all three exposure surfaces read, so the Work sidebar,
   * the Net Exposure tiles and the holdings table cannot drift apart again.
   * Returns null rather than zero while the books are loading: an unknown
   * weight is not a weight of nothing.
   */
  const exposureIn = useCallback((portfolioId: string) => {
    const book = portfolioBooks?.[portfolioId]
    if (!book) return null
    const position = book.positions.find(p => p.assetId === asset.id)
    if (!position) return null
    return {
      weightPct: position.weightPct,
      marketValue: position.marketValue,
      shares: position.shares,
      /* The upload THIS line came from, which is what the number is as of. */
      asOf: position.asOf,
      bookValue: book.totalValue,
    }
  }, [portfolioBooks, asset.id])

  // Current stock price for P&L calculations
  const { data: currentQuote } = useQuery({
    queryKey: ['stock-quote', asset.symbol],
    queryFn: async () => {
      const quote = await financialDataService.getQuote(asset.symbol)
      return quote
    },
    /*
     * A price does not depend on owning the thing.
     *
     * This read `&& portfolioHoldings.length > 0`, so the quote was fetched
     * only for names already in a book. For every other security — a
     * research candidate, a watchlist name, anything being worked up before
     * a position exists — `currentQuote` stayed undefined, and three things
     * went quiet with it:
     *
     *   • `PriceTargetsSummary` computes upside as
     *     `currentPrice && aggregatedPrice ? … : …` (PriceTargetsSummary.tsx:77),
     *     so every upside figure rendered blank;
     *   • `useRatingDivergence` bails on `!currentPrice`
     *     (useRatingDivergence.ts:234) and returns no warning — the
     *     rating-versus-expected-value check was SUPPRESSED rather than
     *     deferred, on exactly the assets where a view is still forming;
     *   • the capital bar's market value fell back to the holdings price.
     *
     * Meanwhile the header rendered a live price the whole time, because
     * `StockQuote` (:2436) fetches its own and is ungated. So the symptom was
     * a header quoting a price above a price-target panel showing dashes,
     * with its integrity warnings off and nothing saying why.
     *
     * The holdings dependency was never a correctness condition. It was a
     * cost control, and the cost it saved is one quote per asset page.
     */
    enabled: !!asset.symbol,
    staleTime: 15000, // Cache for 15 seconds
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  })

  // Unified view warnings (composes divergence + EV mismatch + revision-based rules)
  const viewWarnings = useViewWarnings({
    assetId: asset.id,
    viewScope: ratingViewScope,
    currentPrice: currentQuote?.price,
    accessibleUserIds: ratingAccessibleUserIds,
  })

  // Query to determine the effective workflow ID for this asset
  // Fetch all workflow relationships for this asset
  const { data: allAssetWorkflows, refetch: refetchAllWorkflows, isLoading: allWorkflowsLoading, isFetching: allWorkflowsFetching } = useQuery({
    queryKey: ['asset-all-workflows', effectiveAsset.id],
    queryFn: async () => {
      // Get all workflow progress records for this asset
      const { data: progressData, error: progressError } = await supabase
        .from('asset_workflow_progress')
        .select(`
          *,
          workflows:workflow_id (
            id,
            name,
            branch_suffix,
            description,
            status,
            template_version_id,
            template_version_number,
            parent_workflow_id,
            created_at,
            archived,
            deleted
          )
        `)
        .eq('asset_id', effectiveAsset.id)
        .order('created_at', { ascending: false })

      if (progressError) {
        console.error('Error fetching asset workflows:', progressError)
        return []
      }

      // Filter to only show workflow branches (not templates), and exclude deleted/archived
      const filtered = progressData?.filter(p =>
        p.workflows &&
        !p.workflows.deleted &&
        !p.workflows.archived &&
        p.workflows.parent_workflow_id !== null  // Only branches, not templates
      ) || []

      // Enhance each workflow with progress statistics
      const enhancedWorkflows = await Promise.all(filtered.map(async (workflow) => {
        // Get task completion stats for this workflow
        const { data: taskStats } = await supabase
          .from('asset_checklist_items')
          .select('id, completed')
          .eq('asset_id', effectiveAsset.id)
          .eq('workflow_id', workflow.workflow_id)

        const total_tasks = taskStats?.length || 0
        const completed_tasks = taskStats?.filter(t => t.completed).length || 0

        // Get stage information for this workflow
        const { data: stageData } = await supabase
          .from('workflow_stages')
          .select('id, stage_key, sort_order')
          .eq('workflow_id', workflow.workflow_id)
          .order('sort_order', { ascending: true })

        const total_stages = stageData?.length || 0
        const current_stage_index = workflow.current_stage_key
          ? (stageData?.findIndex(s => s.stage_key === workflow.current_stage_key) ?? 0)
          : 0

        return {
          ...workflow,
          total_tasks,
          completed_tasks,
          total_stages,
          current_stage_index
        }
      }))

      return enhancedWorkflows
    },
    enabled: !!effectiveAsset.id
  })

  // Count of active (non-completed) processes for badge/chip display
  const activeProcessCount = allAssetWorkflows?.filter(w => !w.is_completed && w.workflows?.status === 'active').length ?? 0

  // Fetch available active workflow branches that asset can join
  const { data: availableWorkflows } = useQuery({
    queryKey: ['asset-available-workflows', effectiveAsset.id, user?.id],
    queryFn: async () => {
      if (!user?.id) {
        return []
      }

      // Get IDs of workflows the asset is already in - fetch directly from DB to avoid stale cache
      const { data: assetProgressRecords } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id')
        .eq('asset_id', effectiveAsset.id)

      const assetWorkflowIds = assetProgressRecords?.map(ap => ap.workflow_id) || []

      // Get workflow IDs where user is admin (creator) or stakeholder
      const { data: stakeholderWorkflows } = await supabase
        .from('workflow_stakeholders')
        .select('workflow_id')
        .eq('user_id', user.id)

      const stakeholderWorkflowIds = new Set(stakeholderWorkflows?.map(sw => sw.workflow_id) || [])

      // Fetch active asset-scoped workflow branches (not templates, not portfolio/general)
      const { data: allBranches, error } = await supabase
        .from('workflows')
        .select(`
          id,
          name,
          branch_suffix,
          description,
          status,
          template_version_id,
          template_version_number,
          created_by,
          is_public,
          archived,
          parent_workflow_id,
          scope_type,
          created_at
        `)
        .eq('status', 'active')
        .eq('archived', false)
        .eq('deleted', false)
        .not('parent_workflow_id', 'is', null)  // Only branches, not templates
        .or('scope_type.eq.asset,scope_type.is.null')  // Only asset-scoped processes
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching available workflows:', error)
        return []
      }

      // Also fetch parent workflows to check if they're archived
      const parentIds = [...new Set(allBranches?.map(b => b.parent_workflow_id).filter(Boolean) || [])]
      const { data: parentWorkflows } = await supabase
        .from('workflows')
        .select('id, archived')
        .in('id', parentIds.length > 0 ? parentIds : ['none'])

      const archivedParentIds = new Set(
        parentWorkflows?.filter(p => p.archived).map(p => p.id) || []
      )

      // Filter to only workflows where user has access:
      // 1. User created the workflow (admin)
      // 2. User is a stakeholder on the branch itself
      // 3. User is a stakeholder on the parent template workflow
      // 4. Parent workflow is not archived
      const accessibleWorkflows = allBranches?.filter(w => {
        // Skip if parent is archived
        if (w.parent_workflow_id && archivedParentIds.has(w.parent_workflow_id)) return false

        // User is admin (creator) of the workflow
        if (w.created_by === user.id) return true

        // User is stakeholder on the branch itself
        if (stakeholderWorkflowIds.has(w.id)) return true

        // User is stakeholder on the parent template
        if (w.parent_workflow_id && stakeholderWorkflowIds.has(w.parent_workflow_id)) return true

        return false
      }) || []

      // Filter out workflows asset is already in
      const available = accessibleWorkflows.filter(w => !assetWorkflowIds.includes(w.id))

      return available
    },
    enabled: !!asset.id && !!user?.id
  })


  // Fetch workflows with cadence settings for upcoming branches calculation
  const { data: upcomingBranches } = useQuery({
    queryKey: ['asset-upcoming-branches', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // Fetch workflow templates with cadence settings
      const { data: workflows, error } = await supabase
        .from('workflows')
        .select(`
          id,
          name,
          description,
          cadence_days,
          cadence_timeframe,
          kickoff_cadence,
          kickoff_custom_date,
          auto_create_branch,
          auto_branch_name,
          template_version_number,
          status,
          created_at
        `)
        .eq('auto_create_branch', true)
        .eq('archived', false)
        .or(`is_public.eq.true,created_by.eq.${user.id}`)

      if (error) {
        console.error('Error fetching workflows for upcoming branches:', error)
        return []
      }

      if (!workflows || workflows.length === 0) return []

      // For now, we'll calculate upcoming branches without last branch dates
      // In production, you'd want to fetch the most recent branch for each workflow template
      const { calculateUpcomingBranches } = await import('../../lib/upcomingBranchUtils')
      const lastBranchDates = new Map<string, Date>()

      return calculateUpcomingBranches(workflows, lastBranchDates, 30)
    },
    enabled: !!user?.id
  })

  const { data: effectiveWorkflowId, isLoading: workflowIdLoading, isFetching: workflowIdFetching } = useQuery({
    queryKey: ['asset-effective-workflow', asset.id],
    queryFn: async () => {
      // The workflow an asset is in is per-organisation, so it cannot be read
      // from the global assets row — assets.workflow_id held one org's answer
      // for a row every tenant shares. asset_workflow_progress is org-scoped
      // through workflows.organization_id and is the authority; the in-memory
      // asset.workflow_id is only this session's current selection.
      const { data: freshProgress } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id')
        .eq('asset_id', asset.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const currentWorkflowId = asset.workflow_id || freshProgress?.workflow_id

      // If asset has explicit workflow_id, use it
      if (currentWorkflowId) {
        asset.workflow_id = currentWorkflowId
        const { data: workflowCheck, error: checkError } = await supabase
          .from('workflows')
          .select('id, status, archived, deleted')
          .eq('id', currentWorkflowId)
          .single()

        if (checkError || !workflowCheck || workflowCheck.archived || workflowCheck.deleted) {

          // The selected workflow is archived/deleted, find the next available workflow
          const { data: nextWorkflow } = await supabase
            .from('asset_workflow_progress')
            .select(`
              workflow_id,
              workflows!inner (
                id,
                status,
                archived,
                deleted,
                parent_workflow_id,
                created_at
              )
            `)
            .eq('asset_id', asset.id)
            .eq('is_started', true)
            .eq('workflows.archived', false)
            .eq('workflows.deleted', false)
            .not('workflows.parent_workflow_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          const nextWorkflowId = nextWorkflow?.workflow_id || null

          // No writeback to assets.workflow_id. It was a cache of a
          // resolution this component already performs against
          // asset_workflow_progress + workflows, and a single column on a
          // globally shared asset row cannot hold a second organisation's
          // answer — the 490 populated values on production all belong to
          // one org, and the next org to adopt workflows would overwrite
          // them. The resolver below is the authority.
          asset.workflow_id = nextWorkflowId

          if (nextWorkflowId) {
            return nextWorkflowId
          } else {
            return null
          }
        } else {
          // Allow viewing completed/inactive workflows that user explicitly selected
          return currentWorkflowId
        }
      }

      // Otherwise, check if there's an active workflow progress record
      // Only look for workflow BRANCHES (not templates) that are active
      // Simple two-step approach to avoid PostgREST join ambiguity
      // Step 1: Get all workflow progress records for this asset
      const { data: progressRecords, error } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id')
        .eq('asset_id', asset.id)
        .eq('is_started', true)
        .eq('is_completed', false)
        .order('updated_at', { ascending: false })

      if (error || !progressRecords || progressRecords.length === 0) {
        return null
      }

      // Step 2: Check which of these workflows are active branches
      const workflowIds = progressRecords.map(p => p.workflow_id)
      const { data: activeWorkflows } = await supabase
        .from('workflows')
        .select('id')
        .in('id', workflowIds)
        .eq('status', 'active')
        .eq('archived', false)
        .eq('deleted', false)
        .not('parent_workflow_id', 'is', null)
        .limit(1)

      if (activeWorkflows && activeWorkflows.length > 0) {
        const foundId = activeWorkflows[0].id
        // Resolved from asset_workflow_progress; held in memory for this render
        // pass only, never written back to the shared assets row.
        asset.workflow_id = foundId
        return foundId
      }

      // Step 3: No progress records — check if the asset is in any active branch's scope
      const { data: scopeWorkflows } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id')
        .eq('asset_id', asset.id)
        .order('updated_at', { ascending: false })

      if (scopeWorkflows && scopeWorkflows.length > 0) {
        const scopeWfIds = scopeWorkflows.map(s => s.workflow_id)
        const { data: activeScopeWfs } = await supabase
          .from('workflows')
          .select('id')
          .in('id', scopeWfIds)
          .eq('status', 'active')
          .eq('archived', false)
          .eq('deleted', false)
          .not('parent_workflow_id', 'is', null)
          .limit(1)

        if (activeScopeWfs && activeScopeWfs.length > 0) {
          const foundId = activeScopeWfs[0].id
          asset.workflow_id = foundId
          return foundId
        }
      }

      return null
    },
    staleTime: 30_000,
    refetchOnMount: true,
  })

  // Log the effective workflow ID for debugging
  React.useEffect(() => {
    if (!workflowIdLoading) {
    }
  }, [effectiveWorkflowId, workflowIdLoading, asset.symbol])

  /*
   * The active workflow's identity for the Work summary.
   *
   * Declared HERE rather than beside the other Work state, because it reads
   * `effectiveWorkflowId` and `availableWorkflows`, which are declared above
   * this line — referencing them earlier is a temporal dead zone, which this
   * repo has a guard for.
   *
   * Name only. Progress is deliberately absent (see the render site), and
   * `null` means "this asset has no running process", never "I did not look".
   */
  const processSummary = useAssetProcessSummary(
    asset.id, effectiveWorkflowId, activeMode === 'work'
  )
  const workProcessSummary = React.useMemo(() => {
    if (processSummary.status === 'none') return null
    return {
      workflowName: processSummary.workflowName ?? 'Active process',
      stages: processSummary.stages.map(s => ({
        id: s.id,
        label: s.label,
        done: s.done ?? undefined,
        total: s.total ?? undefined,
        active: s.active,
      })),
      openStageLabel: processSummary.active?.label ?? null,
      openStageDone: processSummary.active?.done ?? undefined,
      openStageTotal: processSummary.active?.total ?? undefined,
      deadline: processSummary.nextDeadlineDate ?? null,
    }
  }, [processSummary])

  // Fetch templates for the asset's workflow
  const { data: workflowTemplates, isLoading: templatesLoading } = useQuery({
    queryKey: ['workflow-templates', effectiveWorkflowId],
    queryFn: async () => {
      if (!effectiveWorkflowId) return []

      const { data, error } = await supabase
        .from('workflow_templates')
        .select('*')
        .eq('workflow_id', effectiveWorkflowId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!effectiveWorkflowId
  })

  // Fetch checklist attachments for the asset
  const { data: checklistAttachments, isLoading: attachmentsLoading } = useQuery({
    queryKey: ['asset-checklist-attachments', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_checklist_attachments')
        .select('*')
        .eq('asset_id', asset.id)
        .order('uploaded_at', { ascending: false })

      if (error) throw error
      return data || []
    }
  })

  /*
   * Lists that contain this asset.
   *
   * This read named tables that do not exist. `list_items` and `lists` are not
   * in the schema — the real ones are `asset_list_items` and `asset_lists` —
   * so PostgREST answered nothing and the "Lists containing this asset" panel
   * below has always rendered empty. It fails silently because an empty result
   * and no result look identical here.
   *
   * Two other columns were wrong with it: `asset_lists` carries `list_type`,
   * not `type`, and `asset_list_items` timestamps the membership as `added_at`,
   * not `created_at` — so the ordering referenced a column that is not there
   * either. Ordering by `added_at` is also the more useful answer: most
   * recently filed first.
   *
   * Scope needs no filter. RLS on these tables is owner-or-collaborator, so
   * this returns the lists this reader may see and no others.
   *
   * ── Then it had to answer one more question ──────────────────────────────
   *
   * Naming the lists is not managing membership. The select above dropped the
   * membership row's own id and `added_by`, so there was nothing to delete and
   * no way to ask whether this reader may. `useAssetListMemberships` is that
   * same single request, widened to carry both, with the existing per-row rule
   * applied. It replaces this query rather than joining it.
   */
  const {
    memberships: assetListMemberships,
    isLoading: listsLoading,
    remove: removeFromList,
  } = useAssetListMemberships(asset.id)

  /*
   * ── The reader's own CoAnalyst threads about this name ──────────────────
   *
   * Gated on the Work mode, like the other Work-only reads. Strictly
   * private: `ai_conversations` is `user_id = auth.uid()` and the hook
   * filters on the owner again on top of that. No message content is
   * fetched — the surface shows titles and timestamps only.
   */
  const {
    conversations: assetConversations,
    isLoading: conversationsLoading,
  } = useAssetConversations(asset.id, activeMode === 'work')

  /*
   * The engagement target for this asset, built once.
   *
   * `askAI` is the existing seam — the same one the header's Ask AI button
   * uses — so opening a thread from here goes through the pane that already
   * exists rather than a second route into CoAnalyst.
   */
  const assetEngagementTarget = React.useMemo(() => ({
    objectType: 'asset' as const,
    objectId: asset.id,
    label: asset.company_name ? `${asset.symbol} — ${asset.company_name}` : (asset.symbol ?? 'Asset'),
    symbol: asset.symbol ?? undefined,
    assetId: asset.id,
    origin: { itemId: asset.id, surface: 'asset-work' },
  }), [asset.id, asset.symbol, asset.company_name])

  /*
   * ── The work items, and which one the surface is showing ───────────────
   *
   * Built from the data Work already loads: the attention split (the existing
   * `portfolio_team` pm/admin rule), the open ideas, the running processes
   * and the reader's own CoAnalyst threads. No new query, and no new notion
   * of priority — the grouping is categorical and the order within a group is
   * the order each source query returned.
   */
  const workProcesses = React.useMemo(
    () => (allAssetWorkflows ?? []).map((w: any) => ({
      workflowId: w.workflow_id as string,
      name: (w.workflows?.name as string) || 'Process',
      /* Already selected by the query above. It is what tells the Apr 10 run
         of a weekly review from the Apr 3 one. */
      branchSuffix: (w.workflows?.branch_suffix as string | null) ?? null,
      /* The stage label only when the summary hook actually knows it. A
         running process whose stages have not loaded says nothing rather
         than guessing one. */
      stageLabel: w.workflow_id === effectiveWorkflowId
        ? (workProcessSummary?.openStageLabel ?? null)
        : null,
      isStarted: !!w.is_started,
      isCompleted: !!w.is_completed,
    })),
    [allAssetWorkflows, effectiveWorkflowId, workProcessSummary],
  )

  /*
   * The idea stage filter, carried over from the Open Items section.
   *
   * It narrows the IDEA rows only. A process is not at an idea stage, and a
   * filter that hid the running process because the reader wanted to see
   * "Researching" ideas would hide the one thing they can always act on.
   */
  const filteredWorkIdeas = React.useMemo(
    () => (openItemsFilter === 'all'
      ? workIdeas
      : workIdeas.filter(i => toIdeaStage(i.stage) === openItemsFilter)),
    [workIdeas, openItemsFilter],
  )

  const workItems = React.useMemo(
    () => buildWorkItems({
      needsYourAction: workAttention.needsYourAction,
      awaitingOthers: workAttention.awaitingOthers,
      ideas: filteredWorkIdeas.map(i => ({
        id: i.id,
        action: i.action,
        stageLabel: i.stage ? stageLabel(i.stage) : null,
        rationale: i.rationale,
        portfolioName: i.portfolioName,
      })),
      processes: workProcesses,
      conversations: assetConversations.map(c => ({
        id: c.id,
        title: c.title,
        lastActivity: c.lastActivityAt
          ? formatDistanceToNow(new Date(c.lastActivityAt), { addSuffix: true })
          : null,
      })),
    }),
    [workAttention, filteredWorkIdeas, workProcesses, assetConversations],
  )

  const workSelection = React.useMemo(
    () => resolveSelection(workItems, workItemKey),
    [workItems, workItemKey],
  )
  const selectedWorkItem = workSelection.selected

  /*
   * ── Lists and portfolios select, they do not depart ──────────────────
   *
   * Both used to call `onNavigate`, which opens a top-level tab: clicking
   * a book in the asset's own sidebar closed the asset workspace and
   * opened the Portfolio application, losing the process you were working
   * and offering no way back. They are now two more kinds on the SAME
   * selection key the sidebar already persists, so they restore on reload
   * like any other work item, and leaving the asset is a labelled control
   * on the surface instead.
   */
  const contextual = React.useMemo(() => contextualSelection(workItemKey), [workItemKey])
  /** What Back returns to. Null means the Work overview. */
  const [previousWorkKey, setPreviousWorkKey] = useState<string | null>(null)
  const openContextual = React.useCallback((key: string) => {
    /*
     * The RESOLVED selection, not the raw key. On first entry the key is
     * null — the surface auto-resolved to the first process without writing
     * one — so capturing the raw key sent the reader back to "work" when
     * they had been on Earnings Season a moment earlier.
     */
    setPreviousWorkKey(prev =>
      contextualSelection(workItemKey) ? prev : (workItemKey ?? selectedWorkItem?.key ?? null))
    setWorkItemKey(key)
  }, [workItemKey, selectedWorkItem])
  const contextualBack = React.useMemo(
    () => backTarget(previousWorkKey, (key) => workItems.find(i => i.key === key)?.label ?? null),
    [previousWorkKey, workItems],
  )
  const leaveContextual = React.useCallback(() => {
    setWorkItemKey(contextualBack.key)
    setPreviousWorkKey(null)
  }, [contextualBack.key])
  /*
   * ── Loading is not absence ──────────────────────────────────────────
   *
   * The work surface said "No active work on this asset" whenever nothing
   * was selected, and nothing can be selected until the four queries that
   * BUILD the list have answered. On a cold load that is a false statement
   * held on screen for several seconds — measured at ~8s against the dev
   * server, on an asset with four running processes — and it is the worst
   * kind of wrong, because it is a confident claim about the reader's own
   * work rather than a blank.
   *
   * One flag, read by the navigator and the surface together, so the two
   * can never disagree about whether the answer is in yet.
   */
  const workIsResolving =
    workAttentionLoading || openItemsLoading || conversationsLoading || allWorkflowsLoading
  const selectedWorkIdea = React.useMemo(
    () => (selectedWorkItem?.kind === 'idea'
      ? workIdeas.find(i => i.id === selectedWorkItem.id) ?? null
      : null),
    [selectedWorkItem, workIdeas],
  )

  // Fetch themes that contain this asset
  const { data: assetThemes, isLoading: themesLoading } = useQuery({
    queryKey: ['asset-themes', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('theme_assets')
        .select('themes(id, name, description, created_at, theme_type, color)')
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('❌ Error fetching asset themes:', error)
        throw error
      }
      const themes = data?.map(item => item.themes).filter(Boolean) || []
      return themes
    }
  })

  // Thesis references (crucial supporting documents). Was
  // assets.thesis_references, a jsonb column on the globally shared asset row;
  // now the caller's own thesis contribution attachments, which are org-scoped.
  const { data: thesisReferences = [] } = useQuery({
    queryKey: ['thesis-references', asset.id, user?.id, assetExploredOrgId],
    queryFn: () => fetchThesisReferences(asset.id, user?.id, assetExploredOrgId),
    enabled: !!user?.id && !!assetExploredOrgId,
  })

  const updateThesisRefsMutation = useMutation({
    mutationFn: (references: typeof thesisReferences) =>
      saveThesisReferences(asset.id, user?.id, assetExploredOrgId, references),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thesis-references', asset.id, user?.id, assetExploredOrgId] })
    }
  })

  const addThesisRef = (ref: Omit<typeof thesisReferences[0], 'addedAt'>) => {
    const exists = thesisReferences.some(r =>
      (r.type === 'note' && ref.type === 'note' && r.id === ref.id) ||
      (r.type === 'file' && ref.type === 'file' && r.id === ref.id) ||
      (r.type === 'link' && ref.type === 'link' && r.url === ref.url)
    )
    if (exists) return
    updateThesisRefsMutation.mutate([...thesisReferences, { ...ref, addedAt: new Date().toISOString() }])
  }

  const removeThesisRef = (index: number) => {
    updateThesisRefsMutation.mutate(thesisReferences.filter((_, i) => i !== index))
  }

  // Fetch per-user key references (new system)
  const { references: userKeyReferences = [] } = useKeyReferences(asset.id)

  /* `getThemeTypeColor` went with the Themes card that coloured its Badge.
     The sidebar shows the theme type as a neutral tag, so there is no
     variant to pick. */

  // ---------- Mutations ----------
  const updateAssetMutation = useMutation({
    mutationFn: async (updates: any) => {
      const { error } = await supabase
        .from('assets')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', asset.id)
      if (error) throw error
      return { ...updates, updated_at: new Date().toISOString() }
    },
    onSuccess: (result) => {
      Object.assign(asset, result)
      setHasLocalChanges(false)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      queryClient.invalidateQueries({ queryKey: ['all-assets'] })
      // Also invalidate any asset list queries that might contain this asset
      queryClient.invalidateQueries({ queryKey: ['asset-list-items'] })
      queryClient.invalidateQueries({ queryKey: ['theme-related-assets'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-holdings'] })
    },
  })

  // Recalculate asset completeness.
  //
  // This used to read the three research columns off the global `assets` row
  // and write the score back to `assets.completeness`. Both halves were wrong
  // for the same reason: research is per-organisation, so a single column on a
  // row shared by every tenant can only ever hold one org's answer, and the
  // last writer won across tenant boundaries. The inputs now come from the
  // org-scoped contributions model and the score is held in component state —
  // it is a derived value, and deriving it is cheaper than reconciling a cache
  // that has no tenant to belong to.
  const updateAssetCompleteness = async () => {
    const research = await fetchOneAssetResearch(asset.id, assetExploredOrgId)
    const completeness = calculateAssetCompleteness({
      thesis: research.thesis,
      where_different: research.where_different,
      risks_to_thesis: research.risks_to_thesis,
      priceTargets: priceTargets || []
    })

    if (completeness !== asset.completeness) {
      asset.completeness = completeness
    }
  }

  // Autosave mutation with completeness update
  const handleSectionSave = (fieldName: string) => {
    return async (content: string) => {
      await updateAssetMutation.mutateAsync({ [fieldName]: content })
      // Recalculate completeness after saving thesis-related fields
      if (['thesis', 'where_different', 'risks_to_thesis'].includes(fieldName)) {
        await updateAssetCompleteness()
      }
    }
  }

  const updatePriceTargetMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { error } = await supabase.from('price_targets').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['price-targets', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['price-target-history'] })
      queryClient.invalidateQueries({ queryKey: ['case-history'] })
      // Recalculate completeness after updating price target
      await updateAssetCompleteness()
    },
  })

  const createPriceTargetMutation = useMutation({
    mutationFn: async (priceTarget: any) => {
      const { error } = await supabase
        .from('price_targets')
        .insert([{ ...priceTarget, asset_id: asset.id, created_by: user?.id }])
      if (error) throw error
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['price-targets', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['price-target-history'] })
      queryClient.invalidateQueries({ queryKey: ['case-history'] })
      // Recalculate completeness after creating price target
      await updateAssetCompleteness()
    },
  })

  // Workflow action mutations
  const joinWorkflowMutation = useMutation({
    mutationFn: async ({ workflowId, startImmediately }: { workflowId: string; startImmediately: boolean }) => {

      // Check session state before inserting
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      // Record as an 'add' override - the trigger will handle creating asset_workflow_progress
      // and auto-starting the workflow if it's an active branch
      const { error: overrideError } = await supabase
        .from('workflow_universe_overrides')
        .upsert({
          workflow_id: workflowId,
          asset_id: asset.id,
          override_type: 'add',
          created_by: user?.id
        }, {
          onConflict: 'workflow_id,asset_id'
        })


      if (overrideError) {
        console.error('❌ Error joining workflow:', overrideError)
        throw overrideError
      }


      // If asset has no workflow selected, automatically select the newly added workflow
      if (!asset.workflow_id) {
        // The org-scoped asset_workflow_progress row written above is the record
        // of this; assets.workflow_id is only the in-memory selection.
        asset.workflow_id = workflowId
      }

      return workflowId
    },
    onMutate: async ({ workflowId }) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['asset-all-workflows', asset.id] })
      await queryClient.cancelQueries({ queryKey: ['asset-available-workflows', asset.id, user?.id] })

      // Snapshot the previous values
      const previousAllWorkflows = queryClient.getQueryData(['asset-all-workflows', asset.id])
      const previousAvailableWorkflows = queryClient.getQueryData(['asset-available-workflows', asset.id, user?.id])

      // Find the workflow being added from availableWorkflows
      const availableWorkflows = queryClient.getQueryData<typeof allAvailableWorkflows>(['asset-available-workflows', asset.id, user?.id]) || []
      const workflowToAdd = availableWorkflows.find((w: any) => w.id === workflowId)

      if (workflowToAdd) {
        // Optimistically add to allAssetWorkflows
        const currentAllWorkflows = queryClient.getQueryData<typeof allAssetWorkflows>(['asset-all-workflows', asset.id]) || []
        const now = new Date().toISOString()
        const optimisticWorkflow: any = {
          id: `temp-${Date.now()}`,
          asset_id: asset.id,
          workflow_id: workflowId,
          current_stage_key: null,
          is_started: true,
          is_completed: false,
          started_at: now,
          completed_at: null,
          created_at: now,
          updated_at: now,
          workflows: {
            id: workflowToAdd.id,
            name: workflowToAdd.name,
            branch_suffix: workflowToAdd.branch_suffix,
            description: workflowToAdd.description,
            status: workflowToAdd.status,
            template_version_id: workflowToAdd.template_version_id,
            template_version_number: workflowToAdd.template_version_number,
            created_at: workflowToAdd.created_at || now,
            archived: workflowToAdd.archived,
            parent_workflow_id: workflowToAdd.parent_workflow_id
          }
        }

        // Find the correct insertion index (sorted by created_at descending)
        // Use workflow's created_at, not the progress record's created_at
        const optimisticCreatedAt = new Date(optimisticWorkflow.workflows.created_at).getTime()
        let insertIndex = currentAllWorkflows.length

        for (let i = 0; i < currentAllWorkflows.length; i++) {
          const currentCreatedAt = new Date((currentAllWorkflows[i] as any).workflows?.created_at || 0).getTime()
          if (optimisticCreatedAt > currentCreatedAt) {
            insertIndex = i
            break
          }
        }

        // Insert at the correct position without resorting
        const newAllWorkflows = [
          ...currentAllWorkflows.slice(0, insertIndex),
          optimisticWorkflow,
          ...currentAllWorkflows.slice(insertIndex)
        ]

        queryClient.setQueryData(['asset-all-workflows', asset.id], newAllWorkflows)

        // Optimistically remove from availableWorkflows
        queryClient.setQueryData(
          ['asset-available-workflows', asset.id, user?.id],
          availableWorkflows.filter((w: any) => w.id !== workflowId)
        )
      }

      return { previousAllWorkflows, previousAvailableWorkflows }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      console.error('❌ Join workflow mutation error:', err)
      if (context?.previousAllWorkflows) {
        queryClient.setQueryData(['asset-all-workflows', asset.id], context.previousAllWorkflows)
      }
      if (context?.previousAvailableWorkflows) {
        queryClient.setQueryData(['asset-available-workflows', asset.id, user?.id], context.previousAvailableWorkflows)
      }
    },
    onSettled: async () => {
      // Wait a tick to ensure optimistic update is rendered before refetching
      await new Promise(resolve => setTimeout(resolve, 0))

      // Refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-available-workflows', asset.id, user?.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-overrides'] })
      queryClient.invalidateQueries({ queryKey: ['assets'] })
    }
  })

  const markWorkflowCompleteMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('asset_workflow_progress')
        .update({
          is_completed: true,
          completed_at: new Date().toISOString()
        })
        .eq('asset_id', asset.id)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: (_, workflowId) => {
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', asset.id, workflowId] })
      refetchAllWorkflows()
    }
  })

  const removeFromWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      // Remove asset from workflow progress
      const { error } = await supabase
        .from('asset_workflow_progress')
        .delete()
        .eq('asset_id', asset.id)
        .eq('workflow_id', workflowId)
      if (error) throw error

      // If we're removing the currently selected workflow, select the next one
      if (asset.workflow_id === workflowId) {
        // Get all active workflows except the one being removed
        const { data: remainingWorkflows } = await supabase
          .from('asset_workflow_progress')
          .select(`
            workflow_id,
            created_at,
            workflows!inner (
              id,
              status,
              archived,
              deleted,
              parent_workflow_id,
              created_at
            )
          `)
          .eq('asset_id', asset.id)
          .neq('workflow_id', workflowId)
          .eq('is_started', true)
          .eq('workflows.status', 'active')
          .eq('workflows.archived', false)
          .eq('workflows.deleted', false)
          .not('workflows.parent_workflow_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const nextWorkflowId = remainingWorkflows?.workflow_id || null

        // Local selection only — see the note on the resolver above.
        asset.workflow_id = nextWorkflowId
      }

      // Record as a 'remove' override (upsert to handle removing after manual add)
      const { error: overrideError } = await supabase
        .from('workflow_universe_overrides')
        .upsert({
          workflow_id: workflowId,
          asset_id: asset.id,
          override_type: 'remove',
          created_by: user?.id
        }, {
          onConflict: 'workflow_id,asset_id'
        })
      if (overrideError) console.error('Error recording override:', overrideError)
      return workflowId
    },
    onMutate: async (workflowId: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['asset-all-workflows', asset.id] })
      await queryClient.cancelQueries({ queryKey: ['asset-available-workflows', asset.id, user?.id] })

      // Snapshot the previous values
      const previousAllWorkflows = queryClient.getQueryData(['asset-all-workflows', asset.id])
      const previousAvailableWorkflows = queryClient.getQueryData(['asset-available-workflows', asset.id, user?.id])

      // Find the workflow being removed
      const currentAllWorkflows = queryClient.getQueryData<typeof allAssetWorkflows>(['asset-all-workflows', asset.id]) || []
      const workflowToRemove = currentAllWorkflows.find((w: any) => w.workflow_id === workflowId)

      if (workflowToRemove && workflowToRemove.workflows) {
        // Optimistically remove from allAssetWorkflows
        queryClient.setQueryData(
          ['asset-all-workflows', asset.id],
          currentAllWorkflows.filter((w: any) => w.workflow_id !== workflowId)
        )

        // Optimistically add back to availableWorkflows in the correct sorted position
        const currentAvailableWorkflows = queryClient.getQueryData<typeof allAvailableWorkflows>(['asset-available-workflows', asset.id, user?.id]) || []
        const workflowToAdd: any = {
          id: workflowToRemove.workflows.id,
          name: workflowToRemove.workflows.name,
          branch_suffix: workflowToRemove.workflows.branch_suffix,
          description: workflowToRemove.workflows.description,
          status: workflowToRemove.workflows.status,
          template_version_id: workflowToRemove.workflows.template_version_id,
          template_version_number: workflowToRemove.workflows.template_version_number,
          created_by: user?.id || '',
          is_public: false,
          archived: workflowToRemove.workflows.archived,
          created_at: workflowToRemove.workflows.created_at,
          parent_workflow_id: null // Add this field for consistency
        }

        // Find the correct insertion index (sorted by created_at descending)
        const workflowCreatedAt = new Date(workflowToAdd.created_at || 0).getTime()
        let insertIndex = currentAvailableWorkflows.length

        for (let i = 0; i < currentAvailableWorkflows.length; i++) {
          const currentCreatedAt = new Date((currentAvailableWorkflows[i] as any).created_at || 0).getTime()
          if (workflowCreatedAt > currentCreatedAt) {
            insertIndex = i
            break
          }
        }


        // Insert at the correct position without resorting
        const newAvailableWorkflows = [
          ...currentAvailableWorkflows.slice(0, insertIndex),
          workflowToAdd,
          ...currentAvailableWorkflows.slice(insertIndex)
        ]

        queryClient.setQueryData(
          ['asset-available-workflows', asset.id, user?.id],
          newAvailableWorkflows
        )
      }

      return { previousAllWorkflows, previousAvailableWorkflows }
    },
    onError: (err, workflowId, context) => {
      // Rollback on error
      console.error('❌ Remove workflow mutation error:', err)
      if (context?.previousAllWorkflows) {
        queryClient.setQueryData(['asset-all-workflows', asset.id], context.previousAllWorkflows)
      }
      if (context?.previousAvailableWorkflows) {
        queryClient.setQueryData(['asset-available-workflows', asset.id, user?.id], context.previousAvailableWorkflows)
      }
    },
    onSettled: async () => {
      // Wait a tick to ensure optimistic update is rendered before refetching
      await new Promise(resolve => setTimeout(resolve, 0))

      // Refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-available-workflows', asset.id, user?.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-overrides'] })
      queryClient.invalidateQueries({ queryKey: ['assets'] })
    }
  })

  const startWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('asset_workflow_progress')
        .update({
          is_started: true,
          started_at: new Date().toISOString()
        })
        .eq('asset_id', asset.id)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      refetchAllWorkflows()
    }
  })

  const restartWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('asset_workflow_progress')
        .update({
          is_completed: false,
          completed_at: null,
          is_started: true,
          started_at: new Date().toISOString()
        })
        .eq('asset_id', asset.id)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: (_, workflowId) => {
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', asset.id, workflowId] })
      refetchAllWorkflows()
    }
  })

  // ---------- Helpers ----------

  const getStageColor = (s: string | null) => {
    switch (s) {
      case 'research': return 'primary'
      case 'analysis': return 'warning'
      case 'monitoring': return 'success'
      case 'review':
      case 'archived':
      default: return 'default'
    }
  }

  const handleWorkflowPriorityChange = async (newPriority: string) => {
    if (!asset.workflow_id) return

    setWorkflowPriorityState(newPriority)
    setHasLocalChanges(true)

    try {
      const { error } = await supabase
        .from('asset_workflow_priorities')
        .upsert({
          asset_id: asset.id,
          workflow_id: asset.workflow_id,
          priority: newPriority,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'asset_id,workflow_id'
        })

      if (error) throw error

      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['asset-workflow-priority', asset.id, asset.workflow_id] })

      setHasLocalChanges(false)
    } catch (error) {
      console.error('Error updating workflow priority:', error)
      // Revert on error
      setWorkflowPriorityState(workflowPriority || 'none')
    }
  }


  const handleStageChange = (newStage: string) => {
    const prevStage = stage
    setStage(newStage)
    setHasLocalChanges(true)

    // Update the asset object immediately to prevent reversion
    asset.process_stage = newStage

    updateAssetMutation.mutate({ process_stage: newStage })

    // Send analyst notification when stock is prioritized
    if (newStage === 'prioritized' && prevStage !== 'prioritized') {
      sendAnalystNotification()
    }
  }

  const handleWorkflowChange = async (workflowId: string) => {
    setHasLocalChanges(true)

    // Optimistically set the effective workflow ID so the UI switches immediately
    queryClient.setQueryData(['asset-effective-workflow', effectiveAsset.id], workflowId)
    asset.workflow_id = workflowId

    /*
     * ── One switch moves BOTH the workspace and the sidebar ───────────────
     *
     * The Work sidebar reads `workItemKey`; this surface reads
     * `effectiveWorkflowId`. They were moved by different code paths, so each
     * could be pointing at a different run. Setting the selection key here
     * makes this function the single place a process switch happens, whether
     * it was asked for from the dropdown or from the sidebar.
     */
    setWorkItemKey(workItemKeyFor.process(workflowId))

    /*
     * ── Returning is not switching ──────────────────────────────────────
     *
     * Clearing the stage and the requirement is right when the run CHANGES:
     * a requirement id belongs to one run's checklist, and carrying it
     * across points completion and assignment at an item the displayed
     * process does not contain.
     *
     * It is wrong when the id is the one already open. This handler runs
     * for every selection of a process row, including re-selecting the one
     * you were on — so opening an idea and clicking back on Earnings Season
     * threw away the requirement you had open and landed you on the stage
     * overview. The reader had not switched anything; they had come back.
     */
    const isSameProcess = workflowId === effectiveWorkflowId
    if (!isSameProcess) {
      setViewingStageId(null)
      setViewingRequirementId(null)
    }

    try {
      // Get the first stage of the new workflow and check if there's an existing workflow progress
      const [workflowStagesResult, workflowProgressResult] = await Promise.all([
        getWorkflowStages(workflowId),
        supabase
          .from('asset_workflow_progress')
          .select('current_stage_key, is_started')
          .eq('asset_id', effectiveAsset.id)
          .eq('workflow_id', workflowId)
          .single()
      ])

      if (workflowStagesResult.error) {
        console.error('Error fetching workflow stages:', workflowStagesResult.error)
        updateAssetMutation.mutate({ workflow_id: workflowId }, {
          onSuccess: () => queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', effectiveAsset.id] })
        })
        return
      }

      const firstStageKey = workflowStagesResult.data?.[0]?.stage_key || 'prioritized'

      // Determine which stage to show: use current_stage_key if available, otherwise first stage
      const workflowProgress = workflowProgressResult.data
      const effectiveCurrentStage = workflowProgress?.current_stage_key || firstStageKey

      setStage(effectiveCurrentStage)

      // Auto-select the appropriate stage to show what needs to be done —
      // but never over a stage the reader is already on in the same run.
      if (!isSameProcess) {
        setTimeout(() => {
          setViewingStageId(effectiveCurrentStage)
        }, 100)
      }

      // Persist to DB — only invalidate after the write lands
      updateAssetMutation.mutate({ workflow_id: workflowId }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', effectiveAsset.id] })
      })
    } catch (error) {
      console.error('Error in handleWorkflowChange:', error)
      updateAssetMutation.mutate({ workflow_id: workflowId }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', effectiveAsset.id] })
      })
    }
  }

  // Execute pending workflow switch once handleWorkflowChange is available
  useEffect(() => {
    if (pendingWorkflowSwitch) {
      // Check if the workflow exists in either allAssetWorkflows or availableWorkflows
      const workflowExists =
        allAssetWorkflows?.some(w => w.workflow_id === pendingWorkflowSwitch.workflowId) ||
        availableWorkflows?.some(w => w.id === pendingWorkflowSwitch.workflowId)

      if (workflowExists || (allAssetWorkflows !== undefined && availableWorkflows !== undefined)) {

        // Optimistically set the effective workflow ID in cache BEFORE clearing pendingWorkflowSwitch.
        // handleWorkflowChange is async (DB queries) but not awaited, so without this the UI would
        // briefly show "No Active Workflows" between clearing the pending guard and the refetch resolving.
        queryClient.setQueryData(['asset-effective-workflow', effectiveAsset.id], pendingWorkflowSwitch.workflowId)

        handleWorkflowChange(pendingWorkflowSwitch.workflowId)

        // After switching, set the stage if provided
        if (pendingWorkflowSwitch.stageId) {
          setTimeout(() => {
            setViewingStageId(pendingWorkflowSwitch.stageId)
          }, 200) // Delay to ensure workflow data is loaded
        }

        // Clear the pending switch
        setPendingWorkflowSwitch(null)
      }
    }
  }, [pendingWorkflowSwitch, allAssetWorkflows, availableWorkflows])

  const handleWorkflowStart = async (workflowId: string) => {

    try {
      // Get the first stage of the workflow
      const { data: workflowStages, error: stagesError } = await getWorkflowStages(workflowId)

      if (stagesError) {
        console.error('Error fetching workflow stages:', stagesError)
        return
      }

      const firstStageKey = workflowStages?.[0]?.stage_key || 'prioritized'
      const now = new Date().toISOString()


      // Create/update workflow progress as started
      const progressData = {
        asset_id: effectiveAsset.id,
        workflow_id: workflowId,
        current_stage_key: firstStageKey,
        is_started: true,
        is_completed: false,
        started_at: now,
        updated_at: now
      }



      const { error: progressError } = await supabase
        .from('asset_workflow_progress')
        .upsert(progressData, {
          onConflict: 'asset_id,workflow_id'
        })

      if (progressError) {
        console.error('❌ Error starting workflow progress:', progressError)
      } else {
        // Invalidate caches so the workflow shows up as active
        await queryClient.invalidateQueries({ queryKey: ['prioritizer-workflows'] })
        await queryClient.invalidateQueries({ queryKey: ['asset-workflows-progress'] })
        await queryClient.invalidateQueries({ queryKey: ['idea-generator-data'] })
        // Invalidate ALL workflow status queries for this asset, not just this specific workflow
        await queryClient.invalidateQueries({ queryKey: ['current-workflow-status', effectiveAsset.id] })
        await queryClient.invalidateQueries({ queryKey: ['current-workflow-status', effectiveAsset.id, workflowId] })
        await queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', effectiveAsset.id] })
        await queryClient.invalidateQueries({ queryKey: ['workflows-all'] })
        // Force refetch of workflow status
        await queryClient.refetchQueries({ queryKey: ['current-workflow-status'] })
      }
    } catch (error) {
      console.error('Error starting workflow:', error)
    }
  }

  const handleWorkflowStop = async (workflowId: string) => {

    try {
      const now = new Date().toISOString()

      // Update workflow progress as stopped
      const { error: progressError } = await supabase
        .from('asset_workflow_progress')
        .update({
          is_started: false,
          updated_at: now
        })
        .eq('asset_id', effectiveAsset.id)
        .eq('workflow_id', workflowId)

      if (progressError) {
        console.error('❌ Error stopping workflow progress:', progressError)
        return
      }


      // Immediately update the cache with the new status
      queryClient.setQueryData(['current-workflow-status', effectiveAsset.id, workflowId], {
        is_started: false,
        is_completed: false
      })

      // Then invalidate and refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['prioritizer-workflows'] })
      queryClient.invalidateQueries({ queryKey: ['asset-workflows-progress'] })
      queryClient.invalidateQueries({ queryKey: ['idea-generator-data'] })
      queryClient.invalidateQueries({ queryKey: ['workflows-all'] })
      queryClient.refetchQueries({ queryKey: ['current-workflow-status'] })

    } catch (error) {
      console.error('Error stopping workflow:', error)
    }
  }

  const sendAnalystNotification = async () => {
    try {
      // Create a notification in the database for analysts
      const { error } = await supabase
        .from('notifications')
        .insert([
          {
            type: 'asset_prioritized',
            title: `New Asset Prioritized: ${asset.symbol}`,
            message: `${asset.symbol} (${asset.company_name}) has been prioritized and requires analyst attention.`,
            asset_id: asset.id,
            created_by: user?.id,
            target_role: 'analyst', // Target analysts specifically
            is_read: false
          }
        ])

      if (error) {
        console.error('Failed to send analyst notification:', error)
      } else {
      }
    } catch (error) {
      console.error('Error sending analyst notification:', error)
    }
  }

  const handleTimelineStageClick = (stageId: string) => {
    // This could be used for showing stage-specific information or actions
  }

  const handleStageView = (stageId: string) => {
    // Expand workflow section and set the stage to view
    setCollapsedSections(prev => ({ ...prev, workflow: false }))
    setViewingStageId(stageId)
  }

  const handleEditStart = (sectionName: string) => {
    // save any other section first
    if (currentlyEditing && currentlyEditing !== sectionName) {
      const currentRef = getCurrentEditingRef()
      if (currentRef?.current) {
        currentRef.current.saveIfEditing()
      }
    }
    setCurrentlyEditing(sectionName)
  }

  const handleEditEnd = () => setCurrentlyEditing(null)

  const getCurrentEditingRef = () => {
    switch (currentlyEditing) {
      case 'thesis':
        return thesisRef
      case 'where_different':
        return whereDifferentRef
      case 'risks_to_thesis':
        return risksRef
      default:
        return null
    }
  }

  const handlePriceTargetSave = async (type: 'bull' | 'base' | 'bear', field: string, value: string) => {
    const existingTarget = priceTargets?.find((pt) => pt.type === type)
    if (existingTarget) {
      await updatePriceTargetMutation.mutateAsync({
        id: existingTarget.id,
        updates: { [field]: field === 'price' ? parseFloat(value) || 0 : value },
      })
    } else {
      const newTarget = {
        type,
        price: field === 'price' ? parseFloat(value) || 0 : 0,
        timeframe: field === 'timeframe' ? value : '12 months',
        reasoning: field === 'reasoning' ? value : '',
      }
      if (field !== 'price') newTarget.price = 0
      await createPriceTargetMutation.mutateAsync(newTarget)
    }
  }

  const getPriceTarget = (type: 'bull' | 'base' | 'bear') => priceTargets?.find((pt) => pt.type === type)

  const handleNoteClick = (noteId: string) => {
    // Use stable tab ID based on entity, not note ID
    const tabId = `note-asset-${asset.id}`
    onNavigate?.({
      id: tabId,
      title: `Note - ${asset.symbol}`,
      type: 'note',
      data: { id: noteId, entityType: 'asset', entityId: asset.id, assetId: asset.id, assetSymbol: asset.symbol }
    })
  }

  const handleCreateNote = () => {
    // Use stable tab ID - same tab for all notes of this asset
    const tabId = `note-asset-${asset.id}`
    onNavigate?.({
      id: tabId,
      title: `Note - ${asset.symbol}`,
      type: 'note',
      data: { entityType: 'asset', entityId: asset.id, assetId: asset.id, assetSymbol: asset.symbol, isNew: true }
    })
  }

  const priorityOptions = [
    { value: 'critical', label: 'Critical Priority' },
    { value: 'high', label: 'High Priority' },
    { value: 'medium', label: 'Medium Priority' },
    { value: 'low', label: 'Low Priority' },
  ]

  // ---------------------------------------------------------------------------
  // Coordinated loading gate — show a single skeleton until all critical data
  // for the initial render is ready, so the page appears all-at-once.
  // ---------------------------------------------------------------------------
  const pageReady = !layoutLoading && !contributionsLoading

  if (!pageReady) {
    return (
      <div className="flex flex-col bg-gray-50 dark:bg-gray-900 -mx-8 -my-6 h-[calc(100%+48px)] overflow-hidden">
        <div className="px-8 pt-6 space-y-4 animate-pulse">
          {/* Header skeleton */}
          <div className="flex items-center gap-6">
            <div>
              <div className="flex items-baseline gap-4">
                <div className="h-9 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-6 w-16 bg-gray-100 dark:bg-gray-800 rounded" />
              </div>
              <div className="h-5 w-48 bg-gray-100 dark:bg-gray-800 rounded mt-2" />
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="h-8 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg" />
              <div className="h-8 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            </div>
          </div>
          {/* State chips skeleton */}
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded-full" />
            ))}
          </div>
          {/* Tab bar skeleton — five, matching the real nav since Snapshot. */}
          <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 pb-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-8 w-24 bg-gray-100 dark:bg-gray-800 rounded-t-lg" />
            ))}
          </div>
          {/* Content skeleton */}
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                <div className="h-5 w-1/4 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
                <div className="space-y-2">
                  <div className="h-3 w-3/4 bg-gray-100 dark:bg-gray-800 rounded" />
                  <div className="h-3 w-1/2 bg-gray-100 dark:bg-gray-800 rounded" />
                  <div className="h-3 w-2/3 bg-gray-100 dark:bg-gray-800 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="asset-ux2 ux2-scope flex flex-col bg-gray-50 dark:bg-gray-900 -mx-8 -my-6 h-[calc(100%+48px)] overflow-hidden">
      {/* Sticky Header Section */}
      {/* Tightened from pt-6/space-y-3: the identity row lost a line, and the
          vertical rhythm around it was still sized for the two-line block. */}
      <div className="flex-shrink-0 sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 px-8 pt-4 space-y-2 shadow-sm">
      {/* UX2 Phase 1 — deep-navy identity band. Replaces the former identity row
          + state chips + context strip + arrival row with one band: ticker +
          company together, price/change, Ask AI, the ⚡ attention popover (one
          A1 resolver), and the collapsible context strip. No new data path. */}
      <AssetWorkspaceHeader
        asset={asset}
        sector={asset.sector || (fullAsset as unknown as { sector?: string | null } | undefined)?.sector}
        quote={currentQuote ?? null}
        spot={currentQuote?.price ?? null}
        headerContext={headerContext}
        coverage={coverage || []}
        thesisStatuses={thesisStatuses}
        coveringUserIds={(coverage || []).map((c: any) => c.user_id).filter(Boolean)}
        onFocus={handleAttentionFocus}
        onNavigate={onNavigate}
        onOpenSubPage={(sub) => goToSubPage(sub)}
        onOpenList={(focus) => {
          /* Lists is a section of Work now; `listsFocus` still does the
             within-section scroll, so no Work anchor is needed here. The
             'listsContent' target is the membership row in the band — the
             chip lands on the surface that can change the membership, not on
             a card that only names it. */
          setActiveSubPage('lists')
          focusListsSection(focus)
        }}
        collapsed={headerCollapsed}
        onToggleCollapse={toggleHeaderCollapsed}
      />

      {/*
        ── Mode selector ──────────────────────────────────────────────────
        Four modes, not five features. Overview answers "what is the state of
        this name", Research holds the written case, Work holds everything
        with an open loop (ideas, the running process, the lists this name
        sits in — one surface, not three tabs), History is the record.

        The count on Work is the running processes, the same number and the
        same source the Process tab carried.
      */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-1" aria-label="Asset modes">
          {ASSET_MODES.map(mode => {
            const Icon = MODE_ICON[mode]
            const current = activeMode === mode
            return (
              <button
                key={mode}
                onClick={() => goToMode(mode)}
                aria-current={current ? 'page' : undefined}
                className={clsx(
                  'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
                  current
                    ? 'bg-white border-t border-l border-r border-gray-200 text-primary-600 -mb-px dark:border-gray-700 dark:bg-gray-800'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:hover:text-gray-200 dark:hover:bg-gray-800 dark:text-gray-400'
                )}
              >
                <div className="flex items-center space-x-2">
                  <Icon className="h-4 w-4" />
                  <span>{MODE_LABEL[mode]}</span>
                  {mode === 'work' && activeProcessCount > 0 && (
                    <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-px rounded-full min-w-[18px] text-center">
                      {activeProcessCount}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </nav>
      </div>
      </div>


      {/* Research View Filter - Fixed bar that doesn't scroll */}
      {activeMode === 'research' && (
        <div className="px-8 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          {/* flex-wrap lets the perspective (left) and the view/utility controls
              (right) drop to a second row on narrow widths instead of
              overflowing or clipping. */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            {/* Left side: View filter */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">View</span>
              {researchAnalysts.length <= 5 ? (
                // Pills mode for 5 or fewer analysts
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                  {/* UX2 Phase 1 — two explicit perspectives: My Research (your
                      editable case, the default landing) and Organization (the
                      read-only, permission-aware firm view). Other analysts'
                      views remain reachable as pills to the right. */}
                  {user?.id && (
                    <button
                      onClick={() => chooseResearchView(user.id)}
                      className={clsx(
                        'px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 flex items-center gap-1.5',
                        researchViewFilter === user.id
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                      )}
                    >
                      My Research
                    </button>
                  )}
                  <button
                    onClick={() => chooseResearchView('aggregated')}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 flex items-center gap-1.5',
                      researchViewFilter === 'aggregated'
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    )}
                  >
                    {/*
                      "Firm valuation", not "Our View".

                      The contributor summary moved to the Snapshot, but this
                      SELECTOR was left untouched — so the authenticated app
                      still offered "Our View (All Analysts)" over a pane that
                      no longer contains any analyst's words. The label
                      promised prose and delivered numbers.

                      Nothing is deleted: the pane still renders the aggregated
                      price targets and the rating consensus, each from its own
                      existing panel, and every contributor and section is intact
                      on the Snapshot and in each analyst's own document.
                    */}
                    <Users className="w-3.5 h-3.5" />
                    Organization
                  </button>
                  {researchAnalysts.filter(a => a.id !== user?.id).map(analyst => {
                    const isCurrentUser = analyst.id === user?.id
                    const isPrimary = analyst.isCovering && analyst.role === 'primary'
                    const roleLabel = analyst.isCovering
                      ? `${analyst.name} — ${analyst.role ? analyst.role.charAt(0).toUpperCase() + analyst.role.slice(1) : 'Covering'} analyst`
                      : `${analyst.name} — Contributor`
                    return (
                      <button
                        key={analyst.id}
                        onClick={() => chooseResearchView(analyst.id)}
                        title={roleLabel}
                        className={clsx(
                          'px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 flex items-center gap-1.5',
                          researchViewFilter === analyst.id
                            ? 'bg-primary-600 text-white shadow-sm'
                            : isCurrentUser
                              ? 'text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300'
                              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        )}
                      >
                        {isPrimary && (
                          <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                        )}
                        {analyst.isCovering && !isPrimary && (
                          <Star className="w-3 h-3 text-yellow-500" />
                        )}
                        {analyst.shortName}
                      </button>
                    )
                  })}
                </div>
              ) : (
                // Dropdown mode for more than 5 analysts
                <select
                  value={researchViewFilter}
                  onChange={(e) => chooseResearchView(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 border-0 focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:text-gray-200"
                >
                  {user?.id && <option value={user.id}>My Research</option>}
                  <option value="aggregated">Organization (firm valuation)</option>
                  {researchAnalysts.filter(a => a.id !== user?.id).map(analyst => {
                    const roleTag = analyst.isCovering
                      ? analyst.role === 'primary' ? '★ ' : '☆ '
                      : ''
                    return (
                      <option key={analyst.id} value={analyst.id}>
                        {roleTag}{analyst.name}
                      </option>
                    )
                  })}
                </select>
              )}
            </div>

            {/* Right side: View mode buttons and Customize */}
            <div className="flex items-center gap-2">
              {/* Visibility control - only show when viewing own view (placed first so view buttons don't shift) */}
              {researchViewFilter === user?.id && (
                <AudiencePicker
                  saved={savedAudience ?? { visibility: sharedThesisVisibility, targetIds: sharedThesisTargetIds }}
                  nodesFor={(v) => getTargetOptions(v) as AudienceNode[]}
                  memberCounts={userOrgContext?.memberCounts ?? new Map()}
                  nodeById={userOrgContext?.nodeById ?? new Map()}
                  isLoading={!userOrgContext}
                  onApply={handleAudienceApply}
                />
              )}

              {/* View warnings indicator - shows next to visibility */}
              {activeMode === 'research' && (
                <ViewWarningIndicator warnings={viewWarnings} />
              )}

              {/*
                How to read the case — the four Research modes, the PRIMARY nav
                on this bar, now the last thing before the overflow. Labels show
                from xl so a narrow desktop keeps the compact icons (titles
                intact).

                Customize and Export used to sit here as bare icons at the same
                weight as these modes. They are one-shot actions nobody uses
                twice in a session, so they moved into the `⋯` menu after the
                modes — two fewer permanent controls, and their labels are now
                spelled out rather than hidden in a tooltip.

                One divider, not two: the audience and view-checks to the left
                are contextual status about THIS view, and the modes are how to
                read it. That is one boundary.
              */}
              <div className="mx-0.5 h-5 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
              <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
                <button
                  onClick={() => goToThesisMode('all')}
                  className={clsx(
                    'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                    thesisViewMode === 'all'
                      ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  )}
                  title="Investment Case"
                >
                  <Layers className="w-4 h-4" />
                  {/* "Investment Case" names the thing being read. "All
                      sections" described the renderer. */}
                  <span className="hidden xl:inline">Investment Case</span>
                </button>
                <button
                  onClick={() => goToThesisMode('summary')}
                  className={clsx(
                    'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                    thesisViewMode === 'summary'
                      ? 'bg-white dark:bg-gray-700 text-purple-600 dark:text-purple-400 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  )}
                  title="AI summary"
                >
                  <Sparkles className="w-4 h-4" />
                  <span className="hidden xl:inline">AI summary</span>
                </button>
                <button
                  onClick={() => goToThesisMode('history')}
                  className={clsx(
                    'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                    thesisViewMode === 'history'
                      ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  )}
                  title="History timeline"
                >
                  <History className="w-4 h-4" />
                  <span className="hidden xl:inline">History</span>
                </button>
                <button
                  onClick={() => goToThesisMode('references')}
                  className={clsx(
                    'relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                    thesisViewMode === 'references'
                      ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  )}
                  title="Key references"
                >
                  <Link2 className="w-4 h-4" />
                  <span className="hidden xl:inline">Key references</span>
                  {userKeyReferences.length > 0 && (
                    <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-medium text-white">
                      {userKeyReferences.length}
                    </span>
                  )}
                </button>
              </div>

              {/*
                Overflow. Customize is offered only in the reader's own view,
                because it edits THEIR layout — showing it while reading a
                colleague's research would promise something it cannot do.
              */}
              <ResearchToolbarMenu
                items={[
                  {
                    key: 'customize',
                    label: 'Customize layout',
                    icon: Settings2,
                    available: researchViewFilter === user?.id,
                    onSelect: () => setShowFieldCustomizer(true),
                  },
                  {
                    key: 'export',
                    label: 'Export investment case',
                    icon: Download,
                    onSelect: () => setShowCaseBuilder(true),
                  },
                ]}
              />

            </div>
          </div>
        </div>
      )}

      {/* Sub-page Content */}
      <div className="flex-1 overflow-auto px-8 py-4">

        {/* UX2 Phase 1 — the attention surface moved to the header ⚡ popover
            (same A1 resolver, signals, grouping, counts, priorities, deep-links).
            No persistent banner in the tab body. */}

        {/* ========== OVERVIEW ========== */}
        {activeMode === 'overview' && (
          <InvestmentSnapshot
            asset={asset}
            /* Already fetched above for the ticker dropdown — passed down so
               the Snapshot adds no second read of the same rows. */
            coverage={coverage || []}
            thesisStatuses={thesisStatuses}
            currentQuote={currentQuote}
            /*
              The firm's contributors, on the OVERVIEW rather than inside
              Research. Research is one analyst's document; who else has
              written, and where they disagree, is a fact about the
              organisation and belongs where the organisation is described.

              Passed down from the reads this tab already issues — no second
              query, and the same `ourViewFields` the Research pane derives
              from the org's own template, so the two cannot disagree about
              which sections exist.
            */
            contributions={allAssetContributions}
            contributionFields={ourViewFields}
            coveringAnalystIds={coveringAnalystIds}
            onOpenAnalyst={(userId) => {
              chooseResearchView(userId)
              setActiveSubPage('research')
            }}
            /* Through `goToSubPage`, so an Overview link into Work both
               lands in Work and scrolls to the section it named. */
            onOpenSubPage={goToSubPage}
            currentUserId={user?.id}
            /* The existing note navigation — opens the note in its own tab.
               Lets "What changed" name the research items instead of counting
               them, without a new route or a second query. */
            onOpenEvidence={handleNoteClick}
          />
        )}

        {/* ========== RESEARCH ========== */}
        {activeMode === 'research' && (
          <div className="space-y-3 min-h-full">

            {thesisViewMode === 'summary' ? (
              /* AI Summary View - shows unified summary */
              <Card padding="md">
                <ThesisUnifiedSummary
                  assetId={asset.id}
                  viewFilter={researchViewFilter}
                  contributions={allAssetContributions}
                  coveringAnalystIds={coveringAnalystIds}
                />
              </Card>
            ) : thesisViewMode === 'history' ? (
              /* History View - shows timeline instead of full layout */
              <Card padding="md">
                <ThesisHistoryView
                  assetId={asset.id}
                  viewFilter={researchViewFilter}
                />
              </Card>
            ) : thesisViewMode === 'references' ? (
              /* References View - unified Key References surface */
              <AssetTabKeyReferencesInline
                assetId={asset.id}
                isCollapsed={false}
                onToggle={() => {}}
                notes={notes || []}
                onCreateNote={handleCreateNote}
                onNoteClick={handleNoteClick}
                isEmbedded
              />
            ) : isAggregatedView ? (
              /* Aggregated "All" View - clean flat list of fields with content */
              allAssetContributions.length === 0 ? (
                /* Empty state when no team contributions exist */
                <Card padding="none">
                  <div className="flex flex-col items-center justify-center py-16 px-6">
                    <div className="relative mb-6">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center">
                        <Target className="w-10 h-10 text-primary-400" />
                      </div>
                      <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center border border-gray-100 dark:border-gray-800 dark:bg-gray-800">
                        <Users className="w-4 h-4 text-gray-400" />
                      </div>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-white">No team research yet</h3>
                    <p className="text-sm text-gray-500 text-center max-w-sm mb-6 dark:text-gray-400">
                      No one has shared their investment thesis on this asset yet. Switch to your personal view to start documenting your research.
                    </p>
                    {user && (
                      <button
                        onClick={() => chooseResearchView(user.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
                      >
                        <Target className="w-4 h-4" />
                        Start Your Research
                      </button>
                    )}
                  </div>
                </Card>
              ) : (
                <div className="space-y-3">
                  {/* UX2 Phase 1 — Organization is read-only (attributed firm
                      research + aggregated valuation). "Edit my research" is the
                      clearly-visible way back to the reader's own editable case.
                      Perspective (what you're viewing) stays distinct from
                      contribution visibility (who can see what you publish). */}
                  {user?.id && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Read-only firm view — attributed research and aggregated valuation, not a firm-authored conclusion.
                      </span>
                      <button
                        type="button"
                        onClick={() => chooseResearchView(user.id)}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                      >
                        <Edit3 className="h-4 w-4" />
                        Edit my research
                      </button>
                    </div>
                  )}

                  {/* Aggregated Price Targets (Bull/Bear/Base) - only shows when data exists */}
                  <PriceTargetsSummary
                    assetId={asset.id}
                    currentPrice={currentQuote?.price}
                  />

                  {/* Aggregated Forecasts Summary - shows ratings, estimates when data exists */}
                  <FirmConsensusPanel assetId={asset.id} />

                  {/*
                    ─── Firm Research: valuation AND contributor context ───

                    The firm-level VALUATION above (aggregated targets, rating
                    consensus) is the organisation's numbers. Beneath it we now
                    render the firm's WORDS too — each visible contributor's
                    opening claim per section, attributed by name.

                    The earlier objection — that contributor prose put "a fact
                    about the firm inside a fact about a person" — was about the
                    INDIVIDUAL view, which is one analyst's own document. This
                    branch is the opposite: the aggregated Firm view, whose
                    whole job is "what does the organisation think". So the
                    attribution belongs here, and the firm position is no longer
                    reachable only by leaving to the Snapshot.

                    This is READ-ONLY and owns no data: it reuses the same
                    OurViewSummary the Snapshot uses, over the RLS-scoped
                    `allAssetContributions` (org + visibility filtered at the
                    DB). It does not merge divergent views into a fabricated
                    firm thesis — it lists them, per author, where they differ.
                    Personal editing, drafts, history, publishing and the
                    visibility controls are untouched; they live in the
                    individual view this branch never renders. Choosing an
                    analyst opens their full, editable research in place.
                  */}
                  <OurViewSummary
                    contributions={allAssetContributions}
                    fields={ourViewFields}
                    coveringAnalystIds={coveringAnalystIds}
                    currentUserId={user?.id}
                    symbol={asset.symbol}
                    onOpenAnalyst={chooseResearchView}
                    mode="full"
                    className="px-1"
                  />
                </div>
              )
            ) : (
              /* Individual User "All" View — the original per-section design:
                 each section is its own card (blue/amber accent, hover
                 highlight, hover-reveal edit), with alternating shade. */
              displayedFieldsBySection.map((section, sectionIdx) => {
                // Skip hidden sections
                if (section.section_is_hidden) return null

                // Alternating shade for visual separation
                const sectionShade = sectionIdx % 2 === 1 ? '!bg-gray-50/60' : ''

              // Forecasts Section - render fields individually as tiles
              if (section.section_slug === 'forecasts') {
                return (
                  <Card key={section.section_id} padding="none" className={sectionShade}>
                    <button
                      onClick={() => toggleSection('outcomes')}
                      className="w-full px-5 py-3 flex items-center gap-2 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 transition-colors rounded-t-xl dark:bg-gray-800/60 dark:hover:bg-gray-800 dark:border-gray-700"
                    >
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{section.section_name}</span>
                      {collapsedSections.outcomes ? (
                        <ChevronDown className="h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronUp className="h-5 w-5 text-gray-400" />
                      )}
                    </button>
                    {!collapsedSections.outcomes && (
                      <div className="border-t border-gray-100 px-5 py-2 space-y-3 dark:border-gray-800">
                        {/* UX2 P2 — keep the reader's personal valuation visibly
                            distinct from the firm consensus (which lives in
                            Organization). Shown only on the reader's own view. */}
                        {isViewingOwnThesisTab && (
                          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            Your rating, price target and estimates — personal, not the firm consensus. The aggregated firm view is under Organization.
                          </p>
                        )}
                        {section.fields
                          .filter(f => f.is_visible)
                          .map(field => {
                            const fieldType = field.field_type

                            // Price target field
                            if (fieldType === 'price_target') {
                              return (
                                <div key={field.field_id} id="asset-warning-anchor-targets" className="border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800">
                                  <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{field.field_name}</h4>
                                  {field.field_description && (
                                    <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{field.field_description}</p>
                                  )}
                                  <OutcomesContainer
                                    assetId={asset.id}
                                    symbol={asset.symbol}
                                    currentPrice={currentQuote?.price}
                                    onNavigate={onNavigate}
                                    viewFilter={researchViewFilter}
                                  />
                                </div>
                              )
                            }

                            // Rating field
                            if (fieldType === 'rating') {
                              return (
                                <div key={field.field_id} id="asset-warning-anchor-rating" className="border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800">
                                  <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{field.field_name}</h4>
                                  {field.field_description && (
                                    <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{field.field_description}</p>
                                  )}
                                  <AnalystRatingsSection
                                    assetId={asset.id}
                                    isEditable={isViewingOwnThesisTab}
                                    currentPrice={currentQuote?.price}
                                    viewScope={ratingViewScope}
                                    accessibleUserIds={ratingAccessibleUserIds}
                                    showConsensus={false}
                                    embedded
                                  />
                                </div>
                              )
                            }

                            // Estimates field
                            if (fieldType === 'estimates') {
                              return (
                                <div key={field.field_id} className="border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800">
                                  <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{field.field_name}</h4>
                                  {field.field_description && (
                                    <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{field.field_description}</p>
                                  )}
                                  <AnalystEstimatesSection
                                    assetId={asset.id}
                                    isEditable={isViewingOwnThesisTab}
                                  />
                                </div>
                              )
                            }

                            // Default: rich_text or other custom fields
                            const anchorId = field.field_slug === 'risks_to_thesis'
                              ? 'asset-warning-anchor-risks'
                              : field.field_slug === 'thesis'
                                ? 'asset-anchor-thesis'
                                : undefined
                            return (
                              <div key={field.field_id} id={anchorId}>
                                <ContributionSection
                                  assetId={asset.id}
                                  section={field.field_slug}
                                  title={field.field_name}
                                  activeTab={researchViewFilter}
                                  onTabChange={setResearchViewFilter}
                                  defaultVisibility={sharedThesisVisibility}
                                  hideViewModeButtons={true}
                                  hideVisibility={true}
                                  sharedVisibility={sharedThesisVisibility}
                                  sharedTargetIds={sharedThesisTargetIds}
                                  fullPageEditor
                                  onOpenNote={handleNoteClick}
                                />
                              </div>
                            )
                          })}
                      </div>
                    )}
                  </Card>
                )
              }

              // Key References section — skip here, shown in references view tab
              if (section.section_slug === 'supporting_docs') {
                return null
              }

              // Generic Section - for all other section types
              return (
                <Card key={section.section_id} padding="none" className={sectionShade}>
                  <button
                    onClick={() => toggleSection(section.section_slug as any)}
                    className="w-full px-5 py-3 flex items-center gap-2 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 transition-colors rounded-t-xl dark:bg-gray-800/60 dark:hover:bg-gray-800 dark:border-gray-700"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{section.section_name}</span>
                    {collapsedSections[section.section_slug as keyof typeof collapsedSections] ? (
                      <ChevronDown className="h-5 w-5 text-gray-400" />
                    ) : (
                      <ChevronUp className="h-5 w-5 text-gray-400" />
                    )}
                  </button>
                  {!collapsedSections[section.section_slug as keyof typeof collapsedSections] && (
                    <div className="border-t border-gray-100 px-5 py-2 space-y-3 dark:border-gray-800">
                      {section.fields
                        .filter(f => f.is_visible)
                        .map(field => {
                          // Render field based on its type
                          const fieldType = field.field_type

                          // Checklist field
                          if (fieldType === 'checklist') {
                            return (
                              <div key={field.field_id} className="border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800">
                                <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{field.field_description}</p>
                                )}
                                <ChecklistField
                                  fieldId={field.field_id}
                                  assetId={asset.id}
                                  config={{}}
                                />
                              </div>
                            )
                          }

                          // Metric field
                          if (fieldType === 'metric') {
                            return (
                              <div key={field.field_id} className="border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800">
                                <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{field.field_description}</p>
                                )}
                                <MetricField
                                  fieldId={field.field_id}
                                  assetId={asset.id}
                                  config={{}}
                                />
                              </div>
                            )
                          }

                          // Timeline field
                          if (fieldType === 'timeline') {
                            return (
                              <div key={field.field_id} className="border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800">
                                <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{field.field_description}</p>
                                )}
                                <TimelineField
                                  fieldId={field.field_id}
                                  assetId={asset.id}
                                  config={{}}
                                />
                              </div>
                            )
                          }

                          // Numeric field
                          if (fieldType === 'numeric') {
                            return (
                              <div key={field.field_id} className="border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800">
                                <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{field.field_description}</p>
                                )}
                                <NumericField
                                  fieldId={field.field_id}
                                  assetId={asset.id}
                                  config={{}}
                                />
                              </div>
                            )
                          }

                          // Date field
                          if (fieldType === 'date') {
                            return (
                              <div key={field.field_id} className="border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800">
                                <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{field.field_description}</p>
                                )}
                                <DateField
                                  fieldId={field.field_id}
                                  assetId={asset.id}
                                  config={{}}
                                />
                              </div>
                            )
                          }

                          // Rating field - render analyst ratings section
                          if (fieldType === 'rating') {
                            return (
                              <div key={field.field_id} id="asset-warning-anchor-rating" className="border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800">
                                <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{field.field_description}</p>
                                )}
                                <AnalystRatingsSection
                                  assetId={asset.id}
                                  isEditable={isViewingOwnThesisTab}
                                  currentPrice={currentQuote?.price}
                                  viewScope={ratingViewScope}
                                  accessibleUserIds={ratingAccessibleUserIds}
                                  showConsensus={false}
                                  embedded
                                />
                              </div>
                            )
                          }

                          // Estimates field - render analyst estimates section
                          if (fieldType === 'estimates') {
                            return (
                              <div key={field.field_id} className="border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800">
                                <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{field.field_description}</p>
                                )}
                                <AnalystEstimatesSection
                                  assetId={asset.id}
                                  isEditable={isViewingOwnThesisTab}
                                />
                              </div>
                            )
                          }

                          // Price target field - render outcomes container for price targets
                          if (fieldType === 'price_target') {
                            return (
                              <div key={field.field_id} id="asset-warning-anchor-targets" className="border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800">
                                <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{field.field_name}</h4>
                                {field.field_description && (
                                  <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{field.field_description}</p>
                                )}
                                <OutcomesContainer
                                  assetId={asset.id}
                                  symbol={asset.symbol}
                                  currentPrice={currentQuote?.price}
                                  viewFilter={researchViewFilter}
                                />
                              </div>
                            )
                          }

                          // Default: rich_text or other text-based fields use ContributionSection
                          const sectionAnchorId = field.field_slug === 'risks_to_thesis'
                            ? 'asset-warning-anchor-risks'
                            : field.field_slug === 'thesis'
                              ? 'asset-anchor-thesis'
                              : undefined
                          return (
                            <div key={field.field_id} id={sectionAnchorId}>
                              <ContributionSection
                                assetId={asset.id}
                                section={field.field_slug}
                                title={field.field_name}
                                activeTab={researchViewFilter}
                                onTabChange={setResearchViewFilter}
                                defaultVisibility={sharedThesisVisibility}
                                hideViewModeButtons={true}
                                hideVisibility={true}
                                sharedVisibility={sharedThesisVisibility}
                                sharedTargetIds={sharedThesisTargetIds}
                                fullPageEditor
                                onOpenNote={handleNoteClick}
                              />
                            </div>
                          )
                        })}
                    </div>
                  )}
                </Card>
              )
            })
            )}

            {/* User-Added Widgets Section */}
            {userWidgets.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Custom Fields</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
                {userWidgets.map(widget => (
                  <UserWidgetRenderer
                    key={widget.id}
                    widget={widget}
                    value={getWidgetValue(widget.id)}
                    isOwner={isMyWidget(widget.id)}
                    isCollapsed={widgetCollapsedState[widget.id] ?? false}
                    onToggleCollapse={() => setWidgetCollapsedState(prev => ({
                      ...prev,
                      [widget.id]: !prev[widget.id]
                    }))}
                    onSaveValue={async (content, value) => {
                      await saveWidgetValue({ widget_id: widget.id, content, value })
                    }}
                    onDelete={isMyWidget(widget.id) ? () => deleteWidget(widget.id) : undefined}
                    assetId={asset.id}
                  />
                ))}
              </div>
            )}

            {/* Field Customizer Modal */}
            <AssetPageFieldCustomizer
              isOpen={showFieldCustomizer}
              onClose={() => setShowFieldCustomizer(false)}
              assetId={asset.id}
              assetName={asset.name}
              viewFilter={researchViewFilter}
              currentUserId={user?.id}
            />

            {/* Investment Case Builder Modal */}
            {showCaseBuilder && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-viewport-90 overflow-hidden dark:bg-gray-800">
                  <div className="overflow-y-auto max-h-viewport-90 p-6">
                    <InvestmentCaseBuilder
                      assetId={asset.id}
                      symbol={asset.symbol || asset.name}
                      companyName={asset.name}
                      currentPrice={currentQuote?.price}
                      onClose={() => setShowCaseBuilder(false)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/*
          ══════════════════ WORK ══════════════════

          One surface, four sections, in order of immediacy:

            1. the orientation band — what needs you, right now
            2. Process  — the running workflow
            3. Ideas    — the open items in full
            4. Lists    — the lists this name sits in

          Process, Ideas and Lists were three peer tabs. They are sections
          now, and the handoffs that used to switch tabs scroll instead, so
          "open the process" no longer costs the reader their place.

          The band at the top is the only thing here that aggregates: it is
          what makes this a surface rather than three accordions. Everything
          below it is the detail behind one of its lines.
        */}
        {activeMode === 'work' && (
          /*
            The band carries the `work-lists` anchor because its first child is
            the membership row. The 'lists' destination — from the Overview and
            from a saved sub-page — therefore lands on the lists themselves,
            not on the themes-and-portfolios block at the foot of Work.
          */
          <div id={WORK_SECTION_ID.lists} className="scroll-mt-4">
            {/*
              ── One sidebar, one working surface ──────────────────────────

              The left column holds everything this asset IS and everything
              there is to DO about it; the centre holds the doing. Before
              this, those were four places in three idioms: a 248px work
              rail, a horizontal list strip above it, and full-width theme /
              portfolio / project Cards stranded 708px BELOW the surface,
              where a reader working a process never saw them.

              296px, which is the widest the sidebar can be before the
              centre's 78ch reading measure stops fitting beside it at the
              narrow end of "wide desktop".
            */}
            {/*
              Collapsed, the sidebar's column is gone rather than emptied —
              one track, so there is no 296px gutter and no implicit second
              row. Only the container's class changes; both children keep
              their slots, so nothing in the working surface is rebuilt.
            */}
            <div className={workSidebarCollapsed
              ? 'grid grid-cols-1 items-start gap-5'
              : 'grid grid-cols-1 items-start gap-5 xl:grid-cols-[296px_minmax(0,1fr)]'}>
              <AssetWorkSidebar
                key="work-sidebar"
                hidden={workSidebarCollapsed}
                onCollapse={toggleWorkSidebar}
                collapsed={collapsedSections}
                onToggleSection={toggleSection}
                className="xl:sticky xl:top-2"
                selectedKey={workItemKey}
                /* Lists — the Step B implementation, moved not rebuilt. */
                lists={listsLoading ? null : assetListMemberships.map(l => ({
                  itemId: l.itemId,
                  listId: l.listId,
                  name: l.name,
                  listType: l.listType,
                  canRemove: l.canRemove,
                }))}
                /* Selects, inside this asset's workspace. Opening the full
                   list is a labelled control on that surface. */
                onOpenList={(listId) => openContextual(contextualKey.list(listId))}
                onRemoveFromList={(itemId) => removeFromList.mutate(itemId)}
                removingListItemId={removeFromList.isPending ? (removeFromList.variables ?? null) : null}
                addToListSlot={<AddToListButton assetId={asset.id} size="sm" variant="ghost" />}
                onOpenAllLists={() => onNavigate?.({ id: 'lists', title: 'Lists', type: 'lists', data: null })}
                /* Themes — the same rows and the same Add dialog the card had. */
                themes={assetThemes === undefined ? null : (assetThemes as any[]).map(t => ({
                  id: t.id, name: t.name, themeType: t.theme_type || 'general',
                }))}
                onOpenTheme={(t) => onNavigate?.({ id: t.id, title: t.name, type: 'theme', data: t })}
                onOpenAllThemes={() => onNavigate?.({ id: 'themes-list', title: 'All Themes', type: 'themes-list', data: null })}
                /* `ghost`/`sm` so the three Add controls carry the same
                   weight as each other and none of them outweighs the work
                   above. The dialogs behind them are untouched. */
                addToThemeSlot={<AddToThemeButton assetId={asset.id} variant="ghost" size="sm" />}
                /* Portfolios — the same dedupe; the weight now comes from the
                   book it belongs to. `null` while the books load, so the
                   sidebar says nothing rather than saying zero. */
                portfolios={portfolioHoldings === undefined ? null : Array.from(
                  new Map((portfolioHoldings as any[]).map((h: any) => [h.portfolio_id, h])).values()
                ).map((h: any) => {
                  const exposure = exposureIn(h.portfolio_id)
                  return {
                    id: h.portfolio_id,
                    name: h.portfolios?.name || 'Unknown Portfolio',
                    weight: exposure && exposure.bookValue > 0
                      ? exposure.weightPct.toFixed(2)
                      : null,
                  }
                })}
                onOpenPortfolio={(id) => openContextual(contextualKey.portfolio(id))}
                onOpenAllPortfolios={() => onNavigate?.({ id: 'portfolios-list', title: 'All Portfolios', type: 'portfolios-list', data: null })}
                /* Projects — the real component, which owns its own data. */
                addToProjectSlot={<AddToProjectButton assetId={asset.id} variant="ghost" size="sm" />}
                projectsSlot={
                  <RelatedProjects
                    contextType="asset"
                    contextId={asset.id}
                    contextTitle={`${asset.symbol} - ${asset.company_name}`}
                    onProjectClick={(projectId) => onNavigate?.({
                      id: projectId, title: 'Project', type: 'project', data: { id: projectId },
                    })}
                    hideCreateButton
                  />
                }
                workSlot={
              <WorkNavigator
                /* The collapse control rides the navigator's first group
                   header instead of a dedicated row above it. */
                headerAction={<WorkSidebarToggle direction="collapse" onToggle={toggleWorkSidebar} />}
                items={workItems}
                /*
                 * ── The highlight is the DISPLAYED process, not a near miss ─
                 *
                 * When the selection is a process, the row that lights up is
                 * the one the surface is actually showing. Normally these are
                 * the same thing, because selecting a row and choosing from the
                 * dropdown both go through `handleWorkflowChange`.
                 *
                 * They come apart in one case: the dropdown can switch to a
                 * process the sidebar does not list — one not started, or
                 * already complete — and `resolveSelection` answers an
                 * unresolvable key by falling back to the FIRST in-progress
                 * item. That fallback is right for a selection whose work was
                 * deleted, and wrong here, because it would highlight some
                 * other run beside a surface showing this one. Keying the
                 * highlight off the displayed workflow means no row matches
                 * and nothing is highlighted, which is true.
                 */
                selectedKey={
                  selectedWorkItem?.kind === 'process'
                    ? (effectiveWorkflowId ? workItemKeyFor.process(effectiveWorkflowId) : null)
                    : (selectedWorkItem?.key ?? null)
                }
                /* `resolveSelection` only knows navigator items, so a
                   contextual key looks to it like a selection that vanished.
                   It did not: it is on screen. Saying otherwise put "the
                   item you were on is no longer available" above a list the
                   reader had just opened. */
                recoveredFrom={!contextual && workSelection.recovered}
                isLoading={workIsResolving}
                onSelect={(item: WorkItem) => {
                  /* A conversation opens the existing CoAnalyst pane and
                     leaves the surface alone. The pane is where threads live;
                     a second chat here would be a second implementation of
                     it, and the cross-asset context protections from
                     ac779006 live there too. */
                  if (item.kind === 'conversation') {
                    askAI({ ...assetEngagementTarget, conversationId: item.id })
                    return
                  }
                  /*
                   * ── A process row moves the WORKSPACE, not just the list ──
                   *
                   * This used to set `workItemKey` alone. The sidebar highlight
                   * followed, and nothing else did: the Process surface, its
                   * header, its stages and its requirements all read
                   * `effectiveWorkflowId`, which only the Process dropdown ever
                   * moved. So a reader could select the Apr 3 run, see it
                   * highlighted, and complete requirements on Apr 10 — the one
                   * failure an investment workflow must not have.
                   *
                   * `handleWorkflowChange` is the switch the dropdown already
                   * performs, and it is the whole operation: it moves the
                   * effective workflow, drops the previous run's stage so no
                   * stale stage shows, and restores the new run's own current
                   * stage. Calling it here makes selection one action with one
                   * implementation rather than two half-switches, and it sets
                   * `workItemKey` itself — so the dropdown now moves the
                   * sidebar too, and the two can no longer disagree.
                   */
                  if (item.kind === 'process') {
                    void handleWorkflowChange(item.id)
                    return
                  }
                  setWorkItemKey(item.key)
                }}
                /* Both carried over from the Open Items section, which this
                   replaces: the canonical stage pills and idea creation
                   through the existing event. */
                stageFilter={openItemsFilter === 'all' ? null : openItemsFilter}
                stageFilterOptions={[
                  { key: 'all', label: 'All' },
                  ...IDEA_STAGES.map(s => ({ key: s, label: IDEA_STAGE_CONFIG[s].label })),
                ]}
                onStageFilter={(key) => setOpenItemsFilter((key ?? 'all') as 'all' | IdeaStage)}
                onNewIdea={() => {
                  window.dispatchEvent(new CustomEvent('decision-engine-action', {
                    detail: { type: 'new-trade-idea', data: { assetId: asset.id, symbol: asset.symbol } }
                  }))
                }}
              />
                }
              />

              <div key="work-surface" className="min-w-0" data-testid="work-surface">
                {/*
                  The way back in, while the sidebar is away.

                  It used to be one `mb-2` row above everything, which simply
                  moved the dedicated row from the sidebar to the surface. It
                  now rides whichever header the surface is already showing:
                  the Process identity row below, the Idea surface's own
                  header, or the empty state's text block. Nothing reserves a
                  row for it in any of the three.
                */}
                {/*
                  ── A contextual destination owns the whole surface ──────

                  A list or a portfolio replaces the work item rather than
                  sitting beside it, so each of the four branches below is
                  guarded on its absence. Without that, selecting a book
                  while a process was open would render both.
                */}
                {contextual?.kind === 'list' && (() => {
                  const m = assetListMemberships.find(l => l.listId === contextual.id)
                  if (!m) {
                    return (
                      <div
                        data-testid="contextual-list-missing"
                        className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center dark:border-gray-700"
                      >
                        <p className="text-[13px] text-gray-500 dark:text-gray-400">
                          {asset.symbol} is no longer on that list.
                        </p>
                        <button
                          type="button"
                          onClick={leaveContextual}
                          className="mt-2 text-[12px] font-medium text-primary-600 hover:underline"
                        >
                          {contextualBack.label}
                        </button>
                      </div>
                    )
                  }
                  return (
                    <ListWorkSurface
                      list={{
                        listId: m.listId,
                        itemId: m.itemId,
                        name: m.name,
                        description: m.description,
                        listType: m.listType,
                        addedAt: m.addedAt,
                        canRemove: m.canRemove,
                      }}
                      assetSymbol={asset.symbol}
                      back={{ label: contextualBack.label, onBack: leaveContextual }}
                      onRemove={(itemId) => removeFromList.mutate(itemId)}
                      removing={removeFromList.isPending}
                      /* The deliberate departure. The List tab derives its
                         own permissions from the row it is handed, so
                         `list_type` and `created_by` travel with it —
                         dropping them opens a list its owner cannot edit. */
                      onOpenFull={() => onNavigate?.({
                        id: m.listId,
                        title: m.name,
                        type: 'list',
                        data: {
                          id: m.listId,
                          name: m.name,
                          description: m.description,
                          list_type: m.listType,
                          created_by: m.createdBy,
                        },
                      })}
                    />
                  )
                })()}

                {contextual?.kind === 'portfolio' && (() => {
                  const holding = (portfolioHoldings as any[] | undefined)
                    ?.find(h => h.portfolio_id === contextual.id)
                  const name = holding?.portfolios?.name || 'Portfolio'
                  const exposure = exposureIn(contextual.id)
                  return (
                    <PortfolioWorkSurface
                      portfolio={{ id: contextual.id, name }}
                      assetSymbol={asset.symbol}
                      exposure={exposure}
                      exposureLoading={portfolioBooks === undefined}
                      /* Matched on portfolio ID. Two books can share a name
                         across organizations. */
                      ideas={openItems
                        .filter(i => i.portfolio?.id === contextual.id)
                        .map(i => ({ id: i.id, action: i.action, stage: i.stage, rationale: i.rationale }))}
                      back={{ label: contextualBack.label, onBack: leaveContextual }}
                      onOpenIdea={(ideaId) => openIdeaDetail(ideaId)}
                      onOpenFull={() => onNavigate?.({
                        id: contextual.id, title: name, type: 'portfolio', data: { id: contextual.id },
                      })}
                    />
                  )
                })()}

                {!contextual && !selectedWorkItem && workIsResolving && (
                  /* The shape of what is coming, and no claim about it. */
                  <div data-testid="work-surface-loading" className="space-y-3">
                    {workSidebarCollapsed && (
                      <div className="flex justify-end">
                        <WorkSidebarToggle direction="expand" onToggle={toggleWorkSidebar} />
                      </div>
                    )}
                    <div className="h-9 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800" />
                    <div className="h-24 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800" />
                    <div className="h-40 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800" />
                    <p className="text-[11px] text-gray-400">Loading this asset's work…</p>
                  </div>
                )}

                {!contextual && !selectedWorkItem && !workIsResolving && (
                  <div
                    data-testid="work-surface-empty"
                    className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center dark:border-gray-700"
                  >
                    {workSidebarCollapsed && (
                      <div className="mb-3 flex justify-center">
                        <WorkSidebarToggle direction="expand" onToggle={toggleWorkSidebar} />
                      </div>
                    )}
                    <p className="text-[13px] text-gray-500 dark:text-gray-400">
                      No active work on this asset.
                    </p>
                    <p className="mt-1 text-[11px] text-gray-400">
                      Start a process, or open an idea, to begin.
                    </p>
                  </div>
                )}

                {!contextual && selectedWorkItem?.kind === 'idea' && (
                  selectedWorkIdea ? (
                    <IdeaWorkSurface
                      idea={selectedWorkIdea}
                      assetId={asset.id}
                      headerAction={workSidebarCollapsed
                        ? <WorkSidebarToggle direction="expand" onToggle={toggleWorkSidebar} />
                        : undefined}
                    />
                  ) : (
                    /* The navigator listed a request whose idea the open-items
                       query did not return. Say so and offer the real editor
                       rather than rendering a blank panel. */
                    <div className="rounded-lg border border-gray-200 px-4 py-6 dark:border-gray-700">
                      <p className="text-[13px] text-gray-600 dark:text-gray-300">
                        This idea is no longer in the open pipeline.
                      </p>
                      <button
                        type="button"
                        data-testid="work-surface-open-closed-idea"
                        onClick={() => openIdeaDetail(selectedWorkItem.id)}
                        className="mt-2 text-[12px] font-medium text-primary-600 hover:underline"
                      >
                        Open it in the idea pipeline
                      </button>
                    </div>
                  )
                )}

                {/* ─────────── The process, as the surface ───────────
                    `InvestmentTimeline` itself, mounted rather than linked
                    to: the authoritative engine, stages, checklist,
                    assignments, deadlines and permissions, unchanged. */}
                {!contextual && selectedWorkItem?.kind === 'process' && (
          <div id={WORK_SECTION_ID.workflow} className="scroll-mt-4">
            {(() => {
            /*
              ── Which Process, which stage: one line ────────────────────

              This was a band of its own above the rail — selector and Mark
              Complete on the left, two labelled view buttons pushed to the
              far right of a 1,500px row. Below it sat the rail, and below
              that a second band for the stage's own controls. Three bands
              of chrome, each holding a handful of short controls, before
              any analysis.

              The identity and its actions now ride the rail's row, in the
              order a reader asks the questions: which Process, what can I
              do to it, which stage. Timeline and Files keep their single
              click and lose their labels to their own icons — they are
              view switches used once a session, and they were spending two
              labels and 150px to say so on every render.

              The row is still rendered standalone for the Timeline and
              Files views, which replace the rail entirely: the way back
              must not live inside the thing it is replacing.
            */
            /*
              ── Identity, not a second selector ─────────────────────────

              The header opened with a dropdown listing the reader's
              processes — the same list the sidebar to its left already
              shows, permanently, with run dates and stage labels. Two
              selectors for one choice, and no obvious answer to "where do I
              switch process".

              The sidebar is the answer. The header now STATES which process
              is open, which run, and its status; switching and joining live
              on one labelled menu, which also carries the view switches that
              were two unlabelled icons.
            */
            const currentRun = allAssetWorkflows?.find(aw => aw.workflow_id === effectiveWorkflowId)
            /*
              ── One switcher, anchored to the title ────────────────────

              `groupProcesses` decides what is offered and in what order;
              `ProcessSwitcher` renders it. Between them they replace the
              "⋯" → selector-trigger → 384px panel stack, and they carry
              Documents and Activity too, which were sitting in a menu
              that had nothing else to do with them.
            */
            const switcherGroups = groupProcesses(
              (allAssetWorkflows ?? []) as unknown as SwitcherRunRow[],
              effectiveWorkflowId || null,
              /* `availableWorkflows` infers as `never[]` from an untyped
                 Supabase select, as most queries in this file do. Named
                 at the boundary rather than spread untyped into the
                 switcher. */
              ((availableWorkflows ?? []) as unknown as Array<{
                id: string; name: string; branch_suffix: string | null
              }>).map(w => ({ id: w.id, name: w.name, branch_suffix: w.branch_suffix })),
            )
            const processHeader = (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                {/* The way back to navigation, on the row the Process
                    identity already occupies. Only while the sidebar is away. */}
                {workSidebarCollapsed && (
                  <WorkSidebarToggle direction="expand" onToggle={toggleWorkSidebar} />
                )}
                {allWorkflowsLoading || (allWorkflowsFetching && !allAssetWorkflows) ? (
                  <div className="flex items-center space-x-3 animate-pulse">
                    <div className="h-6 w-44 rounded bg-gray-200 dark:bg-gray-700" />
                  </div>
                ) : (
                  <>
                    <GitBranch className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
                    <ProcessSwitcher
                      groups={switcherGroups}
                      fallbackLabel={selectedWorkItem?.label ?? 'Process'}
                      onSelect={handleWorkflowChange}
                      onJoin={(workflowId) => joinWorkflowMutation.mutate({ workflowId, startImmediately: false })}
                      upcoming={(upcomingBranches ?? []) as unknown as Array<{
                        workflowId: string; branchName: string; estimatedStartDate: Date
                      }>}
                      onOpenActivity={() => { setShowTimelineView(true); setShowTemplatesView(false) }}
                      onOpenDocuments={() => { setShowTemplatesView(true); setShowTimelineView(false) }}
                      activityActive={showTimelineView}
                      documentsActive={showTemplatesView}
                    />
                    {/*
                      ── "Mark Complete" said what, exactly? ─────────────

                      A solid blue primary button beside the process title
                      that completed the whole PROCESS — the heaviest
                      control on the Work tab, one of three things on the
                      screen called some variant of "complete", and the
                      only one that did not say what it finished.

                      It keeps its handler, its permissions and its
                      mutation; it is now named for what it ends and sits
                      in a labelled process-actions menu, because
                      finishing a process is a once-a-cycle act and was
                      outranking the analysis on every render.
                    */}
                    <WorkActionsMenu
                      label="Process actions"
                      actions={[
                        /* Had no caller at all before: the old button took
                           an `onStart` prop and never invoked it, so a run
                           sitting unstarted could not be started from here. */
                        ...(currentRun && !currentRun.is_started && !currentRun.is_completed ? [{
                          key: 'start-process',
                          label: 'Start process',
                          icon: <Play className="h-3.5 w-3.5" />,
                          onSelect: () => {
                            if (effectiveWorkflowId) startWorkflowMutation.mutate(effectiveWorkflowId)
                          },
                        }] : []),
                        ...(currentRun && !currentRun.is_completed ? [{
                          key: 'complete-process',
                          label: 'Complete process',
                          icon: <CheckCircle2 className="h-3.5 w-3.5" />,
                          onSelect: () => {
                            if (effectiveWorkflowId) markWorkflowCompleteMutation.mutate(effectiveWorkflowId)
                          },
                        }] : []),
                        ...(currentRun?.is_completed ? [{
                          key: 'resume-process',
                          label: 'Reopen process',
                          icon: <RotateCcw className="h-3.5 w-3.5" />,
                          onSelect: () => {
                            if (effectiveWorkflowId) restartWorkflowMutation.mutate(effectiveWorkflowId)
                          },
                        }] : []),
                        {
                          key: 'remove',
                          label: 'Remove this asset from the process',
                          icon: <X className="h-3.5 w-3.5" />,
                          startsGroup: true,
                          onSelect: () => {
                            if (effectiveWorkflowId) removeFromWorkflowMutation.mutate(effectiveWorkflowId)
                          },
                        },
                      ]}
                    />
                  </>
                )}
              </div>
            )
            return (
              <div className="space-y-3">
                {/* Standalone only for the views that REPLACE the rail. */}
                {(showTemplatesView || showTimelineView) && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">{processHeader}</div>
                    {/*
                      No generic subview bar here any more. Each subview now
                      carries its own header — its name, what it is for, and
                      one labelled return — so this row was a second title
                      and a second Back, 40px above the real ones.
                    */}
                  </div>
                )}

              {showTemplatesView ? (
                <ProcessDocuments
                  backLabel={`Back to ${selectedWorkItem?.label ?? 'the process'}`}
                  onBack={() => setShowTemplatesView(false)}
                  attachmentsLoading={attachmentsLoading}
                  templatesLoading={templatesLoading}
                  attachments={(checklistAttachments ?? []).map((a) => ({
                    id: a.id,
                    name: a.file_name,
                    context: a.stage_id ? `Stage: ${a.stage_id}` : null,
                    sizeBytes: a.file_size ?? null,
                    onOpen: () => window.open(a.file_path, '_blank'),
                  }))}
                  templates={(workflowTemplates ?? []).map((t) => ({
                    id: t.id,
                    name: t.name,
                    context: t.file_name ?? null,
                    sizeBytes: t.file_size ?? null,
                    /* `file_url` holds a storage path in a private bucket, so
                       it has to be signed before it can be opened. It used to
                       hold a `getPublicUrl` result, which opened a tab onto a
                       400. Unchanged, moved. */
                    onOpen: async () => {
                      const url = await fetchSignedUrl(
                        queryClient,
                        WORKFLOW_TEMPLATES_BUCKET,
                        workflowTemplatePath(t.file_url),
                      )
                      if (url) window.open(url, '_blank')
                    },
                  }))}
                />
              ) : showTimelineView ? (
                /* Previous runs lead; the activity feed is demoted into a
                   collapsed section inside it, which is what it is. */
                <ProcessHistory
                  assetId={effectiveAsset.id}
                  assetSymbol={asset.symbol}
                  workflowId={effectiveWorkflowId || null}
                  backLabel={`Back to ${selectedWorkItem?.label ?? 'the process'}`}
                  onBack={() => setShowTimelineView(false)}
                  onOpenRun={(wfId) => { setShowTimelineView(false); handleWorkflowChange(wfId) }}
                  activitySlot={
                    <AssetTimelineView
                      assetId={effectiveAsset.id}
                      assetSymbol={asset.symbol}
                      workflowId={effectiveWorkflowId}
                      isOpen={true}
                      onClose={() => setShowTimelineView(false)}
                      inline={true}
                    />
                  }
                />
              ) : workflowIdLoading || pendingWorkflowSwitch || allWorkflowsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin dark:border-gray-600" />
                </div>
              ) : !effectiveWorkflowId ? (
                <div className="bg-white border border-gray-200 rounded-lg p-12 dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex flex-col items-center justify-center text-center space-y-4">
                    <Activity className="w-16 h-16 text-gray-300" />
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">No Active Processes</h3>
                      <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">Add this asset to a process to start tracking progress</p>
                    </div>
                  </div>
                </div>
              ) : (
                <InvestmentTimeline
                  key={`${effectiveAsset.id}-${effectiveWorkflowId || 'no-workflow'}`} // Force remount when asset or workflow changes
                  currentStage={stage}
                  onStageChange={handleStageChange}
                  onStageClick={handleTimelineStageClick}
                  assetSymbol={asset.symbol}
                  assetId={effectiveAsset.id}
                  viewingStageId={viewingStageId}
                  viewingRequirementId={viewingRequirementId}
                  onViewingRequirementChange={setViewingRequirementId}
                  onViewingStageChange={setViewingStageId}
                  workflowId={effectiveWorkflowId}
                  currentPriority={workflowPriorityState}
                  onPriorityChange={handleWorkflowPriorityChange}
                  headerSlot={processHeader}
                  /* Opening a previous cycle from the prior-work panel is
                     the same process switch the sidebar performs. */
                  onOpenRun={handleWorkflowChange}
                />
              )}
            </div>
            )
          })()}
          </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========== DECISIONS SUB-PAGE ========== */}
        {/*
          Work and History both render from this block, because both need the
          same holdings arithmetic: Work does not use it, but History's
          capital bar and Current Exposure do, and the book filter that
          governs the timeline is derived from it. The two halves are guarded
          separately inside.
        */}
        {(activeMode === 'work' || activeMode === 'history') && (() => {
          // Derive summary metrics from portfolio holdings
          const portfolioCount = portfolioHoldings?.length ?? 0
          /*
           * ── One price for both sides of every figure in this bar ────────
           *
           * `mktVal` was `shares * (currentPrice || held)` — the LIVE quote —
           * while `weight` was `(shares * held) / ptotal`, a book price over
           * a book-priced NAV. Two tiles rendered side by side from the same
           * array therefore described different portfolios: Net Exposure
           * marked this one holding at today's price while every other
           * holding in the denominator stayed at its upload price. A reader
           * could divide the two visible columns of one Current Exposure row
           * and not recover the percentage printed beside them.
           *
           * It is not fixable by repricing the numerator alone, which is the
           * tempting move. `useAssetLiveWeights.ts:34-37` states the rule:
           * "weight is a ratio, and repricing only the numerator against a
           * stale denominator is worse than leaving both stale." The
           * denominator here is the book `exposureIn` reads, every holding at
           * its upload price, and repricing it means a quote for every name
           * in every book — ~40 requests per portfolio, which the mapping
           * document marks desktop opt-in at most.
           *
           * So both sides are struck at the book price, which is what
           * `lib/portfolio/holdings.ts` does, what `PositionsTab:250-253` and
           * `OverviewTab:184-197` already do, and what `useAssetWorkspace`
           * returns. The cost is that Net Exposure no longer moves intraday.
           * That is the honest reading of a book priced at its last upload,
           * and the figure is labelled with its as-of date rather than left
           * to look live.
           *
           * The live quote is still fetched and still used — for the header,
           * and for the upside and divergence checks that genuinely compare
           * a target against today's price. It is simply not mixed into a
           * ratio whose denominator it does not reach.
           */
          const holdingMetrics = portfolioHoldings?.map((h: any) => {
            const exposure = exposureIn(h.portfolio_id)
            /*
             * `weight` feeds Largest Position, which compares weights ACROSS
             * books. That comparison is only meaningful while each weight is
             * struck against its own book — the previous denominator came
             * from a different upload per portfolio, so the comparison was
             * between numbers that measured different things.
             *
             * `mktVal` is a sum, not a ratio, so it was never affected by the
             * denominator defect; it is read from the book here only so one
             * reduction feeds every figure in this block.
             */
            return {
              weight: exposure?.weightPct ?? 0,
              mktVal: exposure?.marketValue ?? parseFloat(h.shares) * parseFloat(h.price ?? h.cost),
              shares: parseFloat(h.shares),
              name: h.portfolios?.name || 'Unknown',
              portfolioId: h.portfolio_id,
            }
          }) || []

          // Net exposure = sum of all market values across portfolios
          const netExposure = holdingMetrics.reduce((s, m) => s + m.mktVal, 0)
          // Largest position
          const largestPos = holdingMetrics.length > 0
            ? holdingMetrics.reduce((best, m) => m.weight > best.weight ? m : best, holdingMetrics[0])
            : null

          return (
            <div className="space-y-3">
              {/*
                ─── Order: the decision workflow first ──────────────────

                This tab opened with five exposure tiles and a holdings
                table, and put Open Items and the decision timeline BELOW
                them — roughly four hundred lines of portfolio arithmetic
                before the first thing anybody can act on.

                Decisions is the authoritative environment for
                recommendations, approvals, commitments, executions and
                reviews. Exposure is the context those happen against, not
                the subject, and the Snapshot already states it in the
                conclusion band and the Position module.

                So the lifecycle leads and exposure follows. Nothing was
                removed: both exposure blocks are intact and unchanged
                below, and the capital bar keeps the one-price rule
                documented in its own comment.
              */}
              {/* ─────────── Work · Ideas — REMOVED ───────────
                  The Open Items list rendered the same ideas the navigator
                  now lists, 1,092px down a 661px viewport, and clicking one
                  left the Asset page for the Ideas tab. Everything it could
                  do is reachable in the shell above:

                    the list          → the navigator's idea rows
                    the stage pills   → the navigator's stage filter
                    New Trade Idea    → the navigator's + control
                    opening an idea   → the idea surface, which also carries
                                        the rationale and the decision module
                    Open Idea Pipeline→ "Edit in the idea pipeline" on that
                                        surface, the same event

                  The attention deep-link that used to scroll here now clears
                  the selection and lets `resolveSelection` choose, which
                  lands on an item this reader can act on. */}

              {/* ─────────── History ───────────
                  The record: what was decided, in which book, and the
                  capital behind it. This was the lower half of the old
                  Decisions tab. */}
              {activeMode === 'history' && (<>
              {/*
                * The book selector sits ABOVE the timeline rather than inside
                * it, so the same control governs the capital bar and the
                * narrative below it and a reader is never looking at one
                * book's numbers beside another book's history.
                *
                * Books come from this asset's own holdings, which are already
                * fetched for the bar above — so the list is exactly the books
                * the reader is authorized to see (RLS-scoped) AND in which
                * this asset actually appears. Offering a book with no
                * exposure and no decisions would be offering an empty filter.
                *
                * `BookFilter` renders nothing at one book or fewer: a choice
                * of one is not a choice.
                */}
              {(() => {
                const books = [...new Map(
                  holdingMetrics.map(m => [m.portfolioId, { id: m.portfolioId, name: m.name }]),
                ).values()]
                return books.length > 1 ? (
                  <div className="flex items-center justify-end">
                    <BookFilter
                      books={books}
                      portfolioId={decisionBookId}
                      onSelect={setDecisionBookId}
                      allLabel="All portfolios"
                      testId="decision-memory-book-filter"
                      compact
                    />
                  </div>
                ) : null
              })()}

              <DecisionTimeline
                assetId={asset.id}
                portfolioId={decisionBookId}
                onNavigate={onNavigate}
              />

              {/* ─── Capital State Bar ────────────────────────────── */}
              <div className="grid grid-cols-5 gap-2">
                {[
                  {
                    label: 'Held In',
                    value: portfolioCount > 0 ? `${portfolioCount}` : '\u2014',
                    sub: portfolioCount > 0 ? `portfolio${portfolioCount !== 1 ? 's' : ''}` : null,
                    active: portfolioCount > 0,
                  },
                  {
                    label: 'Net Exposure',
                    /* Gated on the exposure itself, not on a quote. It is
                       struck at the book price now, so a missing quote is
                       irrelevant to it \u2014 and the old gate rendered an
                       active-styled em-dash while a book-priced exposure
                       was sitting right there. */
                    value: netExposure > 0
                      ? `$${netExposure.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                      : '\u2014',
                    sub: 'at book price',
                    active: netExposure > 0,
                  },
                  {
                    label: 'Largest Position',
                    value: largestPos && largestPos.weight > 0 ? `${largestPos.weight.toFixed(2)}%` : '\u2014',
                    sub: largestPos && largestPos.weight > 0 ? largestPos.name : null,
                    active: !!(largestPos && largestPos.weight > 0),
                  },
                  {
                    label: 'Active vs BM',
                    value: '\u2014',
                    sub: null,
                    active: false,
                  },
                  /*
                   * The newest EXECUTION the reader is allowed to see.
                   *
                   * Same hook, same arguments and therefore the same React
                   * Query key as the DecisionTimeline directly above, so this
                   * reads the cached result rather than issuing a second
                   * request \u2014 and inherits that query's authorization exactly.
                   * Executions are portfolio-team scoped by RLS, so a reader
                   * who cannot see a book does not see its trades here either.
                   *
                   * Still an em-dash when there is nothing: an asset with no
                   * execution the reader may see has no last action, and
                   * substituting a recommendation or an idea would answer a
                   * different question than the label asks.
                   */
                  {
                    label: 'Last Action',
                    value: lastExecution
                      ? lastExecution.title
                      : '\u2014',
                    sub: lastExecution
                      ? formatDistanceToNow(new Date(lastExecution.timestamp), { addSuffix: true })
                      : null,
                    active: !!lastExecution,
                  },
                ].map((metric) => (
                  <div
                    key={metric.label}
                    className={`rounded-lg border px-3 py-2.5 ${metric.active ? 'border-gray-200/80 bg-white shadow-sm dark:bg-gray-800' : 'border-gray-200/60 bg-gray-50/80'}`}
                  >
                    <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest block leading-none">
                      {metric.label}
                    </span>
                    <span className={`text-[17px] font-extrabold tabular-nums block mt-1.5 leading-tight ${metric.active ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                      {metric.value}
                    </span>
                    {metric.sub && (
                      <span className="text-[10px] text-gray-500 block mt-0.5 leading-tight truncate dark:text-gray-400">{metric.sub}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* ─── Current Exposure ────────────────────────────── */}
              <Card padding="none">
                <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between dark:border-gray-800">
                  <h4 className="text-[13px] font-semibold text-gray-900 dark:text-white">Current Exposure</h4>
                  {portfolioCount > 0 && (
                    <span className="text-[10px] text-gray-400 tabular-nums">{portfolioCount} position{portfolioCount !== 1 ? 's' : ''}</span>
                  )}
                </div>
                {portfolioHoldings && portfolioHoldings.length > 0 ? (
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/60 dark:border-gray-800">
                        <th className="px-4 py-1.5 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider">Portfolio</th>
                        <th className="px-4 py-1.5 text-right text-[10px] font-medium text-gray-400 uppercase tracking-wider">Port Wgt</th>
                        <th className="px-4 py-1.5 text-right text-[10px] font-medium text-gray-400 uppercase tracking-wider" title="Benchmark not configured">Bench Wgt</th>
                        <th className="px-4 py-1.5 text-right text-[10px] font-medium text-gray-400 uppercase tracking-wider" title="Benchmark not configured">Active Wgt</th>
                        <th className="px-4 py-1.5 text-right text-[10px] font-medium text-gray-400 uppercase tracking-wider">Port Shs</th>
                        <th className="px-4 py-1.5 text-right text-[10px] font-medium text-gray-400 uppercase tracking-wider">Mkt Val</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100/80">
                      {portfolioHoldings.map((holding: any) => {
                        const shares = parseFloat(holding.shares)
                        const costPerShare = parseFloat(holding.cost)
                        const held = parseFloat(holding.price ?? holding.cost)
                        // Book price, matching the weight beside it. See the
                        // note above `holdingMetrics`.
                        const currentValue = shares * held
                        /*
                         * The weight and its as-of come from the same book.
                         * `exposure` is null while the books load, and the
                         * cell shows an em dash rather than a percentage of
                         * an unknown denominator.
                         */
                        const exposure = exposureIn(holding.portfolio_id)
                        const weight = exposure?.weightPct ?? null
                        const weightAsOf = exposure?.asOf ?? null

                        return (
                          <tr key={holding.id} className="hover:bg-blue-50/40 group transition-colors">
                            <td className="px-4 py-1.5">
                              <span className="text-[13px] font-medium text-gray-900 dark:text-white">{holding.portfolios?.name || 'Unknown'}</span>
                            </td>
                            <td className="px-4 py-1.5 text-right">
                              <span
                                className="text-[13px] font-bold text-gray-900 tabular-nums dark:text-white"
                                /* A snapshot weight with no date invites the
                                   reader to trade against a number that may
                                   be weeks old. */
                                title={weightAsOf ? `Weight as of ${weightAsOf}` : undefined}
                              >
                                {weight !== null && exposure && exposure.bookValue > 0
                                  ? `${weight.toFixed(2)}%`
                                  : '\u2014'}
                              </span>
                            </td>
                            <td className="px-4 py-1.5 text-right">
                              <span className="text-[12px] text-gray-300 tabular-nums">{'\u2014'}</span>
                            </td>
                            <td className="px-4 py-1.5 text-right">
                              <span className="text-[12px] text-gray-300 tabular-nums">{'\u2014'}</span>
                            </td>
                            <td className="px-4 py-1.5 text-right">
                              <span className="text-[12px] text-gray-500 tabular-nums dark:text-gray-400">{shares.toLocaleString()}</span>
                            </td>
                            <td className="px-4 py-1.5 text-right">
                              <span className="text-[12px] text-gray-500 tabular-nums dark:text-gray-400">
                                {held > 0
                                  ? `$${currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                  : '\u2014'}
                              </span>
                            </td>
                            <td className="px-1 py-1.5">
                              <button
                                onClick={() => {
                                  if (onNavigate) {
                                    onNavigate({
                                      id: holding.portfolio_id,
                                      title: holding.portfolios?.name || 'Portfolio',
                                      type: 'portfolio',
                                      data: { id: holding.portfolio_id, portfolio_id: holding.portfolios?.portfolio_id }
                                    })
                                  }
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-primary-600"
                                title="Open portfolio"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>

                  </table>
                ) : (
                  <div className="px-4 py-4 flex items-center justify-between">
                    <div>
                      <span className="text-[13px] font-medium text-gray-500 block dark:text-gray-400">Not currently held</span>
                      <span className="text-[11px] text-gray-400 block mt-0.5">No approved or executed trade recommendations exist for this asset.</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('decision-engine-action', {
                            detail: {
                              type: 'trade-queue',
                              data: { filterAssetId: asset.id, filterSymbol: asset.symbol }
                            }
                          }))
                        }}
                        className="text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300"
                      >
                        View Idea Pipeline
                      </button>
                      <button
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('decision-engine-action', {
                            detail: {
                              type: 'new-trade-idea',
                              data: { assetId: asset.id, symbol: asset.symbol }
                            }
                          }))
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-white bg-primary-600 hover:bg-primary-700 transition-colors shadow-sm"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        New Trade Idea
                      </button>
                    </div>
                  </div>
                )}
              </Card>
              </>)}
            </div>
          )
        })()}

        {/* ─────────── Work · Other memberships — REMOVED ───────────

            Themes, portfolios and projects were full-width collapsible Cards
            here, 708px BELOW the working surface, where a reader working a
            process never saw them. They are sections of the sidebar now,
            beside the work they relate to, with the same rows, the same
            navigation and the same Add dialogs:

              Add to Theme      → the Themes section header
              Add to Project    → the Projects section header
              RelatedProjects   → the Projects section body, unchanged
              theme rows        → open the theme
              portfolio rows    → open the portfolio, weight beside the name
              "All themes" /
              "All portfolios"  → the ↗ on each header

            The one thing deliberately NOT carried over is the Portfolios
            card's `AddToQueueButton`, labelled "New Trade Idea": creating an
            idea is not a portfolio relationship, and the control already
            exists on In Progress. One action, one place.

            The `lists-section-*Content` ids moved with the sections, so the
            header's context chips still deep-link to them. */}


      </div>

      {/* Workflow Manager Modal */}
      <WorkflowManager
        isOpen={showWorkflowManager}
        onClose={() => setShowWorkflowManager(false)}
      />
    </div>
  )
}


/*
 * UX2 Phase 1 — the asset arrival/Ask-AI row moved into AssetWorkspaceHeader
 * (the navy identity band). Ask AI uses the same `askAI` engagement target;
 * arrival provenance ("Opened from …") was dropped from the dedicated row per
 * the approved design. The D1 pane in Layout and every other discuss() call
 * site are untouched.
 */
