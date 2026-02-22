/**
 * AddAdminModal Component
 *
 * Modal for adding one or more admins to a workflow.
 * Supports multi-select with removable chips.
 */

import React, { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { supabase } from '../../../lib/supabase'

interface PickedUser {
  id: string
  email: string
  name: string
}

export interface AddAdminModalProps {
  workflowId: string
  workflowName: string
  onClose: () => void
  onAdd: (userIds: string[]) => void
}

export function AddAdminModal({ workflowId, workflowName, onClose, onAdd }: AddAdminModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<PickedUser[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  const selectedIds = new Set(selectedUsers.map(u => u.id))

  const filteredUsers = users?.filter(user =>
    !selectedIds.has(user.id) &&
    (user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
     user.email.toLowerCase().includes(searchTerm.toLowerCase()))
  ) || []

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedUsers.length > 0) {
      onAdd(selectedUsers.map(u => u.id))
    }
  }

  const handleUserSelect = (user: PickedUser) => {
    setSelectedUsers(prev => [...prev, user])
    setSearchTerm('')
    setShowDropdown(false)
    inputRef.current?.focus()
  }

  const handleRemoveUser = (userId: string) => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId))
  }

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setShowDropdown(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && searchTerm === '' && selectedUsers.length > 0) {
      setSelectedUsers(prev => prev.slice(0, -1))
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Add Admins</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-1">
            Add admins to "{workflowName}"
          </p>
          <p className="text-xs text-gray-500">
            Admins can manage the process, add/remove team members, and edit all settings.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-3">
            <div ref={containerRef} className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search users
              </label>
              {/* Multi-select input with chips */}
              <div
                className="flex flex-wrap gap-1.5 px-2.5 py-1.5 border border-gray-300 rounded-md focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 min-h-[38px] cursor-text"
                onClick={() => inputRef.current?.focus()}
              >
                {selectedUsers.map(user => (
                  <span
                    key={user.id}
                    className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    {user.name}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRemoveUser(user.id) }}
                      className="p-0.5 rounded-full hover:bg-blue-200 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  ref={inputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onFocus={() => setShowDropdown(true)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 min-w-[120px] py-0.5 text-sm outline-none bg-transparent"
                  placeholder={selectedUsers.length === 0 ? 'Search by name or email...' : 'Add another...'}
                />
              </div>

              {showDropdown && filteredUsers.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
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
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={selectedUsers.length === 0}>
              {selectedUsers.length <= 1 ? 'Add Admin' : `Add ${selectedUsers.length} Admins`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
