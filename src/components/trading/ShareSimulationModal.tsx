import React, { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X,
  Search,
  Send,
  Check,
  User,
  Loader2,
  Eye,
  MessageSquare,
  Users,
  Camera,
  Link2,
  Info,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  useSimulationShare,
  type SimulationShareAccess,
  type SimulationShareMode,
} from '../../hooks/useSimulationShare'
import { clsx } from 'clsx'

interface ShareSimulationModalProps {
  isOpen: boolean
  onClose: () => void
  simulationId: string
  simulationName: string
}

const ACCESS_LEVELS: {
  value: SimulationShareAccess
  label: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    value: 'view',
    label: 'View only',
    description: 'Can view the simulation but not make changes',
    icon: <Eye className="h-4 w-4" />,
  },
  {
    value: 'suggest',
    label: 'Can suggest',
    description: 'Can view and submit suggestions for changes',
    icon: <MessageSquare className="h-4 w-4" />,
  },
  {
    value: 'collaborate',
    label: 'Collaborate',
    description: 'Full edit access (live mode only)',
    icon: <Users className="h-4 w-4" />,
  },
]

const SHARE_MODES: {
  value: SimulationShareMode
  label: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    value: 'snapshot',
    label: 'Snapshot',
    description: 'Share a read-only copy of the current state',
    icon: <Camera className="h-4 w-4" />,
  },
  {
    value: 'live',
    label: 'Live',
    description: 'Share real-time access to the live simulation',
    icon: <Link2 className="h-4 w-4" />,
  },
]

export function ShareSimulationModal({
  isOpen,
  onClose,
  simulationId,
  simulationName,
}: ShareSimulationModalProps) {
  const { user } = useAuth()
  const { shareSimulation, isSharing } = useSimulationShare({
    onShareCreated: () => setSent(true),
  })

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [accessLevel, setAccessLevel] = useState<SimulationShareAccess>('view')
  const [shareMode, setShareMode] = useState<SimulationShareMode>('snapshot')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('')
      setSelectedUsers([])
      setAccessLevel('view')
      setShareMode('snapshot')
      setMessage('')
      setSent(false)
    }
  }, [isOpen])

  // Auto-close after success
  useEffect(() => {
    if (sent) {
      const timer = setTimeout(() => {
        onClose()
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [sent, onClose])

  // Fetch all users
  const { data: allUsers, isLoading: usersLoading } = useQuery({
    queryKey: ['all-users-share'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .neq('id', user?.id)
        .order('first_name', { ascending: true })

      if (error) throw error
      return data || []
    },
    enabled: isOpen,
  })

  // Filter users based on search
  const filteredUsers =
    allUsers?.filter((u) => {
      if (!searchQuery) return true
      const fullName = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase()
      const email = (u.email || '').toLowerCase()
      const query = searchQuery.toLowerCase()
      return fullName.includes(query) || email.includes(query)
    }) || []

  const toggleUser = (userId: string) => {
    setSelectedUsers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    )
  }

  const getUserDisplayName = (u: { first_name?: string; last_name?: string; email?: string }) => {
    if (u.first_name && u.last_name) {
      return `${u.first_name} ${u.last_name}`
    }
    if (u.email) {
      return u.email.split('@')[0]
    }
    return 'Unknown User'
  }

  const getUserInitials = (u: { first_name?: string; last_name?: string; email?: string }) => {
    if (u.first_name && u.last_name) {
      return (u.first_name[0] + u.last_name[0]).toUpperCase()
    }
    if (u.email) {
      return u.email.substring(0, 2).toUpperCase()
    }
    return 'UU'
  }

  const handleShare = () => {
    shareSimulation({
      simulationId,
      recipientIds: selectedUsers,
      accessLevel,
      shareMode,
      message: message || undefined,
    })
  }

  // Disable collaborate access in snapshot mode
  const isCollaborateDisabled = shareMode === 'snapshot'

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Share Simulation
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-[300px]">
              {simulationName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {sent ? (
          // Success state
          <div className="flex-1 flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              Shared Successfully!
            </h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Sent to {selectedUsers.length} {selectedUsers.length === 1 ? 'person' : 'people'}
            </p>
          </div>
        ) : (
          <>
            {/* Share Mode Selection */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Share Mode
              </label>
              <div className="flex gap-2">
                {SHARE_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    onClick={() => {
                      setShareMode(mode.value)
                      // Reset access level if switching to snapshot and collaborate is selected
                      if (mode.value === 'snapshot' && accessLevel === 'collaborate') {
                        setAccessLevel('view')
                      }
                    }}
                    className={clsx(
                      'flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left',
                      shareMode === mode.value
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800',
                    )}
                  >
                    <span
                      className={clsx(
                        shareMode === mode.value
                          ? 'text-primary-600 dark:text-primary-400'
                          : 'text-gray-400'
                      )}
                    >
                      {mode.icon}
                    </span>
                    <div className="flex-1">
                      <p
                        className={clsx(
                          'text-sm font-medium',
                          shareMode === mode.value
                            ? 'text-primary-700 dark:text-primary-300'
                            : 'text-gray-700 dark:text-gray-300'
                        )}
                      >
                        {mode.label}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              {shareMode === 'snapshot' && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Recipients will see a frozen copy of your simulation's current state.
                </p>
              )}
              {shareMode === 'live' && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Recipients will see your simulation update in real time as you make changes.
                </p>
              )}
            </div>

            {/* Access Level Selection */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Access Level
              </label>
              <div className="space-y-2">
                {ACCESS_LEVELS.map((level) => {
                  const isDisabled = level.value === 'collaborate' && isCollaborateDisabled
                  return (
                    <button
                      key={level.value}
                      onClick={() => !isDisabled && setAccessLevel(level.value)}
                      disabled={isDisabled}
                      className={clsx(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors text-left',
                        accessLevel === level.value
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800',
                        isDisabled && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <span
                        className={clsx(
                          accessLevel === level.value
                            ? 'text-primary-600 dark:text-primary-400'
                            : 'text-gray-400'
                        )}
                      >
                        {level.icon}
                      </span>
                      <div className="flex-1">
                        <p
                          className={clsx(
                            'text-sm font-medium',
                            accessLevel === level.value
                              ? 'text-primary-700 dark:text-primary-300'
                              : 'text-gray-700 dark:text-gray-300'
                          )}
                        >
                          {level.label}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {level.description}
                        </p>
                      </div>
                      {accessLevel === level.value && (
                        <Check className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Search */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Share with
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search team members..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            {/* User list */}
            <div className="flex-1 overflow-y-auto px-2 py-2 min-h-[150px] max-h-[200px]">
              {usersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 text-gray-400 animate-spin" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <User className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-sm">No users found</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredUsers.map((u) => {
                    const isSelected = selectedUsers.includes(u.id)
                    return (
                      <button
                        key={u.id}
                        onClick={() => toggleUser(u.id)}
                        className={clsx(
                          'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left',
                          isSelected
                            ? 'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        )}
                      >
                        <div
                          className={clsx(
                            'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
                            isSelected ? 'bg-primary-500' : 'bg-gray-200 dark:bg-gray-700'
                          )}
                        >
                          {isSelected ? (
                            <Check className="h-4 w-4 text-white" />
                          ) : (
                            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                              {getUserInitials(u)}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={clsx(
                              'text-sm font-medium truncate',
                              isSelected
                                ? 'text-primary-900 dark:text-primary-100'
                                : 'text-gray-900 dark:text-gray-100'
                            )}
                          >
                            {getUserDisplayName(u)}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {u.email}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Message input */}
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Add a message (optional)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write a message..."
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                rows={2}
              />
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {selectedUsers.length > 0
                  ? `${selectedUsers.length} selected`
                  : 'Select team members to share with'}
              </span>
              <button
                onClick={handleShare}
                disabled={selectedUsers.length === 0 || isSharing}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  selectedUsers.length > 0
                    ? 'bg-primary-600 text-white hover:bg-primary-700'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                )}
              >
                {isSharing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Share
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default ShareSimulationModal
