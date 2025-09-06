import React from 'react'
import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Target, FileText, TrendingUp, Plus, Calendar, User, Users, ArrowLeft, Briefcase, DollarSign, Percent } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EditableSection, type EditableSectionRef } from '../ui/EditableSection'
import { EditableField } from '../ui/EditableField'
import { PortfolioNoteEditor } from '../notes/PortfolioNoteEditor'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'

interface PortfolioTabProps {
  portfolio: any
}

export function PortfolioTab({ portfolio }: PortfolioTabProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const [showNoteEditor, setShowNoteEditor] = useState(false)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const queryClient = useQueryClient()
  
  // Update local state only when switching to a different portfolio
  useEffect(() => {
    if (portfolio.id && !hasLocalChanges) {
      // Reset any local state if needed
    }
  }, [portfolio.id, hasLocalChanges])

  // Fetch notes for this portfolio
  const { data: notes } = useQuery({
    queryKey: ['portfolio-notes', portfolio.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_notes')
        .select('*')
        .eq('portfolio_id', portfolio.id)
        .neq('is_deleted', true)
        .order('updated_at', { ascending: false })
      
      if (error) throw error
      return data || []
    },
  })

  // Fetch holdings for this portfolio
  const { data: holdings } = useQuery({
    queryKey: ['portfolio-holdings', portfolio.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select(`
          *,
          assets(symbol, company_name, current_price, sector)
        `)
        .eq('portfolio_id', portfolio.id)
        .order('date', { ascending: false })
      
      if (error) throw error
      return data || []
    },
  })

  const updatePortfolioMutation = useMutation({
    mutationFn: async (updates: any) => {
      const { error } = await supabase
        .from('portfolios')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', portfolio.id)
      
      if (error) throw error
      return { ...updates, updated_at: new Date().toISOString() }
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: ['all-portfolios'] })
      
      const previousPortfolios = queryClient.getQueryData(['all-portfolios'])
      
      queryClient.setQueryData(['all-portfolios'], (oldData: any) => {
        if (!oldData) return oldData
        return oldData.map((p: any) => 
          p.id === portfolio.id ? { ...p, ...updates, updated_at: new Date().toISOString() } : p
        )
      })
      
      return { previousPortfolios }
    },
    onError: (_err, _updates, context) => {
      if (context?.previousPortfolios) {
        queryClient.setQueryData(['all-portfolios'], context.previousPortfolios)
      }
    },
    onSuccess: (result) => {
      Object.assign(portfolio, result)
      setHasLocalChanges(false)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-portfolios'] })
    }
  })

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
    queryClient.invalidateQueries({ queryKey: ['portfolio-notes', portfolio.id] })
  }

  // Calculate portfolio metrics
  const totalValue = holdings?.reduce((sum, holding) => {
    const currentPrice = holding.assets?.current_price || 0
    return sum + (holding.shares * currentPrice)
  }, 0) || 0

  const totalCost = holdings?.reduce((sum, holding) => sum + holding.cost, 0) || 0
  const totalReturn = totalValue - totalCost
  const returnPercentage = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Portfolio Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-8 flex-1">
          {/* Left side: Portfolio name and description */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">{portfolio.name}</h1>
            {portfolio.description && (
              <p className="text-lg text-gray-600 mb-1">{portfolio.description}</p>
            )}
            {portfolio.benchmark && (
              <p className="text-sm text-gray-500">Benchmark: {portfolio.benchmark}</p>
            )}
          </div>
          
          {/* Right side: Stats */}
          <div className="text-left">
            {holdings && holdings.length > 0 && (
              <div className="mb-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Holdings</p>
                <p className="text-xl font-bold text-gray-900">{holdings.length}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Created</p>
              <p className="text-sm text-gray-700">
                {formatDistanceToNow(new Date(portfolio.created_at || 0), { addSuffix: true })}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabular System */}
      <Card padding="none">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'overview'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Briefcase className="h-4 w-4" />
                <span>Overview</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('holdings')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'holdings'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-4 w-4" />
                <span>Holdings</span>
                {holdings && holdings.length > 0 && (
                  <Badge variant="default" size="sm">
                    {holdings.length}
                  </Badge>
                )}
              </div>
            </button>
            <button
              onClick={() => setActiveTab('performance')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'performance'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <BarChart3 className="h-4 w-4" />
                <span>Performance</span>
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
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Key Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <div className="flex items-center">
                    <div className="p-2 bg-primary-100 rounded-lg">
                      <DollarSign className="h-5 w-5 text-primary-600" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-600">Total Value</p>
                      <p className="text-lg font-semibold text-gray-900">
                        ${totalValue.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex items-center">
                    <div className="p-2 bg-success-100 rounded-lg">
                      <TrendingUp className="h-5 w-5 text-success-600" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-600">Total Return</p>
                      <p className={`text-lg font-semibold ${totalReturn >= 0 ? 'text-success-600' : 'text-error-600'}`}>
                        {totalReturn >= 0 ? '+' : ''}${totalReturn.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex items-center">
                    <div className="p-2 bg-warning-100 rounded-lg">
                      <Percent className="h-5 w-5 text-warning-600" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-600">Return %</p>
                      <p className={`text-lg font-semibold ${returnPercentage >= 0 ? 'text-success-600' : 'text-error-600'}`}>
                        {returnPercentage >= 0 ? '+' : ''}{returnPercentage.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex items-center">
                    <div className="p-2 bg-gray-100 rounded-lg">
                      <Briefcase className="h-5 w-5 text-gray-600" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-600">Positions</p>
                      <p className="text-lg font-semibold text-gray-900">{holdings?.length || 0}</p>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'holdings' && (
            <div className="space-y-6">
              {holdings && holdings.length > 0 ? (
                <div className="space-y-4">
                  {holdings.map((holding) => (
                    <Card 
                      key={holding.id} 
                      padding="sm" 
                      className="cursor-pointer hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div>
                            <h4 className="font-semibold text-gray-900">{holding.assets?.symbol}</h4>
                            <p className="text-sm text-gray-600">{holding.assets?.company_name}</p>
                            <p className="text-xs text-gray-500">{holding.assets?.sector}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-gray-900">
                            {holding.shares} shares
                          </p>
                          <p className="text-sm text-gray-600">
                            @ ${holding.price}
                          </p>
                          <p className="text-xs text-gray-500">
                            Cost: ${holding.cost.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No holdings yet</h3>
                  <p className="text-gray-500 mb-4">Add holdings to track your portfolio performance.</p>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Holding
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'performance' && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-lg p-12 text-center">
                <BarChart3 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Performance Charts Coming Soon</h3>
                <p className="text-gray-500">Interactive performance charts and analytics will be available here.</p>
              </div>
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
                <PortfolioNoteEditor
                  portfolioId={portfolio.id}
                  portfolioName={portfolio.name}
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
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No related notes</h3>
                    <p className="text-gray-500 mb-4">Create notes to document your thoughts about this portfolio.</p>
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
    </div>
  )
}