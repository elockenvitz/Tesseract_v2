/**
 * AddStakeholderModal Component
 *
 * Modal for adding a stakeholder to a workflow.
 * Extracted from WorkflowsPage.tsx during Phase 5 refactoring.
 */

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { supabase } from '../../../lib/supabase'

export interface AddStakeholderModalProps {
  /** Workflow ID */
  workflowId: string

  /** Workflow name */
  workflowName: string

  /** Callback when modal is closed */
  onClose: () => void

  /** Callback when stakeholder is added */
  onAdd: (userId: string) => void
}

export function AddStakeholderModal({ workflowId, workflowName, onClose, onAdd }: AddStakeholderModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedUser, setSelectedUser] = useState<{id: string, email: string, name: string} | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  // Query to get all users for searchable dropdown
  const { data: users } = useQuery({
    queryKey: ['users-search'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name')
        .order('last_name')

      if (error) throw error

      return data.map(user => ({
        id: user.id,
        email: user.email,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email
      }))
    }
  })

  // Filter users based on search term
  const filteredUsers = users?.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedUser) {
      onAdd(selectedUser.id)
    }
  }

  const handleUserSelect = (user: {id: string, email: string, name: string}) => {
    setSelectedUser(user)
    setSearchTerm(user.name)
    setShowDropdown(false)
  }

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setSelectedUser(null)
    setShowDropdown(true)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Add Stakeholder</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">
            Add a stakeholder who will be using "{workflowName}"
          </p>
          <p className="text-xs text-gray-500">
            Stakeholders can view the workflow but won't have permission to edit it.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search User
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search by name or email..."
                required
              />

              {/* Searchable dropdown */}
              {showDropdown && filteredUsers.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {filteredUsers.slice(0, 10).map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => handleUserSelect(user)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                    >
                      <div className="font-medium text-sm text-gray-900">{user.name}</div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedUser && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-semibold text-xs">
                      {selectedUser.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium text-sm text-gray-900">{selectedUser.name}</div>
                    <div className="text-xs text-gray-500">{selectedUser.email}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!selectedUser}>
              Add Stakeholder
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
