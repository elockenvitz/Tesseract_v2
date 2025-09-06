import React, { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { BarChart3, Target, FileText, TrendingUp, Plus, Calendar, User, ArrowLeft } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { BadgeSelect } from '../ui/BadgeSelect'
import { EditableSection, type EditableSectionRef } from '../ui/EditableSection'
import { ThemeNoteEditor } from '../notes/ThemeNoteEditor'
import { AddAssetToThemeModal } from '../themes/AddAssetToThemeModal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { formatDistanceToNow } from 'date-fns'

interface ThemeTabProps {
  theme: any
}

export function ThemeTab({ theme }: ThemeTabProps) {
  const { user } = useAuth()
  const [themeType, setThemeType] = useState(theme.theme_type || 'general')
  const [activeTab, setActiveTab] = useState<'thesis' | 'outcomes' | 'chart' | 'related-assets' | 'notes'>('thesis')
  const [currentlyEditing, setCurrentlyEditing] = useState<string | null>(null)
  const [showNoteEditor, setShowNoteEditor] = useState(false)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const [showAddAssetModal, setShowAddAssetModal] = useState(false)
  const queryClient = useQueryClient()

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

  // ---------- Helpers ----------
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
    queryClient.invalidateQueries({ queryKey: ['theme-notes', theme.id] })
  }

  const themeTypeOptions = [
    { value: 'general', label: 'General' },
    { value: 'sector', label: 'Sector' },
    { value: 'geography', label: 'Geography' },
    { value: 'strategy', label: 'Strategy' },
    { value: 'macro', label: 'Macro' },
  ]

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
            </div>
            {theme.description && (
              <p className="text-lg text-gray-600 mb-1">{theme.description}</p>
            )}
          </div>

          {/* Right side: Stats */}
          <div className="text-left">
            {notes && notes.length > 0 && (
              <div className="mb-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Notes</p>
                <p className="text-xl font-bold text-gray-900">{notes.length}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Created</p>
              <p className="text-sm text-gray-700">
                {formatDistanceToNow(new Date(theme.created_at || 0), { addSuffix: true })}
              </p>
            </div>
          </div>
        </div>

        {/* Status Badges */}
        <div className="flex items-center space-x-3">
          <BadgeSelect
            value={themeType}
            onChange={handleThemeTypeChange}
            options={themeTypeOptions}
            variant={getThemeTypeColor(themeType)}
            size="sm"
          />
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
                {notes && notes.length > 0 && (
                  <Badge variant="default" size="sm">
                    {notes.length}
                  </Badge>
                )}
              </div>
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'thesis' && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-lg p-6">
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

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
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

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
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
            <div className="space-y-6">
              {relatedAssets && relatedAssets.length > 0 ? (
                <>
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-900">
                      {relatedAssets.length} Related Asset{relatedAssets.length !== 1 ? 's' : ''}
                    </h4>
                    <Button size="sm" variant="outline" onClick={() => setShowAddAssetModal(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Assets
                    </Button>
                  </div>
                  <div className="space-y-4">
                    {relatedAssets.map((themeAsset: any) => (
                      <Card
                        key={themeAsset.id}
                        padding="sm"
                        className="cursor-pointer hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg flex items-center justify-center">
                              <span className="text-white font-bold text-sm">
                                {themeAsset.assets?.symbol?.substring(0, 2) || 'AS'}
                              </span>
                            </div>
                            <div>
                              <h4 className="font-semibold text-gray-900">{themeAsset.assets?.symbol}</h4>
                              <p className="text-sm text-gray-600">{themeAsset.assets?.company_name}</p>
                              {themeAsset.notes && (
                                <p className="text-xs text-gray-500 italic mt-1">"{themeAsset.notes}"</p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            {themeAsset.assets?.current_price && (
                              <p className="text-lg font-semibold text-gray-900">${themeAsset.assets.current_price}</p>
                            )}
                            <p className="text-xs text-gray-500">
                              Added {formatDistanceToNow(new Date(themeAsset.added_at || ''), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900">No related assets</h3>
                  <p className="text-gray-500 mb-4">Assets related to this theme will appear here.</p>
                  <Button size="sm" onClick={() => setShowAddAssetModal(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Related Asset
                  </Button>
                </div>
              )}
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
                  onNoteSelect={setSelectedNoteId}
                  onClose={handleCloseNoteEditor}
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
                              {note.content.substring(0, 150)}...
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
                    <Button size="sm" onClick={handleCreateNote}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add First Note
                    </Button>
                  </div>
                )}
              </div>
            )
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
    </div>
  )
}