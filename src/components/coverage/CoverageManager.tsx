import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, X, Search, Trash2, ChevronDown, Upload, Download, FileText, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { formatDistanceToNow } from 'date-fns'

interface CoverageManagerProps {
  isOpen: boolean
  onClose: () => void
}

interface CoverageRecord {
  id: string
  asset_id: string
  user_id: string
  analyst_name: string
  created_at: string
  updated_at: string
  assets: {
    id: string
    symbol: string
    company_name: string
    sector?: string
  } | null
}

export function CoverageManager({ isOpen, onClose }: CoverageManagerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
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

  // Fetch all users
  const { data: users } = useQuery({
    queryKey: ['all-users-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name', { ascending: true })
      
      if (error) throw error
      return data || []
    },
    enabled: isOpen,
  })

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

  const filteredCoverage = coverageRecords?.filter(coverage => 
    !searchQuery || 
    coverage.assets?.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    coverage.assets?.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    coverage.analyst_name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || []

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
        <div className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full mx-auto transform transition-all max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Coverage Management</h3>
              <p className="text-sm text-gray-600 mt-1">Manage analyst coverage assignments</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-120px)]">
            {/* Bulk Upload Coverage */}
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

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by asset symbol, company name, or analyst..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {/* Coverage List */}
            <Card padding="none">
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
              ) : filteredCoverage.length > 0 ? (
                <div className="divide-y divide-gray-200">
                  {/* Table Header */}
                  <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                    <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <div className="col-span-4">Asset</div>
                      <div className="col-span-3">Analyst</div>
                      <div className="col-span-2">Sector</div>
                      <div className="col-span-2">Last Updated</div>
                      <div className="col-span-1">Actions</div>
                    </div>
                  </div>

                  {/* Coverage Rows */}
                  {filteredCoverage.map((coverage) => (
                    <div key={coverage.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                      <div className="grid grid-cols-12 gap-4 items-center">
                        {/* Asset Info */}
                        <div className="col-span-4">
                          <div className="flex items-center space-x-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-900 truncate">
                                {coverage.assets?.symbol || 'Unknown Symbol'}
                              </p>
                              <p className="text-sm text-gray-600 truncate">
                                {coverage.assets?.company_name || 'Unknown Company'}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Analyst - Editable Dropdown */}
                        <div className="col-span-3" ref={dropdownRef}>
                          <div className="relative">
                            <button
                              onClick={() => handleEditCoverage(coverage.id)}
                              className="flex items-center justify-between w-full text-left px-3 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors group"
                            >
                              <span className="truncate">{coverage.analyst_name}</span>
                              <ChevronDown className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2" />
                            </button>
                            
                            {showUserDropdown === coverage.id && (
                              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto min-w-[200px] py-1">
                                <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
                                  Select analyst for {coverage.assets?.symbol}
                                </div>
                                {users && users.length > 0 ? (
                                  users.map((userOption) => {
                                    const handleUserClick = () => {
                                      console.log('🖱️ DIRECT USER CLICK:', { 
                                        coverageId: coverage.id, 
                                        userId: userOption.id, 
                                        userName: getUserDisplayName(userOption),
                                        userEmail: userOption.email
                                      })
                                      
                                      const analystName = userOption.first_name && userOption.last_name 
                                        ? `${userOption.first_name} ${userOption.last_name}`
                                        : userOption.email?.split('@')[0] || 'Unknown'
                                      
                                      console.log('📝 Calling mutation with:', { 
                                        coverageId: coverage.id, 
                                        userId: userOption.id, 
                                        analystName 
                                      })
                                      
                                      updateCoverageMutation.mutate({ 
                                        coverageId: coverage.id, 
                                        userId: userOption.id, 
                                        analystName 
                                      })
                                    }
                                    
                                    return (
                                      <div
                                        key={userOption.id}
                                        onMouseDown={handleUserClick}
                                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors flex items-center justify-between cursor-pointer"
                                      >
                                        <div className="flex-1 min-w-0">
                                          <p className="font-medium text-gray-900 truncate">{getUserDisplayName(userOption)}</p>
                                          <p className="text-xs text-gray-500 truncate">{userOption.email}</p>
                                        </div>
                                        {coverage.analyst_name === getUserDisplayName(userOption) && (
                                          <div className="w-2 h-2 bg-primary-500 rounded-full flex-shrink-0"></div>
                                        )}
                                      </div>
                                    )
                                  })
                                ) : (
                                  <div className="px-3 py-2 text-sm text-gray-500">
                                    No users available
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {updateCoverageMutation.isPending && editingCoverageId === coverage.id && (
                              <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-500" />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Sector */}
                        <div className="col-span-2">
                          <span className="text-sm text-gray-600">
                            {coverage.assets?.sector || '—'}
                          </span>
                        </div>

                        {/* Last Updated */}
                        <div className="col-span-2">
                          <span className="text-sm text-gray-500">
                            {formatDistanceToNow(new Date(coverage.updated_at), { addSuffix: true })}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="col-span-1">
                          <button
                            onClick={() => handleDeleteCoverage(
                              coverage.id, 
                              coverage.assets?.symbol || 'Unknown', 
                              coverage.analyst_name
                            )}
                            className="p-1 text-gray-400 hover:text-error-600 transition-colors"
                            disabled={deleteCoverageMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
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
          </div>

          {/* Footer */}
          <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>

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
    </div>
  )
}