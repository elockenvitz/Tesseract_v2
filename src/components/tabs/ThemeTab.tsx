import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { BarChart3, Target, FileText, TrendingUp, Plus, Calendar, User, ArrowLeft, Share2, Users, UserPlus, UserMinus, X, Search, Trash2, FolderKanban, ChevronDown, Check, Tag } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EditableSection, type EditableSectionRef } from '../ui/EditableSection'
import { ThemeNoteEditor } from '../notes/ThemeNoteEditorUnified'
import { RelatedProjects } from '../projects/RelatedProjects'
import { AddAssetToThemeModal } from '../themes/AddAssetToThemeModal'
import { AssetTableView } from '../table/AssetTableView'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { formatDistanceToNow } from 'date-fns'
import { TabStateManager } from '../../lib/tabStateManager'
import { getContentPreview } from '../../utils/stripHtml'

interface ThemeTabProps {
  theme: any
  isFocusMode?: boolean
  onCite?: (content: string, fieldName?: string) => void
}

export function ThemeTab({ theme, isFocusMode = false, onCite }: ThemeTabProps) {
  const { user } = useAuth()
  const [themeType, setThemeType] = useState(theme.theme_type || 'general')

  // Initialize state from saved tab state
  const [activeTab, setActiveTab] = useState<'thesis' | 'outcomes' | 'chart' | 'related-assets' | 'notes' | 'projects'>(() => {
    const savedState = TabStateManager.loadTabState(theme.id)
    return savedState?.activeTab || 'thesis'
  })

  const [currentlyEditing, setCurrentlyEditing] = useState<string | null>(null)

  const [showNoteEditor, setShowNoteEditor] = useState(() => {
    const savedState = TabStateManager.loadTabState(theme.id)
    return savedState?.showNoteEditor || false
  })

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(() => {
    const savedState = TabStateManager.loadTabState(theme.id)
    return savedState?.selectedNoteId || null
  })

  const [isTabStateInitialized, setIsTabStateInitialized] = useState(false)

  // Mark tab state as initialized after first render
  useEffect(() => {
    setIsTabStateInitialized(true)
  }, [])

  // Handle noteId from navigation (e.g., from dashboard note click)
  useEffect(() => {
    if (theme.noteId && theme.id) {
      console.log('📝 ThemeTab: Opening note from navigation:', theme.noteId)
      setActiveTab('notes')
      setShowNoteEditor(true)
      setSelectedNoteId(theme.noteId)
    }
  }, [theme.id, theme.noteId])

  // Debug logging
  useEffect(() => {
    console.log('🔔 ThemeTab state changed:', { showNoteEditor, selectedNoteId })
  }, [showNoteEditor, selectedNoteId])

  // Save tab state when it changes
  useEffect(() => {
    if (isTabStateInitialized && theme.id) {
      TabStateManager.saveTabState(theme.id, {
        activeTab,
        showNoteEditor,
        selectedNoteId
      })
    }
  }, [theme.id, activeTab, showNoteEditor, selectedNoteId, isTabStateInitialized])
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const [showAddAssetModal, setShowAddAssetModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [invitePermission, setInvitePermission] = useState<'read' | 'write'>('read')
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean
    collaborationId: string | null
    userEmail: string
  }>({
    isOpen: false,
    collaborationId: null,
    userEmail: ''
  })
  const [showBulkRemoveConfirm, setShowBulkRemoveConfirm] = useState<{ isOpen: boolean; assetIds: string[] }>({ isOpen: false, assetIds: [] })
  const [showThemeTypeDropdown, setShowThemeTypeDropdown] = useState(false)
  const themeTypeDropdownRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  // Handle component citation in focus mode
  const handleComponentClick = useCallback((content: string, fieldName: string) => {
    if (isFocusMode && onCite) {
      onCite(content, fieldName)
    }
  }, [isFocusMode, onCite])

  // Refs for each editable section
  const thesisRef = useRef<EditableSectionRef>(null)
  const whereDifferentRef = useRef<EditableSectionRef>(null)
  const risksRef = useRef<EditableSectionRef>(null)

  // Update local state when switching theme
  useEffect(() => {
    if (theme.id) {
      setThemeType(theme.theme_type || 'general')
      setHasLocalChanges(false)
    }
  }, [theme.id, theme.theme_type])


  // ---------- Queries ----------
  const { data: notes } = useQuery({
    queryKey: ['theme-notes', theme.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('theme_notes')
        .select('*')
        .eq('theme_id', theme.id)
        .neq('is_deleted', true)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: relatedAssets } = useQuery({
    queryKey: ['theme-related-assets', theme.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('theme_assets')
        .select(`
          *,
          assets(*)
        `)
        .eq('theme_id', theme.id)
        .order('added_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // Transform related assets for AssetTableView
  const themeAssets = useMemo(() => {
    if (!relatedAssets) return []
    return relatedAssets.map((ta: any) => ta.assets).filter(Boolean)
  }, [relatedAssets])

  // Map asset ID to theme_asset ID for removal
  const assetToThemeAssetMap = useMemo(() => {
    const map = new Map<string, string>()
    relatedAssets?.forEach((ta: any) => {
      if (ta.assets?.id) {
        map.set(ta.assets.id, ta.id)
      }
    })
    return map
  }, [relatedAssets])

  // Bulk remove assets from theme mutation
  const bulkRemoveFromThemeMutation = useMutation({
    mutationFn: async (assetIds: string[]) => {
      const themeAssetIds = assetIds
        .map(assetId => assetToThemeAssetMap.get(assetId))
        .filter(Boolean) as string[]
      if (themeAssetIds.length === 0) throw new Error('No items to remove')
      const { error } = await supabase
        .from('theme_assets')
        .delete()
        .in('id', themeAssetIds)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-related-assets', theme.id] })
      setShowBulkRemoveConfirm({ isOpen: false, assetIds: [] })
    }
  })

  const handleBulkRemoveFromTheme = useCallback((assetIds: string[]) => {
    setShowBulkRemoveConfirm({ isOpen: true, assetIds })
  }, [])

  // Fetch owner details
  const { data: ownerDetails } = useQuery({
    queryKey: ['theme-owner', theme.created_by],
    queryFn: async () => {
      if (!theme.created_by) return null

      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .eq('id', theme.created_by)
        .single()

      if (error) throw error
      return data
    },
    enabled: showShareModal && !!theme.created_by
  })

  // Fetch existing collaborations
  const { data: collaborations, isLoading: collaborationsLoading } = useQuery({
    queryKey: ['theme-collaborations', theme.id],
    queryFn: async () => {
      // First get collaborations
      const { data: collaborationsData, error: collaborationsError } = await supabase
        .from('theme_collaborations')
        .select('*')
        .eq('theme_id', theme.id)
        .order('created_at', { ascending: false })

      if (collaborationsError) throw collaborationsError
      if (!collaborationsData || collaborationsData.length === 0) return []

      // Get unique user IDs
      const userIds = [...new Set(collaborationsData.map((c: any) => c.user_id))]

      // Fetch user details separately
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)

      if (usersError) throw usersError

      // Combine the data
      const usersMap = new Map(usersData?.map(u => [u.id, u]) || [])

      return collaborationsData.map((collaboration: any) => ({
        ...collaboration,
        user: usersMap.get(collaboration.user_id)
      }))
    },
    enabled: showShareModal
  })

  // Search for users to invite
  const { data: searchResults } = useQuery({
    queryKey: ['user-search', searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim() || searchQuery.length < 2) return []

      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .or(`email.ilike.%${searchQuery.toLowerCase()}%,first_name.ilike.%${searchQuery.toLowerCase()}%,last_name.ilike.%${searchQuery.toLowerCase()}%`)
        .neq('id', user?.id) // Exclude current user
        .limit(10)

      if (error) throw error

      // Filter out users who are already collaborators or the owner
      const existingUserIds = new Set(collaborations?.map((c: any) => c.user_id) || [])
      existingUserIds.add(theme.created_by) // Exclude the owner

      const filteredResults = data?.filter(u => !existingUserIds.has(u.id)) || []

      return filteredResults
    },
    enabled: showShareModal && searchQuery.length >= 2
  })

  // ---------- Mutation (safer: maybeSingle + diagnostics) ----------
  const updateThemeMutation = useMutation({
    mutationFn: async (updates: any) => {
      if (!theme?.id) throw new Error('Missing theme.id')

      const { error } = await supabase
        .from('themes')
        .update(updates)
        .eq('id', theme.id)

      if (error) {
        throw error
      }

      return { ...theme, ...updates }
    },
    onSuccess: (result) => {
      // Update the theme object directly
      Object.assign(theme, result)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-themes'] })
    },
    onError: (error) => {
      console.error('Theme update failed:', error)
    }
  })

  // ---------- Collaboration Mutations ----------
  const inviteUserMutation = useMutation({
    mutationFn: async ({ userId, permission }: { userId: string; permission: 'read' | 'write' }) => {
      const { error } = await supabase
        .from('theme_collaborations')
        .insert({
          theme_id: theme.id,
          user_id: userId,
          permission,
          invited_by: user?.id
        })

      if (error) throw error

      // Create notification for the invited user
      await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          type: 'theme_shared',
          title: 'Theme Shared With You',
          message: `${user?.first_name || user?.email?.split('@')[0] || 'Someone'} shared the theme "${theme.name}" with you`,
          context_type: 'theme',
          context_id: theme.id,
          context_data: {
            theme_name: theme.name,
            theme_id: theme.id,
            shared_by: user?.id,
            permission
          }
        })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-collaborations', theme.id] })
      setSearchQuery('')
    }
  })

  const updatePermissionMutation = useMutation({
    mutationFn: async ({ collaborationId, permission }: { collaborationId: string; permission: 'read' | 'write' }) => {
      const { error } = await supabase
        .from('theme_collaborations')
        .update({ permission })
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-collaborations', theme.id] })
    }
  })

  const removeCollaborationMutation = useMutation({
    mutationFn: async (collaborationId: string) => {
      const { error } = await supabase
        .from('theme_collaborations')
        .delete()
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-collaborations', theme.id] })
      setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })
    }
  })

  // ---------- Helpers ----------
  const handleInviteUser = (userId: string) => {
    inviteUserMutation.mutate({ userId, permission: invitePermission })
  }

  const handleUpdatePermission = (collaborationId: string, permission: 'read' | 'write') => {
    updatePermissionMutation.mutate({ collaborationId, permission })
  }

  const handleRemoveCollaboration = (collaborationId: string, userEmail: string) => {
    setDeleteConfirm({
      isOpen: true,
      collaborationId,
      userEmail
    })
  }

  const confirmRemoveCollaboration = () => {
    if (deleteConfirm.collaborationId) {
      removeCollaborationMutation.mutate(deleteConfirm.collaborationId)
    }
  }

  const getUserDisplayName = (user: any) => {
    if (!user) return 'Unknown User'

    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }

    return user.email?.split('@')[0] || 'Unknown User'
  }

  const getPermissionColor = (permission: string) => {
    switch (permission) {
      case 'write': return 'warning'
      case 'read': return 'success'
      default: return 'default'
    }
  }

  const handleThemeTypeChange = async (newType: string) => {
    if (newType === themeType) return
    const prev = themeType
    setThemeType(newType)
    setHasLocalChanges(true)

    try {
      await updateThemeMutation.mutateAsync({ theme_type: newType })
    } catch {
      // revert UI if DB rejected
      setThemeType(prev)
      setHasLocalChanges(false)
    }
  }

  const handleSectionSave = async (field: string, content: string) => {
    try {
      await updateThemeMutation.mutateAsync({ [field]: content })
      // rely on cache updates; do not mutate props directly
    } catch (error) {
      console.error('Failed to save section:', error)
      throw error
    }
  }

  const handleEditStart = (sectionName: string) => {
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
      case 'description': return thesisRef
      case 'where_different': return whereDifferentRef
      case 'risks_to_thesis': return risksRef
      default: return null
    }
  }

  const handleNoteClick = useCallback((noteId: string) => {
    setSelectedNoteId(noteId)
    setShowNoteEditor(true)
  }, [])

  const handleNoteSelect = (noteId: string) => {
    setSelectedNoteId(noteId)
    // Ensure editor stays visible when selecting notes within the editor
    if (!showNoteEditor) {
      setShowNoteEditor(true)
    }
  }

  const handleCreateNote = () => {
    console.log('📝 handleCreateNote called')
    setSelectedNoteId(null)
    setShowNoteEditor(true)
    console.log('📝 State updated - selectedNoteId: null, showNoteEditor: true')
  }

  const handleCloseNoteEditor = () => {
    setShowNoteEditor(false)
    setSelectedNoteId(null)
    queryClient.invalidateQueries({ queryKey: ['theme-notes', theme.id] })
  }

  const themeTypeOptions = [
    { value: 'general', label: 'General', color: 'bg-gray-100 text-gray-700', dotColor: 'bg-gray-400' },
    { value: 'sector', label: 'Sector', color: 'bg-blue-100 text-blue-700', dotColor: 'bg-blue-500' },
    { value: 'geography', label: 'Geography', color: 'bg-green-100 text-green-700', dotColor: 'bg-green-500' },
    { value: 'strategy', label: 'Strategy', color: 'bg-amber-100 text-amber-700', dotColor: 'bg-amber-500' },
    { value: 'macro', label: 'Macro', color: 'bg-red-100 text-red-700', dotColor: 'bg-red-500' },
  ]

  const currentThemeType = themeTypeOptions.find(opt => opt.value === themeType) || themeTypeOptions[0]

  // Close theme type dropdown on click outside
  useEffect(() => {
    if (!showThemeTypeDropdown) return
    const handleClick = (e: MouseEvent) => {
      if (themeTypeDropdownRef.current && !themeTypeDropdownRef.current.contains(e.target as Node)) {
        setShowThemeTypeDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showThemeTypeDropdown])

  return (
    <div className="space-y-6">
      {/* Theme Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-8 flex-1">
          {/* Left side: Theme name and description */}
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <div
                className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                style={{ backgroundColor: theme.color || '#3b82f6' }}
              />
              <h1 className="text-2xl font-bold text-gray-900">{theme.name}</h1>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowShareModal(true)}
              >
                <Share2 className="h-4 w-4 mr-1" />
                Share
              </Button>
            </div>
            {theme.description && (
              <p className="text-lg text-gray-600 mb-1">{theme.description}</p>
            )}
          </div>
        </div>

        {/* Right side: Theme Category + Add Assets button */}
        <div className="flex items-center gap-3">
          {/* Professional Theme Type Selector */}
          <div className="relative" ref={themeTypeDropdownRef}>
            <button
              onClick={() => setShowThemeTypeDropdown(!showThemeTypeDropdown)}
              className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-all shadow-sm"
            >
              <div className={clsx('w-2 h-2 rounded-full', currentThemeType.dotColor)} />
              <span className="text-sm font-medium text-gray-700">{currentThemeType.label}</span>
              <ChevronDown className={clsx('w-4 h-4 text-gray-400 transition-transform', showThemeTypeDropdown && 'rotate-180')} />
            </button>

            {showThemeTypeDropdown && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                {themeTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      handleThemeTypeChange(option.value)
                      setShowThemeTypeDropdown(false)
                    }}
                    className={clsx(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                      option.value === themeType ? 'bg-gray-50' : 'hover:bg-gray-50'
                    )}
                  >
                    <div className={clsx('w-2.5 h-2.5 rounded-full', option.dotColor)} />
                    <span className={clsx('flex-1', option.value === themeType ? 'font-medium text-gray-900' : 'text-gray-600')}>
                      {option.label}
                    </span>
                    {option.value === themeType && <Check className="w-4 h-4 text-blue-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeTab === 'related-assets' && (
            <Button size="sm" onClick={() => setShowAddAssetModal(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Assets
            </Button>
          )}
        </div>
      </div>

      {/* Tabular System */}
      <Card padding="none">
        {/* Tab Navigation */}
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
                <span>Forecasts</span>
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
              onClick={() => setActiveTab('related-assets')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'related-assets'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-4 w-4" />
                <span>Related Assets</span>
                {relatedAssets && relatedAssets.length > 0 && (
                  <Badge variant="default" size="sm">
                    {relatedAssets.length}
                  </Badge>
                )}
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
              onClick={() => setActiveTab('projects')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'projects'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <FolderKanban className="h-4 w-4" />
                <span>Projects</span>
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
                onClick={() => handleComponentClick(theme.description || '', 'Theme Description')}
              >
                <EditableSection
                  ref={thesisRef}
                  title="Theme Description"
                  content={theme.description || ''}
                  onSave={(content) => handleSectionSave('description', content)}
                  placeholder="Describe this investment theme..."
                  onEditStart={() => handleEditStart('description')}
                  onEditEnd={handleEditEnd}
                  className="mb-0"
                />
              </div>

              <div
                className={clsx(
                  "bg-blue-50 border border-blue-200 rounded-lg p-6",
                  isFocusMode && "citable-component"
                )}
                onClick={() => handleComponentClick(theme.where_different || '', 'Where We are Different')}
              >
                <EditableSection
                  ref={whereDifferentRef}
                  title="Where We are Different"
                  content={theme.where_different || ''}
                  onSave={(content) => handleSectionSave('where_different', content)}
                  placeholder="Explain how your view on this theme differs from consensus..."
                  onEditStart={() => handleEditStart('where_different')}
                  onEditEnd={handleEditEnd}
                  className="mb-0"
                />
              </div>

              <div
                className={clsx(
                  "bg-amber-50 border border-amber-200 rounded-lg p-6",
                  isFocusMode && "citable-component"
                )}
                onClick={() => handleComponentClick(theme.risks_to_thesis || '', 'Risks to Theme')}
              >
                <EditableSection
                  ref={risksRef}
                  title="Risks to Theme"
                  content={theme.risks_to_thesis || ''}
                  onSave={(content) => handleSectionSave('risks_to_thesis', content)}
                  placeholder="Identify key risks that could invalidate this theme..."
                  onEditStart={() => handleEditStart('risks_to_thesis')}
                  onEditEnd={handleEditEnd}
                  className="mb-0"
                />
              </div>
            </div>
          )}

          {activeTab === 'outcomes' && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-lg p-12 text-center">
                <Target className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Theme Outcomes Coming Soon</h3>
                <p className="text-gray-500">Track theme performance and key metrics here.</p>
              </div>
            </div>
          )}

          {activeTab === 'chart' && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-lg p-12 text-center">
                <BarChart3 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Chart Coming Soon</h3>
                <p className="text-gray-500">Interactive charts for theme analysis will be available here.</p>
              </div>
            </div>
          )}

          {activeTab === 'related-assets' && (
            <div className="space-y-4">
              {/* Asset Table View with all views */}
              <AssetTableView
                assets={themeAssets}
                isLoading={!relatedAssets}
                onAssetSelect={(asset) => {
                  // Handle asset click - could navigate to asset detail
                  console.log('Asset clicked:', asset.symbol)
                }}
                storageKey={`themeAssets_${theme.id}`}
                onBulkAction={handleBulkRemoveFromTheme}
                bulkActionLabel="Remove from Theme"
                bulkActionIcon={<Trash2 className="h-4 w-4 mr-1" />}
                emptyState={
                  <div className="text-center py-12">
                    <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900">No related assets</h3>
                    <p className="text-gray-500 mb-4">Assets related to this theme will appear here.</p>
                    <Button size="sm" onClick={() => setShowAddAssetModal(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Related Asset
                    </Button>
                  </div>
                }
              />
            </div>
          )}

          {activeTab === 'notes' && (
            showNoteEditor ? (
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCloseNoteEditor}
                    className="flex items-center"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Notes
                  </Button>
                </div>
                <ThemeNoteEditor
                  themeId={theme.id}
                  themeName={theme.name}
                  selectedNoteId={selectedNoteId ?? undefined}
                  onNoteSelect={handleNoteSelect}
                  onClose={handleCloseNoteEditor}
                />
              </div>
            ) : (
              <div className="space-y-6">
                {notes && notes.length > 0 && (
                  <div className="flex items-center justify-between">
                    <Button size="sm" onClick={handleCreateNote}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Note
                    </Button>
                  </div>
                )}

                {notes && notes.length > 0 ? (
                  <div className="space-y-4">
                    {notes.map((note) => (
                      <Card
                        key={note.id}
                        padding="sm"
                        className="cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => handleNoteClick(note.id)}
                      >
                        <div className="flex items-start justify-between">
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
                              {getContentPreview(note.content || '', 150)}
                            </p>
                            <div className="flex items-center space-x-4 text-xs text-gray-500">
                              <div className="flex items-center">
                                <Calendar className="h-3 w-3 mr-1" />
                                {formatDistanceToNow(new Date(note.updated_at || 0), { addSuffix: true })}
                              </div>
                              <div className="flex items-center">
                                <User className="h-3 w-3 mr-1" />
                                You
                              </div>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900">No related notes</h3>
                    <p className="text-gray-500 mb-4">Create notes to document your research and thoughts about this theme.</p>
                    <Button size="sm" onClick={() => {
                      console.log('🔥 Add First Note button clicked!')
                      handleCreateNote()
                    }}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add First Note
                    </Button>
                  </div>
                )}
              </div>
            )
          )}

          {activeTab === 'projects' && (
            <div className="space-y-6">
              <RelatedProjects
                contextType="theme"
                contextId={theme.id}
                contextTitle={theme.name}
                onProjectClick={(projectId) => {
                  // Navigate to project - you may need to implement this via onNavigate if available
                  console.log('Navigate to project:', projectId)
                }}
              />
            </div>
          )}
        </div>
      </Card>

      {/* Add Asset Modal */}
      <AddAssetToThemeModal
        isOpen={showAddAssetModal}
        onClose={() => setShowAddAssetModal(false)}
        themeId={theme.id}
        themeName={theme.name}
      />

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => setShowShareModal(false)}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-auto transform transition-all">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Manage Collaborators</h3>
                  <p className="text-sm text-gray-600 mt-1">Share "{theme.name}" with other users</p>
                </div>
                <button
                  onClick={() => setShowShareModal(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Public/Private Toggle */}
                <Card>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={theme.is_public || false}
                        onChange={(e) => {
                          updateThemeMutation.mutate({ is_public: e.target.checked })
                        }}
                        className="mr-2 rounded"
                      />
                      <span className="text-sm text-gray-700 font-medium">
                        Make public (visible to all users)
                      </span>
                    </label>
                    <p className="text-xs text-gray-500 mt-2">
                      {theme.is_public
                        ? 'This theme is visible to everyone.'
                        : 'This theme is private. Share with specific users below.'
                      }
                    </p>
                  </div>
                </Card>

                {/* Theme Owner */}
                {ownerDetails && (
                  <Card>
                    <h4 className="text-sm font-semibold text-gray-900 mb-4">Theme Owner</h4>
                    <div className="flex items-center space-x-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
                      <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                        <Users className="h-4 w-4 text-primary-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {getUserDisplayName(ownerDetails)}
                        </p>
                        <p className="text-xs text-gray-500">{ownerDetails.email}</p>
                      </div>
                      <Badge variant="primary" size="sm" className="ml-auto">Owner</Badge>
                    </div>
                  </Card>
                )}

                {/* Invite New User */}
                {!theme.is_public && (
                  <Card>
                    <h4 className="text-sm font-semibold text-gray-900 mb-4">Invite New Collaborator</h4>

                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search by email or name..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        />
                      </div>
                      {searchQuery.length >= 2 && (
                        <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                          {searchResults && searchResults.length > 0 ? (
                            searchResults.map((searchUser: any) => (
                              <div
                                key={searchUser.id}
                                className="flex items-center justify-between p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                              >
                                <div>
                                  <p className="text-sm font-medium text-gray-900">
                                    {searchUser.first_name && searchUser.last_name
                                      ? `${searchUser.first_name} ${searchUser.last_name}`
                                      : getUserDisplayName(searchUser)
                                    }
                                  </p>
                                  <p className="text-xs text-gray-500">{searchUser.email}</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <select
                                    value={invitePermission}
                                    onChange={(e) => setInvitePermission(e.target.value as 'read' | 'write')}
                                    className="text-xs px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-primary-500"
                                  >
                                    <option value="read">Read Only</option>
                                    <option value="write">Read & Write</option>
                                  </select>
                                  <Button
                                    size="sm"
                                    onClick={() => handleInviteUser(searchUser.id)}
                                    disabled={inviteUserMutation.isPending}
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Invite
                                  </Button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="flex items-center justify-center py-8 text-center text-gray-500 text-sm">
                              No users found matching "{searchQuery}"
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                )}

                {/* Current Collaborators */}
                {!theme.is_public && (
                  <Card>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-semibold text-gray-900">Current Collaborators</h4>
                      {collaborations && (
                        <Badge variant="default" size="sm">
                          {collaborations.filter((c: any) => c.user_id !== theme.created_by).length} collaborator
                          {collaborations.filter((c: any) => c.user_id !== theme.created_by).length !== 1 ? 's' : ''}
                        </Badge>
                      )}
                    </div>

                    {collaborationsLoading ? (
                      <div className="space-y-3">
                        {[...Array(2)].map((_, i) => (
                          <div key={i} className="animate-pulse flex items-center space-x-3">
                            <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
                            <div className="flex-1 space-y-2">
                              <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : collaborations && collaborations.filter((c: any) => c.user_id !== theme.created_by).length > 0 ? (
                      <div className="space-y-3">
                        {collaborations.filter((c: any) => c.user_id !== theme.created_by).map((collaboration: any) => (
                          <div
                            key={collaboration.id}
                            className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                                <Users className="h-4 w-4 text-primary-600" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {getUserDisplayName(collaboration.user)}
                                </p>
                                <p className="text-xs text-gray-500">{collaboration.user?.email}</p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-2">
                              <select
                                value={collaboration.permission}
                                onChange={(e) => handleUpdatePermission(collaboration.id, e.target.value as any)}
                                className="text-xs px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-primary-500"
                                disabled={updatePermissionMutation.isPending}
                              >
                                <option value="read">Read Only</option>
                                <option value="write">Read & Write</option>
                              </select>

                              <Badge variant={getPermissionColor(collaboration.permission)} size="sm">
                                {collaboration.permission}
                              </Badge>

                              <button
                                onClick={() => handleRemoveCollaboration(collaboration.id, collaboration.user?.email || 'Unknown')}
                                className="p-1 text-gray-400 hover:text-error-600 transition-colors"
                                disabled={removeCollaborationMutation.isPending}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <Users className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-sm">No collaborators yet</p>
                        <p className="text-xs">Search for users above to start collaborating</p>
                      </div>
                    )}
                  </Card>
                )}
              </div>

              {/* Footer */}
              <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
                <Button variant="outline" onClick={() => setShowShareModal(false)}>
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Remove Collaborator</h3>
              <p className="text-gray-600 mb-4">
                Are you sure you want to remove {deleteConfirm.userEmail} from this theme? They will no longer be able to access it.
              </p>
              <div className="flex space-x-3">
                <Button
                  variant="outline"
                  onClick={() => setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={confirmRemoveCollaboration}
                  className="flex-1"
                  loading={removeCollaborationMutation.isPending}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Remove from Theme Confirmation */}
      {showBulkRemoveConfirm.isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowBulkRemoveConfirm({ isOpen: false, assetIds: [] })} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Remove Assets from Theme</h3>
              <p className="text-gray-600 mb-4">
                Are you sure you want to remove {showBulkRemoveConfirm.assetIds.length} asset{showBulkRemoveConfirm.assetIds.length !== 1 ? 's' : ''} from this theme?
              </p>
              <div className="flex space-x-3">
                <Button
                  variant="outline"
                  onClick={() => setShowBulkRemoveConfirm({ isOpen: false, assetIds: [] })}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => bulkRemoveFromThemeMutation.mutate(showBulkRemoveConfirm.assetIds)}
                  className="flex-1"
                  loading={bulkRemoveFromThemeMutation.isPending}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}