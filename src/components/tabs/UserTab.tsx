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
  ChevronUp,
  ArrowLeft
} from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { AnalystPerformanceCard } from '../outcomes/AnalystPerformanceCard'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'

/*
  The four section empty states, which are identical apart from icon and copy.

  On a phone: a single left-aligned line, no panel, no dashed border. From
  `sm` up: the original centred dashed panel. Four of these stacked were the
  bulk of an empty profile.
*/
const EMPTY_SECTION_CLASS =
  'flex items-center gap-2.5 py-2 text-left sm:block sm:text-center sm:py-8 sm:bg-gray-50 sm:rounded-lg sm:border-2 sm:border-dashed sm:border-gray-300 dark:sm:border-gray-600 dark:sm:bg-gray-900'
const EMPTY_ICON_CLASS = 'h-5 w-5 shrink-0 text-gray-400 sm:h-8 sm:w-8 sm:mx-auto sm:mb-2'

interface UserTabProps {
  user: {
    id: string
    full_name?: string
    email?: string
    avatar_url?: string
    [key: string]: any
  }
  onNavigate?: (result: { id: string; title: string; type: string; data: any }) => void
  /**
   * Leave this person and return to where they were opened from.
   *
   * A person opens as its own tab, and `TabManager` is desktop-only — so on a
   * phone there is no tab strip to go back with and this surface was a dead
   * end. Supplied only on mobile; desktop closes the tab from the strip as
   * before.
   */
  onBack?: () => void
}

export function UserTab({ user, onNavigate, onBack }: UserTabProps) {
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
    <div className="h-full overflow-auto p-3 sm:p-6 space-y-3 sm:space-y-6">
      {/* Back to where this person was opened from. Mobile only: on desktop
          the tab strip is the way back and this would be a second one. */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          data-slot="user-back"
          className="sm:hidden -mt-1 flex items-center gap-1.5 min-h-[44px] pr-2 text-sm font-medium text-gray-600 dark:text-gray-300"
        >
          <ArrowLeft className="w-5 h-5 shrink-0" />
          <span>Back</span>
        </button>
      )}

      {/* User Header */}
      <Card className="max-sm:p-3 max-sm:shadow-none">
        <div className="flex items-start gap-3 sm:gap-6">
          {/* Avatar */}
          <div className="w-12 h-12 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white text-lg sm:text-2xl font-bold flex-shrink-0">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={displayName} className="w-full h-full rounded-full object-cover" />
            ) : (
              displayName.charAt(0).toUpperCase()
            )}
          </div>

          {/* User Info */}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white break-words">{displayName}</h1>

            <div className="mt-1 sm:mt-2 space-y-1">
              {profile.email && (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <Mail className="w-4 h-4" />
                  <span>{profile.email}</span>
                </div>
              )}
              {profile.organization && (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <Building2 className="w-4 h-4" />
                  <span>{profile.organization}</span>
                </div>
              )}
              {profile.created_at && (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <Calendar className="w-4 h-4" />
                  <span>Member since {formatDistanceToNow(new Date(profile.created_at), { addSuffix: true })}</span>
                </div>
              )}
            </div>

            {/* Quick Stats.

                Four `text-2xl` numerals spread across a row is a desktop
                stat band; on a phone it was four zeros dominating the first
                screen of a person's profile. Same four facts, same order, as
                a compact strip — the person's identity should be the largest
                thing here, not the absence of their data. */}
            <div className="mt-2 sm:mt-4 grid grid-cols-4 gap-1 sm:flex sm:gap-6">
              {([
                ['Assets Covered', coveredAssets?.length || 0],
                ['Price Targets', priceTargets?.length || 0],
                ['Notes', recentNotes?.length || 0],
                ['Open Tasks', assignedTasks?.length || 0],
              ] as const).map(([label, value]) => (
                <div key={label} className="min-w-0 sm:text-center">
                  <div className={`text-base sm:text-2xl font-bold tabular-nums ${value > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-300 dark:text-gray-600'}`}>
                    {value}
                  </div>
                  <div className="text-[10px] sm:text-xs leading-tight text-gray-500 dark:text-gray-400">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Track Record Section */}
      <Card padding="none" className="max-sm:shadow-none">
        <button
          onClick={() => toggleSection('trackRecord')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors dark:hover:bg-gray-800"
        >
          <div className="flex items-center space-x-3">
            <TrendingUp className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Track Record</h2>
          </div>
          {collapsedSections.trackRecord ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
        </button>
        {!collapsedSections.trackRecord && (
          <div className="border-t border-gray-100 p-6 dark:border-gray-800">
            <AnalystPerformanceCard
              userId={user.id}
              periodType="all_time"
            />
          </div>
        )}
      </Card>

      {/* Covered Assets Section */}
      <Card padding="none" className="max-sm:shadow-none">
        <button
          onClick={() => toggleSection('coveredAssets')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors dark:hover:bg-gray-800"
        >
          <div className="flex items-center space-x-3">
            <Target className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Coverage ({coveredAssets?.length || 0})</h2>
          </div>
          {collapsedSections.coveredAssets ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
        </button>
        {!collapsedSections.coveredAssets && (
          <div className="border-t border-gray-100 p-6 dark:border-gray-800">
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
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 cursor-pointer transition-colors dark:border-gray-700"
                  >
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white">{coverage.assets?.symbol}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">{coverage.assets?.company_name}</div>
                    </div>
                    <div className="text-right">
                      <Badge variant="default" size="sm">{coverage.role || 'Analyst'}</Badge>
                      {coverage.assets?.sector && (
                        <div className="text-xs text-gray-500 mt-1 dark:text-gray-400">{coverage.assets.sector}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Compact on a phone: one line of icon + copy. A dashed panel
                 with a centred 32px icon and `py-8` is ~130px of a 844px
                 screen saying nothing — four of them, stacked, were most of
                 this profile. Desktop keeps the panel. */
              <div className={EMPTY_SECTION_CLASS}>
                <Target className={EMPTY_ICON_CLASS} />
                <p className="text-sm text-gray-500 dark:text-gray-400">No coverage assignments</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Price Targets Section */}
      <Card padding="none" className="max-sm:shadow-none">
        <button
          onClick={() => toggleSection('priceTargets')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors dark:hover:bg-gray-800"
        >
          <div className="flex items-center space-x-3">
            <TrendingUp className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Price Targets ({priceTargets?.length || 0})</h2>
          </div>
          {collapsedSections.priceTargets ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
        </button>
        {!collapsedSections.priceTargets && (
          <div className="border-t border-gray-100 p-6 dark:border-gray-800">
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
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 cursor-pointer transition-colors dark:border-gray-700"
                  >
                    <div className="flex items-center gap-3">
                      <div className="font-semibold text-gray-900 dark:text-white">{target.assets?.symbol}</div>
                      <Badge
                        variant={target.scenario?.toLowerCase().includes('bull') ? 'success' : target.scenario?.toLowerCase().includes('bear') ? 'error' : 'default'}
                        size="sm"
                      >
                        {target.scenario || 'Base'}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-gray-900 dark:text-white">${target.target_price?.toFixed(2)}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {target.target_date ? new Date(target.target_date).toLocaleDateString() : 'No date'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={EMPTY_SECTION_CLASS}>
                <TrendingUp className={EMPTY_ICON_CLASS} />
                <p className="text-sm text-gray-500 dark:text-gray-400">No price targets set</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Open Tasks Section */}
      <Card padding="none" className="max-sm:shadow-none">
        <button
          onClick={() => toggleSection('openTasks')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors dark:hover:bg-gray-800"
        >
          <div className="flex items-center space-x-3">
            <CheckSquare className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Open Tasks ({assignedTasks?.length || 0})</h2>
          </div>
          {collapsedSections.openTasks ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
        </button>
        {!collapsedSections.openTasks && (
          <div className="border-t border-gray-100 p-6 dark:border-gray-800">
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
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 cursor-pointer transition-colors dark:border-gray-700"
                  >
                    <div className="flex-1">
                      <div className="text-sm text-gray-900 dark:text-white">{task.item_text}</div>
                      <div className="text-xs text-gray-500 mt-1 dark:text-gray-400">
                        {task.assets?.symbol} • Stage: {task.stage_id}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={EMPTY_SECTION_CLASS}>
                <CheckSquare className={EMPTY_ICON_CLASS} />
                <p className="text-sm text-gray-500 dark:text-gray-400">No open tasks assigned</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Recent Notes Section */}
      <Card padding="none" className="max-sm:shadow-none">
        <button
          onClick={() => toggleSection('recentNotes')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors dark:hover:bg-gray-800"
        >
          <div className="flex items-center space-x-3">
            <FileText className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Notes ({recentNotes?.length || 0})</h2>
          </div>
          {collapsedSections.recentNotes ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
        </button>
        {!collapsedSections.recentNotes && (
          <div className="border-t border-gray-100 p-6 dark:border-gray-800">
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
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 cursor-pointer transition-colors dark:border-gray-700"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">{note.title}</div>
                      <div className="text-xs text-gray-500 mt-1 dark:text-gray-400">
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
              <div className={EMPTY_SECTION_CLASS}>
                <FileText className={EMPTY_ICON_CLASS} />
                <p className="text-sm text-gray-500 dark:text-gray-400">No notes yet</p>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

export default UserTab
