// src/components/portfolios/AddTeamMemberModal.tsx
import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Plus, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Card } from '../ui/Card'
import { SearchableSelect } from '../ui/SearchableSelect' // Import the new component

interface AddTeamMemberModalProps {
  isOpen: boolean
  onClose: () => void
  portfolioId: string
  portfolioName: string
  onMemberAdded?: () => void
}

interface UserOption {
  id: string
  email: string | null
  first_name?: string
  last_name?: string
}

export function AddTeamMemberModal({
  isOpen,
  onClose,
  portfolioId,
  portfolioName,
  onMemberAdded,
}: AddTeamMemberModalProps) {
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null)
  const [role, setRole] = useState('')
  const [focus, setFocus] = useState<string | null>(null)
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()

  // IMPORTANT: Make sure these match your DB CHECK/ENUM exactly.
  // If your check is lowercase snake_case, switch values accordingly.
  const roleOptions = [
    { value: '', label: 'Select Role' },
    { value: 'Portfolio Manager', label: 'Portfolio Manager' },
    { value: 'Analyst', label: 'Analyst' },
    { value: 'Trader', label: 'Trader' },
  ]

  const focusOptions = [
    { value: '', label: 'Select Focus (Optional)' },
    { value: 'Generalist', label: 'Generalist' },
    { value: 'Technology', label: 'Technology' },
    { value: 'Healthcare', label: 'Healthcare' },
    { value: 'Energy', label: 'Energy' },
    { value: 'Financials', label: 'Financials' },
    { value: 'Consumer', label: 'Consumer' },
    { value: 'Industrials', label: 'Industrials' },
    { value: 'Utilities', label: 'Utilities' },
    { value: 'Materials', label: 'Materials' },
    { value: 'Real Estate', label: 'Real Estate' },
    { value: 'Quant', label: 'Quant' },
    { value: 'Technical', label: 'Technical' },
  ]

  // Moved getUserDisplayName function definition here
  const getUserDisplayName = (user: UserOption | undefined | null) => {
    if (!user) return 'Unknown User'
    if (user.first_name || user.last_name) {
      return `${user.first_name || ''} ${user.last_name || ''}`.trim()
    }
    if (user.email) return user.email.split('@')[0]
    return 'Unknown User'
  }

  const { data: allUsers, isLoading: usersLoading } = useQuery<UserOption[]>({
    queryKey: ['all-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: isOpen,
    staleTime: 0,
  })

  const { data: existingTeamMembers, isLoading: existingTeamLoading } = useQuery<
    Array<{ user_id: string; role: string; focus: string }>
  >({
    queryKey: ['portfolio-team', portfolioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_team')
        .select('user_id, role, focus')
        .eq('portfolio_id', portfolioId)
      if (error) throw error
      return data || []
    },
    enabled: isOpen,
    staleTime: 0,
  })

  // Transform allUsers into options for SearchableSelect
  const userOptions = useMemo(() => {
    if (!allUsers) return []

    const existingRoleFocusCombinations = new Set(
      (existingTeamMembers || []).map((tm) => `${tm.user_id}-${tm.role}-${tm.focus || 'null'}`)
    )

    return allUsers.filter((u) => {
      // Filter out users only if they already have this exact role+focus combination
      const currentCombination = `${u.id}-${role}-${focus || 'null'}`
      const isAlreadyAssignedExactCombo = role ? existingRoleFocusCombinations.has(currentCombination) : false;

      return !isAlreadyAssignedExactCombo;
    }).map((user) => ({
      value: user.id,
      label: getUserDisplayName(user),
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      ...user // Spread all user properties
    }));
  }, [allUsers, existingTeamMembers, role, focus, currentUser]);


  const addTeamMemberMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser || !role.trim()) {
        throw new Error('Please select a user and a role.')
      }
      const payload = {
        portfolio_id: portfolioId,
        user_id: selectedUser.id,
        role: role.trim(),
        focus: focus || null,
      }

      const { data, error } = await supabase
        .from('portfolio_team')
        .insert([payload])
        .select('id')
        .single()

      if (error) throw error
      return data
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portfolio-team', portfolioId] }),
        queryClient.invalidateQueries({ queryKey: ['team-users-by-id'] }),
      ])

      // reset form
      setSelectedUser(null)
      setRole('')
      setFocus(null)

      onMemberAdded?.()
      onClose()
    },
    onError: (error: any) => {
      console.error('Failed to add team member:', error?.message || error)
      alert(`Error adding team member: ${error?.message || error}`)
    },
  })

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={onClose} />

      {/* Dialog */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-auto transform transition-all p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Add Team Member to {portfolioName}
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form */}
          <div className="space-y-4">
            {/* User SearchableSelect */}
            <SearchableSelect
              label="Select User"
              placeholder="Search users by name or email..."
              options={userOptions}
              value={selectedUser ? { value: selectedUser.id, label: getUserDisplayName(selectedUser), ...selectedUser } : null}
              onChange={(option) => setSelectedUser(option as UserOption)}
              loading={usersLoading || existingTeamLoading}
              disabled={usersLoading || existingTeamLoading}
              displayKey="label" // Display the formatted name in the input
              autocomplete="off" // ADD THIS LINE
            />

            {/* Role */}
            <Select
              label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              options={roleOptions}
            />

            {/* Focus */}
            <Select
              label="Focus"
              value={focus || ''}
              onChange={(e) => setFocus(e.target.value || null)}
              options={focusOptions}
            />
          </div>

          {/* Actions */}
          <div className="mt-6 flex justify-end space-x-3">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => addTeamMemberMutation.mutate()}
              disabled={!selectedUser || !role.trim() || addTeamMemberMutation.isPending}
              loading={addTeamMemberMutation.isPending}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Team Member
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
