/**
 * InviteUserModal Component
 *
 * Modal for inviting a user to collaborate on a workflow.
 * Extracted from WorkflowsPage.tsx during Phase 5 refactoring.
 */

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search } from 'lucide-react'
import { Button } from '../../ui/Button'
import { supabase } from '../../../lib/supabase'

export interface InviteUserModalProps {
  /** Workflow ID */
  workflowId: string

  /** Workflow name */
  workflowName: string

  /** Callback when modal is closed */
  onClose: () => void

  /** Callback when user is invited */
  onInvite: (email: string, permission: 'read' | 'write' | 'admin') => void
}

export function InviteUserModal({ workflowId, workflowName, onClose, onInvite }: InviteUserModalProps) {
  const [email, setEmail] = useState('')
  const [permission, setPermission] = useState<'read' | 'write' | 'admin'>('read')
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
    const inviteEmail = selectedUser?.email || email.trim()
    if (inviteEmail) {
      onInvite(inviteEmail, permission)
    }
  }

  const handleUserSelect = (user: {id: string, email: string, name: string}) => {
    setSelectedUser(user)
    setEmail(user.email)
    setSearchTerm(user.name)
    setShowDropdown(false)
  }

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setSelectedUser(null)
    setEmail('')
    setShowDropdown(true)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Invite User</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">
            Invite a team member to collaborate on "{workflowName}"
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search User or Enter Email
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onFocus={() => setShowDropdown(true)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Search by name or enter email..."
                />
                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              </div>

              {/* Dropdown */}
              {showDropdown && searchTerm && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowDropdown(false)}
                  />
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-20 max-h-48 overflow-y-auto">
                    {filteredUsers.length > 0 ? (
                      filteredUsers.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => handleUserSelect(user)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                        >
                          <div className="font-medium text-gray-900">{user.name}</div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-gray-500 text-sm">
                        No users found. You can still enter an email manually.
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Manual email input for non-found users */}
              {!selectedUser && searchTerm && !searchTerm.includes(' ') && searchTerm.includes('@') && (
                <div className="mt-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Or enter email manually"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Permission Level
              </label>
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as 'read' | 'write' | 'admin')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="read">Read Only - Can view workflow</option>
                <option value="write">Write - Can edit checklist items</option>
                <option value="admin">Admin - Can edit workflow settings</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Send Invitation
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
