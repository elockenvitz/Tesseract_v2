import { useState, useEffect } from 'react'
import { X, Save, Users } from 'lucide-react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

interface CreateTeamModalProps {
  isOpen: boolean
  onClose: () => void
  editingTeam?: {
    id: string
    name: string
    member_ids: string[]
  } | null
}

export function CreateTeamModal({ isOpen, onClose, editingTeam }: CreateTeamModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])

  // Fetch all users
  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .order('full_name')

      if (error) throw error
      return data || []
    }
  })

  // Load existing team data when editing
  useEffect(() => {
    if (editingTeam) {
      setName(editingTeam.name)
      setSelectedUserIds(editingTeam.member_ids || [])
    } else {
      // Reset form when creating new
      setName('')
      setSelectedUserIds([])
    }
  }, [editingTeam, isOpen])

  // Create/Update team mutation
  const saveTeamMutation = useMutation({
    mutationFn: async () => {
      if (editingTeam) {
        // Update existing team
        const { error } = await supabase
          .from('project_teams')
          .update({ name, member_ids: selectedUserIds })
          .eq('id', editingTeam.id)

        if (error) throw error
      } else {
        // Create new team
        const { error } = await supabase
          .from('project_teams')
          .insert({
            name,
            member_ids: selectedUserIds,
            created_by: user?.id
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-teams'] })
      onClose()
    }
  })

  const toggleUser = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingTeam ? 'Edit Team' : 'Create Team'}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Group team members together
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Team Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Team Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Engineering Team"
              required
            />
          </div>

          {/* Team Members */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Team Members
            </label>
            <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-3 max-h-64 overflow-y-auto">
              {allUsers && allUsers.length > 0 ? (
                <div className="space-y-2">
                  {allUsers.map((user) => (
                    <label
                      key={user.id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-2 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(user.id)}
                        onChange={() => toggleUser(user.id)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-900 dark:text-white">
                        {user.full_name || user.email}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">No users found</p>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {selectedUserIds.length} member{selectedUserIds.length !== 1 ? 's' : ''} selected
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveTeamMutation.mutate()}
            disabled={!name.trim() || saveTeamMutation.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            {editingTeam ? 'Update Team' : 'Create Team'}
          </Button>
        </div>
      </div>
    </div>
  )
}
