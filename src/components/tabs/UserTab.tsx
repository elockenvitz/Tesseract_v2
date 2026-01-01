import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  User,
  Mail,
  Building2,
  Calendar,
  TrendingUp,
  FileText,
  CheckSquare,
  Target,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { AnalystPerformanceCard } from '../outcomes/AnalystPerformanceCard'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'

interface UserTabProps {
  user: {
    id: string
    full_name?: string
    email?: string
    avatar_url?: string
    [key: string]: any
  }
  onNavigate?: (result: { id: string; title: string; type: string; data: any }) => void
}

export function UserTab({ user, onNavigate }: UserTabProps) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  // Fetch user profile
  const { data: userProfile } = useQuery({
    queryKey: ['user-profile', user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (error) throw error
      return data
    }
  })

  // Fetch assets covered by this user
  const { data: coveredAssets } = useQuery({
    queryKey: ['user-covered-assets', user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select(`
          *,
          assets (
            id,
            symbol,
            company_name,
            sector
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    }
  })

  // Fetch recent notes by this user
  const { data: recentNotes } = useQuery({
    queryKey: ['user-recent-notes', user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notes')
        .select(`
          id,
          title,
          note_type,
          updated_at,
          asset_id,
          assets (symbol, company_name)
        `)
        .eq('user_id', user.id)
        .neq('is_deleted', true)
        .order('updated_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data || []
    }
  })

  // Fetch open tasks assigned to this user
  const { data: assignedTasks } = useQuery({
    queryKey: ['user-assigned-tasks', user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_checklist_items')
        .select(`
          id,
          item_text,
          completed,
          stage_id,
          asset_id,
          assets (symbol, company_name)
        `)
        .eq('assigned_user_id', user.id)
        .eq('completed', false)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data || []
    }
  })

  // Fetch price targets by this user
  const { data: priceTargets } = useQuery({
    queryKey: ['user-price-targets', user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analyst_price_targets')
        .select(`
          id,
          target_price,
          scenario,
          target_date,
          status,
          asset_id,
          created_at,
          assets (symbol, company_name)
        `)
        .eq('analyst_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data || []
    }
  })

  const profile = userProfile || user
  const displayName = profile.full_name || profile.email || 'Unknown User'

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      {/* User Header */}
      <Card>
        <div className="flex items-start gap-6">
          {/* Avatar */}
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={displayName} className="w-full h-full rounded-full object-cover" />
            ) : (
              displayName.charAt(0).toUpperCase()
            )}
          </div>

          {/* User Info */}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>

            <div className="mt-2 space-y-1">
              {profile.email && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Mail className="w-4 h-4" />
                  <span>{profile.email}</span>
                </div>
              )}
              {profile.organization && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Building2 className="w-4 h-4" />
                  <span>{profile.organization}</span>
                </div>
              )}
              {profile.created_at && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="w-4 h-4" />
                  <span>Member since {formatDistanceToNow(new Date(profile.created_at), { addSuffix: true })}</span>
                </div>
              )}
            </div>

            {/* Quick Stats */}
            <div className="mt-4 flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{coveredAssets?.length || 0}</div>
                <div className="text-xs text-gray-500">Assets Covered</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{priceTargets?.length || 0}</div>
                <div className="text-xs text-gray-500">Price Targets</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{recentNotes?.length || 0}</div>
                <div className="text-xs text-gray-500">Notes</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{assignedTasks?.length || 0}</div>
                <div className="text-xs text-gray-500">Open Tasks</div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Track Record Section */}
      <Card padding="none">
        <button
          onClick={() => toggleSection('trackRecord')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center space-x-3">
            <TrendingUp className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900">Track Record</h2>
          </div>
          {collapsedSections.trackRecord ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
        </button>
        {!collapsedSections.trackRecord && (
          <div className="border-t border-gray-100 p-6">
            <AnalystPerformanceCard
              userId={user.id}
              periodType="all_time"
            />
          </div>
        )}
      </Card>

      {/* Covered Assets Section */}
      <Card padding="none">
        <button
          onClick={() => toggleSection('coveredAssets')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center space-x-3">
            <Target className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900">Coverage ({coveredAssets?.length || 0})</h2>
          </div>
          {collapsedSections.coveredAssets ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
        </button>
        {!collapsedSections.coveredAssets && (
          <div className="border-t border-gray-100 p-6">
            {coveredAssets && coveredAssets.length > 0 ? (
              <div className="grid gap-3">
                {coveredAssets.map((coverage: any) => (
                  <div
                    key={coverage.id}
                    onClick={() => {
                      if (onNavigate && coverage.assets) {
                        onNavigate({
                          id: coverage.assets.symbol,
                          title: `${coverage.assets.symbol} - ${coverage.assets.company_name}`,
                          type: 'asset',
                          data: coverage.assets
                        })
                      }
                    }}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 cursor-pointer transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-gray-900">{coverage.assets?.symbol}</div>
                      <div className="text-sm text-gray-600">{coverage.assets?.company_name}</div>
                    </div>
                    <div className="text-right">
                      <Badge variant="default" size="sm">{coverage.role || 'Analyst'}</Badge>
                      {coverage.assets?.sector && (
                        <div className="text-xs text-gray-500 mt-1">{coverage.assets.sector}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <Target className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No coverage assignments</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Price Targets Section */}
      <Card padding="none">
        <button
          onClick={() => toggleSection('priceTargets')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center space-x-3">
            <TrendingUp className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900">Recent Price Targets ({priceTargets?.length || 0})</h2>
          </div>
          {collapsedSections.priceTargets ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
        </button>
        {!collapsedSections.priceTargets && (
          <div className="border-t border-gray-100 p-6">
            {priceTargets && priceTargets.length > 0 ? (
              <div className="space-y-3">
                {priceTargets.map((target: any) => (
                  <div
                    key={target.id}
                    onClick={() => {
                      if (onNavigate && target.assets) {
                        onNavigate({
                          id: target.assets.symbol,
                          title: `${target.assets.symbol} - ${target.assets.company_name}`,
                          type: 'asset',
                          data: target.assets
                        })
                      }
                    }}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="font-semibold text-gray-900">{target.assets?.symbol}</div>
                      <Badge
                        variant={target.scenario?.toLowerCase().includes('bull') ? 'success' : target.scenario?.toLowerCase().includes('bear') ? 'error' : 'default'}
                        size="sm"
                      >
                        {target.scenario || 'Base'}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-gray-900">${target.target_price?.toFixed(2)}</div>
                      <div className="text-xs text-gray-500">
                        {target.target_date ? new Date(target.target_date).toLocaleDateString() : 'No date'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <TrendingUp className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No price targets set</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Open Tasks Section */}
      <Card padding="none">
        <button
          onClick={() => toggleSection('openTasks')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center space-x-3">
            <CheckSquare className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900">Open Tasks ({assignedTasks?.length || 0})</h2>
          </div>
          {collapsedSections.openTasks ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
        </button>
        {!collapsedSections.openTasks && (
          <div className="border-t border-gray-100 p-6">
            {assignedTasks && assignedTasks.length > 0 ? (
              <div className="space-y-3">
                {assignedTasks.map((task: any) => (
                  <div
                    key={task.id}
                    onClick={() => {
                      if (onNavigate && task.assets) {
                        onNavigate({
                          id: task.assets.symbol,
                          title: `${task.assets.symbol} - ${task.assets.company_name}`,
                          type: 'asset',
                          data: { ...task.assets, taskId: task.id, stageId: task.stage_id }
                        })
                      }
                    }}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 cursor-pointer transition-colors"
                  >
                    <div className="flex-1">
                      <div className="text-sm text-gray-900">{task.item_text}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {task.assets?.symbol} • Stage: {task.stage_id}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <CheckSquare className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No open tasks assigned</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Recent Notes Section */}
      <Card padding="none">
        <button
          onClick={() => toggleSection('recentNotes')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center space-x-3">
            <FileText className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900">Recent Notes ({recentNotes?.length || 0})</h2>
          </div>
          {collapsedSections.recentNotes ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
        </button>
        {!collapsedSections.recentNotes && (
          <div className="border-t border-gray-100 p-6">
            {recentNotes && recentNotes.length > 0 ? (
              <div className="space-y-3">
                {recentNotes.map((note: any) => (
                  <div
                    key={note.id}
                    onClick={() => {
                      if (onNavigate && note.assets) {
                        onNavigate({
                          id: note.assets.symbol,
                          title: `${note.assets.symbol} - ${note.assets.company_name}`,
                          type: 'asset',
                          data: { ...note.assets, noteId: note.id }
                        })
                      }
                    }}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 cursor-pointer transition-colors"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{note.title}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {note.assets?.symbol} • {note.note_type || 'Note'} • Updated {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}
                      </div>
                    </div>
                    {note.note_type && (
                      <Badge variant="default" size="sm">{note.note_type}</Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <FileText className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No notes yet</p>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

export default UserTab
