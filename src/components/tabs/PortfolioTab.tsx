import React, { useState, useEffect, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { BarChart3, FileText, TrendingUp, Plus, Calendar, User, ArrowLeft, Briefcase, DollarSign, Percent, Users, Trash2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { StockQuote } from '../financial/StockQuote'
import { PortfolioNoteEditor } from '../notes/PortfolioNoteEditorUnified'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { AddTeamMemberModal } from '../portfolios/AddTeamMemberModal'
import { ConfirmDialog } from '../ui/ConfirmDialog' // Import ConfirmDialog

interface PortfolioTabProps {
  portfolio: any
}

export function PortfolioTab({ portfolio }: PortfolioTabProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'holdings' | 'performance' | 'notes' | 'team'>('overview')
  const [showNoteEditor, setShowNoteEditor] = useState(false)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const [showAddTeamMemberModal, setShowAddTeamMemberModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean
    teamMemberId: string | null
    userName: string
    role: string
  }>({
    isOpen: false,
    teamMemberId: null,
    userName: '',
    role: ''
  })
  const queryClient = useQueryClient()

  useEffect(() => {
    if (portfolio.id && !hasLocalChanges) {
      // reset local state if needed on portfolio switch
    }
  }, [portfolio.id, hasLocalChanges])

  // NOTES
  const { data: notes } = useQuery({
    queryKey: ['portfolio-notes', portfolio.id],
    enabled: !!portfolio.id,
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

  // HOLDINGS
  const { data: holdings } = useQuery({
    queryKey: ['portfolio-holdings', portfolio.id],
    enabled: !!portfolio.id,
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

  // TEAM — inner join to users
  const {
    data: teamWithUsers,
    isLoading: teamLoading,
    refetch: refetchTeamWithUsers,
    error: teamError,
  } = useQuery({
    queryKey: ['portfolio-team-with-users', portfolio.id],
    enabled: !!portfolio.id,
    refetchOnMount: 'always',
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_team')
        .select(`
          id,
          portfolio_id,
          user_id,
          role,
          focus,
          created_at,
          user:users!inner (
            id,
            email,
            first_name,
            last_name
          )
        `)
        .eq('portfolio_id', portfolio.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data || []).filter(r => r.user !== null)
    },
  })

  // Group team members by role
  const teamMembersByRole = useMemo(() => {
    if (!teamWithUsers) return {}
    const grouped: { [role: string]: Array<any> } = {} // Changed to group by role

    for (const row of teamWithUsers as any[]) {
      const role = row.role as string
      if (!grouped[role]) {
        grouped[role] = []
      }
      grouped[role].push({
        id: row.id, // The ID of the portfolio_team record
        user: row.user,
        focus: row.focus,
        created_at: row.created_at,
      })
    }
    return grouped
  }, [teamWithUsers])

  // Delete team member mutation
  const deleteTeamMemberMutation = useMutation({
    mutationFn: async (teamMemberId: string) => {
      const { error } = await supabase
        .from('portfolio_team')
        .delete()
        .eq('id', teamMemberId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-with-users', portfolio.id] })
      setDeleteConfirm({ isOpen: false, teamMemberId: null, userName: '', role: '' })
    },
    onError: (error) => {
      console.error('Failed to delete team member:', error)
      alert(`Error deleting team member: ${error.message}`)
    }
  })

  // Update portfolio (unchanged)
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
    },
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

  const handleConfirmDelete = () => {
    if (deleteConfirm.teamMemberId) {
      deleteTeamMemberMutation.mutate(deleteConfirm.teamMemberId)
    }
  }

  const handleCancelDelete = () => {
    setDeleteConfirm({ isOpen: false, teamMemberId: null, userName: '', role: '' });
  }

  const getUserDisplayName = (user: any) => {
    if (!user) return 'Unknown User'
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    return user.email || 'Unknown User'
  }

  const getUserInitials = (user: any) => {
    if (!user) return 'UU'
    if (user.first_name && user.last_name) {
      return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase()
    }
    const nameParts = user.email?.split('@')[0].split('.')
    if (nameParts && nameParts.length > 1) {
      return `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
    }
    return user.email?.substring(0, 2).toUpperCase() || 'UU'
  }

  // Metrics
  const totalValue =
    holdings?.reduce((sum: number, h: any) => sum + h.shares * (h.assets?.current_price || 0), 0) || 0
  const totalCost = holdings?.reduce((sum: number, h: any) => sum + h.cost, 0) || 0
  const totalReturn = totalValue - totalCost
  const returnPercentage = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-8 flex-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">{portfolio.name}</h1>
            {portfolio.description && (
              <p className="text-lg text-gray-600 mb-1">{portfolio.description}</p>
            )}
            {portfolio.benchmark && (
              <p className="text-sm text-gray-500">Benchmark: {portfolio.benchmark}</p>
            )}
          </div>

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

      {/* Tabs */}
      <Card padding="none">
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

            <button
              onClick={() => setActiveTab('team')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'team'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Users className="h-4 w-4" />
                <span>Team</span>
                {teamWithUsers && teamWithUsers.length > 0 && (
                  <Badge variant="default" size="sm">
                    {teamWithUsers.length}
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
                  {holdings.map((holding: any) => (
                    <Card key={holding.id} padding="sm" className="hover:shadow-md transition-shadow">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div className="flex items-center space-x-3">
                          <div>
                            <h4 className="font-semibold text-gray-900">{holding.assets?.symbol}</h4>
                            <p className="text-sm text-gray-600">{holding.assets?.company_name}</p>
                            <p className="text-xs text-gray-500">{holding.assets?.sector}</p>
                          </div>
                        </div>

                        <div className="flex items-center">
                          <StockQuote symbol={holding.assets?.symbol} className="flex-1" />
                        </div>

                        <div className="text-right space-y-1">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{holding.shares} shares</p>
                            <p className="text-sm text-gray-600">Cost: ${holding.price}/share</p>
                            <p className="text-xs text-gray-500">Total: ${holding.cost.toLocaleString()}</p>
                          </div>
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
                  <Button variant="ghost" size="sm" onClick={handleCloseNoteEditor} className="flex items-center">
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
                    {notes.map((note: any) => (
                      <Card key={note.id} padding="sm" className="cursor-pointer hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between" onClick={() => handleNoteClick(note.id)}>
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

          {activeTab === 'team' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Portfolio Team</h2>
                <Button size="sm" onClick={() => setShowAddTeamMemberModal(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Team Member
                </Button>
              </div>

              {teamError && (
                <div className="text-sm text-red-600">Error loading team: {(teamError as any)?.message || 'Unknown error'}</div>
              )}

              {teamLoading && !teamWithUsers ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <Card padding="sm">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                            <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                          </div>
                        </div>
                      </Card>
                    </div>
                  ))}
                </div>
              ) : Object.keys(teamMembersByRole).length > 0 ? ( // Check if there are any roles with members
                <div className="space-y-6">
                  {Object.entries(teamMembersByRole).map(([role, members]) => (
                    <div key={role}>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">{role}</h3>
                      <div className="space-y-4">
                        {members.map((member: any, idx: number) => {
                          const u = member.user
                          const initials = getUserInitials(u)
                          const displayName = getUserDisplayName(u)
                          return (
                            <Card key={`${member.id}-${idx}`} padding="sm"> {/* Use member.id for unique key */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                                    <span className="text-primary-600 font-semibold text-sm">{initials}</span>
                                  </div>
                                  <div>
                                    <h4 className="font-semibold text-gray-900">{displayName}</h4>
                                    <p className="text-sm text-gray-600">{u?.email || '—'}</p>
                                    {member.focus && (
                                      <p className="text-xs text-gray-500">Focus: {member.focus}</p>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeleteConfirm({
                                    isOpen: true,
                                    teamMemberId: member.id,
                                    userName: displayName,
                                    role: role
                                  })}
                                >
                                  <Trash2 className="h-4 w-4 text-error-600" />
                                </Button>
                              </div>
                            </Card>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No team members yet</h3>
                  <p className="text-gray-500 mb-4">Add team members to this portfolio.</p>
                  <Button size="sm" onClick={() => setShowAddTeamMemberModal(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Team Member
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {showAddTeamMemberModal && (
        <AddTeamMemberModal
          isOpen={showAddTeamMemberModal}
          onClose={() => setShowAddTeamMemberModal(false)}
          portfolioId={portfolio.id}
          portfolioName={portfolio.name}
          onMemberAdded={async () => {
            await refetchTeamWithUsers()
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Remove Team Member Role"
        message={`Are you sure you want to remove ${deleteConfirm.userName} as a "${deleteConfirm.role}" from this portfolio?`}
        confirmText="Remove Role"
        cancelText="Cancel"
        variant="danger"
        isLoading={deleteTeamMemberMutation.isPending}
      />
    </div>
  )
}
