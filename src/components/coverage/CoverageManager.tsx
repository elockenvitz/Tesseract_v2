import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, X, Search, Trash2, ChevronDown, Upload, Download, FileText, AlertCircle, ChevronUp, Shield, Eye, History, Calendar, ArrowRightLeft, RefreshCw, Clock, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { formatDistanceToNow } from 'date-fns'

// Helper function to get local date in YYYY-MM-DD format (not UTC)
const getLocalDateString = (date: Date = new Date()): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface CoverageManagerProps {
  isOpen: boolean
  onClose: () => void
  initialView?: 'active' | 'history' | 'requests'
}

interface CoverageRecord {
  id: string
  asset_id: string
  user_id: string
  analyst_name: string
  created_at: string
  updated_at: string
  start_date: string
  end_date: string | null
  is_active: boolean
  changed_by: string | null
  assets: {
    id: string
    symbol: string
    company_name: string
    sector?: string
  } | null
}

export function CoverageManager({ isOpen, onClose, initialView = 'active' }: CoverageManagerProps) {
  const [activeView, setActiveView] = useState<'active' | 'history' | 'requests'>(initialView)
  const [searchQuery, setSearchQuery] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  // Sync activeView with initialView when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveView(initialView)
    }
  }, [isOpen, initialView])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [showUserDropdown, setShowUserDropdown] = useState<string | null>(null)
  const [editingCoverageId, setEditingCoverageId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean
    coverageId: string | null
    assetSymbol: string
    analystName: string
  }>({
    isOpen: false,
    coverageId: null,
    assetSymbol: '',
    analystName: ''
  })
  const [deleteTimelineConfirm, setDeleteTimelineConfirm] = useState<{
    isOpen: boolean
    coverageId: string | null
    analystName: string
    startDate: string
    endDate: string | null
    isActive: boolean
  }>({
    isOpen: false,
    coverageId: null,
    analystName: '',
    startDate: '',
    endDate: null,
    isActive: false
  })
  const [viewHistoryAssetId, setViewHistoryAssetId] = useState<string | null>(null)
  const [showAllChanges, setShowAllChanges] = useState(false)
  const [expandedChanges, setExpandedChanges] = useState<Set<string>>(new Set())
  const [showAllTimelinePeriods, setShowAllTimelinePeriods] = useState(false)
  const [selectedHistoryEvent, setSelectedHistoryEvent] = useState<any | null>(null)
  const [pendingTimelineChanges, setPendingTimelineChanges] = useState<{
    [coverageId: string]: {
      analyst?: { userId: string; analystName: string }
      startDate?: string
      endDate?: string | null
      isActive?: boolean
    }
  }>({})
  const [pendingTimelineDeletes, setPendingTimelineDeletes] = useState<Set<string>>(new Set())
  const [pendingNewCoverages, setPendingNewCoverages] = useState<Array<{
    id: string
    asset_id: string
    user_id: string
    analyst_name: string
    start_date: string
    end_date: string | null
    is_active: boolean
    changed_by?: string
    fromCoverageId?: string
  }>>([])
  const [editingDateValue, setEditingDateValue] = useState<{
    coverageId: string
    field: 'start' | 'end'
    value: string
  } | null>(null)
  const [editingAnalyst, setEditingAnalyst] = useState<string | null>(null)
  const [addingTransition, setAddingTransition] = useState<{
    fromCoverageId: string
    transitionDate: string
    newAnalystId: string
  } | null>(null)
  const [addingHistoricalPeriod, setAddingHistoricalPeriod] = useState<{
    assetId: string
    startDate: string
    endDate: string
    analystId: string
  } | null>(null)
  const [changingCurrentCoverage, setChangingCurrentCoverage] = useState<{
    assetId: string
    currentCoverageId: string
    currentAnalystName: string
    newAnalystId: string
  } | null>(null)
  const [endingCoverage, setEndingCoverage] = useState<{
    coverageId: string
    assetSymbol: string
    analystName: string
    endDate: string
  } | null>(null)
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean
    title: string
    message: string
  }>({
    isOpen: false,
    title: '',
    message: ''
  })
  const [requestingChange, setRequestingChange] = useState<{
    assetId: string
    assetSymbol: string
    currentUserId: string | null
    currentAnalystName: string | null
    requestedUserId: string
    requestType: 'add' | 'change' | 'remove'
    reason: string
  } | null>(null)
  const [rescindingRequest, setRescindingRequest] = useState<{
    requestId: string
    assetSymbol: string
  } | null>(null)
  const [addingCoverage, setAddingCoverage] = useState<{
    assetId: string
    analystId: string
    startDate: string
    endDate: string
  } | null>(null)
  const [assetSearchQuery, setAssetSearchQuery] = useState('')
  const [analystSearchQuery, setAnalystSearchQuery] = useState('')
  const [showAssetDropdown, setShowAssetDropdown] = useState(false)
  const [showAnalystDropdown, setShowAnalystDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Fetch all coverage records with asset details
  const { data: coverageRecords, isLoading: coverageLoading } = useQuery({
    queryKey: ['all-coverage'],
    queryFn: async () => {
      console.log('🔍 Fetching all coverage records with assets...')
      
      // First, let's check what's in the coverage table
      const { data: rawCoverage, error: rawError } = await supabase
        .from('coverage')
        .select('*')
        .limit(5)
      
      console.log('📋 Raw coverage data:', rawCoverage)
      console.log('❌ Raw coverage error:', rawError)
      
      // Now let's try the join
      const { data, error } = await supabase
        .from('coverage')
        .select('*, assets(*)')
        .order('updated_at', { ascending: false })
      
      if (error) {
        console.error('❌ Failed to fetch coverage:', error)
        console.error('❌ Error details:', JSON.stringify(error, null, 2))
        throw error
      }
      
      console.log('✅ Coverage with assets fetched:', data?.length || 0, 'records')
      console.log('📋 First record structure:', JSON.stringify(data?.[0], null, 2))
      console.log('📋 Asset data in first record:', data?.[0]?.assets)
      
      // Let's also check if there are any assets at all
      const { data: allAssets } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .limit(5)
      
      console.log('📊 Available assets:', allAssets?.length || 0)
      console.log('📊 Sample assets:', allAssets)
      
      return data as CoverageRecord[]
    },
    enabled: isOpen,
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  // Fetch all assets for adding new coverage
  const { data: assets } = useQuery({
    queryKey: ['assets-for-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .order('symbol', { ascending: true })
      
      if (error) throw error
      return data || []
    },
    enabled: isOpen,
  })

  // Fetch coverage history for a specific asset
  const { data: assetCoverageHistory } = useQuery({
    queryKey: ['asset-coverage-history', viewHistoryAssetId],
    queryFn: async () => {
      if (!viewHistoryAssetId) return []
      const { data, error } = await supabase
        .from('coverage')
        .select('*, assets(*)')
        .eq('asset_id', viewHistoryAssetId)
        .order('start_date', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!viewHistoryAssetId
  })

  // Fetch coverage change history for a specific asset
  const { data: coverageChangeHistory } = useQuery({
    queryKey: ['coverage-change-history', viewHistoryAssetId],
    queryFn: async () => {
      if (!viewHistoryAssetId) return []
      const { data, error } = await supabase
        .from('coverage_history')
        .select(`
          *,
          changed_by_user:users!coverage_history_changed_by_fkey(id, first_name, last_name, email)
        `)
        .eq('asset_id', viewHistoryAssetId)
        .order('changed_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!viewHistoryAssetId
  })

  // Fetch all users for analyst selection
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name, coverage_admin')
        .order('first_name')

      if (error) throw error
      return data || []
    }
  })

  // Fetch all major coverage events for history tab
  const { data: allCoverageEvents } = useQuery({
    queryKey: ['all-coverage-events'],
    queryFn: async () => {
      console.log('[Coverage History] Fetching coverage events...')
      const { data, error } = await supabase
        .from('coverage_history')
        .select(`
          *,
          assets(id, symbol, company_name)
        `)
        .in('change_type', ['created', 'analyst_changed', 'deleted', 'dates_changed'])
        .limit(100)

      if (error) {
        console.error('[Coverage History] Error fetching coverage events:', error)
        throw error
      }
      console.log('[Coverage History] Fetched events:', data?.length || 0, 'records')
      return data || []
    },
    enabled: isOpen && activeView === 'history'
  })

  // Fetch coverage requests
  const { data: coverageRequests } = useQuery({
    queryKey: ['coverage-requests', user?.id],
    queryFn: async () => {
      let query = supabase
        .from('coverage_requests')
        .select('*, assets(*), requested_by_user:users!coverage_requests_requested_by_fkey(id, email, first_name, last_name), reviewed_by_user:users!coverage_requests_reviewed_by_fkey(id, email, first_name, last_name)')
        .order('created_at', { ascending: false })

      // Non-admins can only see their own requests
      if (!user?.coverage_admin && user?.id) {
        query = query.eq('requested_by', user.id)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
    enabled: isOpen && activeView === 'requests'
  })

  // Set showAllChanges default based on user role
  useEffect(() => {
    if (user) {
      setShowAllChanges(!user.coverage_admin)
    }
  }, [user])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowUserDropdown(null)
        setEditingCoverageId(null)
      }
    }

    if (showUserDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserDropdown])

  // Close Add Coverage dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Check if click is outside both dropdowns
      if (!target.closest('.asset-search-container') && !target.closest('.analyst-search-container')) {
        setShowAssetDropdown(false)
        setShowAnalystDropdown(false)
      }
    }

    if (showAssetDropdown || showAnalystDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAssetDropdown, showAnalystDropdown])

  // Update coverage mutation
  const updateCoverageMutation = useMutation({
    mutationFn: async ({ coverageId, userId, analystName }: { coverageId: string; userId: string; analystName: string }) => {
      console.log('🚀 Mutation started - Updating coverage:', { coverageId, userId, analystName })
      
      const updateData = { 
        user_id: userId,
        analyst_name: analystName,
        updated_at: new Date().toISOString() 
      }
      console.log('📝 Update data:', updateData)
      
      const { data, error } = await supabase
        .from('coverage')
        .update(updateData)
        .eq('id', coverageId)
        .select()
      
      if (error) {
        console.error('❌ Supabase update failed:', error)
        console.error('❌ Error details:', JSON.stringify(error, null, 2))
        throw error
      }
      
      console.log('✅ Coverage updated successfully, returned data:', data)
      return data
    },
    onSuccess: () => {
      console.log('🎉 Mutation success - invalidating queries')
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
      setShowUserDropdown(null)
      setEditingCoverageId(null)
    },
    onError: (error) => {
      console.error('💥 Mutation onError callback:', error)
      console.error('💥 Error type:', typeof error)
      console.error('💥 Error message:', error?.message)
    }
  })

  // Bulk upload coverage mutation
  const bulkUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setIsUploading(true)
      setUploadErrors([])
      setUploadSuccess(null)
      
      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())
      
      if (lines.length === 0) {
        throw new Error('File is empty')
      }
      
      // Parse CSV (expecting: Symbol, Analyst Name, Email)
      const records = []
      const errors = []
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line || (i === 0 && line.toLowerCase().includes('symbol'))) continue // Skip header
        
        const [symbol, analystName, email] = line.split(',').map(s => s.trim().replace(/"/g, ''))
        
        if (!symbol || !analystName) {
          errors.push(`Line ${i + 1}: Missing symbol or analyst name`)
          continue
        }
        
        // Find asset by symbol
        const asset = assets?.find(a => a.symbol.toLowerCase() === symbol.toLowerCase())
        if (!asset) {
          errors.push(`Line ${i + 1}: Asset "${symbol}" not found`)
          continue
        }
        
        // Find user by email if provided, otherwise use analyst name as-is
        let userId = user?.id // Default to current user
        if (email) {
          const foundUser = users?.find(u => u.email?.toLowerCase() === email.toLowerCase())
          if (foundUser) {
            userId = foundUser.id
          } else {
            errors.push(`Line ${i + 1}: User with email "${email}" not found, using current user`)
          }
        }
        
        records.push({
          asset_id: asset.id,
          user_id: userId,
          analyst_name: analystName
        })
      }
      
      if (errors.length > 0) {
        setUploadErrors(errors)
      }
      
      if (records.length === 0) {
        throw new Error('No valid records to upload')
      }
      
      // Insert records
      const { error } = await supabase
        .from('coverage')
        .insert(records)
      
      if (error) throw error
      
      return { recordsCount: records.length, errorsCount: errors.length }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
      setUploadSuccess(`Successfully uploaded ${result.recordsCount} coverage assignments${result.errorsCount > 0 ? ` with ${result.errorsCount} warnings` : ''}`)
      setUploadFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    onError: (error) => {
      setUploadErrors([error.message])
    },
    onSettled: () => {
      setIsUploading(false)
    }
  })

  // Delete coverage mutation
  const deleteCoverageMutation = useMutation({
    mutationFn: async (coverageId: string) => {
      const { error } = await supabase
        .from('coverage')
        .delete()
        .eq('id', coverageId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
    }
  })

  // Create coverage request mutation (for non-admins)
  const createCoverageRequestMutation = useMutation({
    mutationFn: async (request: {
      asset_id: string
      current_user_id: string | null
      current_analyst_name: string | null
      requested_user_id: string
      requested_analyst_name: string
      request_type: 'add' | 'change' | 'remove'
      reason: string
    }) => {
      const { error } = await supabase
        .from('coverage_requests')
        .insert({
          ...request,
          requested_by: user?.id,
          status: 'pending'
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage-requests'] })
      setErrorModal({
        isOpen: true,
        title: 'Request Submitted',
        message: 'Your coverage change request has been submitted for admin approval.'
      })
    }
  })

  // Approve coverage request mutation (for admins)
  const approveCoverageRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const request = coverageRequests?.find(r => r.id === requestId)
      if (!request) throw new Error('Request not found')

      // First update the request status
      const { error: requestError } = await supabase
        .from('coverage_requests')
        .update({
          status: 'approved',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', requestId)

      if (requestError) throw requestError

      // Then execute the requested action
      if (request.request_type === 'add') {
        const { error } = await supabase
          .from('coverage')
          .insert({
            asset_id: request.asset_id,
            user_id: request.requested_user_id,
            analyst_name: request.requested_analyst_name,
            start_date: getLocalDateString(),
            is_active: true
          })
        if (error) throw error
      } else if (request.request_type === 'change') {
        const { error } = await supabase
          .from('coverage')
          .update({
            user_id: request.requested_user_id,
            analyst_name: request.requested_analyst_name,
            changed_by: user?.id
          })
          .eq('asset_id', request.asset_id)
          .eq('is_active', true)
        if (error) throw error
      } else if (request.request_type === 'remove') {
        const { error } = await supabase
          .from('coverage')
          .delete()
          .eq('asset_id', request.asset_id)
          .eq('user_id', request.current_user_id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage-requests'] })
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
    }
  })

  // Deny coverage request mutation (for admins)
  const denyCoverageRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from('coverage_requests')
        .update({
          status: 'denied',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', requestId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage-requests'] })
    }
  })

  // Rescind coverage request mutation (for users to cancel their own requests)
  const rescindCoverageRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase
        .from('coverage_requests')
        .update({
          status: 'rescinded',
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .eq('requested_by', user?.id) // Ensure users can only rescind their own requests
        .select()

      if (error) {
        console.error('Rescind error:', error)
        throw error
      }
      console.log('Rescind success:', data)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage-requests'] })
      setErrorModal({
        isOpen: true,
        title: 'Request Cancelled',
        message: 'Your coverage change request has been cancelled.'
      })
    },
    onError: (error) => {
      console.error('Rescind mutation error:', error)
      setErrorModal({
        isOpen: true,
        title: 'Error Cancelling Request',
        message: 'Failed to cancel the coverage request. Please try again.'
      })
    }
  })

  // Resubmit coverage request mutation (for users to resubmit rescinded requests)
  const resubmitCoverageRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase
        .from('coverage_requests')
        .update({
          status: 'pending',
          updated_at: new Date().toISOString(),
          reviewed_by: null,
          reviewed_at: null
        })
        .eq('id', requestId)
        .eq('requested_by', user?.id) // Ensure users can only resubmit their own requests
        .select()

      if (error) {
        console.error('Resubmit error:', error)
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage-requests'] })
      setErrorModal({
        isOpen: true,
        title: 'Request Resubmitted',
        message: 'Your coverage change request has been resubmitted for admin review.'
      })
    },
    onError: (error) => {
      console.error('Resubmit mutation error:', error)
      setErrorModal({
        isOpen: true,
        title: 'Error Resubmitting Request',
        message: 'Failed to resubmit the coverage request. Please try again.'
      })
    }
  })

  // Mutation to save all pending timeline changes
  const saveTimelineChangesMutation = useMutation({
    mutationFn: async () => {
      const updates: Promise<any>[] = []

      // Process analyst changes, date changes, deletions, and new coverages
      for (const [coverageId, changes] of Object.entries(pendingTimelineChanges)) {
        const updateData: any = {}
        if (changes.analyst) {
          updateData.user_id = changes.analyst.userId
          updateData.analyst_name = changes.analyst.analystName
        }
        if (changes.startDate !== undefined) updateData.start_date = changes.startDate
        if (changes.endDate !== undefined) updateData.end_date = changes.endDate
        if (changes.isActive !== undefined) updateData.is_active = changes.isActive

        if (Object.keys(updateData).length > 0) {
          updateData.changed_by = user?.id
          updates.push(
            supabase.from('coverage').update(updateData).eq('id', coverageId)
          )
        }
      }

      // Process deletions
      for (const coverageId of pendingTimelineDeletes) {
        updates.push(supabase.from('coverage').delete().eq('id', coverageId))
      }

      // Process new coverages
      for (const newCoverage of pendingNewCoverages) {
        const { id, fromCoverageId, ...insertData} = newCoverage
        updates.push(supabase.from('coverage').insert(insertData))
      }

      await Promise.all(updates)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage-change-history'] })
      queryClient.invalidateQueries({ queryKey: ['all-coverage-events'] })

      // Clear pending changes
      setPendingTimelineChanges({})
      setPendingTimelineDeletes(new Set())
      setPendingNewCoverages([])

      setViewHistoryAssetId(null)
      setAddingTransition(null)
      setAddingHistoricalPeriod(null)
      setChangingCurrentCoverage(null)
    }
  })

  const handleEditCoverage = (coverageId: string) => {
    console.log('✏️ Starting to edit coverage:', coverageId)
    setEditingCoverageId(coverageId)
    setShowUserDropdown(coverageId)
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setUploadFile(file)
      setUploadErrors([])
      setUploadSuccess(null)
    }
  }
  
  const handleUpload = () => {
    if (uploadFile) {
      bulkUploadMutation.mutate(uploadFile)
    }
  }
  
  const downloadTemplate = () => {
    const csvContent = 'Symbol,Analyst Name,Email (optional)\nAAPL,John Smith,john.smith@company.com\nMSFT,Jane Doe,jane.doe@company.com\nGOOGL,Bob Johnson,'
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'coverage_template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }

  const handleDeleteCoverage = (coverageId: string, assetSymbol: string, analystName: string) => {
    setDeleteConfirm({
      isOpen: true,
      coverageId,
      assetSymbol,
      analystName
    })
  }

  const confirmDeleteCoverage = () => {
    if (deleteConfirm.coverageId) {
      deleteCoverageMutation.mutate(deleteConfirm.coverageId)
    }
  }

  const getUserDisplayName = (user: any) => {
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    return user.email?.split('@')[0] || 'Unknown'
  }

  const filteredCoverage = (() => {
    let records = coverageRecords || []

    // Apply activeView filter
    if (activeView === 'active') {
      records = records.filter(coverage => coverage.is_active)

      // For active view, ensure only one active coverage per asset (currently active based on today's date)
      const today = new Date()
      const todayStr = today.toISOString().split('T')[0] // YYYY-MM-DD format

      const assetMap = new Map()
      records.forEach(coverage => {
        const assetId = coverage.asset_id
        const startDateStr = coverage.start_date.split('T')[0] // YYYY-MM-DD format

        // Only include coverage that has already started (start_date <= today)
        if (startDateStr > todayStr) {
          console.log(`Skipping future coverage: ${coverage.analyst_name} for ${coverage.assets?.symbol}, start_date: ${startDateStr}, today: ${todayStr}`)
          return // Skip future coverage
        }

        const existing = assetMap.get(assetId)
        if (!existing) {
          assetMap.set(assetId, coverage)
        } else {
          const existingStartDateStr = existing.start_date.split('T')[0]

          // Keep the one with the most recent start date that has already started
          if (startDateStr > existingStartDateStr) {
            assetMap.set(assetId, coverage)
          }
        }
      })
      records = Array.from(assetMap.values())
    } else if (activeView === 'history') {
      // Only show coverage that was previously active (not future coverage that never became active)
      records = records.filter(coverage => !coverage.is_active && coverage.end_date !== null)
    } else if (activeView === 'requests') {
      return [] // Don't show coverage table in requests view
    }

    // Apply search filter
    if (searchQuery) {
      records = records.filter(coverage =>
        coverage.assets?.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        coverage.assets?.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        coverage.analyst_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    return records
  })()

  // Get uncovered assets when searching in active view
  const uncoveredAssets = (() => {
    // Only show uncovered assets when in active view with a search query
    if (activeView !== 'active' || !searchQuery) {
      return []
    }

    // Get all covered asset IDs
    const coveredAssetIds = new Set(
      (coverageRecords || [])
        .filter(coverage => coverage.is_active)
        .map(coverage => coverage.asset_id)
    )

    // Filter all assets to find those matching the search but not covered
    return (assets || []).filter(asset => {
      const matchesSearch =
        asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.company_name.toLowerCase().includes(searchQuery.toLowerCase())

      return matchesSearch && !coveredAssetIds.has(asset.id)
    })
  })()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-7xl w-full mx-auto transform transition-all h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center justify-between p-6">
              <div className="flex items-center gap-6">
                {viewHistoryAssetId && assetCoverageHistory && assetCoverageHistory.length > 0 && (
                  <button
                    onClick={() => {
                      setPendingTimelineChanges({})
                      setPendingTimelineDeletes(new Set())
                      setPendingNewCoverages([])
                      setViewHistoryAssetId(null)
                      setAddingTransition(null)
                      setChangingCurrentCoverage(null)
                      setAddingHistoricalPeriod(null)
                      setShowAllChanges(false)
                    }}
                    className="text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    <ChevronDown className="h-5 w-5 rotate-90" />
                  </button>
                )}
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {viewHistoryAssetId && assetCoverageHistory && assetCoverageHistory.length > 0
                        ? 'Coverage Timeline'
                        : 'Coverage Management'}
                    </h3>
                    {user?.coverage_admin && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm ring-1 ring-blue-600/20">
                        <svg className="w-3 h-3 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        ADMIN
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    {viewHistoryAssetId && assetCoverageHistory && assetCoverageHistory.length > 0
                      ? `${assetCoverageHistory[0]?.assets?.symbol} - ${assetCoverageHistory[0]?.assets?.company_name}`
                      : 'Manage analyst coverage assignments'}
                  </p>
                </div>

                {/* Timeline Action Buttons - shown inline with header text */}
                {viewHistoryAssetId && assetCoverageHistory && assetCoverageHistory.length > 0 && user?.coverage_admin && (
                  <div className="flex items-center gap-2">
                    {/* Coverage Transition button */}
                    {(() => {
                      const today = getLocalDateString()
                      const activeCoverage = assetCoverageHistory.find(c =>
                        c.start_date <= today && (!c.end_date || c.end_date >= today)
                      )
                      return activeCoverage && (
                        <div className="relative group">
                          <button
                            onClick={() => {
                              const tomorrow = new Date()
                              tomorrow.setDate(tomorrow.getDate() + 1)
                              setAddingTransition({
                                fromCoverageId: activeCoverage.id,
                                transitionDate: getLocalDateString(tomorrow),
                                newAnalystId: ''
                              })
                            }}
                            className="p-2 text-purple-600 hover:bg-purple-50 rounded-md transition-colors border border-purple-300"
                          >
                            <ArrowRightLeft className="h-4 w-4" />
                          </button>
                          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap pointer-events-none z-10">
                            Add Transition
                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900"></div>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Change Current Coverage button */}
                    {(() => {
                      const today = getLocalDateString()
                      const activeCoverage = assetCoverageHistory.find(c =>
                        c.start_date <= today && (!c.end_date || c.end_date >= today)
                      )
                      return activeCoverage && (
                        <div className="relative group">
                          <button
                            onClick={() => setChangingCurrentCoverage({
                              assetId: viewHistoryAssetId,
                              currentCoverageId: activeCoverage.id,
                              currentAnalystName: activeCoverage.analyst_name,
                              newAnalystId: ''
                            })}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-md transition-colors border border-green-300"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </button>
                          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap pointer-events-none z-10">
                            Change Current Coverage
                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900"></div>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Add Historical Period button */}
                    <div className="relative group">
                      <button
                        onClick={() => setAddingHistoricalPeriod({
                          startDate: '',
                          endDate: null,
                          analystId: ''
                        })}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors border border-blue-300"
                      >
                        <Clock className="h-4 w-4" />
                      </button>
                      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap pointer-events-none z-10">
                        Add Historical Period
                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900"></div>
                      </div>
                    </div>

                    {/* End Coverage button */}
                    {(() => {
                      const today = getLocalDateString()
                      const activeCoverage = assetCoverageHistory.find(c =>
                        c.start_date <= today && (!c.end_date || c.end_date >= today)
                      )
                      return activeCoverage && (
                        <div className="relative group">
                          <button
                            onClick={() => setEndingCoverage({
                              coverageId: activeCoverage.id,
                              assetSymbol: activeCoverage.assets?.symbol || '',
                              analystName: activeCoverage.analyst_name,
                              endDate: today
                            })}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors border border-red-300"
                          >
                            <X className="h-4 w-4" />
                          </button>
                          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap pointer-events-none z-10">
                            End Coverage
                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900"></div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                {!viewHistoryAssetId && user?.coverage_admin && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        setAddingCoverage({
                          assetId: '',
                          analystId: '',
                          startDate: getLocalDateString(),
                          endDate: ''
                        })
                        setAssetSearchQuery('')
                        setAnalystSearchQuery('')
                        setShowAssetDropdown(false)
                        setShowAnalystDropdown(false)
                      }}
                      variant="outline"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Coverage
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setShowBulkUpload(!showBulkUpload)}
                      variant={showBulkUpload ? "primary" : "outline"}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Bulk Upload
                    </Button>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-hidden flex-1 relative">
            {/* Show Timeline View */}
            {viewHistoryAssetId && assetCoverageHistory && assetCoverageHistory.length > 0 ? (
              <div className="absolute inset-0 bg-white animate-slide-in-right flex flex-col">
                  {/* Timeline Content */}
                  <div className="flex-1 overflow-y-auto px-6 py-6">
                    {/* Timeline Entries */}
                    <div className="space-y-0">
                      {/* Add Transition Form - Show as purple tile above current coverage */}
                      {addingTransition && (() => {
                        const today = getLocalDateString()
                        const isFuture = addingTransition.transitionDate > today
                        const selectedUser = users?.find(u => u.id === addingTransition.newAnalystId)
                        const newAnalystName = selectedUser
                          ? (selectedUser.first_name && selectedUser.last_name
                            ? `${selectedUser.first_name} ${selectedUser.last_name}`
                            : selectedUser.email?.split('@')[0] || 'Unknown')
                          : ''
                        const currentCoverage = assetCoverageHistory.find(c => c.id === addingTransition.fromCoverageId)

                        return (
                          <div className="relative border-l-4 pl-6 pb-4 border-purple-500">
                            <div className="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-purple-500" />
                            <div className="p-4 rounded-md border border-purple-200 bg-purple-50">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <h5 className="text-sm font-semibold text-gray-900">
                                    {isFuture ? 'Schedule Future Transition' : 'Add Coverage Transition'}
                                  </h5>
                                  <Badge variant="purple" size="sm">Future</Badge>
                                </div>
                                <button
                                  onClick={() => setAddingTransition(null)}
                                  className="text-gray-400 hover:text-gray-600"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>

                              <div className="grid grid-cols-2 gap-3 mb-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    New Analyst
                                  </label>
                                  <select
                                    value={addingTransition.newAnalystId}
                                    onChange={(e) => setAddingTransition({ ...addingTransition, newAnalystId: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                                  >
                                    <option value="">Select analyst...</option>
                                    {users?.filter(u => u.id !== currentCoverage?.user_id).map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {u.first_name && u.last_name
                                          ? `${u.first_name} ${u.last_name}`
                                          : u.email?.split('@')[0] || 'Unknown'}
                                      </option>
                                    ))}
                                  </select>
                                  <p className="text-xs text-gray-500 mt-1">
                                    Who will take over coverage
                                  </p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Start Date
                                  </label>
                                  <input
                                    type="date"
                                    value={addingTransition.transitionDate}
                                    onChange={(e) => setAddingTransition({ ...addingTransition, transitionDate: e.target.value })}
                                    min={(() => {
                                      const tomorrow = new Date()
                                      tomorrow.setDate(tomorrow.getDate() + 1)
                                      return getLocalDateString(tomorrow)
                                    })()}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">
                                    When {newAnalystName || 'new analyst'} starts covering
                                  </p>
                                </div>
                              </div>

                              <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => setAddingTransition(null)}>
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    const { transitionDate, newAnalystId } = addingTransition

                                    if (!newAnalystId || !transitionDate) return

                                    // Validate transition date is in the future
                                    if (transitionDate <= today) {
                                      setErrorModal({
                                        isOpen: true,
                                        title: 'Invalid Transition Date',
                                        message: 'Coverage transitions must be scheduled for a future date (tomorrow or later). To change coverage effective today, please use the "Change Current Coverage" option instead.'
                                      })
                                      return
                                    }

                                    // Update the current coverage to end the day before transition
                                    const dayBefore = (() => {
                                      const [year, month, day] = transitionDate.split('-').map(Number)
                                      const d = new Date(year, month - 1, day)
                                      d.setDate(d.getDate() - 1)
                                      return getLocalDateString(d)
                                    })()

                                    setPendingTimelineChanges(prev => ({
                                      ...prev,
                                      [addingTransition.fromCoverageId]: {
                                        ...prev[addingTransition.fromCoverageId],
                                        endDate: dayBefore
                                      }
                                    }))

                                    // Create the new coverage record as pending
                                    const newCoverageId = `temp-${Date.now()}`
                                    const newCoverage = {
                                      id: newCoverageId,
                                      asset_id: currentCoverage!.asset_id,
                                      user_id: newAnalystId,
                                      analyst_name: newAnalystName,
                                      start_date: transitionDate,
                                      end_date: null,
                                      is_active: true,
                                      changed_by: user?.id,
                                      fromCoverageId: addingTransition.fromCoverageId
                                    }

                                    setPendingNewCoverages(prev => [...prev, newCoverage])
                                    setAddingTransition(null)
                                  }}
                                  disabled={!addingTransition.newAnalystId || !addingTransition.transitionDate}
                                >
                                  Add Transition
                                </Button>
                              </div>
                            </div>
                          </div>
                        )
                      })()}

                      {/* Render timeline entries */}
                      {(() => {
                        const sortedTimeline = [...assetCoverageHistory, ...pendingNewCoverages]
                          .sort((a, b) => b.start_date.localeCompare(a.start_date))

                        const displayTimeline = showAllTimelinePeriods ? sortedTimeline : sortedTimeline.slice(0, 3)
                        const hasMore = sortedTimeline.length > 3

                        return (
                          <>
                            {displayTimeline.map((dbRecord, index, sortedArray) => {
                          const pendingChange = pendingTimelineChanges[dbRecord.id]
                          const record = {
                            ...dbRecord,
                            ...(pendingChange?.analyst && {
                              user_id: pendingChange.analyst.userId,
                              analyst_name: pendingChange.analyst.analystName
                            }),
                            ...(pendingChange?.startDate !== undefined && { start_date: pendingChange.startDate }),
                            ...(pendingChange?.endDate !== undefined && { end_date: pendingChange.endDate })
                          }

                          const isDeleted = pendingTimelineDeletes.has(dbRecord.id)
                          const today = getLocalDateString()
                          const isCurrent = record.start_date <= today && (!record.end_date || record.end_date > today)
                          const isFuture = record.start_date > today

                          // Apply pending changes to adjacent records for accurate validation
                          const prevRecord = index > 0 ? (() => {
                            const dbPrev = sortedArray[index - 1]
                            const pendingPrev = pendingTimelineChanges[dbPrev.id]
                            return {
                              ...dbPrev,
                              ...(pendingPrev?.analyst && {
                                user_id: pendingPrev.analyst.userId,
                                analyst_name: pendingPrev.analyst.analystName
                              }),
                              ...(pendingPrev?.startDate !== undefined && { start_date: pendingPrev.startDate }),
                              ...(pendingPrev?.endDate !== undefined && { end_date: pendingPrev.endDate })
                            }
                          })() : null

                          const nextRecord = index < sortedArray.length - 1 ? (() => {
                            const dbNext = sortedArray[index + 1]
                            const pendingNext = pendingTimelineChanges[dbNext.id]
                            return {
                              ...dbNext,
                              ...(pendingNext?.analyst && {
                                user_id: pendingNext.analyst.userId,
                                analyst_name: pendingNext.analyst.analystName
                              }),
                              ...(pendingNext?.startDate !== undefined && { start_date: pendingNext.startDate }),
                              ...(pendingNext?.endDate !== undefined && { end_date: pendingNext.endDate })
                            }
                          })() : null

                          if (isDeleted) return null

                          // Check if this coverage is being ended (has a pending end date change)
                          const isEnding = isCurrent && pendingChange?.endDate !== undefined

                          const borderColor = isEnding ? 'border-red-500' : isCurrent ? 'border-green-500' : isFuture ? 'border-purple-500' : 'border-gray-300'
                          const dotColor = isEnding ? 'bg-red-500' : isCurrent ? 'bg-green-500' : isFuture ? 'bg-purple-500' : 'bg-gray-300'
                          const bgColor = isEnding ? 'bg-red-50 border-red-200' : isCurrent ? 'bg-green-50 border-green-200' : 'bg-white'

                          return (
                            <div key={record.id} className={`relative pl-4 pb-2`}>
                              <div className={`absolute left-0 top-[10px] bottom-2 w-1 ${dotColor}`} />
                              <div className={`absolute left-[-4px] top-[2px] w-[9px] h-[9px] rounded-full ${dotColor}`} />

                              <div className={`p-4 rounded-lg border shadow-sm hover:shadow-md transition-shadow ${bgColor}`}>
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    {/* Analyst Name */}
                                    <div className="flex items-center gap-2 mb-1.5">
                                    {editingAnalyst === record.id && user?.coverage_admin ? (
                                      <div className="relative" ref={dropdownRef}>
                                        <button
                                          onClick={() => setEditingAnalyst(null)}
                                          className="text-sm font-semibold text-gray-900 hover:text-blue-600 flex items-center gap-1"
                                        >
                                          {record.analyst_name}
                                          <ChevronDown className="h-3.5 w-3.5" />
                                        </button>
                                        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-[200px]">
                                          {users?.map((u) => {
                                            const displayName = u.first_name && u.last_name
                                              ? `${u.first_name} ${u.last_name}`
                                              : u.email?.split('@')[0] || 'Unknown'

                                            return (
                                              <button
                                                key={u.id}
                                                onClick={() => {
                                                  setPendingTimelineChanges(prev => ({
                                                    ...prev,
                                                    [dbRecord.id]: {
                                                      ...prev[dbRecord.id],
                                                      analyst: { userId: u.id, analystName: displayName }
                                                    }
                                                  }))
                                                  setEditingAnalyst(null)
                                                }}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-blue-50 transition-colors"
                                              >
                                                {displayName}
                                              </button>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    ) : user?.coverage_admin ? (
                                      <button
                                        onClick={() => setEditingAnalyst(record.id)}
                                        className="text-sm font-semibold text-gray-900 hover:text-blue-600 flex items-center gap-1"
                                      >
                                        {record.analyst_name}
                                        <ChevronDown className="h-3 w-3" />
                                      </button>
                                    ) : (
                                      <span className="text-sm font-semibold text-gray-900 flex items-center gap-1">
                                        {record.analyst_name}
                                      </span>
                                    )}
                                    {isEnding ? (
                                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white shadow-sm">
                                        ● ENDING
                                      </span>
                                    ) : isCurrent && (
                                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-500 text-white shadow-sm">
                                        ● CURRENT
                                      </span>
                                    )}
                                    {isFuture && <Badge variant="purple" size="sm">Future</Badge>}
                                  </div>

                                  {/* Date Range */}
                                  <div className="text-sm text-gray-600 flex items-center gap-2">
                                    {/* Start Date */}
                                    {editingDateValue?.coverageId === record.id && editingDateValue?.field === 'start' && user?.coverage_admin ? (
                                      <input
                                        type="date"
                                        value={editingDateValue.value}
                                        autoFocus
                                        onChange={(e) => {
                                          setEditingDateValue({
                                            coverageId: record.id,
                                            field: 'start',
                                            value: e.target.value
                                          })
                                        }}
                                        onBlur={(e) => {
                                          const newDate = e.target.value
                                          if (!newDate || newDate === record.start_date) {
                                            setEditingDateValue(null)
                                            return
                                          }

                                          const today = getLocalDateString()

                                          if (newDate > today) {
                                            setErrorModal({
                                              isOpen: true,
                                              title: 'Invalid Start Date',
                                              message: 'Start date cannot be in the future.'
                                            })
                                            setEditingDateValue(null)
                                            return
                                          }

                                          if (record.end_date && newDate > record.end_date) {
                                            setErrorModal({
                                              isOpen: true,
                                              title: 'Invalid Start Date',
                                              message: 'Start date cannot be after end date.'
                                            })
                                            setEditingDateValue(null)
                                            return
                                          }

                                          // Validate start date doesn't overlap with previous period
                                          if (nextRecord && nextRecord.end_date && newDate <= nextRecord.end_date) {
                                            const prevEndFormatted = (() => {
                                              const [year, month, day] = nextRecord.end_date.split('T')[0].split('-')
                                              const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                            })()
                                            setErrorModal({
                                              isOpen: true,
                                              title: 'Invalid Start Date',
                                              message: `Start date must be after the previous period ends (${prevEndFormatted}).`
                                            })
                                            setEditingDateValue(null)
                                            return
                                          }

                                          setPendingTimelineChanges(prev => ({
                                            ...prev,
                                            [dbRecord.id]: {
                                              ...prev[dbRecord.id],
                                              startDate: newDate
                                            }
                                          }))
                                          setEditingDateValue(null)
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.currentTarget.blur()
                                          } else if (e.key === 'Escape') {
                                            setEditingDateValue(null)
                                            e.currentTarget.blur()
                                          }
                                        }}
                                        className="inline-block w-[110px] h-[20px] px-1 py-0 text-sm leading-5 border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white align-baseline"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    ) : user?.coverage_admin ? (
                                      <button
                                        onClick={() => setEditingDateValue({ coverageId: record.id, field: 'start', value: record.start_date.split('T')[0] })}
                                        className="text-gray-900 hover:text-blue-600 hover:underline cursor-pointer"
                                      >
                                        {(() => {
                                          const [year, month, day] = record.start_date.split('T')[0].split('-')
                                          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                        })()}
                                      </button>
                                    ) : (
                                      <span className="text-gray-900">
                                        {(() => {
                                          const [year, month, day] = record.start_date.split('T')[0].split('-')
                                          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                        })()}
                                      </span>
                                    )}

                                    <span>→</span>

                                    {/* End Date */}
                                    {editingDateValue?.coverageId === record.id && editingDateValue?.field === 'end' && user?.coverage_admin ? (
                                      <input
                                        type="date"
                                        value={editingDateValue.value !== null
                                          ? editingDateValue.value
                                          : undefined
                                        }
                                        autoFocus
                                        onChange={(e) => {
                                          setEditingDateValue({
                                            coverageId: record.id,
                                            field: 'end',
                                            value: e.target.value
                                          })
                                        }}
                                        onBlur={(e) => {
                                          const newDate = e.target.value

                                          if (!newDate) {
                                            setPendingTimelineChanges(prev => ({
                                              ...prev,
                                              [dbRecord.id]: {
                                                ...prev[dbRecord.id],
                                                endDate: null
                                              }
                                            }))
                                            setEditingDateValue(null)
                                            return
                                          }

                                          if (newDate === record.end_date) {
                                            setEditingDateValue(null)
                                            return
                                          }

                                          if (newDate < record.start_date) {
                                            setErrorModal({
                                              isOpen: true,
                                              title: 'Invalid End Date',
                                              message: 'End date cannot be before start date.'
                                            })
                                            setEditingDateValue(null)
                                            return
                                          }

                                          // Validate end date doesn't overlap with future periods
                                          if (prevRecord) {
                                            const nextStartDate = prevRecord.start_date.includes('T') ? prevRecord.start_date.split('T')[0] : prevRecord.start_date
                                            if (newDate >= nextStartDate) {
                                              const [year, month, day] = nextStartDate.split('-').map(Number)
                                              const nextStartDateObj = new Date(year, month - 1, day)
                                              const nextStartFormatted = nextStartDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                              setErrorModal({
                                                isOpen: true,
                                                title: 'Invalid End Date',
                                                message: `End date must be before the next period starts (${nextStartFormatted}).`
                                              })
                                              setEditingDateValue(null)
                                              return
                                            }
                                          }

                                          setPendingTimelineChanges(prev => ({
                                            ...prev,
                                            [dbRecord.id]: {
                                              ...prev[dbRecord.id],
                                              endDate: newDate
                                            }
                                          }))
                                          setEditingDateValue(null)
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.currentTarget.blur()
                                          } else if (e.key === 'Escape') {
                                            setEditingDateValue(null)
                                            e.currentTarget.blur()
                                          }
                                        }}
                                        className="inline-block w-[110px] h-[20px] px-1 py-0 text-sm leading-5 border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white align-baseline"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    ) : user?.coverage_admin ? (
                                      <button
                                        onClick={() => setEditingDateValue({ coverageId: record.id, field: 'end', value: record.end_date ? record.end_date.split('T')[0] : null })}
                                        className="text-gray-900 hover:text-blue-600 hover:underline cursor-pointer"
                                      >
                                        {record.end_date ? (() => {
                                          const [year, month, day] = record.end_date.split('T')[0].split('-')
                                          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                        })() : (
                                          <span className="flex items-center gap-2">
                                            <span className="text-gray-500 italic">Unspecified</span>
                                          </span>
                                        )}
                                      </button>
                                    ) : (
                                      <span className="text-gray-900">
                                        {record.end_date ? (() => {
                                          const [year, month, day] = record.end_date.split('T')[0].split('-')
                                          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                        })() : (
                                          <span className="text-gray-500 italic">Unspecified</span>
                                        )}
                                      </span>
                                    )}

                                    {/* No End Date checkbox - only for current period when editing end date and not already unspecified */}
                                    {user?.coverage_admin && isCurrent && (editingDateValue?.coverageId === record.id && editingDateValue?.field === 'end') && record.end_date && (
                                      <label className="flex items-center gap-1.5 ml-2 cursor-pointer group">
                                        <input
                                          type="checkbox"
                                          checked={false}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setPendingTimelineChanges(prev => ({
                                                ...prev,
                                                [dbRecord.id]: {
                                                  ...prev[dbRecord.id],
                                                  endDate: null
                                                }
                                              }))
                                              setEditingDateValue(null)
                                            }
                                          }}
                                          className="w-3.5 h-3.5 text-green-600 border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:ring-offset-0 cursor-pointer"
                                        />
                                        <span className="text-sm text-gray-600 group-hover:text-gray-900">No End Date</span>
                                      </label>
                                    )}
                                  </div>
                                </div>

                                {/* Delete button */}
                                {user?.coverage_admin && (
                                  <button
                                    onClick={() => {
                                      setPendingTimelineDeletes(prev => new Set([...prev, record.id]))
                                    }}
                                    className="text-red-600 hover:bg-red-50 p-1.5 rounded transition-colors"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                                </div>
                              </div>
                            </div>
                          )
                        })}

                            {/* Show More Button */}
                            {hasMore && !showAllTimelinePeriods && (
                              <div className="flex justify-center pt-4 pb-2">
                                <button
                                  onClick={() => setShowAllTimelinePeriods(true)}
                                  className="px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-md transition-colors flex items-center gap-2"
                                >
                                  <ChevronDown className="h-4 w-4" />
                                  Show {sortedTimeline.length - 3} More Coverage Period{sortedTimeline.length - 3 !== 1 ? 's' : ''}
                                </button>
                              </div>
                            )}

                            {/* Show Less Button */}
                            {showAllTimelinePeriods && hasMore && (
                              <div className="flex justify-center pt-4 pb-2">
                                <button
                                  onClick={() => setShowAllTimelinePeriods(false)}
                                  className="px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-md transition-colors flex items-center gap-2"
                                >
                                  <ChevronUp className="h-4 w-4" />
                                  Show Less
                                </button>
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </div>

                    {/* All Changes Section */}
                    <div className="border-t border-gray-200 mt-4">
                      <button
                        onClick={() => setShowAllChanges(!showAllChanges)}
                        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <History className="h-5 w-5 text-gray-600" />
                          <span className="font-medium text-gray-900">All Changes</span>
                          <span className="text-sm text-gray-500">
                            ({coverageChangeHistory?.length || 0} {coverageChangeHistory?.length === 1 ? 'change' : 'changes'})
                          </span>
                        </div>
                        <ChevronDown className={`h-5 w-5 text-gray-600 transition-transform ${showAllChanges ? 'rotate-180' : ''}`} />
                      </button>

                      {showAllChanges && coverageChangeHistory && coverageChangeHistory.length > 0 && (
                        <div className="px-6 pb-4">
                          {/* Timeline View */}
                          <div className="max-h-[400px] overflow-y-auto pt-3">
                            {(() => {
                              // Filter changes
                              const filteredChanges = coverageChangeHistory.filter((change) => {
                                if (change.change_type === 'created') {
                                  const startDate = new Date(change.new_start_date)
                                  const today = new Date()
                                  today.setHours(0, 0, 0, 0)
                                  return startDate <= today
                                }
                                return true
                              })

                              // Group changes by date
                              const groupedByDate = filteredChanges.reduce((acc, change) => {
                                const changeDate = new Date(change.changed_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })
                                if (!acc[changeDate]) {
                                  acc[changeDate] = []
                                }
                                acc[changeDate].push(change)
                                return acc
                              }, {} as Record<string, typeof filteredChanges>)

                              const formatDate = (dateStr: string | null) => {
                                if (!dateStr) return 'Unspecified'
                                const [year, month, day] = dateStr.split('T')[0].split('-')
                                const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              }

                              return Object.entries(groupedByDate).map(([date, changes], dateIndex, dateArray) => {
                                const isLastDate = dateIndex === dateArray.length - 1

                                return (
                                  <div key={date} className="mb-4 last:mb-0">
                                    {/* Date Header */}
                                    <div className="flex items-center gap-2 mb-2 pl-6">
                                      <div className="text-sm font-semibold text-gray-700">{date}</div>
                                      <div className="flex-1 h-px bg-gray-200" />
                                    </div>

                                    {/* Changes for this date */}
                                    <div className="space-y-1">
                                      {changes.map((change, changeIndex) => {
                                        const changedByName = change.changed_by_user
                                          ? (change.changed_by_user.first_name && change.changed_by_user.last_name
                                            ? `${change.changed_by_user.first_name} ${change.changed_by_user.last_name}`
                                            : change.changed_by_user.email?.split('@')[0] || 'Unknown')
                                          : 'System'

                                        const changeTime = new Date(change.changed_at).toLocaleTimeString('en-US', {
                                          hour: 'numeric',
                                          minute: '2-digit'
                                        })

                                        const isLastChange = isLastDate && changeIndex === changes.length - 1
                                        const isExpanded = expandedChanges.has(change.id)

                                        return (
                                          <div key={change.id} className="relative pl-6">
                                            {/* Timeline dot and line */}
                                            <div className="absolute left-0 top-1.5 flex flex-col items-center">
                                              <div className={`w-2.5 h-2.5 rounded-full border-2 border-white ${
                                                change.change_type === 'created' ? 'bg-green-500' :
                                                change.change_type === 'analyst_changed' ? 'bg-blue-500' :
                                                change.change_type === 'dates_changed' ? 'bg-yellow-500' :
                                                'bg-red-500'
                                              } shadow`} />
                                              {!isLastChange && <div className="w-0.5 h-full bg-gray-200 mt-1" />}
                                            </div>

                                            {/* Content */}
                                            <div className="pb-2">
                                              {/* Main content - Clickable */}
                                              <button
                                                onClick={() => {
                                                  const newExpanded = new Set(expandedChanges)
                                                  if (isExpanded) {
                                                    newExpanded.delete(change.id)
                                                  } else {
                                                    newExpanded.add(change.id)
                                                  }
                                                  setExpandedChanges(newExpanded)
                                                }}
                                                className="w-full text-left bg-gray-50 border border-gray-200 rounded-lg p-2.5 hover:bg-gray-100 transition-colors"
                                              >
                                                {change.change_type === 'created' && (
                                                  <p className="text-sm text-gray-900">
                                                    <span className="font-semibold text-green-700">{change.new_analyst_name}</span> started covering this stock <span className="text-xs text-gray-500 font-normal ml-1">at {changeTime}</span>
                                                  </p>
                                                )}

                                                {change.change_type === 'analyst_changed' && (
                                                  <p className="text-sm text-gray-900">
                                                    Coverage transitioned from <span className="font-semibold text-gray-700">{change.old_analyst_name}</span> to <span className="font-semibold text-blue-700">{change.new_analyst_name}</span> <span className="text-xs text-gray-500 font-normal ml-1">at {changeTime}</span>
                                                  </p>
                                                )}

                                                {change.change_type === 'dates_changed' && (
                                                  <p className="text-sm text-gray-900">
                                                    <span className="font-semibold text-yellow-700">{change.new_analyst_name}</span>'s coverage period adjusted <span className="text-xs text-gray-500 font-normal ml-1">at {changeTime}</span>
                                                  </p>
                                                )}

                                                {change.change_type === 'deleted' && (
                                                  <p className="text-sm text-gray-900">
                                                    <span className="font-semibold text-red-700">{change.old_analyst_name}</span>'s coverage ended <span className="text-xs text-gray-500 font-normal ml-1">at {changeTime}</span>
                                                  </p>
                                                )}

                                                {/* Expand/collapse indicator */}
                                                <div className="flex items-center justify-end mt-1">
                                                  <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                </div>
                                              </button>

                                              {/* Expanded details */}
                                              {isExpanded && (
                                                <div className="mt-1 bg-white border border-gray-200 rounded-lg p-3 text-xs">
                                                  {change.change_type === 'created' && (
                                                    <div className="text-gray-600">
                                                      Period: {formatDate(change.new_start_date)} {change.new_end_date ? `— ${formatDate(change.new_end_date)}` : '— Present'}
                                                    </div>
                                                  )}

                                                  {change.change_type === 'analyst_changed' && (
                                                    <div className="text-gray-600">
                                                      Effective date: {formatDate(change.new_start_date)}
                                                    </div>
                                                  )}

                                                  {change.change_type === 'dates_changed' && (
                                                    <div className="text-gray-600 space-y-0.5">
                                                      {change.old_start_date !== change.new_start_date && (
                                                        <p>Start date: {formatDate(change.old_start_date)} → {formatDate(change.new_start_date)}</p>
                                                      )}
                                                      {change.old_end_date !== change.new_end_date && (
                                                        <p>End date: {formatDate(change.old_end_date)} → {formatDate(change.new_end_date)}</p>
                                                      )}
                                                    </div>
                                                  )}

                                                  {change.change_type === 'deleted' && (
                                                    <div className="text-gray-600">
                                                      Previously: {formatDate(change.old_start_date)} {change.old_end_date ? `— ${formatDate(change.old_end_date)}` : '— Present'}
                                                    </div>
                                                  )}

                                                  {/* Who made the change */}
                                                  <div className="mt-2 pt-2 border-t border-gray-200 text-gray-500">
                                                    Change made by {changedByName}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )
                              })
                            })()}
                          </div>
                        </div>
                      )}

                      {showAllChanges && (!coverageChangeHistory || coverageChangeHistory.length === 0) && (
                        <div className="px-6 pb-4">
                          <p className="text-sm text-gray-500 text-center py-4">No changes recorded yet</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Timeline Footer */}
                  {user?.coverage_admin ? (
                    <div className="flex justify-between items-center p-6 border-t border-gray-200 flex-shrink-0">
                      <div className="text-sm text-gray-600">
                        {(Object.keys(pendingTimelineChanges).length > 0 || pendingTimelineDeletes.size > 0 || pendingNewCoverages.length > 0) && (
                          <span className="text-warning-600 font-medium">
                            You have unsaved changes
                          </span>
                        )}
                      </div>
                      <div className="flex gap-3">
                        <Button variant="outline" onClick={() => {
                          setPendingTimelineChanges({})
                          setPendingTimelineDeletes(new Set())
                          setPendingNewCoverages([])
                          setViewHistoryAssetId(null)
                          setAddingTransition(null)
                          setChangingCurrentCoverage(null)
                          setAddingHistoricalPeriod(null)
                          setShowAllChanges(false)
                        }}>
                          Cancel
                        </Button>
                        <Button
                          onClick={() => saveTimelineChangesMutation.mutate()}
                          loading={saveTimelineChangesMutation.isPending}
                          disabled={Object.keys(pendingTimelineChanges).length === 0 && pendingTimelineDeletes.size === 0 && pendingNewCoverages.length === 0}
                        >
                          Save Changes
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end items-center p-6 border-t border-gray-200 flex-shrink-0">
                      <Button
                        onClick={() => {
                          const asset = assets?.find(a => a.id === viewHistoryAssetId)
                          const today = getLocalDateString()
                          // Find the current coverage using the same logic as the timeline view
                          const currentCoverage = assetCoverageHistory?.find(c => {
                            return c.start_date <= today && (!c.end_date || c.end_date >= today)
                          })
                          setRequestingChange({
                            assetId: viewHistoryAssetId || '',
                            assetSymbol: asset?.symbol || '',
                            currentUserId: currentCoverage?.user_id || null,
                            currentAnalystName: currentCoverage?.analyst_name || null,
                            requestedUserId: '',
                            requestType: currentCoverage ? 'change' : 'add',
                            reason: ''
                          })
                        }}
                      >
                        Request Coverage Change
                      </Button>
                    </div>
                  )}
                </div>
            ) : (
              <div className="p-6 space-y-6 overflow-y-auto flex-1">
            {/* Bulk Upload Coverage */}
            {showBulkUpload && (
              <Card>
                <h4 className="text-sm font-semibold text-gray-900 mb-4">Bulk Upload Coverage</h4>
              
              <div className="space-y-4">
                {/* Template Download */}
                <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <FileText className="h-5 w-5 text-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-blue-900">Download CSV Template</p>
                      <p className="text-xs text-blue-700">Get the correct format for bulk upload</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={downloadTemplate}>
                    <Download className="h-4 w-4 mr-2" />
                    Download Template
                  </Button>
                </div>
                
                {/* File Upload */}
                <div className="space-y-3">
                  <div className="flex items-center space-x-4">
                    <div className="flex-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        onChange={handleFileSelect}
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                      />
                    </div>
                    <Button
                      onClick={handleUpload}
                      disabled={!uploadFile || isUploading}
                      loading={isUploading}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload
                    </Button>
                  </div>
                  
                  {uploadFile && (
                    <div className="text-sm text-gray-600">
                      Selected: {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                    </div>
                  )}
                </div>
                
                {/* Upload Results */}
                {uploadSuccess && (
                  <div className="p-3 bg-success-50 border border-success-200 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 bg-success-500 rounded-full flex items-center justify-center">
                        <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-success-900">{uploadSuccess}</p>
                    </div>
                  </div>
                )}
                
                {uploadErrors.length > 0 && (
                  <div className="p-3 bg-warning-50 border border-warning-200 rounded-lg">
                    <div className="flex items-start space-x-2">
                      <AlertCircle className="h-4 w-4 text-warning-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-warning-900 mb-2">Upload Warnings:</p>
                        <ul className="text-xs text-warning-800 space-y-1">
                          {uploadErrors.map((error, index) => (
                            <li key={index}>• {error}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Format Instructions */}
                <div className="text-xs text-gray-500 space-y-1">
                  <p className="font-medium">CSV Format:</p>
                  <p>• Column 1: Asset Symbol (e.g., AAPL, MSFT)</p>
                  <p>• Column 2: Analyst Name (e.g., John Smith)</p>
                  <p>• Column 3: Email (optional - if not provided, assigns to current user)</p>
                </div>
              </div>
            </Card>
            )}

            {/* Search and Filter Buttons */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by asset symbol, company name, or analyst..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div className="inline-flex rounded-lg border border-gray-300 p-1 bg-gray-50">
                <button
                  onClick={() => setActiveView('active')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    activeView === 'active'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Active
                </button>
                <button
                  onClick={() => setActiveView('history')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    activeView === 'history'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  History
                </button>
                <button
                  onClick={() => setActiveView('requests')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors relative ${
                    activeView === 'requests'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Requests
                  {coverageRequests && coverageRequests.filter(r => r.status === 'pending').length > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full">
                      {coverageRequests.filter(r => r.status === 'pending').length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Coverage List - Active View */}
            {activeView === 'active' && (
              <Card padding="none" className="min-h-[400px]">
              {coverageLoading ? (
                <div className="p-6">
                  <div className="space-y-4">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="animate-pulse">
                        <div className="flex items-center space-x-4">
                          <div className="w-10 h-10 bg-gray-200 rounded-lg"></div>
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                          </div>
                          <div className="w-24 h-8 bg-gray-200 rounded"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : filteredCoverage.length > 0 || uncoveredAssets.length > 0 ? (
                <>
                  {/* Table Header */}
                  <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                    <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <div className="col-span-3">Asset</div>
                      <div className="col-span-3">Analyst</div>
                      <div className="col-span-3">Sector</div>
                      <div className="col-span-3 text-right">Actions</div>
                    </div>
                  </div>

                  {/* Scrollable Content */}
                  <div className="overflow-y-auto divide-y divide-gray-200 max-h-[calc(90vh-330px)]">
                    {/* Active Coverage Rows */}
                    {filteredCoverage.map((coverage) => (
                      <div key={coverage.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                        <div className="grid grid-cols-12 gap-4 items-center">
                          {/* Asset Info */}
                          <div className="col-span-3">
                            <div className="flex items-center space-x-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-gray-900 truncate">
                                  {coverage.assets?.symbol || 'Unknown Symbol'}
                                </p>
                                <p className="text-sm text-gray-600 truncate" title={coverage.assets?.company_name || 'Unknown Company'}>
                                  {coverage.assets?.company_name || 'Unknown Company'}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Analyst - Read Only */}
                          <div className="col-span-3">
                            <span className="text-sm text-gray-700">
                              {coverage.analyst_name}
                            </span>
                          </div>

                          {/* Sector */}
                          <div className="col-span-3">
                            <span className="text-sm text-gray-600">
                              {coverage.assets?.sector || '—'}
                            </span>
                          </div>

                          {/* Actions */}
                          <div className="col-span-3">
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={() => setViewHistoryAssetId(coverage.assets?.id || null)}
                                className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                title="View Coverage Timeline"
                              >
                                <History className="h-4 w-4" />
                              </button>
                              {user?.coverage_admin ? (
                                <button
                                  onClick={() => handleDeleteCoverage(
                                    coverage.id,
                                    coverage.assets?.symbol || 'Unknown',
                                    coverage.analyst_name
                                  )}
                                  className="p-1 text-gray-400 hover:text-error-600 transition-colors"
                                  disabled={deleteCoverageMutation.isPending}
                                  title="Delete Coverage"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => setRequestingChange({
                                    assetId: coverage.asset_id,
                                    assetSymbol: coverage.assets?.symbol || 'Unknown',
                                    currentUserId: coverage.user_id,
                                    currentAnalystName: coverage.analyst_name,
                                    requestedUserId: '',
                                    requestType: 'change',
                                    reason: ''
                                  })}
                                  className="p-1 text-gray-400 hover:text-warning-600 transition-colors"
                                  title="Request Coverage Change"
                                >
                                  <AlertCircle className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Not Covered Section */}
                    {uncoveredAssets.length > 0 && (
                      <>
                        {/* Section Divider */}
                        <div className="px-6 py-3 bg-amber-50 border-t-2 border-amber-200">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                            <span className="text-xs font-semibold text-amber-900 uppercase tracking-wider">
                              Not Covered ({uncoveredAssets.length})
                            </span>
                          </div>
                        </div>

                        {/* Uncovered Assets */}
                        {uncoveredAssets.map((asset) => (
                          <div key={asset.id} className="px-6 py-4 bg-amber-50/30 hover:bg-amber-50 transition-colors">
                            <div className="grid grid-cols-12 gap-4 items-center">
                              {/* Asset Info */}
                              <div className="col-span-3">
                                <div className="flex items-center space-x-3">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-gray-900 truncate">
                                      {asset.symbol}
                                    </p>
                                    <p className="text-sm text-gray-600 truncate" title={asset.company_name}>
                                      {asset.company_name}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {/* No Analyst */}
                              <div className="col-span-3">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                  No Coverage
                                </span>
                              </div>

                              {/* Sector */}
                              <div className="col-span-3">
                                <span className="text-sm text-gray-600">
                                  {asset.sector || '—'}
                                </span>
                              </div>

                              {/* Actions */}
                              <div className="col-span-3">
                                <div className="flex items-center gap-2 justify-end">
                                  {user?.coverage_admin && (
                                    <button
                                      onClick={() => {
                                        setAddingCoverage({
                                          assetId: asset.id,
                                          analystId: '',
                                          startDate: getLocalDateString(),
                                          endDate: ''
                                        })
                                        setAssetSearchQuery(`${asset.symbol} - ${asset.company_name}`)
                                        setAnalystSearchQuery('')
                                        setShowAssetDropdown(false)
                                        setShowAnalystDropdown(false)
                                      }}
                                      className="px-3 py-1 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
                                      title="Add Coverage"
                                    >
                                      Add Coverage
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Users className="h-8 w-8 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    {coverageRecords?.length === 0 ? 'No coverage assignments yet' : 'No coverage matches your search'}
                  </h3>
                  <p className="text-gray-500 mb-4">
                    {coverageRecords?.length === 0
                      ? 'Start by assigning analysts to cover specific assets.'
                      : 'Try adjusting your search criteria.'
                    }
                  </p>
                </div>
              )}
              </Card>
            )}

            {/* History View - Coverage Events */}
            {activeView === 'history' && (
              <Card padding="none" className={`min-h-[500px] ${!allCoverageEvents || allCoverageEvents.length === 0 ? 'flex items-center justify-center' : ''}`}>
                {!allCoverageEvents || allCoverageEvents.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <History className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No coverage history yet</h3>
                    <p className="text-gray-500">Coverage events will appear here</p>
                  </div>
                ) : (
                  <>
                    {/* Table Header */}
                    <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                      <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <div className="col-span-2">Event</div>
                        <div className="col-span-2">Asset</div>
                        <div className="col-span-5">Details</div>
                        <div className="col-span-3 text-right">Date</div>
                      </div>
                    </div>

                    {/* Coverage Events - Scrollable */}
                    <div className="overflow-y-auto divide-y divide-gray-200 max-h-[calc(90vh-330px)]">
                      {(() => {
                        // First, deduplicate events by creating a unique key for each logical event
                        const uniqueEvents = new Map()

                        console.log('[Coverage History] Raw events before dedup:', allCoverageEvents.length)
                        console.log('[Coverage History] Raw event types:', allCoverageEvents.filter(e => e.change_type === 'dates_changed').length, 'dates_changed')

                        allCoverageEvents.forEach((event) => {
                          // Create a unique key based on asset, change type, and the actual data that changed
                          let key = ''
                          if (event.change_type === 'created') {
                            key = `${event.asset_id}-created-${event.new_analyst_name}-${event.new_start_date}`
                          } else if (event.change_type === 'analyst_changed') {
                            key = `${event.asset_id}-changed-${event.old_analyst_name}-${event.new_analyst_name}-${event.new_start_date}`
                          } else if (event.change_type === 'deleted') {
                            key = `${event.asset_id}-deleted-${event.old_analyst_name}-${event.old_end_date}`
                          } else if (event.change_type === 'dates_changed') {
                            // For dates_changed events that SET an end date (transition), use a unique key that won't collide
                            // We want to keep these separate so we can match them with created events
                            if (event.old_end_date === null && event.new_end_date !== null) {
                              // This is setting an end date - likely part of a transition
                              key = `${event.asset_id}-transition-end-${event.old_analyst_name}-${event.new_end_date}-${event.changed_at}`
                            } else {
                              // Regular date change
                              key = `${event.asset_id}-dates-${event.old_analyst_name}-${event.old_start_date}-${event.new_end_date}`
                            }
                          }

                          // Keep the most recent version of each unique event
                          if (!uniqueEvents.has(key) || event.changed_at > uniqueEvents.get(key).changed_at) {
                            uniqueEvents.set(key, event)
                          }
                        })

                        // Convert to array
                        const deduplicatedEvents = Array.from(uniqueEvents.values())

                        // Now detect transitions: when a "created" event is close in time to a "dates_changed" event
                        // that set an end_date for a different analyst on the same asset
                        const transitionMap = new Map()
                        const processedEvents = new Set()

                        console.log('[Coverage History] Detecting transitions from', deduplicatedEvents.length, 'events')
                        console.log('[Coverage History] Event types:', deduplicatedEvents.map(e => e.change_type))
                        console.log('[Coverage History] dates_changed events:', deduplicatedEvents.filter(e => e.change_type === 'dates_changed').length)

                        deduplicatedEvents.forEach((createdEvent, idx) => {
                          if (createdEvent.change_type === 'created' && !processedEvents.has(createdEvent.id)) {
                            console.log('[Coverage History] Checking created event:', {
                              analyst: createdEvent.new_analyst_name,
                              asset: createdEvent.assets?.symbol,
                              date: createdEvent.new_start_date,
                              changed_at: createdEvent.changed_at
                            })

                            // Look for a corresponding dates_changed event around the same time
                            const matchingEndEvent = deduplicatedEvents.find((endEvent) => {
                              if (endEvent.change_type === 'dates_changed' &&
                                  endEvent.asset_id === createdEvent.asset_id &&
                                  endEvent.old_analyst_name !== createdEvent.new_analyst_name &&
                                  endEvent.new_end_date && // Make sure an end date was set
                                  !processedEvents.has(endEvent.id)) {

                                // Check if they happened within a few seconds of each other
                                const timeDiff = Math.abs(
                                  new Date(createdEvent.changed_at).getTime() -
                                  new Date(endEvent.changed_at).getTime()
                                )
                                console.log('[Coverage History] Potential match:', {
                                  old_analyst: endEvent.old_analyst_name,
                                  new_analyst: createdEvent.new_analyst_name,
                                  timeDiff,
                                  matches: timeDiff < 10000
                                })
                                return timeDiff < 10000 // Within 10 seconds
                              }
                              return false
                            })

                            if (matchingEndEvent) {
                              console.log('[Coverage History] ✓ Transition detected:', {
                                from: matchingEndEvent.old_analyst_name,
                                to: createdEvent.new_analyst_name,
                                asset: createdEvent.assets?.symbol
                              })
                              // This is a transition! Create a synthetic analyst_changed event
                              transitionMap.set(createdEvent.id, {
                                ...createdEvent,
                                change_type: 'analyst_changed',
                                old_analyst_name: matchingEndEvent.old_analyst_name,
                                old_user_id: matchingEndEvent.old_user_id,
                                old_start_date: matchingEndEvent.old_start_date,
                                old_end_date: matchingEndEvent.new_end_date
                              })
                              processedEvents.add(createdEvent.id)
                              processedEvents.add(matchingEndEvent.id)
                            } else {
                              console.log('[Coverage History] No matching transition found for', createdEvent.new_analyst_name)
                            }
                          }
                        })

                        console.log('[Coverage History] Transitions detected:', transitionMap.size)

                        // Build final events list: use transitions where detected, otherwise use original events
                        const finalEvents = deduplicatedEvents
                          .filter(event => !processedEvents.has(event.id))
                          .concat(Array.from(transitionMap.values()))
                          .sort((a, b) => {
                            // Sort by effective date (when the coverage actually changed)
                            const dateA = a.change_type === 'deleted' ? a.old_end_date : a.new_start_date
                            const dateB = b.change_type === 'deleted' ? b.old_end_date : b.new_start_date

                            // First compare by date
                            const dateComparison = (dateB || '').localeCompare(dateA || '')

                            // If dates are the same, sort by timestamp (changed_at)
                            if (dateComparison === 0) {
                              return (b.changed_at || '').localeCompare(a.changed_at || '')
                            }

                            return dateComparison
                          })

                        return finalEvents
                      })().map((event) => {
                        const formatDate = (dateStr: string | null) => {
                          if (!dateStr) {
                            console.warn('[Coverage History] N/A date for event:', {
                              id: event.id,
                              type: event.change_type,
                              asset: event.assets?.symbol,
                              old_start: event.old_start_date,
                              new_start: event.new_start_date,
                              old_end: event.old_end_date,
                              new_end: event.new_end_date
                            })
                            return 'N/A'
                          }
                          const [year, month, day] = dateStr.split('T')[0].split('-')
                          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        }

                        let eventType = ''
                        let details = ''
                        let badgeColor = 'bg-gray-100 text-gray-700'
                        let eventDate = ''
                        let dateToDisplay: string | null = null

                        if (event.change_type === 'created') {
                          eventType = 'Coverage Started'
                          details = `${event.new_analyst_name} started covering`
                          dateToDisplay = event.new_start_date
                          eventDate = formatDate(event.new_start_date)
                          badgeColor = 'bg-green-100 text-green-700'
                        } else if (event.change_type === 'analyst_changed') {
                          eventType = 'Analyst Changed'
                          details = `${event.old_analyst_name} → ${event.new_analyst_name}`
                          dateToDisplay = event.new_start_date
                          eventDate = formatDate(event.new_start_date)
                          badgeColor = 'bg-blue-100 text-blue-700'
                        } else if (event.change_type === 'deleted') {
                          eventType = 'Coverage Ended'
                          details = `${event.old_analyst_name} stopped covering`
                          dateToDisplay = event.old_end_date
                          eventDate = formatDate(event.old_end_date)
                          badgeColor = 'bg-red-100 text-red-700'
                        } else if (event.change_type === 'dates_changed') {
                          // Handle dates_changed events that weren't part of a transition
                          // These are standalone date changes that didn't involve an analyst transition

                          // Check what actually changed
                          const startDateChanged = event.old_start_date !== event.new_start_date
                          const endDateChanged = event.old_end_date !== event.new_end_date
                          const activeStatusChanged = event.old_is_active !== event.new_is_active

                          if (!startDateChanged && !endDateChanged) {
                            // Nothing meaningful changed, skip this event
                            return null
                          }

                          // Skip events where only an end date was added (likely part of a transition)
                          // These should have been caught by the transition detection
                          if (!startDateChanged && endDateChanged && event.old_end_date === null && event.new_end_date !== null) {
                            // This is setting an end date, which is usually part of a transition
                            // If it wasn't caught by transition detection, it's still not worth showing separately
                            return null
                          }

                          // Skip events for inactive coverage (historical adjustments)
                          if (event.old_is_active === false && event.new_is_active === false) {
                            // Both old and new are inactive, this is just historical cleanup
                            return null
                          }

                          eventType = 'Dates Updated'

                          // Build a more descriptive detail message
                          if (startDateChanged && endDateChanged) {
                            details = `${event.old_analyst_name}'s coverage dates changed`
                          } else if (startDateChanged) {
                            details = `${event.old_analyst_name}'s start date changed`
                          } else if (endDateChanged) {
                            details = `${event.old_analyst_name}'s end date changed`
                          }

                          // Use the new start date as the event date
                          dateToDisplay = event.new_start_date || event.old_start_date
                          eventDate = formatDate(dateToDisplay)
                          badgeColor = 'bg-gray-100 text-gray-700'
                        }

                        // Skip events that don't have a displayable date
                        if (!dateToDisplay) {
                          console.warn('[Coverage History] Skipping event with no displayable date:', event)
                          return null
                        }

                        return (
                          <div
                            key={event.id}
                            className="px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                            onClick={() => setSelectedHistoryEvent(event)}
                          >
                            <div className="grid grid-cols-12 gap-4 items-center">
                              <div className="col-span-2">
                                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${badgeColor} whitespace-nowrap`}>
                                  {eventType}
                                </span>
                              </div>
                              <div className="col-span-2">
                                <div>
                                  <p className="text-sm font-semibold text-gray-900">
                                    {event.assets?.symbol || 'Unknown'}
                                  </p>
                                  <p className="text-xs text-gray-500 truncate" title={event.assets?.company_name}>
                                    {event.assets?.company_name || '—'}
                                  </p>
                                </div>
                              </div>
                              <div className="col-span-5">
                                <p className="text-sm text-gray-900 font-medium">{details}</p>
                              </div>
                              <div className="col-span-3 text-right">
                                <p className="text-sm font-medium text-gray-900">{eventDate}</p>
                              </div>
                            </div>
                          </div>
                        )
                      }).filter(Boolean)}
                    </div>
                  </>
                )}
              </Card>
            )}

            {/* Requests View */}
            {activeView === 'requests' && (
              <Card padding="none" className={`min-h-[500px] ${!coverageRequests || coverageRequests.length === 0 ? 'flex items-center justify-center' : ''}`}>
                {!coverageRequests || coverageRequests.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Shield className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No coverage requests</h3>
                    <p className="text-gray-500">
                      There are no pending or historical coverage change requests.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200 w-full">
                    {/* Table Header */}
                    <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                      <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <div className="col-span-2">Asset</div>
                        <div className="col-span-1">Type</div>
                        <div className="col-span-2">Current Analyst</div>
                        <div className="col-span-2">Requested Analyst</div>
                        <div className="col-span-2">Requested By</div>
                        <div className="col-span-1">Status</div>
                        <div className="col-span-2">Actions</div>
                      </div>
                    </div>

                    {/* Request Rows */}
                    {coverageRequests.map((request) => (
                      <div key={request.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                        <div className="grid grid-cols-12 gap-4 items-center">
                          {/* Asset Info */}
                          <div className="col-span-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">
                                {request.assets?.symbol || 'Unknown'}
                              </p>
                              <p className="text-xs text-gray-600 truncate">
                                {request.assets?.company_name || ''}
                              </p>
                            </div>
                          </div>

                          {/* Request Type */}
                          <div className="col-span-1">
                            <Badge
                              variant={
                                request.request_type === 'add' ? 'blue' :
                                request.request_type === 'change' ? 'purple' :
                                'slate'
                              }
                              size="sm"
                            >
                              {request.request_type.charAt(0).toUpperCase() + request.request_type.slice(1)}
                            </Badge>
                          </div>

                          {/* Current Analyst */}
                          <div className="col-span-2">
                            <span className="text-sm text-gray-600">
                              {request.current_analyst_name || '—'}
                            </span>
                          </div>

                          {/* Requested Analyst */}
                          <div className="col-span-2">
                            <span className="text-sm text-gray-900 font-medium">
                              {request.requested_analyst_name}
                            </span>
                          </div>

                          {/* Requested By */}
                          <div className="col-span-2">
                            <div className="min-w-0">
                              <p className="text-sm text-gray-900 truncate">
                                {request.requested_by_user?.first_name && request.requested_by_user?.last_name
                                  ? `${request.requested_by_user.first_name} ${request.requested_by_user.last_name}`
                                  : request.requested_by_user?.email?.split('@')[0] || 'Unknown'}
                              </p>
                              <p className="text-xs text-gray-500">
                                {formatDistanceToNow(new Date(request.created_at), { addSuffix: true })}
                              </p>
                            </div>
                          </div>

                          {/* Status */}
                          <div className="col-span-1">
                            <Badge
                              variant={
                                request.status === 'pending' ? 'orange' :
                                request.status === 'approved' ? 'green' :
                                request.status === 'rescinded' ? 'slate' :
                                'error'
                              }
                              size="sm"
                            >
                              {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                            </Badge>
                          </div>

                          {/* Actions */}
                          <div className="col-span-2">
                            {request.status === 'pending' ? (
                              user?.coverage_admin ? (
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => approveCoverageRequestMutation.mutate(request.id)}
                                    disabled={approveCoverageRequestMutation.isPending}
                                    className="!text-green-600 !border-green-300 hover:!bg-green-50"
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => denyCoverageRequestMutation.mutate(request.id)}
                                    disabled={denyCoverageRequestMutation.isPending}
                                    className="!text-red-600 !border-red-300 hover:!bg-red-50"
                                  >
                                    Deny
                                  </Button>
                                </div>
                              ) : request.requested_by === user?.id ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setRescindingRequest({
                                    requestId: request.id,
                                    assetSymbol: request.assets?.symbol || 'Unknown'
                                  })}
                                  disabled={rescindCoverageRequestMutation.isPending}
                                  className="!text-orange-600 !border-orange-300 hover:!bg-orange-50"
                                >
                                  Cancel
                                </Button>
                              ) : (
                                <span className="text-xs text-gray-500">Pending</span>
                              )
                            ) : request.status === 'rescinded' && request.requested_by === user?.id ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => resubmitCoverageRequestMutation.mutate(request.id)}
                                disabled={resubmitCoverageRequestMutation.isPending}
                                className="!text-blue-600 !border-blue-300 hover:!bg-blue-50"
                              >
                                Resubmit
                              </Button>
                            ) : (
                              <div className="text-xs text-gray-500">
                                <div>
                                  {request.status === 'approved' ? 'Approved' :
                                   request.status === 'denied' ? 'Denied' :
                                   request.status === 'rescinded' ? 'Cancelled' : '—'}
                                </div>
                                {(request.status === 'approved' || request.status === 'denied') && request.reviewed_by_user && (
                                  <div className="text-[10px] text-gray-400 mt-0.5">
                                    by {request.reviewed_by_user.first_name} {request.reviewed_by_user.last_name}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Reason */}
                        {request.reason && (
                          <div className="mt-2 pl-0">
                            <p className="text-xs text-gray-500">
                              <span className="font-medium">Reason:</span> {request.reason}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
              </div>
            )}
          </div>

          {/* Footer - only shown for main view */}
          {!viewHistoryAssetId && (
            <div className="flex justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Add Historical Period Modal */}
      {addingHistoricalPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setAddingHistoricalPeriod(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Add Historical Coverage</h3>
              <button
                onClick={() => setAddingHistoricalPeriod(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Add a historical coverage period that occurred in the past.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Analyst
                </label>
                <select
                  value={addingHistoricalPeriod.analystId}
                  onChange={(e) => setAddingHistoricalPeriod({
                    ...addingHistoricalPeriod,
                    analystId: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select analyst...</option>
                  {users?.map((u) => {
                    const displayName = u.first_name && u.last_name
                      ? `${u.first_name} ${u.last_name}`
                      : u.email?.split('@')[0] || 'Unknown'
                    return (
                      <option key={u.id} value={u.id}>
                        {displayName}
                      </option>
                    )
                  })}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start Date
                </label>
                <input
                  type="date"
                  value={addingHistoricalPeriod.startDate}
                  max={addingHistoricalPeriod.endDate || getLocalDateString()}
                  onChange={(e) => setAddingHistoricalPeriod({
                    ...addingHistoricalPeriod,
                    startDate: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  End Date
                </label>
                <input
                  type="date"
                  value={addingHistoricalPeriod.endDate}
                  min={addingHistoricalPeriod.startDate}
                  max={getLocalDateString()}
                  onChange={(e) => setAddingHistoricalPeriod({
                    ...addingHistoricalPeriod,
                    endDate: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Historical periods must end in the past or today
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setAddingHistoricalPeriod(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const { startDate, endDate, analystId, assetId } = addingHistoricalPeriod

                  if (!startDate || !endDate || !analystId) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Missing Information',
                      message: 'Please fill in all required fields.'
                    })
                    return
                  }

                  const today = getLocalDateString()
                  if (endDate > today) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Invalid Date Range',
                      message: 'Historical periods cannot extend into the future. Use "Coverage Transition" to schedule future changes.'
                    })
                    return
                  }

                  if (startDate > endDate) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Invalid Date Range',
                      message: 'Start date must be before end date.'
                    })
                    return
                  }

                  const selectedUser = users?.find(u => u.id === analystId)
                  if (!selectedUser) return

                  const analystName = selectedUser.first_name && selectedUser.last_name
                    ? `${selectedUser.first_name} ${selectedUser.last_name}`
                    : selectedUser.email?.split('@')[0] || 'Unknown'

                  // Create new historical coverage
                  const newCoverageId = `temp-${Date.now()}`
                  const newCoverage = {
                    id: newCoverageId,
                    asset_id: assetId,
                    user_id: analystId,
                    analyst_name: analystName,
                    start_date: startDate,
                    end_date: endDate,
                    is_active: false,
                    changed_by: user?.id
                  }

                  setPendingNewCoverages(prev => [...prev, newCoverage])
                  setAddingHistoricalPeriod(null)
                }}
                disabled={!addingHistoricalPeriod.analystId || !addingHistoricalPeriod.startDate || !addingHistoricalPeriod.endDate}
              >
                Add Historical Coverage
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Change Current Coverage Modal */}
      {changingCurrentCoverage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setChangingCurrentCoverage(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Change Current Coverage</h3>
              <button
                onClick={() => setChangingCurrentCoverage(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              This will immediately replace <span className="font-medium">{changingCurrentCoverage.currentAnalystName}</span> with a new analyst for active coverage.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New Analyst
              </label>
              <select
                value={changingCurrentCoverage.newAnalystId}
                onChange={(e) => setChangingCurrentCoverage({
                  ...changingCurrentCoverage,
                  newAnalystId: e.target.value
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select analyst...</option>
                {users?.map((u) => {
                  const displayName = u.first_name && u.last_name
                    ? `${u.first_name} ${u.last_name}`
                    : u.email?.split('@')[0] || 'Unknown'
                  return (
                    <option key={u.id} value={u.id}>
                      {displayName}
                    </option>
                  )
                })}
              </select>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setChangingCurrentCoverage(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const selectedUser = users?.find(u => u.id === changingCurrentCoverage.newAnalystId)
                  if (!selectedUser) return

                  const newAnalystName = selectedUser.first_name && selectedUser.last_name
                    ? `${selectedUser.first_name} ${selectedUser.last_name}`
                    : selectedUser.email?.split('@')[0] || 'Unknown'

                  const today = getLocalDateString()

                  // Check if the current coverage started today
                  const currentCoverage = assetCoverageHistory?.find(c => c.id === changingCurrentCoverage.currentCoverageId)
                  const coverageStartedToday = currentCoverage?.start_date === today

                  if (coverageStartedToday) {
                    // Just update the analyst for the existing coverage
                    setPendingTimelineChanges(prev => ({
                      ...prev,
                      [changingCurrentCoverage.currentCoverageId]: {
                        ...prev[changingCurrentCoverage.currentCoverageId],
                        analyst: {
                          userId: changingCurrentCoverage.newAnalystId,
                          analystName: newAnalystName
                        }
                      }
                    }))
                  } else {
                    // End the current coverage and create a new one
                    setPendingTimelineChanges(prev => ({
                      ...prev,
                      [changingCurrentCoverage.currentCoverageId]: {
                        ...prev[changingCurrentCoverage.currentCoverageId],
                        endDate: today,
                        isActive: false
                      }
                    }))

                    // Stage creating new coverage starting today
                    const newCoverageId = `temp-${Date.now()}`
                    const newCoverage = {
                      id: newCoverageId,
                      asset_id: changingCurrentCoverage.assetId,
                      user_id: changingCurrentCoverage.newAnalystId,
                      analyst_name: newAnalystName,
                      start_date: today,
                      end_date: null,
                      is_active: true,
                      changed_by: user?.id,
                      fromCoverageId: changingCurrentCoverage.currentCoverageId
                    }

                    setPendingNewCoverages(prev => [...prev, newCoverage])
                  }

                  setChangingCurrentCoverage(null)
                }}
                disabled={!changingCurrentCoverage.newAnalystId}
              >
                Change Coverage
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Coverage Modal */}
      {addingCoverage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setAddingCoverage(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Add Coverage</h3>
              <button
                onClick={() => setAddingCoverage(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Add a new coverage record for an asset with a specific analyst and date range.
            </p>

            <div className="space-y-4">
              <div className="relative asset-search-container">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Asset *
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={assetSearchQuery}
                    onChange={(e) => {
                      setAssetSearchQuery(e.target.value)
                      setShowAssetDropdown(true)
                    }}
                    onFocus={() => setShowAssetDropdown(true)}
                    placeholder="Search for an asset..."
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                {showAssetDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto asset-dropdown">
                    {assets
                      ?.filter((asset) => {
                        const query = assetSearchQuery.toLowerCase()
                        return (
                          asset.symbol.toLowerCase().includes(query) ||
                          asset.company_name.toLowerCase().includes(query)
                        )
                      })
                      .map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => {
                            setAddingCoverage({
                              ...addingCoverage,
                              assetId: asset.id
                            })
                            setAssetSearchQuery(`${asset.symbol} - ${asset.company_name}`)
                            setShowAssetDropdown(false)
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                        >
                          <div className="font-medium text-gray-900">{asset.symbol}</div>
                          <div className="text-sm text-gray-600">{asset.company_name}</div>
                        </button>
                      ))}
                    {assets?.filter((asset) => {
                      const query = assetSearchQuery.toLowerCase()
                      return (
                        asset.symbol.toLowerCase().includes(query) ||
                        asset.company_name.toLowerCase().includes(query)
                      )
                    }).length === 0 && (
                      <div className="px-4 py-2 text-sm text-gray-500">No assets found</div>
                    )}
                  </div>
                )}
              </div>

              <div className="relative analyst-search-container">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Analyst *
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={analystSearchQuery}
                    onChange={(e) => {
                      setAnalystSearchQuery(e.target.value)
                      setShowAnalystDropdown(true)
                    }}
                    onFocus={() => setShowAnalystDropdown(true)}
                    placeholder="Search for an analyst..."
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                {showAnalystDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto analyst-dropdown">
                    {users
                      ?.filter((user) => {
                        const query = analystSearchQuery.toLowerCase()
                        const displayName = user.first_name && user.last_name
                          ? `${user.first_name} ${user.last_name}`
                          : user.email?.split('@')[0] || 'Unknown'
                        const email = user.email || ''
                        return (
                          displayName.toLowerCase().includes(query) ||
                          email.toLowerCase().includes(query)
                        )
                      })
                      .map((user) => {
                        const displayName = user.first_name && user.last_name
                          ? `${user.first_name} ${user.last_name}`
                          : user.email?.split('@')[0] || 'Unknown'
                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => {
                              setAddingCoverage({
                                ...addingCoverage,
                                analystId: user.id
                              })
                              setAnalystSearchQuery(displayName)
                              setShowAnalystDropdown(false)
                            }}
                            className="w-full px-4 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                          >
                            <div className="font-medium text-gray-900">{displayName}</div>
                            {user.email && (
                              <div className="text-sm text-gray-600">{user.email}</div>
                            )}
                          </button>
                        )
                      })}
                    {users?.filter((user) => {
                      const query = analystSearchQuery.toLowerCase()
                      const displayName = user.first_name && user.last_name
                        ? `${user.first_name} ${user.last_name}`
                        : user.email?.split('@')[0] || 'Unknown'
                      const email = user.email || ''
                      return (
                        displayName.toLowerCase().includes(query) ||
                        email.toLowerCase().includes(query)
                      )
                    }).length === 0 && (
                      <div className="px-4 py-2 text-sm text-gray-500">No analysts found</div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start Date *
                </label>
                <input
                  type="date"
                  value={addingCoverage.startDate}
                  onChange={(e) => setAddingCoverage({
                    ...addingCoverage,
                    startDate: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  End Date (Optional)
                </label>
                <input
                  type="date"
                  value={addingCoverage.endDate}
                  min={addingCoverage.startDate}
                  onChange={(e) => setAddingCoverage({
                    ...addingCoverage,
                    endDate: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Leave empty for ongoing coverage
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setAddingCoverage(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  if (!addingCoverage.assetId || !addingCoverage.analystId || !addingCoverage.startDate) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Missing Required Fields',
                      message: 'Please select an asset, analyst, and start date.'
                    })
                    return
                  }

                  try {
                    // Get analyst name
                    const selectedUser = users?.find(u => u.id === addingCoverage.analystId)
                    const analystName = selectedUser
                      ? (selectedUser.first_name && selectedUser.last_name
                        ? `${selectedUser.first_name} ${selectedUser.last_name}`
                        : selectedUser.email?.split('@')[0] || 'Unknown')
                      : 'Unknown'

                    // Insert the coverage record
                    const { error } = await supabase
                      .from('coverage')
                      .insert({
                        asset_id: addingCoverage.assetId,
                        user_id: addingCoverage.analystId,
                        analyst_name: analystName,
                        start_date: addingCoverage.startDate,
                        end_date: addingCoverage.endDate || null,
                        is_active: !addingCoverage.endDate || addingCoverage.endDate >= getLocalDateString(),
                        changed_by: user?.id
                      })

                    if (error) throw error

                    // Refresh the coverage data
                    queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
                    queryClient.invalidateQueries({ queryKey: ['coverage'] })
                    queryClient.invalidateQueries({ queryKey: ['asset-coverage-history'] })

                    setAddingCoverage(null)
                  } catch (error: any) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Error Adding Coverage',
                      message: error.message || 'Failed to add coverage record. Please try again.'
                    })
                  }
                }}
                disabled={!addingCoverage.assetId || !addingCoverage.analystId || !addingCoverage.startDate}
              >
                Add Coverage
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* End Coverage Modal */}
      {endingCoverage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setEndingCoverage(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">End Coverage</h3>
              <button
                onClick={() => setEndingCoverage(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              End coverage for <span className="font-medium">{endingCoverage.assetSymbol}</span> by <span className="font-medium">{endingCoverage.analystName}</span> on the selected date.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  End Date
                </label>
                <input
                  type="date"
                  value={endingCoverage.endDate}
                  min={getLocalDateString()}
                  onChange={(e) => setEndingCoverage({
                    ...endingCoverage,
                    endDate: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Coverage will end on this date
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setEndingCoverage(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="bg-red-600 hover:bg-red-700"
                onClick={() => {
                  // Find all future coverage periods for this asset
                  const futureCoverages = assetCoverageHistory.filter(c =>
                    c.start_date > endingCoverage.endDate
                  )

                  // Calculate the day before the end date
                  const endDateObj = new Date(endingCoverage.endDate)
                  const dayBefore = new Date(endDateObj)
                  dayBefore.setDate(dayBefore.getDate() - 1)
                  const dayBeforeStr = getLocalDateString(dayBefore)

                  // Handle the current coverage end date and future coverages
                  setPendingTimelineChanges(prev => {
                    const newChanges = {
                      ...prev,
                      [endingCoverage.coverageId]: {
                        ...prev[endingCoverage.coverageId],
                        endDate: endingCoverage.endDate
                      }
                    }

                    // Handle each future coverage based on the end date
                    futureCoverages.forEach(futureCov => {
                      // If the future coverage starts on or before the day before end date,
                      // set its end date to the day before
                      if (futureCov.start_date <= dayBeforeStr) {
                        newChanges[futureCov.id] = {
                          ...newChanges[futureCov.id],
                          endDate: dayBeforeStr
                        }
                      }
                    })

                    return newChanges
                  })

                  // Delete future coverages that start after the end date
                  const coveragesToDelete = futureCoverages
                    .filter(futureCov => futureCov.start_date > dayBeforeStr)
                    .map(c => c.id)

                  if (coveragesToDelete.length > 0) {
                    setPendingTimelineDeletes(prevDeletes => {
                      const newDeletes = new Set(prevDeletes)
                      coveragesToDelete.forEach(id => newDeletes.add(id))
                      return newDeletes
                    })
                  }

                  setEndingCoverage(null)
                }}
                disabled={!endingCoverage.endDate}
              >
                End Coverage
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Error Modal */}
      {errorModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setErrorModal({ isOpen: false, title: '', message: '' })} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{errorModal.title}</h3>
            <p className="text-gray-600 mb-4">{errorModal.message}</p>
            <Button onClick={() => setErrorModal({ isOpen: false, title: '', message: '' })}>OK</Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, coverageId: null, assetSymbol: '', analystName: '' })}
        onConfirm={confirmDeleteCoverage}
        title="Remove Coverage Assignment"
        message={`Are you sure you want to remove ${deleteConfirm.analystName}'s coverage of ${deleteConfirm.assetSymbol}?`}
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
        isLoading={deleteCoverageMutation.isPending}
      />

      {/* Rescind Request Confirmation */}
      <ConfirmDialog
        isOpen={!!rescindingRequest}
        onClose={() => setRescindingRequest(null)}
        onConfirm={() => {
          if (rescindingRequest) {
            rescindCoverageRequestMutation.mutate(rescindingRequest.requestId)
            setRescindingRequest(null)
          }
        }}
        title="Cancel Coverage Request"
        message={`Are you sure you want to cancel your coverage change request for ${rescindingRequest?.assetSymbol}?`}
        confirmText="Yes, Cancel Request"
        cancelText="No, Keep Request"
        variant="warning"
        isLoading={rescindCoverageRequestMutation.isPending}
      />

      {/* Request Coverage Change Modal */}
      {requestingChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setRequestingChange(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Request Coverage Change</h3>
              <button
                onClick={() => setRequestingChange(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Request a coverage change for <span className="font-medium">{requestingChange.assetSymbol}</span>
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Current Analyst
                </label>
                <input
                  type="text"
                  value={requestingChange.currentAnalystName || 'None'}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Requested Analyst
                </label>
                <select
                  value={requestingChange.requestedUserId}
                  onChange={(e) => setRequestingChange({
                    ...requestingChange,
                    requestedUserId: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select analyst...</option>
                  {users?.map((u) => {
                    const displayName = u.first_name && u.last_name
                      ? `${u.first_name} ${u.last_name}`
                      : u.email?.split('@')[0] || 'Unknown'
                    return (
                      <option key={u.id} value={u.id}>
                        {displayName}
                      </option>
                    )
                  })}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reason for Change
                </label>
                <textarea
                  value={requestingChange.reason}
                  onChange={(e) => setRequestingChange({
                    ...requestingChange,
                    reason: e.target.value
                  })}
                  placeholder="Explain why this change is needed..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setRequestingChange(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!requestingChange.requestedUserId || !requestingChange.reason) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Missing Information',
                      message: 'Please select an analyst and provide a reason for the change.'
                    })
                    return
                  }

                  const selectedUser = users?.find(u => u.id === requestingChange.requestedUserId)
                  if (!selectedUser) return

                  const requestedAnalystName = selectedUser.first_name && selectedUser.last_name
                    ? `${selectedUser.first_name} ${selectedUser.last_name}`
                    : selectedUser.email?.split('@')[0] || 'Unknown'

                  createCoverageRequestMutation.mutate({
                    asset_id: requestingChange.assetId,
                    current_user_id: requestingChange.currentUserId,
                    current_analyst_name: requestingChange.currentAnalystName,
                    requested_user_id: requestingChange.requestedUserId,
                    requested_analyst_name: requestedAnalystName,
                    request_type: requestingChange.requestType,
                    reason: requestingChange.reason
                  })

                  setRequestingChange(null)
                }}
                disabled={!requestingChange.requestedUserId || !requestingChange.reason}
              >
                Submit Request
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* History Event Detail Modal */}
      {selectedHistoryEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setSelectedHistoryEvent(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Coverage Change Details</h3>
              <button
                onClick={() => setSelectedHistoryEvent(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Event Type */}
              <div>
                <label className="text-sm font-medium text-gray-500">Event Type</label>
                <p className="text-base text-gray-900 mt-1 capitalize">{selectedHistoryEvent.change_type.replace('_', ' ')}</p>
              </div>

              {/* Asset */}
              <div>
                <label className="text-sm font-medium text-gray-500">Asset</label>
                <p className="text-base text-gray-900 mt-1">
                  {selectedHistoryEvent.assets?.symbol} - {selectedHistoryEvent.assets?.company_name}
                </p>
              </div>

              {/* Changed At */}
              <div>
                <label className="text-sm font-medium text-gray-500">Changed At</label>
                <p className="text-base text-gray-900 mt-1">
                  {new Date(selectedHistoryEvent.changed_at).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })}
                </p>
              </div>

              {/* Changed By */}
              {selectedHistoryEvent.changed_by && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Changed By</label>
                  <p className="text-base text-gray-900 mt-1">
                    {users?.find(u => u.id === selectedHistoryEvent.changed_by)?.first_name} {users?.find(u => u.id === selectedHistoryEvent.changed_by)?.last_name || 'Unknown User'}
                  </p>
                </div>
              )}

              {/* Old Values */}
              {(selectedHistoryEvent.old_analyst_name || selectedHistoryEvent.old_start_date || selectedHistoryEvent.old_end_date !== undefined) && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Previous State</h4>
                  <div className="space-y-2 bg-red-50 p-3 rounded">
                    {selectedHistoryEvent.old_analyst_name && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Analyst</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.old_analyst_name}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.old_start_date && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Start Date</label>
                        <p className="text-sm text-gray-900">{new Date(selectedHistoryEvent.old_start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.old_end_date !== undefined && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">End Date</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.old_end_date ? new Date(selectedHistoryEvent.old_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'None (Open-ended)'}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.old_is_active !== undefined && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Status</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.old_is_active ? 'Active' : 'Inactive'}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* New Values */}
              {(selectedHistoryEvent.new_analyst_name || selectedHistoryEvent.new_start_date || selectedHistoryEvent.new_end_date !== undefined) && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">New State</h4>
                  <div className="space-y-2 bg-green-50 p-3 rounded">
                    {selectedHistoryEvent.new_analyst_name && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Analyst</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.new_analyst_name}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.new_start_date && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Start Date</label>
                        <p className="text-sm text-gray-900">{new Date(selectedHistoryEvent.new_start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.new_end_date !== undefined && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">End Date</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.new_end_date ? new Date(selectedHistoryEvent.new_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'None (Open-ended)'}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.new_is_active !== undefined && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Status</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.new_is_active ? 'Active' : 'Inactive'}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end mt-6">
              <Button
                variant="outline"
                onClick={() => setSelectedHistoryEvent(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}