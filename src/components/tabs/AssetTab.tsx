import React, { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { BarChart3, Target, FileText, Plus, Calendar, User, ArrowLeft, Activity, Clock, ChevronDown, AlertTriangle, Zap } from 'lucide-react'
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
import { WorkflowManager } from '../ui/WorkflowManager'
import { CaseCard } from '../ui/CaseCard'
import { AddToListButton } from '../lists/AddToListButton'
import { StockQuote } from '../financial/StockQuote'
import { AssetTimelineView } from '../ui/AssetTimelineView'
import { FinancialNews } from '../financial/FinancialNews'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { AdvancedChart } from '../charts/AdvancedChart'
import { CoverageDisplay } from '../coverage/CoverageDisplay'
import { NoteEditor } from '../notes/NoteEditorUnified'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'

interface AssetTabProps {
  asset: any
  onCite?: (content: string, fieldName?: string) => void
  onNavigate?: (tab: { id: string, title: string, type: string, data?: any }) => void
}

export function AssetTab({ asset, onCite, onNavigate }: AssetTabProps) {
  const { user } = useAuth()
  const [assetPriority, setAssetPriority] = useState(asset.priority || 'none')
  const [workflowPriorityState, setWorkflowPriorityState] = useState('none')

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
  const [activeTab, setActiveTab] = useState<'thesis' | 'outcomes' | 'chart' | 'notes' | 'stage'>(() => {
    // Initialize with saved state if available
    const savedState = TabStateManager.loadTabState(asset.id)
    const initialTab = savedState?.activeTab || 'thesis'
    console.log(`AssetTab ${asset.id}: Initializing with activeTab:`, initialTab, 'Full saved state:', savedState)
    return initialTab
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
  const [showTimelineView, setShowTimelineView] = useState(false)
  const [isTabStateInitialized, setIsTabStateInitialized] = useState(false)
  const [showWorkflowManager, setShowWorkflowManager] = useState(false)
  const [showAssetPriorityDropdown, setShowAssetPriorityDropdown] = useState(false)
  const [showWorkflowPriorityDropdown, setShowWorkflowPriorityDropdown] = useState(false)
  const queryClient = useQueryClient()

  // Refs for EditableSectionWithHistory components
  const thesisRef = useRef<EditableSectionWithHistoryRef>(null)
  const whereDifferentRef = useRef<EditableSectionWithHistoryRef>(null)
  const risksRef = useRef<EditableSectionWithHistoryRef>(null)


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
        fullAsset: asset
      })
      setStage(mapToTimelineStage(asset.process_stage))
      setHasLocalChanges(false) // Reset local changes flag when loading new asset
    }
  }, [asset.id])

  // Mark as initialized once asset is loaded (state is already initialized in useState)
  useEffect(() => {
    setIsTabStateInitialized(true)
  }, [asset.id])

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
        console.log(`🔍 AssetTab: No active workflow progress, fetching default workflow`)
        // No active workflow progress, fetch and return the default workflow
        const { data: defaultWorkflow, error: defaultError } = await supabase
          .from('workflows')
          .select('id')
          .eq('is_default', true)
          .single()

        if (defaultError || !defaultWorkflow) {
          console.log(`❌ AssetTab: No default workflow found`)
          return null
        }

        console.log(`✅ AssetTab: Using default workflow: ${defaultWorkflow.id}`)
        return defaultWorkflow.id
      }

      console.log(`✅ AssetTab: Using active workflow progress: ${workflowProgress.workflow_id}`)
      return workflowProgress.workflow_id
    },
    staleTime: 1000, // Cache for 1 second to be more responsive to workflow changes
  })

  const nameFor = (id?: string | null) => {
    if (!id) return 'Unknown'
    const u = usersById?.[id]
    if (!u) return 'Unknown'
    if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`
    return u.email?.split('@')[0] || 'Unknown'
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

  // Autosave mutation
  const handleSectionSave = (fieldName: string) => {
    return async (content: string) => {
      await updateAssetMutation.mutateAsync({ [fieldName]: content })
    }
  }

  const updatePriceTargetMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { error } = await supabase.from('price_targets').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-targets', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['price-target-history'] })
      queryClient.invalidateQueries({ queryKey: ['case-history'] })
    },
  })

  const createPriceTargetMutation = useMutation({
    mutationFn: async (priceTarget: any) => {
      const { error } = await supabase
        .from('price_targets')
        .insert([{ ...priceTarget, asset_id: asset.id, created_by: user?.id }])
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-targets', asset.id] })
      queryClient.invalidateQueries({ queryKey: ['price-target-history'] })
      queryClient.invalidateQueries({ queryKey: ['case-history'] })
    },
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
    console.log(`🔄 Switching workflow for asset ${asset.symbol} (${asset.id}) to workflow ${workflowId}`)
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
          .eq('asset_id', asset.id)
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

      updateAssetMutation.mutate({
        workflow_id: workflowId,
        process_stage: effectiveCurrentStage
      })

      // Invalidate the effective workflow query to update the UI immediately
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', asset.id] })
    } catch (error) {
      console.error('Error in handleWorkflowChange:', error)
      // Fallback to just updating workflow
      asset.workflow_id = workflowId
      updateAssetMutation.mutate({ workflow_id: workflowId })
      // Invalidate the effective workflow query to update the UI immediately
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow', asset.id] })
    }
  }

  const handleWorkflowStart = async (workflowId: string) => {
    console.log(`🔴 AssetTab: handleWorkflowStart called for asset ${asset.symbol} (${asset.id}) in workflow ${workflowId}`)

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
        asset_id: asset.id,
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
        queryClient.invalidateQueries({ queryKey: ['prioritizer-workflows'] })
        queryClient.invalidateQueries({ queryKey: ['asset-workflows-progress'] })
        queryClient.invalidateQueries({ queryKey: ['idea-generator-data'] })
        queryClient.invalidateQueries({ queryKey: ['current-workflow-status', asset.id, workflowId] })
        queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', asset.id, workflowId] })
        queryClient.invalidateQueries({ queryKey: ['workflows-all'] })
        console.log(`🔄 Cache invalidated for workflow status updates`)
      }
    } catch (error) {
      console.error('Error starting workflow:', error)
    }
  }

  const handleWorkflowStop = async (workflowId: string) => {
    console.log(`⏸️ AssetTab: handleWorkflowStop called for asset ${asset.symbol} (${asset.id}) in workflow ${workflowId}`)

    try {
      const now = new Date().toISOString()

      // Update workflow progress as stopped
      const { error: progressError } = await supabase
        .from('asset_workflow_progress')
        .update({
          is_started: false,
          updated_at: now
        })
        .eq('asset_id', asset.id)
        .eq('workflow_id', workflowId)

      if (progressError) {
        console.error('❌ Error stopping workflow progress:', progressError)
      } else {
        console.log(`✅ Workflow stopped successfully for asset ${asset.symbol} in workflow ${workflowId}`)
        // Invalidate caches so the workflow no longer shows as active
        queryClient.invalidateQueries({ queryKey: ['prioritizer-workflows'] })
        queryClient.invalidateQueries({ queryKey: ['asset-workflows-progress'] })
        queryClient.invalidateQueries({ queryKey: ['idea-generator-data'] })
        queryClient.invalidateQueries({ queryKey: ['current-workflow-status', asset.id, workflowId] })
        queryClient.invalidateQueries({ queryKey: ['asset-workflow-progress', asset.id, workflowId] })
        queryClient.invalidateQueries({ queryKey: ['workflows-all'] })
        console.log(`🔄 Cache invalidated for workflow stop updates`)
      }
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
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-10 flex-1">
          {/* Company Info and Price in same section */}
          <div className="flex items-start space-x-6">
            <div className="flex flex-col">
              <div className="flex items-baseline space-x-4 mb-1">
                <h1 className="text-2xl font-bold text-gray-900">{asset.symbol}</h1>
              </div>
              <p className="text-lg text-gray-600">{asset.company_name}</p>
              {asset.sector && <p className="text-sm text-gray-500">{asset.sector}</p>}
            </div>

            {/* Live Financial Data */}
            <div className="flex-shrink-0">
              <StockQuote symbol={asset.symbol} compact={true} className="min-w-0" />
            </div>
          </div>

          {/* Coverage */}
          <div className="flex-shrink-0">
            <CoverageDisplay assetId={asset.id} coverage={coverage || []} />
          </div>

          {/* Add to List Button */}
          <div className="flex-shrink-0">
            <AddToListButton assetId={asset.id} assetSymbol={asset.symbol} variant="outline" size="sm" />
          </div>
        </div>

        {/* Status Badges */}
        <div className="flex items-center space-x-3">
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



          <AssetWorkflowSelector
            assetId={asset.id}
            currentWorkflowId={effectiveWorkflowId}
            onWorkflowChange={handleWorkflowChange}
            onWorkflowStart={handleWorkflowStart}
            onWorkflowStop={handleWorkflowStop}
          />
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
                {notes && notes.length > 0 && (
                  <Badge variant="default" size="sm">
                    {notes.length}
                  </Badge>
                )}
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
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'thesis' && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-lg p-6">
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
                  onCite={onCite}
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
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
                  onCite={onCite}
                />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
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
                  onCite={onCite}
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
              {portfolioHoldings && portfolioHoldings.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Portfolio Holdings</h3>
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
                </div>
              )}
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
                  <p className="text-gray-500 mb-4">Create notes to document your research and thoughts about {asset.symbol}.</p>
                  <Button size="sm" onClick={handleCreateNote}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Note
                  </Button>
                </div>
              )}
            </div>
          ))}

          {activeTab === 'stage' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                {showTimelineView ? (
                  <h3 className="text-lg font-semibold text-gray-900">Activity Timeline</h3>
                ) : (
                  <WorkflowSelector
                    currentWorkflowId={effectiveWorkflowId}
                    assetId={asset.id}
                    onWorkflowChange={handleWorkflowChange}
                    onWorkflowStart={handleWorkflowStart}
                    onWorkflowStop={handleWorkflowStop}
                    onManageWorkflows={() => setShowWorkflowManager(true)}
                    onViewAllWorkflows={() => {
                      if (onNavigate) {
                        onNavigate({
                          id: 'workflows',
                          title: 'Workflows',
                          type: 'workflows',
                          data: null
                        })
                      }
                    }}
                  />
                )}
                <button
                  onClick={() => setShowTimelineView(!showTimelineView)}
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
                      <span>Timeline View</span>
                    </>
                  )}
                </button>
              </div>

              {showTimelineView ? (
                <AssetTimelineView
                  assetId={asset.id}
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
                  assetId={asset.id}
                  viewingStageId={viewingStageId}
                  onViewingStageChange={setViewingStageId}
                  workflowId={effectiveWorkflowId}
                  currentPriority={workflowPriorityState}
                  onPriorityChange={handleWorkflowPriorityChange}
                />
              )}
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