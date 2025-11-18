import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { BarChart3, Target, FileText, Plus, Calendar, User, ArrowLeft, Activity, Clock, ChevronDown, AlertTriangle, Zap, Copy, Download, Trash2, List } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../../hooks/useAuth'
import { TabStateManager } from '../../lib/tabStateManager'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { PriorityBadge } from '../ui/PriorityBadge'
import { BadgeSelect } from '../ui/BadgeSelect'
import { EditableSectionWithHistory, type EditableSectionWithHistoryRef } from '../ui/EditableSectionWithHistory'
import { InvestmentTimeline } from '../ui/InvestmentTimeline'
import { QuickStageSwitcher } from '../ui/QuickStageSwitcher'
import { AssetWorkflowSelector } from '../ui/AssetWorkflowSelector'
import { WorkflowSelector } from '../ui/WorkflowSelector'
import { AssetWorkflowSelectorEnhanced } from '../asset/AssetWorkflowSelectorEnhanced'
import { WorkflowManager } from '../ui/WorkflowManager'
import { CaseCard } from '../ui/CaseCard'
import { AddToListButton } from '../lists/AddToListButton'
import { AddToThemeButton } from '../lists/AddToThemeButton'
import { AddToQueueButton } from '../lists/AddToQueueButton'
import { StockQuote } from '../financial/StockQuote'
import { AssetTimelineView } from '../ui/AssetTimelineView'
import { FinancialNews } from '../financial/FinancialNews'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { AdvancedChart } from '../charts/AdvancedChart'
import { CoverageDisplay } from '../coverage/CoverageDisplay'
import { NoteEditor } from '../notes/NoteEditorUnified'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { calculateAssetCompleteness } from '../../utils/assetCompleteness'

interface AssetTabProps {
  asset: any
  onCite?: (content: string, fieldName?: string) => void
  onNavigate?: (tab: { id: string, title: string, type: string, data?: any }) => void
  isFocusMode?: boolean
}

export function AssetTab({ asset, onCite, onNavigate, isFocusMode = false }: AssetTabProps) {
  const { user } = useAuth()
  const [assetPriority, setAssetPriority] = useState(asset.priority || 'none')
  const [workflowPriorityState, setWorkflowPriorityState] = useState('none')

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
  const [activeTab, setActiveTab] = useState<'thesis' | 'outcomes' | 'chart' | 'notes' | 'stage' | 'lists'>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.activeTab || 'thesis'
  })
  const [currentlyEditing, setCurrentlyEditing] = useState<string | null>(null)
  const [showNoteEditor, setShowNoteEditor] = useState(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.showNoteEditor || false
  })
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.selectedNoteId || null
  })
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const [showCoverageManager, setShowCoverageManager] = useState(false)
  const [viewingStageId, setViewingStageId] = useState<string | null>(() => {
    const savedState = TabStateManager.loadTabState(asset.id)
    return savedState?.viewingStageId || null
  })
  const [showHoldingsHistory, setShowHoldingsHistory] = useState(false)
  const [showTimelineView, setShowTimelineView] = useState(false)
  const [showTemplatesView, setShowTemplatesView] = useState(false)
  const [isTabStateInitialized, setIsTabStateInitialized] = useState(false)
  const [showWorkflowManager, setShowWorkflowManager] = useState(false)
  const [showAssetPriorityDropdown, setShowAssetPriorityDropdown] = useState(false)
  const [showWorkflowPriorityDropdown, setShowWorkflowPriorityDropdown] = useState(false)
  const [showTickerDropdown, setShowTickerDropdown] = useState(false)
  const queryClient = useQueryClient()

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
        .select('*')

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

  // Update asset priority when asset changes
  useEffect(() => {
    setAssetPriority(asset.priority || 'none')
  }, [asset.priority])

  // Update local state when switching to a different asset
  useEffect(() => {
    if (asset.id) {
      console.log(`🔍 AssetTab: Loading asset ${asset.symbol} with data:`, {
        assetId: asset.id,
        symbol: asset.symbol,
        workflow_id: asset.workflow_id,
        hasWorkflowProperty: 'workflow' in asset,
        assetPriority: asset.priority,
        thesis: asset.thesis,
        where_different: asset.where_different,
        risks_to_thesis: asset.risks_to_thesis,
        fullAsset: asset
      })
      setStage(mapToTimelineStage(asset.process_stage))

      // Restore saved tab state if available, otherwise start on thesis tab
      const savedState = TabStateManager.loadTabState(asset.id)
      if (savedState?.activeTab) {
        setActiveTab(savedState.activeTab)
      } else {
        setActiveTab('thesis')
      }

      setHasLocalChanges(false) // Reset local changes flag when loading new asset
    }
  }, [asset.id])

  // Mark as initialized once asset is loaded (state is already initialized in useState)
  useEffect(() => {
    setIsTabStateInitialized(true)
  }, [asset.id])

  // Handle noteId from navigation (e.g., from dashboard note click)
  // Only auto-switch to notes tab when noteId is present AND it's different from current selection
  // This prevents the tab from switching back to notes when user manually navigates to other tabs
  useEffect(() => {
    if (asset.noteId && asset.id && asset.noteId !== selectedNoteId) {
      console.log('📝 AssetTab: Opening note from navigation:', asset.noteId)
      setActiveTab('notes')
      setShowNoteEditor(true)
      setSelectedNoteId(asset.noteId)
    }
  }, [asset.id, asset.noteId, selectedNoteId])

  // Save tab state whenever relevant state changes (but only after initialization)
  useEffect(() => {
    if (isTabStateInitialized) {
      const stateToSave = {
        activeTab,
        viewingStageId,
        showNoteEditor,
        selectedNoteId
      }
      console.log(`AssetTab ${asset.id}: Saving state:`, stateToSave)
      TabStateManager.saveTabState(asset.id, stateToSave)
    }
  }, [asset.id, activeTab, viewingStageId, showNoteEditor, selectedNoteId, isTabStateInitialized])

  // ---------- Queries ----------
  const { data: coverage } = useQuery({
    queryKey: ['coverage', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('*')
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

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
        .select('*')
        .eq('asset_id', asset.id)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  // User lookup for notes
  const { data: usersById } = useQuery({
    queryKey: ['users-by-id', (notes ?? []).map(n => n.created_by), (notes ?? []).map(n => n.updated_by)],
    enabled: !!notes && notes.length > 0,
    queryFn: async () => {
      const ids = Array.from(
        new Set(
          (notes ?? [])
            .flatMap(n => [n.created_by, n.updated_by])
            .filter(Boolean) as string[]
        )
      )
      if (ids.length === 0) return {} as Record<string, any>

      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', ids)

      if (error) throw error

      const map: Record<string, any> = {}
      for (const u of data || []) map[u.id] = u
      return map
    }
  })

  // Portfolio holdings query
  const { data: portfolioHoldings } = useQuery({
    queryKey: ['portfolio-holdings', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select(`
          *,
          portfolios (
            id,
            name
          )
        `)
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // Get all holdings for each portfolio to calculate weights
  const { data: portfolioTotals } = useQuery({
    queryKey: ['portfolio-totals', portfolioHoldings?.map(h => h.portfolio_id)],
    queryFn: async () => {
      if (!portfolioHoldings || portfolioHoldings.length === 0) return {}

      const portfolioIds = [...new Set(portfolioHoldings.map(h => h.portfolio_id))]
      const totals: Record<string, number> = {}

      for (const portfolioId of portfolioIds) {
        const { data, error } = await supabase
          .from('portfolio_holdings')
          .select('shares, cost')
          .eq('portfolio_id', portfolioId)

        if (error) throw error

        // Calculate total cost (cost basis) for this portfolio
        const totalCost = (data || []).reduce((sum, holding) => {
          return sum + (parseFloat(holding.shares) * parseFloat(holding.cost))
        }, 0)

        totals[portfolioId] = totalCost
      }

      return totals
    },
    enabled: !!portfolioHoldings && portfolioHoldings.length > 0,
  })

  // Portfolio trade history
  const { data: portfolioTradeHistory } = useQuery({
    queryKey: ['portfolio-trade-history', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_trades')
        .select(`
          *,
          portfolios (
            id,
            name
          )
        `)
        .eq('asset_id', asset.id)
        .order('trade_date', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: showHoldingsHistory,
  })

  // Current stock price for P&L calculations
  const { data: currentQuote } = useQuery({
    queryKey: ['stock-quote', asset.symbol],
    queryFn: async () => {
      const quote = await financialDataService.getQuote(asset.symbol)
      return quote
    },
    enabled: !!asset.symbol && portfolioHoldings && portfolioHoldings.length > 0,
    staleTime: 15000, // Cache for 15 seconds
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  })

  // Query to determine the effective workflow ID for this asset
  // Fetch all workflow relationships for this asset
  const { data: allAssetWorkflows, refetch: refetchAllWorkflows } = useQuery({
    queryKey: ['asset-all-workflows', asset.id],
    queryFn: async () => {
      // Get all workflow progress records for this asset
      const { data: progressData, error: progressError } = await supabase
        .from('asset_workflow_progress')
        .select(`
          *,
          workflows:workflow_id (
            id,
            name,
            description,
            status,
            template_version_id,
            template_version_number,
            created_at,
            is_archived
          )
        `)
        .eq('asset_id', asset.id)
        .order('updated_at', { ascending: false })

      if (progressError) {
        console.error('Error fetching asset workflows:', progressError)
        return []
      }

      return progressData || []
    },
    enabled: !!asset.id
  })

  // Fetch available active workflow branches that asset can join
  const { data: availableWorkflows } = useQuery({
    queryKey: ['asset-available-workflows', asset.id, user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // Get IDs of workflows the asset is already in
      const assetWorkflowIds = allAssetWorkflows?.map(aw => aw.workflow_id) || []

      // Fetch active workflow branches user has access to
      const { data: workflows, error } = await supabase
        .from('workflows')
        .select(`
          id,
          name,
          description,
          status,
          template_version_id,
          template_version_number,
          created_by,
          is_public,
          is_archived
        `)
        .eq('status', 'active')
        .eq('is_archived', false)
        .or(`is_public.eq.true,created_by.eq.${user.id}`)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching available workflows:', error)
        return []
      }

      // Filter out workflows asset is already in
      return workflows?.filter(w => !assetWorkflowIds.includes(w.id)) || []
    },
    enabled: !!asset.id && !!user?.id && !!allAssetWorkflows
  })

  const { data: effectiveWorkflowId } = useQuery({
    queryKey: ['asset-effective-workflow', asset.id, asset.workflow_id],
    queryFn: async () => {
      console.log(`🔍 AssetTab: Determining effective workflow for ${asset.symbol}:`, {
        assetWorkflowId: asset.workflow_id,
        hasExplicitWorkflowId: !!asset.workflow_id
      })

      // If asset has explicit workflow_id, use that
      if (asset.workflow_id) {
        console.log(`✅ AssetTab: Using explicit workflow_id: ${asset.workflow_id}`)
        return asset.workflow_id
      }

      // Otherwise, check if there's an active workflow progress record
      const { data: workflowProgress, error } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id')
        .eq('asset_id', asset.id)
        .eq('is_started', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()

      if (error || !workflowProgress) {
        console.log(`🔍 AssetTab: No active workflow progress, fetching most recent workflow`)
        // No active workflow progress, fetch and return the most recently worked on workflow
        const { data: recentWorkflow, error: recentError } = await supabase
          .from('asset_workflow_progress')
          .select('workflow_id')
          .eq('asset_id', asset.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .single()

        if (recentError || !recentWorkflow) {
          console.log(`❌ AssetTab: No workflow history found for this asset`)
          return null
        }

        console.log(`✅ AssetTab: Using most recent workflow: ${recentWorkflow.workflow_id}`)
        return recentWorkflow.workflow_id
      }

      console.log(`✅ AssetTab: Using active workflow progress: ${workflowProgress.workflow_id}`)
      return workflowProgress.workflow_id
    },
    staleTime: 1000, // Cache for 1 second to be more responsive to workflow changes
  })

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

  // Fetch lists that contain this asset
  const { data: assetLists, isLoading: listsLoading } = useQuery({
    queryKey: ['asset-lists', asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('list_items')
        .select('lists(id, name, description, type, created_at)')
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data?.map(item => item.lists).filter(Boolean) || []
    }
  })

  // Fetch themes that contain this asset
  const { data: assetThemes, isLoading: themesLoading } = useQuery({
    queryKey: ['asset-themes', asset.id],
    queryFn: async () => {
      console.log('🔍 Fetching themes for asset:', asset.id)
      const { data, error } = await supabase
        .from('theme_assets')
        .select('themes(id, name, description, created_at, theme_type, color)')
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('❌ Error fetching asset themes:', error)
        throw error
      }
      console.log('📦 Raw theme_assets data:', data)
      const themes = data?.map(item => item.themes).filter(Boolean) || []
      console.log('🎨 Asset themes fetched:', themes)
      return themes
    }
  })

  const nameFor = (id?: string | null) => {
    if (!id) return 'Unknown'
    const u = usersById?.[id]
    if (!u) return 'Unknown'
    if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`
    return u.email?.split('@')[0] || 'Unknown'
  }

  const getThemeTypeColor = (type: string | null) => {
    switch (type) {
      case 'sector': return 'primary'
      case 'geography': return 'success'
      case 'strategy': return 'warning'
      case 'macro': return 'error'
      case 'general': return 'default'
      default: return 'default'
    }
  }

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
      // Ensure local state is in sync with the updated asset
      if (result.priority !== undefined) {
        setPriority(result.priority)
      }
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

  // Function to recalculate and update asset completeness
  const updateAssetCompleteness = async () => {
    const completeness = calculateAssetCompleteness({
      thesis: asset.thesis,
      where_different: asset.where_different,
      risks_to_thesis: asset.risks_to_thesis,
      priceTargets: priceTargets || []
    })

    // Only update if completeness has changed
    if (completeness !== asset.completeness) {
      await supabase
        .from('assets')
        .update({ completeness, updated_at: new Date().toISOString() })
        .eq('id', asset.id)

      // Update local asset object
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
      const { error } = await supabase
        .from('asset_workflow_progress')
        .insert({
          asset_id: asset.id,
          workflow_id: workflowId,
          is_started: startImmediately,
          started_at: startImmediately ? new Date().toISOString() : null
        })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-available-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', asset.id] })
      refetchAllWorkflows()
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      refetchAllWorkflows()
    }
  })

  const removeFromWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('asset_workflow_progress')
        .delete()
        .eq('asset_id', asset.id)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-available-workflows', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', asset.id] })
      refetchAllWorkflows()
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows', asset.id] })
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

  const handleAssetPriorityChange = (newPriority: string) => {
    setAssetPriority(newPriority)
    setHasLocalChanges(true)
    updateAssetMutation.mutate({ priority: newPriority })
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
    console.log(`🔄 Switching workflow for asset ${asset.symbol} (${effectiveAsset.id}) to workflow ${workflowId}`)
    setHasLocalChanges(true)

    // Clear the viewing stage initially to prevent showing stale information from previous workflow
    setViewingStageId(null)

    try {
      // Get the first stage of the new workflow and check if there's an existing workflow progress
      const [workflowStagesResult, workflowProgressResult] = await Promise.all([
        supabase
          .from('workflow_stages')
          .select('stage_key')
          .eq('workflow_id', workflowId)
          .order('sort_order')
          .limit(1),
        supabase
          .from('asset_workflow_progress')
          .select('current_stage_key, is_started')
          .eq('asset_id', effectiveAsset.id)
          .eq('workflow_id', workflowId)
          .single()
      ])

      if (workflowStagesResult.error) {
        console.error('Error fetching workflow stages:', workflowStagesResult.error)
        // Fallback to just updating workflow without changing stage
        asset.workflow_id = workflowId
        updateAssetMutation.mutate({ workflow_id: workflowId })
        // Invalidate the effective workflow query to update the UI immediately
        queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', asset.id] })
        return
      }

      const firstStageKey = workflowStagesResult.data?.[0]?.stage_key || 'prioritized'

      // Determine which stage to show: current active stage if workflow is started, otherwise first stage
      const workflowProgress = workflowProgressResult.data
      const isWorkflowStarted = workflowProgress?.is_started || false
      const effectiveCurrentStage = isWorkflowStarted && workflowProgress?.current_stage_key
        ? workflowProgress.current_stage_key
        : firstStageKey

      console.log(`📊 Workflow status for ${asset.symbol}:`, {
        workflowId,
        firstStageKey,
        isWorkflowStarted,
        currentProgress: workflowProgress,
        effectiveCurrentStage
      })

      // Update workflow assignment (but don't automatically start it)
      asset.workflow_id = workflowId
      setStage(effectiveCurrentStage)

      // Auto-select the appropriate stage to show what needs to be done
      setTimeout(() => {
        setViewingStageId(effectiveCurrentStage)
      }, 100) // Small delay to ensure the workflow data is updated

      // Only update workflow_id, don't try to update process_stage since stage_key values
      // may not match the process_stage enum values
      updateAssetMutation.mutate({
        workflow_id: workflowId
      })

      // Invalidate the effective workflow query to update the UI immediately
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', effectiveAsset.id] })
    } catch (error) {
      console.error('Error in handleWorkflowChange:', error)
      // Fallback to just updating workflow
      asset.workflow_id = workflowId
      updateAssetMutation.mutate({ workflow_id: workflowId })
      // Invalidate the effective workflow query to update the UI immediately
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', effectiveAsset.id] })
    }
  }

  const handleWorkflowStart = async (workflowId: string) => {
    console.log(`🔴 AssetTab: handleWorkflowStart called for asset ${asset.symbol} (${effectiveAsset.id}) in workflow ${workflowId}`)

    try {
      // Get the first stage of the workflow
      const { data: workflowStages, error: stagesError } = await supabase
        .from('workflow_stages')
        .select('stage_key')
        .eq('workflow_id', workflowId)
        .order('sort_order')
        .limit(1)

      if (stagesError) {
        console.error('Error fetching workflow stages:', stagesError)
        return
      }

      const firstStageKey = workflowStages?.[0]?.stage_key || 'prioritized'
      const now = new Date().toISOString()

      console.log(`📋 First stage key: ${firstStageKey}, workflow stages:`, workflowStages)

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

      console.log(`💾 About to upsert workflow progress:`, progressData)


      const { error: progressError } = await supabase
        .from('asset_workflow_progress')
        .upsert(progressData, {
          onConflict: 'asset_id,workflow_id'
        })

      if (progressError) {
        console.error('❌ Error starting workflow progress:', progressError)
      } else {
        console.log(`✅ Workflow started successfully for asset ${asset.symbol} in workflow ${workflowId}`)
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
        console.log(`🔄 Cache invalidated for workflow status updates`)
      }
    } catch (error) {
      console.error('Error starting workflow:', error)
    }
  }

  const handleWorkflowStop = async (workflowId: string) => {
    console.log(`⏸️ AssetTab: handleWorkflowStop called for asset ${asset.symbol} (${effectiveAsset.id}) in workflow ${workflowId}`)

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

      console.log(`✅ Workflow stopped successfully for asset ${asset.symbol} in workflow ${workflowId}`)

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

      console.log(`🔄 Cache updated and invalidated for workflow stop`)
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
        console.log(`Analyst notification sent for ${asset.symbol}`)
      }
    } catch (error) {
      console.error('Error sending analyst notification:', error)
    }
  }

  const handleTimelineStageClick = (stageId: string) => {
    // This could be used for showing stage-specific information or actions
    console.log('Timeline stage clicked:', stageId)
  }

  const handleStageView = (stageId: string) => {
    // Switch to stage tab to view the selected stage
    setActiveTab('stage')
    // Set the stage to view
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
    setSelectedNoteId(noteId)
    setShowNoteEditor(true)
  }

  const handleCreateNote = () => {
    setSelectedNoteId(null)
    setShowNoteEditor(true)
  }

  const handleCloseNoteEditor = () => {
    setShowNoteEditor(false)
    setSelectedNoteId(null)
    queryClient.invalidateQueries({ queryKey: ['asset-notes', asset.id] })
    queryClient.invalidateQueries({ queryKey: ['recent-notes'] })
  }

  const priorityOptions = [
    { value: 'critical', label: 'Critical Priority' },
    { value: 'high', label: 'High Priority' },
    { value: 'medium', label: 'Medium Priority' },
    { value: 'low', label: 'Low Priority' },
  ]

  return (
    <div className="space-y-6">
      {/* Asset Header */}
      <div className="space-y-4">
        {/* Single Row - All Summary Info and Controls */}
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-start gap-6">
            {/* Ticker, Price and Company Name */}
            <div className="flex flex-col relative">
              <div className="flex items-baseline gap-4">
                <button
                  onClick={() => setShowTickerDropdown(!showTickerDropdown)}
                  className="text-3xl font-bold text-gray-900 hover:text-gray-700 transition-colors"
                >
                  {asset.symbol}
                </button>
                <StockQuote symbol={asset.symbol} showOnlyPrice={true} className="text-2xl font-bold" />
                <StockQuote symbol={asset.symbol} showOnlyChange={true} className="text-xl font-semibold" />
              </div>
              <p className="text-lg text-gray-600 mt-1">{asset.company_name}</p>

              {/* Ticker Dropdown */}
              {showTickerDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowTickerDropdown(false)}
                  />
                  <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-xl z-20 p-4 min-w-[300px]">
                    <div className="space-y-4">
                      {/* Coverage */}
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Coverage</h4>
                        <CoverageDisplay assetId={asset.id} coverage={coverage || []} />
                      </div>

                      {/* Sector */}
                      {(asset.sector || fullAsset?.sector) && (
                        <div className="pt-4 border-t border-gray-200">
                          <h4 className="text-sm font-semibold text-gray-700 mb-2">Sector</h4>
                          <p className="text-sm text-gray-900">{asset.sector || fullAsset?.sector}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
          {/* Asset Priority Badge */}
          <div className="relative">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowAssetPriorityDropdown(!showAssetPriorityDropdown)}
                className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center space-x-1 hover:opacity-90 transition-opacity ${
                  assetPriority === 'critical' ? 'bg-red-600 text-white' :
                  assetPriority === 'high' ? 'bg-orange-500 text-white' :
                  assetPriority === 'medium' ? 'bg-blue-500 text-white' :
                  assetPriority === 'low' ? 'bg-green-500 text-white' :
                  'bg-gray-400 text-white'
                }`}
              >
                {assetPriority === 'critical' && <AlertTriangle className="w-3 h-3" />}
                {assetPriority === 'high' && <Zap className="w-3 h-3" />}
                {assetPriority === 'medium' && <Target className="w-3 h-3" />}
                {assetPriority === 'low' && <Clock className="w-3 h-3" />}
                {!assetPriority || assetPriority === 'none' && <Clock className="w-3 h-3" />}
                <span>Asset: {assetPriority === 'critical' ? 'Critical' : assetPriority === 'high' ? 'High' : assetPriority === 'medium' ? 'Medium' : assetPriority === 'low' ? 'Low' : 'None'}</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {showAssetPriorityDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowAssetPriorityDropdown(false)}
                  />
                  <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                    <div className="p-2">
                      <button
                        onClick={() => {
                          handleAssetPriorityChange('critical')
                          setShowAssetPriorityDropdown(false)
                        }}
                        className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all bg-red-600 text-white flex items-center space-x-1 mb-1 ${
                          assetPriority === 'critical' ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        <span>Critical</span>
                      </button>
                      <button
                        onClick={() => {
                          handleAssetPriorityChange('high')
                          setShowAssetPriorityDropdown(false)
                        }}
                        className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all bg-orange-500 text-white flex items-center space-x-1 mb-1 ${
                          assetPriority === 'high' ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        <Zap className="w-3 h-3" />
                        <span>High</span>
                      </button>
                      <button
                        onClick={() => {
                          handleAssetPriorityChange('medium')
                          setShowAssetPriorityDropdown(false)
                        }}
                        className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all bg-blue-500 text-white flex items-center space-x-1 mb-1 ${
                          assetPriority === 'medium' ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        <Target className="w-3 h-3" />
                        <span>Medium</span>
                      </button>
                      <button
                        onClick={() => {
                          handleAssetPriorityChange('low')
                          setShowAssetPriorityDropdown(false)
                        }}
                        className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all bg-green-500 text-white flex items-center space-x-1 mb-1 ${
                          assetPriority === 'low' ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        <span>Low</span>
                      </button>
                      <button
                        onClick={() => {
                          handleAssetPriorityChange('none')
                          setShowAssetPriorityDropdown(false)
                        }}
                        className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all bg-gray-400 text-white flex items-center space-x-1 ${
                          (!assetPriority || assetPriority === 'none') ? 'ring-2 ring-offset-1 ring-blue-300' : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        <span>None</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Workflow Selector */}
          <AssetWorkflowSelectorEnhanced
            mode="header"
            selectedWorkflowId={effectiveWorkflowId || null}
            allAssetWorkflows={allAssetWorkflows || []}
            availableWorkflows={[]}
            onSelectWorkflow={handleWorkflowChange}
            onJoinWorkflow={(workflowId) => joinWorkflowMutation.mutate({ workflowId, startImmediately: false })}
          />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Card padding="none">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('thesis')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'thesis'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <FileText className="h-4 w-4" />
                <span>Thesis</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('outcomes')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'outcomes'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Target className="h-4 w-4" />
                <span>Outcomes</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('chart')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'chart'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <BarChart3 className="h-4 w-4" />
                <span>Chart</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('notes')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'notes'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <FileText className="h-4 w-4" />
                <span>Notes</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('stage')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'stage'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Activity className="h-4 w-4" />
                <span>Stage</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('lists')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'lists'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <List className="h-4 w-4" />
                <span>Lists</span>
              </div>
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'thesis' && (
            <div className="space-y-6">
              <div
                className={clsx(
                  "bg-white border border-gray-200 rounded-lg p-6",
                  isFocusMode && "citable-component"
                )}
                onClick={() => handleComponentClick(asset.thesis || '', 'Investment Thesis')}
              >
                <EditableSectionWithHistory
                  ref={thesisRef}
                  title="Investment Thesis"
                  content={asset.thesis || ''}
                  onSave={handleSectionSave('thesis')}
                  placeholder="Describe your investment thesis for this asset..."
                  onEditStart={() => handleEditStart('thesis')}
                  onEditEnd={handleEditEnd}
                  assetId={asset.id}
                  fieldName="thesis"
                />
              </div>

              <div
                className={clsx(
                  "bg-blue-50 border border-blue-200 rounded-lg p-6",
                  isFocusMode && "citable-component"
                )}
                onClick={() => handleComponentClick(asset.where_different || '', 'Where We are Different')}
              >
                <EditableSectionWithHistory
                  ref={whereDifferentRef}
                  title="Where We are Different"
                  content={asset.where_different || ''}
                  onSave={handleSectionSave('where_different')}
                  placeholder="Explain how your view differs from consensus..."
                  onEditStart={() => handleEditStart('where_different')}
                  onEditEnd={handleEditEnd}
                  assetId={asset.id}
                  fieldName="where_different"
                />
              </div>

              <div
                className={clsx(
                  "bg-amber-50 border border-amber-200 rounded-lg p-6",
                  isFocusMode && "citable-component"
                )}
                onClick={() => handleComponentClick(asset.risks_to_thesis || '', 'Risks to Thesis')}
              >
                <EditableSectionWithHistory
                  ref={risksRef}
                  title="Risks to Thesis"
                  content={asset.risks_to_thesis || ''}
                  onSave={handleSectionSave('risks_to_thesis')}
                  placeholder="Identify key risks that could invalidate your thesis..."
                  onEditStart={() => handleEditStart('risks_to_thesis')}
                  onEditEnd={handleEditEnd}
                  assetId={asset.id}
                  fieldName="risks_to_thesis"
                />
              </div>
            </div>
          )}

          {activeTab === 'outcomes' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <CaseCard caseType="bull" priceTarget={getPriceTarget('bull')} onPriceTargetSave={handlePriceTargetSave} />
                <CaseCard caseType="base" priceTarget={getPriceTarget('base')} onPriceTargetSave={handlePriceTargetSave} />
                <CaseCard caseType="bear" priceTarget={getPriceTarget('bear')} onPriceTargetSave={handlePriceTargetSave} />
              </div>

              {/* Portfolio Holdings Section */}
              <div className="bg-white border border-gray-200 rounded-lg relative overflow-hidden">
                {/* Front side - Current Holdings */}
                <div className={`transition-transform duration-500 ease-in-out ${showHoldingsHistory ? 'transform -translate-x-full' : 'transform translate-x-0'}`}>
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">Portfolio Holdings</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowHoldingsHistory(true)}
                        className="flex items-center gap-2"
                      >
                        <Clock className="h-4 w-4" />
                        History
                      </Button>
                    </div>
                    {portfolioHoldings && portfolioHoldings.length > 0 ? (
                      <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Portfolio</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Weight</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shares</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Cost</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Cost</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Value</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unrealized P&L</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unrealized %</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {portfolioHoldings.map((holding: any) => {
                          const currentPrice = currentQuote?.price || 0
                          const shares = parseFloat(holding.shares)
                          const costPerShare = parseFloat(holding.cost)
                          const totalCost = shares * costPerShare
                          const currentValue = shares * currentPrice
                          const unrealizedPnL = currentValue - totalCost
                          const unrealizedPercentage = totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : 0
                          const isPositive = unrealizedPnL >= 0

                          // Calculate weight as percentage of total portfolio
                          const portfolioTotal = portfolioTotals?.[holding.portfolio_id] || 0
                          const weight = portfolioTotal > 0 ? (totalCost / portfolioTotal) * 100 : 0

                          return (
                            <tr key={holding.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm font-medium text-gray-900">
                                  {holding.portfolios?.name || 'Unknown Portfolio'}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {portfolioTotal > 0 ? `${weight.toFixed(2)}%` : '--'}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {shares.toLocaleString()}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                ${costPerShare.toFixed(2)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {currentPrice > 0 ? `$${currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm">
                                {currentPrice > 0 ? (
                                  <span className={`font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                    {isPositive ? '+' : ''}${unrealizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">--</span>
                                )}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm">
                                {currentPrice > 0 ? (
                                  <span className={`font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                    {isPositive ? '+' : ''}{unrealizedPercentage.toFixed(2)}%
                                  </span>
                                ) : (
                                  <span className="text-gray-400">--</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-gray-500">Not held in any portfolio</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Back side - Trade History */}
                  <div className={`absolute inset-0 transition-transform duration-500 ease-in-out ${showHoldingsHistory ? 'transform translate-x-0' : 'transform translate-x-full'}`}>
                    <div className="h-full flex flex-col">
                      <div className="flex items-center justify-between p-6 pb-4">
                        <h3 className="text-lg font-semibold text-gray-900">Trade History</h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowHoldingsHistory(false)}
                          className="flex items-center gap-2"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          Back
                        </Button>
                      </div>
                      <div className="flex-1 overflow-x-auto px-6 pb-6">
                        {portfolioTradeHistory && portfolioTradeHistory.length > 0 ? (
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Portfolio</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shares</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Value</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Weight Change</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {portfolioTradeHistory.map((trade: any) => {
                                const isBuy = trade.trade_type === 'buy'
                                const weightChange = trade.weight_change || 0

                                return (
                                  <tr key={trade.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                      {new Date(trade.trade_date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <div className="text-sm font-medium text-gray-900">
                                        {trade.portfolios?.name || 'Unknown Portfolio'}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <Badge variant={isBuy ? 'success' : 'error'}>
                                        {trade.trade_type.toUpperCase()}
                                      </Badge>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                      {isBuy ? '+' : '-'}{Math.abs(trade.shares).toLocaleString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                      ${parseFloat(trade.price).toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                      ${parseFloat(trade.total_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                      <div className="flex flex-col">
                                        <span className={`font-medium ${weightChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                          {weightChange >= 0 ? '+' : ''}{(weightChange * 100).toFixed(2)}%
                                        </span>
                                        <span className="text-xs text-gray-500">
                                          {trade.weight_before ? `${(trade.weight_before * 100).toFixed(2)}% → ${(trade.weight_after * 100).toFixed(2)}%` : ''}
                                        </span>
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        ) : (
                          <div className="text-center py-8 text-gray-500">
                            No trade history available
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
              </div>
            </div>
          )}

          {activeTab === 'chart' && (
            <div className="space-y-6">
              {asset.symbol ? (
                <AdvancedChart
                  symbol={asset.symbol}
                  height={500}
                  className="w-full"
                />
              ) : (
                <div className="bg-gray-50 rounded-lg p-12 text-center">
                  <BarChart3 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Chart Available</h3>
                  <p className="text-gray-500">This asset does not have a stock symbol associated with it.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'notes' && (showNoteEditor ? (
            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <Button variant="ghost" size="sm" onClick={handleCloseNoteEditor} className="flex items-center">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Notes
                </Button>
              </div>
              <NoteEditor
                assetId={asset.id}
                assetSymbol={asset.symbol}
                selectedNoteId={selectedNoteId ?? undefined}
                onNoteSelect={setSelectedNoteId}
              />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <Button size="sm" onClick={handleCreateNote}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Note
                </Button>
              </div>

              {notes && notes.length > 0 ? (
                <div className="space-y-4">
                  {notes.map((note) => (
                    <Card
                      key={note.id}
                      padding="sm"
                      className="cursor-pointer hover:shadow-md transition-shadow"
                    >
                      <div
                        className="flex items-start justify-between"
                        onClick={() => handleNoteClick(note.id)}
                      >
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <h4 className="font-semibold text-gray-900">{note.title}</h4>
                            {note.note_type && (
                              <Badge variant="default" size="sm">
                                {note.note_type}
                              </Badge>
                            )}
                            {note.is_shared && (
                              <Badge variant="primary" size="sm">
                                Shared
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                            {note.content.substring(0, 150)}...
                          </p>
                          <div className="flex items-center space-x-4 text-xs text-gray-500">
                            <div className="flex items-center">
                              <Calendar className="h-3 w-3 mr-1" />
                              {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}
                            </div>
                            {note.updated_by && (
                              <div className="flex items-center">
                                <User className="h-3 w-3 mr-1" />
                                Edited by {nameFor(note.updated_by)}
                              </div>
                            )}
                            {note.created_by && (
                              <div className="flex items-center">
                                <User className="h-3 w-3 mr-1" />
                                Created by {nameFor(note.created_by)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No related notes</h3>
                  <p className="text-gray-500">Create notes to document your research and thoughts about {asset.symbol}.</p>
                </div>
              )}
            </div>
          ))}

          {activeTab === 'stage' && (() => {
            console.log('🔍 AssetTab Stage - asset.id:', asset.id, 'effectiveAsset.id:', effectiveAsset.id, 'typeof effectiveAsset.id:', typeof effectiveAsset.id)
            return (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  {showTimelineView ? (
                    <h3 className="text-lg font-semibold text-gray-900">Activity Timeline</h3>
                  ) : (
                    <AssetWorkflowSelectorEnhanced
                      mode="stage-tab"
                      selectedWorkflowId={effectiveWorkflowId || null}
                      allAssetWorkflows={allAssetWorkflows || []}
                      availableWorkflows={availableWorkflows || []}
                      onSelectWorkflow={handleWorkflowChange}
                      onJoinWorkflow={(workflowId) => joinWorkflowMutation.mutate({ workflowId, startImmediately: false })}
                    />
                  )}
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      setShowTimelineView(!showTimelineView)
                      setShowTemplatesView(false)
                    }}
                    className="flex items-center space-x-2 px-3 py-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors duration-200 text-xs font-medium border border-gray-200 hover:border-gray-300"
                  >
                    {showTimelineView ? (
                      <>
                        <Activity className="w-4 h-4" />
                        <span>Stage View</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-4 h-4" />
                        <span>Timeline</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowTemplatesView(!showTemplatesView)
                      setShowTimelineView(false)
                    }}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg transition-colors duration-200 text-xs font-medium border ${
                      showTemplatesView
                        ? 'bg-blue-50 text-blue-700 border-blue-300'
                        : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    <span>Files</span>
                  </button>
                </div>
              </div>

              {showTemplatesView ? (
                <div className="mt-6 space-y-6">
                  {/* Workflow Templates Section */}
                  <Card>
                    <div className="p-4 border-b border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900">Workflow Templates</h3>
                      <p className="text-sm text-gray-500 mt-1">Templates available for this workflow</p>
                    </div>
                    <div className="p-4">
                      {templatesLoading ? (
                        <div className="text-center py-8">
                          <p className="text-gray-500 text-sm">Loading templates...</p>
                        </div>
                      ) : workflowTemplates && workflowTemplates.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {workflowTemplates.map((template) => (
                            <div key={template.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center space-x-3 flex-1 min-w-0">
                                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <FileText className="w-5 h-5 text-blue-600" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-medium text-gray-900 truncate">{template.name}</h4>
                                    <p className="text-xs text-gray-500 truncate">{template.file_name}</p>
                                  </div>
                                </div>
                              </div>

                              {template.description && (
                                <p className="text-xs text-gray-600 mb-3 line-clamp-2">{template.description}</p>
                              )}

                              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                <span className="text-xs text-gray-400">
                                  {template.file_size ? `${(template.file_size / 1024).toFixed(1)} KB` : 'Unknown size'}
                                </span>
                                <button
                                  onClick={() => window.open(template.file_url, '_blank')}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                  title="Download template"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                          <p className="text-sm text-gray-500 font-medium">No templates available</p>
                          <p className="text-xs text-gray-400 mt-2">Workflow admins can upload templates in the Workflows tab</p>
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Workflow Attachments Section */}
                  <Card>
                    <div className="p-4 border-b border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900">Workflow Attachments</h3>
                      <p className="text-sm text-gray-500 mt-1">Files attached to workflow tasks and stages</p>
                    </div>
                    <div className="p-4">
                      {attachmentsLoading ? (
                        <div className="text-center py-8">
                          <p className="text-gray-500 text-sm">Loading attachments...</p>
                        </div>
                      ) : checklistAttachments && checklistAttachments.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {checklistAttachments.map((attachment) => (
                            <div key={attachment.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center space-x-3 flex-1 min-w-0">
                                  <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <FileText className="w-5 h-5 text-green-600" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-medium text-gray-900 truncate">{attachment.file_name}</h4>
                                    <p className="text-xs text-gray-500">Stage: {attachment.stage_id}</p>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                <span className="text-xs text-gray-400">
                                  {attachment.file_size ? `${(attachment.file_size / 1024).toFixed(1)} KB` : 'Unknown size'}
                                </span>
                                <button
                                  onClick={() => window.open(attachment.file_path, '_blank')}
                                  className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                                  title="Download file"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                          <p className="text-sm text-gray-500 font-medium">No attachments yet</p>
                          <p className="text-xs text-gray-400 mt-2">Files can be attached to workflow tasks in the Stage view</p>
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              ) : showTimelineView ? (
                <AssetTimelineView
                  assetId={effectiveAsset.id}
                  assetSymbol={asset.symbol}
                  workflowId={effectiveWorkflowId}
                  isOpen={true}
                  onClose={() => setShowTimelineView(false)}
                  inline={true}
                />
              ) : (
                <InvestmentTimeline
                  currentStage={stage}
                  onStageChange={handleStageChange}
                  onStageClick={handleTimelineStageClick}
                  assetSymbol={asset.symbol}
                  assetId={effectiveAsset.id}
                  viewingStageId={viewingStageId}
                  onViewingStageChange={setViewingStageId}
                  workflowId={effectiveWorkflowId}
                  currentPriority={workflowPriorityState}
                  onPriorityChange={handleWorkflowPriorityChange}
                />
              )}
            </div>
            )
          })()}

          {activeTab === 'lists' && (
            <div className="space-y-6">
              <>
                  {(() => {
                    const listsByType = (assetLists as any[] || []).reduce((acc, list) => {
                      const type = list.type || 'list'
                      if (!acc[type]) acc[type] = []
                      acc[type].push(list)
                      return acc
                    }, {} as Record<string, any[]>)

                    return (
                      <div className="space-y-8">
                        {/* Lists Section */}
                        <div className="pb-8 border-b border-gray-200">
                          <div className="flex justify-between items-center mb-3">
                            <h4
                              onClick={() => {
                                if (onNavigate) {
                                  onNavigate({
                                    id: 'lists',
                                    title: 'Lists',
                                    type: 'lists',
                                    data: null
                                  })
                                }
                              }}
                              className="text-sm font-semibold text-gray-700 uppercase tracking-wide hover:text-primary-600 cursor-pointer transition-colors"
                            >
                              Lists
                            </h4>
                            <AddToListButton assetId={asset.id} />
                          </div>
                          {listsByType.list && listsByType.list.length > 0 ? (
                            <div className="grid gap-3">
                              {listsByType.list.map((list: any) => (
                                <Card key={list.id} className="hover:shadow-md transition-shadow cursor-pointer">
                                  <div className="p-4">
                                    <div className="flex items-start justify-between">
                                      <div>
                                        <h5 className="font-semibold text-gray-900">{list.name}</h5>
                                        {list.description && (
                                          <p className="text-sm text-gray-600 mt-1">{list.description}</p>
                                        )}
                                        {list.created_at && (
                                          <p className="text-xs text-gray-500 mt-2">
                                            Created {formatDistanceToNow(new Date(list.created_at), { addSuffix: true })}
                                          </p>
                                        )}
                                      </div>
                                      <Badge variant="default">list</Badge>
                                    </div>
                                  </div>
                                </Card>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                              <p className="text-sm text-gray-500">Not in any lists</p>
                            </div>
                          )}
                        </div>

                        {/* Themes Section */}
                        <div className="pb-8 border-b border-gray-200">
                          <div className="flex justify-between items-center mb-3">
                            <h4
                              onClick={() => {
                                if (onNavigate) {
                                  onNavigate({
                                    id: 'themes-list',
                                    title: 'All Themes',
                                    type: 'themes-list',
                                    data: null
                                  })
                                }
                              }}
                              className="text-sm font-semibold text-gray-700 uppercase tracking-wide hover:text-primary-600 cursor-pointer transition-colors"
                            >
                              Themes
                            </h4>
                            <AddToThemeButton assetId={asset.id} />
                          </div>
                          {assetThemes && assetThemes.length > 0 ? (
                            <div className="grid gap-2">
                              {assetThemes.map((theme: any) => (
                                <div
                                  key={theme.id}
                                  className="px-2 py-1 flex items-center gap-2"
                                >
                                  <span
                                    onClick={() => {
                                      if (onNavigate) {
                                        onNavigate({
                                          id: theme.id,
                                          title: theme.name,
                                          type: 'theme',
                                          data: theme
                                        })
                                      }
                                    }}
                                    className="text-sm font-medium text-gray-900 hover:bg-gray-50 cursor-pointer transition-colors px-1 py-0.5 rounded"
                                  >
                                    {theme.name}
                                  </span>
                                  <Badge variant={getThemeTypeColor(theme.theme_type)} size="sm">
                                    {theme.theme_type || 'general'}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                              <p className="text-sm text-gray-500">Not in any themes</p>
                            </div>
                          )}
                        </div>

                        {/* Portfolios Section */}
                        <div>
                          <div className="flex justify-between items-center mb-3">
                            <h4
                              onClick={() => {
                                if (onNavigate) {
                                  onNavigate({
                                    id: 'portfolios-list',
                                    title: 'All Portfolios',
                                    type: 'portfolios-list',
                                    data: null
                                  })
                                }
                              }}
                              className="text-sm font-semibold text-gray-700 uppercase tracking-wide hover:text-primary-600 cursor-pointer transition-colors"
                            >
                              Portfolios
                            </h4>
                            <AddToQueueButton assetId={asset.id} />
                          </div>
                          {portfolioHoldings && portfolioHoldings.length > 0 ? (
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Portfolio</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Weight</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shares</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Cost</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Cost</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Value</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unrealized P&L</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unrealized %</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {portfolioHoldings.map((holding: any) => {
                                    const currentPrice = currentQuote?.price || 0
                                    const shares = parseFloat(holding.shares)
                                    const costPerShare = parseFloat(holding.cost)
                                    const totalCost = shares * costPerShare
                                    const currentValue = shares * currentPrice
                                    const unrealizedPnL = currentValue - totalCost
                                    const unrealizedPercentage = totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : 0
                                    const isPositive = unrealizedPnL >= 0

                                    // Calculate weight as percentage of total portfolio
                                    const portfolioTotal = portfolioTotals?.[holding.portfolio_id] || 0
                                    const weight = portfolioTotal > 0 ? (totalCost / portfolioTotal) * 100 : 0

                                    return (
                                      <tr key={holding.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                          <div className="text-sm font-medium text-gray-900">
                                            {holding.portfolios?.name || 'Unknown Portfolio'}
                                          </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                          {portfolioTotal > 0 ? `${weight.toFixed(2)}%` : '--'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                          {shares.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                          ${costPerShare.toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                          ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                          {currentPrice > 0 ? `$${currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                          {currentPrice > 0 ? (
                                            <span className={`font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                              {isPositive ? '+' : ''}${unrealizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                          ) : (
                                            <span className="text-gray-400">--</span>
                                          )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                          {currentPrice > 0 ? (
                                            <span className={`font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                              {isPositive ? '+' : ''}{unrealizedPercentage.toFixed(2)}%
                                            </span>
                                          ) : (
                                            <span className="text-gray-400">--</span>
                                          )}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                              <p className="text-sm text-gray-500">Not in any portfolios</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}
              </>
            </div>
          )}
        </div>
      </Card>

      {/* Workflow Manager Modal */}
      <WorkflowManager
        isOpen={showWorkflowManager}
        onClose={() => setShowWorkflowManager(false)}
      />
    </div>
  )
}