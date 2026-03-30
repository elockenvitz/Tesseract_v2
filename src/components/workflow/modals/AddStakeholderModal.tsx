/**
 * AddStakeholderModal Component
 *
 * Modal for adding one or more stakeholders to a workflow.
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

export interface AddStakeholderModalProps {
  workflowId: string
  workflowName: string
  scopeType?: 'asset' | 'portfolio' | 'general'
  onClose: () => void
  onAdd: (userIds: string[]) => void
}

export function AddStakeholderModal({ workflowId, workflowName, scopeType, onClose, onAdd }: AddStakeholderModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<PickedUser[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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

  // For portfolio-scoped workflows, check membership of selected users
  const { data: membershipWarnings = [] } = useQuery({
    queryKey: ['stakeholder-membership-check', workflowId, selectedUsers.map(u => u.id).join(',')],
    queryFn: async () => {
      if (selectedUsers.length === 0) return []
      // Get portfolios in this process
      const { data: selections } = await supabase
        .from('workflow_portfolio_selections')
        .select('portfolio_id, portfolio:portfolios!workflow_portfolio_selections_portfolio_id_fkey(id, name)')
        .eq('workflow_id', workflowId)
      if (!selections || selections.length === 0) return []

      const portfolios = selections.map((s: any) => ({
        id: s.portfolio_id,
        name: Array.isArray(s.portfolio) ? s.portfolio[0]?.name : s.portfolio?.name || 'Unknown',
      }))

      // Check portfolio_team membership for each selected user
      const userIds = selectedUsers.map(u => u.id)
      const { data: memberships } = await supabase
        .from('portfolio_team')
        .select('user_id, portfolio_id')
        .in('user_id', userIds)
        .in('portfolio_id', portfolios.map(p => p.id))

      const membershipSet = new Set((memberships || []).map((m: any) => `${m.user_id}:${m.portfolio_id}`))

      const warnings: { userId: string; userName: string; missingPortfolios: string[] }[] = []
      for (const user of selectedUsers) {
        const missing = portfolios
          .filter(p => !membershipSet.has(`${user.id}:${p.id}`))
          .map(p => p.name)
        if (missing.length > 0) {
          warnings.push({ userId: user.id, userName: user.name, missingPortfolios: missing })
        }
      }
      return warnings
    },
    enabled: scopeType === 'portfolio' && selectedUsers.length > 0,
    staleTime: 10_000,
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && searchTerm === '' && selectedUsers.length > 0) {
      setSelectedUsers(prev => prev.slice(0, -1))
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Add Stakeholders</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-1">
            Add stakeholders to "{workflowName}"
          </p>
          <p className="text-xs text-gray-500">
            Stakeholders are notified on run activity but cannot edit.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-3">
            <div ref={containerRef} className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search users
              </label>
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
                  onChange={(e) => { setSearchTerm(e.target.value); setShowDropdown(true) }}
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

          {membershipWarnings.length > 0 && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider mb-1.5">Portfolio access</p>
              <div className="space-y-1">
                {membershipWarnings.map(w => (
                  <p key={w.userId} className="text-[12px] text-amber-800">
                    <span className="font-medium">{w.userName}</span> is not a member of{' '}
                    {w.missingPortfolios.join(', ')}
                  </p>
                ))}
              </div>
              <p className="text-[11px] text-amber-600 mt-1.5">
                They can still work on the process from the Workflows page but won't have access to the portfolio page.
              </p>
            </div>
          )}

          <div className="flex justify-end space-x-3 mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={selectedUsers.length === 0}>
              {selectedUsers.length <= 1 ? 'Add Stakeholder' : `Add ${selectedUsers.length} Stakeholders`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
