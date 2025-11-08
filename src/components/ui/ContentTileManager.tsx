import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, GripVertical, Eye, EyeOff, Settings, ChevronDown, ChevronRight } from 'lucide-react'
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd'
import { supabase } from '../../lib/supabase'
import { Button } from './Button'
import { Card } from './Card'
import { Badge } from './Badge'
import { ContentTile } from './ContentTile'

interface ContentTileManagerProps {
  workflowId: string
  stageId: string
  className?: string
}

interface ContentTileData {
  id: string
  tile_type: string
  title: string
  description?: string
  configuration: any
  sort_order: number
  is_enabled: boolean
}

const AVAILABLE_TILE_TYPES = [
  {
    type: 'last_review',
    name: 'Last Research Review',
    description: 'Shows when the asset research was last updated'
  },
  {
    type: 'portfolio_holdings',
    name: 'Portfolio Holdings',
    description: 'Displays current portfolio allocations and weights'
  },
  {
    type: 'trading_activity',
    name: 'Trading Activity',
    description: 'Shows recent trading activity and changes'
  },
  {
    type: 'action_items',
    name: 'Action Items',
    description: 'Customizable list of next steps or tasks'
  },
  {
    type: 'custom_text',
    name: 'Custom Text',
    description: 'Free-form text content for instructions or notes'
  },
  {
    type: 'financial_metrics',
    name: 'Financial Metrics',
    description: 'Key financial ratios and performance metrics'
  },
  {
    type: 'outdated_stage_view',
    name: 'Complete Outdated View',
    description: 'Full outdated stage view with all sections'
  }
]

export function ContentTileManager({ workflowId, stageId, className = '' }: ContentTileManagerProps) {
  const [showAddTile, setShowAddTile] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [selectedTileForPreview, setSelectedTileForPreview] = useState<string | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const queryClient = useQueryClient()

  // Query to get content tiles for this stage
  const { data: contentTiles, isLoading } = useQuery({
    queryKey: ['workflow-stage-content-tiles', workflowId, stageId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_stage_content_tiles')
        .select('*')
        .eq('workflow_id', workflowId)
        .eq('stage_id', stageId)
        .order('sort_order', { ascending: true })

      if (error) throw error
      return data || []
    }
  })

  // Mutation to add a new content tile
  const addTileMutation = useMutation({
    mutationFn: async (tileType: string) => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId) throw new Error('Not authenticated')

      const tileConfig = AVAILABLE_TILE_TYPES.find(t => t.type === tileType)
      if (!tileConfig) throw new Error('Invalid tile type')

      const nextSortOrder = (contentTiles?.length || 0) + 1

      const { error } = await supabase
        .from('workflow_stage_content_tiles')
        .insert({
          workflow_id: workflowId,
          stage_id: stageId,
          tile_type: tileType,
          title: tileConfig.name,
          description: tileConfig.description,
          configuration: getDefaultConfiguration(tileType),
          sort_order: nextSortOrder,
          created_by: userId
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stage-content-tiles', workflowId, stageId] })
      setShowAddTile(false)
    }
  })

  // Mutation to delete a content tile
  const deleteTileMutation = useMutation({
    mutationFn: async (tileId: string) => {
      const { error } = await supabase
        .from('workflow_stage_content_tiles')
        .delete()
        .eq('id', tileId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stage-content-tiles', workflowId, stageId] })
    }
  })

  // Mutation to update tile order
  const updateTileOrderMutation = useMutation({
    mutationFn: async (updates: { id: string; sort_order: number }[]) => {
      const { error } = await supabase
        .from('workflow_stage_content_tiles')
        .upsert(updates)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stage-content-tiles', workflowId, stageId] })
    }
  })

  // Mutation to toggle tile enabled state
  const toggleTileMutation = useMutation({
    mutationFn: async ({ tileId, enabled }: { tileId: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('workflow_stage_content_tiles')
        .update({ is_enabled: enabled })
        .eq('id', tileId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stage-content-tiles', workflowId, stageId] })
    }
  })

  const handleDragEnd = (result: any) => {
    if (!result.destination || !contentTiles) return

    const reorderedTiles = Array.from(contentTiles)
    const [removed] = reorderedTiles.splice(result.source.index, 1)
    reorderedTiles.splice(result.destination.index, 0, removed)

    // Update sort orders
    const updates = reorderedTiles.map((tile, index) => ({
      id: tile.id,
      sort_order: index + 1
    }))

    updateTileOrderMutation.mutate(updates)
  }

  const getDefaultConfiguration = (tileType: string) => {
    switch (tileType) {
      case 'action_items':
        return {
          items: [
            'Review current analysis and assumptions',
            'Check for recent news and developments',
            'Assess position sizing and risk parameters'
          ]
        }
      case 'custom_text':
        return {
          content: 'Add your custom instructions or notes here...'
        }
      default:
        return {}
    }
  }

  if (isLoading) {
    return <div className="animate-pulse h-32 bg-gray-200 rounded-lg"></div>
  }

  return (
    <div className={`${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center space-x-2 hover:text-gray-700 transition-colors"
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
          <div className="text-left">
            <h4 className="font-semibold text-gray-900">Content Tiles {contentTiles && contentTiles.length > 0 && `(${contentTiles.length})`}</h4>
            {isCollapsed && (
              <p className="text-xs text-gray-500">Click to expand</p>
            )}
          </div>
        </button>
        {!isCollapsed && (
          <div className="flex items-center space-x-2">
            <Button
              size="sm"
              variant={previewMode ? 'default' : 'outline'}
              onClick={() => setPreviewMode(!previewMode)}
            >
              {previewMode ? <Settings className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
              {previewMode ? 'Edit' : 'Preview'}
            </Button>
            {!previewMode && (
              <Button size="sm" onClick={() => setShowAddTile(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Add Tile
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Collapsible Content */}
      {!isCollapsed && (
        <div className="mt-4 space-y-4">
          {/* Preview Mode */}
          {previewMode && (
            <div className="space-y-4 border-2 border-dashed border-blue-300 rounded-lg p-4 bg-blue-50">
              <div className="text-sm font-medium text-blue-800 mb-4">Preview Mode - How tiles will appear to users:</div>
              {contentTiles && contentTiles.length > 0 ? (
                contentTiles
                  .filter(tile => tile.is_enabled)
                  .map(tile => (
                    <ContentTile
                      key={tile.id}
                      tile={tile}
                      assetId="preview"
                      assetSymbol="PREVIEW"
                    />
                  ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No content tiles configured for this stage
                </div>
              )}
            </div>
          )}

          {/* Edit Mode */}
          {!previewMode && (
            <>
          {/* Content Tiles List */}
          {contentTiles && contentTiles.length > 0 ? (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="content-tiles">
                {(provided) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className="space-y-3"
                  >
                    {contentTiles.map((tile, index) => (
                      <Draggable key={tile.id} draggableId={tile.id} index={index}>
                        {(provided, snapshot) => (
                          <Card
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`p-4 transition-shadow ${
                              snapshot.isDragging ? 'shadow-lg' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-3">
                                <div
                                  {...provided.dragHandleProps}
                                  className="text-gray-400 hover:text-gray-600 cursor-grab"
                                >
                                  <GripVertical className="w-4 h-4" />
                                </div>
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <h5 className="font-medium text-gray-900">{tile.title}</h5>
                                    <Badge variant="secondary" size="sm">
                                      {tile.tile_type}
                                    </Badge>
                                    {!tile.is_enabled && (
                                      <Badge variant="outline" size="sm">
                                        Disabled
                                      </Badge>
                                    )}
                                  </div>
                                  {tile.description && (
                                    <p className="text-sm text-gray-600 mt-1">{tile.description}</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => toggleTileMutation.mutate({
                                    tileId: tile.id,
                                    enabled: !tile.is_enabled
                                  })}
                                >
                                  {tile.is_enabled ? (
                                    <EyeOff className="w-4 h-4" />
                                  ) : (
                                    <Eye className="w-4 h-4" />
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => deleteTileMutation.mutate(tile.id)}
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </Card>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          ) : (
            <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg">
              No content tiles configured. Click "Add Tile" to get started.
            </div>
          )}

          {/* Add Tile Modal */}
          {showAddTile && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <Card className="w-full max-w-4xl p-6 max-h-[90vh] overflow-hidden">
                <h3 className="text-lg font-semibold mb-4">Add Content Tile</h3>
                <div className="flex gap-6 h-full">
                  {/* Tile Selection */}
                  <div className="w-1/2">
                    <h4 className="font-medium text-gray-900 mb-3">Select Tile Type</h4>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {AVAILABLE_TILE_TYPES.map((tileType) => (
                        <div
                          key={tileType.type}
                          className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                            selectedTileForPreview === tileType.type
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-blue-300'
                          }`}
                          onClick={() => setSelectedTileForPreview(tileType.type)}
                        >
                          <h4 className="font-medium text-gray-900">{tileType.name}</h4>
                          <p className="text-sm text-gray-600">{tileType.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="w-1/2">
                    <h4 className="font-medium text-gray-900 mb-3">Preview</h4>
                    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 min-h-[300px]">
                      {selectedTileForPreview ? (
                        <div className="bg-white rounded-lg p-4 shadow-sm">
                          <ContentTile
                            tile={{
                              id: 'preview',
                              tile_type: selectedTileForPreview,
                              title: AVAILABLE_TILE_TYPES.find(t => t.type === selectedTileForPreview)?.name || '',
                              configuration: {},
                              sort_order: 0,
                              is_enabled: true
                            }}
                            assetId="preview"
                            assetSymbol="PREVIEW"
                            isPreview={true}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                          Select a tile type to see preview
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex justify-between mt-6">
                  <Button variant="outline" onClick={() => {
                    setShowAddTile(false)
                    setSelectedTileForPreview(null)
                  }}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      if (selectedTileForPreview) {
                        addTileMutation.mutate(selectedTileForPreview)
                        setSelectedTileForPreview(null)
                      }
                    }}
                    disabled={!selectedTileForPreview}
                  >
                    Add Tile
                  </Button>
                </div>
              </Card>
            </div>
          )}
            </>
          )}
        </div>
      )}
    </div>
  )
}