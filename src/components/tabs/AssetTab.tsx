import React, { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { BarChart3, Target, FileText, Plus, Calendar, User, ArrowLeft } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { BadgeSelect } from '../ui/BadgeSelect'
import { EditableSectionWithHistory, type EditableSectionWithHistoryRef } from '../ui/EditableSectionWithHistory'
import { CaseCard } from '../ui/CaseCard'
import { NoteEditor } from '../notes/NoteEditor'
import { CoverageDisplay } from '../coverage/CoverageDisplay'
import { AddToListButton } from '../lists/AddToListButton'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'

interface AssetTabProps {
  asset: any
  onCite?: (content: string, fieldName?: string) => void
}

export function AssetTab({ asset, onCite }: AssetTabProps) {
  const { user } = useAuth()
  const [priority, setPriority] = useState(asset.priority || 'none')
  const [stage, setStage] = useState(asset.process_stage || 'research')
  const [activeTab, setActiveTab] = useState<'thesis' | 'outcomes' | 'chart' | 'notes'>('thesis')
  const [currentlyEditing, setCurrentlyEditing] = useState<string | null>(null)
  const [showNoteEditor, setShowNoteEditor] = useState(false)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const [showCoverageManager, setShowCoverageManager] = useState(false)
  const queryClient = useQueryClient()

  // Refs for EditableSectionWithHistory components
  const thesisRef = useRef<EditableSectionWithHistoryRef>(null)
  const whereDifferentRef = useRef<EditableSectionWithHistoryRef>(null)
  const risksRef = useRef<EditableSectionWithHistoryRef>(null)

  // Update local state only when switching to a different asset and no unsaved changes
  useEffect(() => {
    if (asset.id && !hasLocalChanges) {
      setPriority(asset.priority || 'none')
      setStage(asset.process_stage || 'research')
    }
  }, [asset.id, hasLocalChanges, asset.priority, asset.process_stage])

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

  // ---------- MINIMAL ADD: user lookup for created_by / updated_by ----------
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

  const nameFor = (id?: string | null) => {
    if (!id) return 'Unknown'
    const u = usersById?.[id]
    if (!u) return 'Unknown'
    if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`
    return u.email?.split('@')[0] || 'Unknown'
  }
  // ------------------------------------------------------------------------

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
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: ['assets'] })
      await queryClient.cancelQueries({ queryKey: ['all-assets'] })
      const previousAssets = queryClient.getQueryData(['assets'])
      const previousAllAssets = queryClient.getQueryData(['all-assets'])

      queryClient.setQueryData(['assets'], (oldData: any) => {
        if (!oldData) return oldData
        return oldData.map((a: any) =>
          a.id === asset.id ? { ...a, ...updates, updated_at: new Date().toISOString() } : a
        )
      })
      queryClient.setQueryData(['all-assets'], (oldData: any) => {
        if (!oldData) return oldData
        return oldData.map((a: any) =>
          a.id === asset.id ? { ...a, ...updates, updated_at: new Date().toISOString() } : a
        )
      })

      return { previousAssets, previousAllAssets }
    },
    onError: (_err, _updates, context) => {
      if (context?.previousAssets) {
        queryClient.setQueryData(['assets'], context.previousAssets)
      }
      if (context?.previousAllAssets) {
        queryClient.setQueryData(['all-assets'], context.previousAllAssets)
      }
    },
    onSuccess: (result) => {
      Object.assign(asset, result)
      setHasLocalChanges(false)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      queryClient.invalidateQueries({ queryKey: ['all-assets'] })
    },
  })

  // ✅ Final autosave mutation: generic RPC + no retries + correct invalidations
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
  const getPriorityColor = (p: string | null) => {
    switch (p) {
      case 'high':
        return 'error'
      case 'medium':
        return 'warning'
      case 'low':
        return 'success'
      case 'none':
      default:
        return 'default'
    }
  }

  const getStageColor = (s: string | null) => {
    switch (s) {
      case 'research':
        return 'primary'
      case 'analysis':
        return 'warning'
      case 'monitoring':
        return 'success'
      case 'review':
      case 'archived':
      default:
        return 'default'
    }
  }

  const handlePriorityChange = (newPriority: string) => {
    setPriority(newPriority)
    setHasLocalChanges(true)
    updateAssetMutation.mutate({ priority: newPriority })
  }

  const handleStageChange = (newStage: string) => {
    setStage(newStage)
    setHasLocalChanges(true)
    updateAssetMutation.mutate({ process_stage: newStage })
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
    { value: 'none', label: 'No Priority Set' },
    { value: 'high', label: 'High Priority' },
    { value: 'medium', label: 'Medium Priority' },
    { value: 'low', label: 'Low Priority' },
  ]

  const stageOptions = [
    { value: 'research', label: 'Research' },
    { value: 'analysis', label: 'Analysis' },
    { value: 'monitoring', label: 'Monitoring' },
    { value: 'review', label: 'Review' },
    { value: 'archived', label: 'Archived' },
  ]

  return (
    <div className="space-y-6">
      {/* Asset Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-8 flex-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">{asset.symbol}</h1>
            <p className="text-lg text-gray-600 mb-1">{asset.company_name}</p>
            {asset.sector && <p className="text-sm text-gray-500">{asset.sector}</p>}
          </div>

          {/* Right side: Price / Market cap */}
          <div className="text-left">
            {asset.current_price && (
              <div className="mb-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Price</p>
                <p className="text-xl font-bold text-gray-900">${asset.current_price}</p>
              </div>
            )}
            {asset.market_cap && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Market Cap</p>
                <p className="text-sm text-gray-700">{asset.market_cap}</p>
              </div>
            )}
          </div>

          {/* Coverage */}
          <div className="text-left">
            <CoverageDisplay assetId={asset.id} coverage={coverage || []} />
          </div>
        </div>

        {/* Status Badges */}
        <div className="flex items-center space-x-3">
          <AddToListButton assetId={asset.id} assetSymbol={asset.symbol} variant="outline" size="sm" />
          <BadgeSelect
            value={priority}
            onChange={handlePriorityChange}
            options={priorityOptions.map((opt) => ({ ...opt, label: `${opt.label.split(' ')[0]} priority` }))}
            variant={getPriorityColor(priority)}
            size="sm"
          />
          <BadgeSelect value={stage} onChange={handleStageChange} options={stageOptions} variant={getStageColor(stage)} size="sm" />
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
            </div>
          )}

          {activeTab === 'chart' && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-lg p-12 text-center">
                <BarChart3 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Chart Coming Soon</h3>
                <p className="text-gray-500">Interactive price charts will be available here.</p>
              </div>
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
                            {/* MINIMAL CHANGE: replace "You" with real names */}
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
        </div>
      </Card>
    </div>
  )
}
