import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface Collaborator {
  id: string
  template_id: string
  user_id: string | null
  team_id: string | null
  permission: 'view' | 'edit' | 'admin'
  invited_by: string | null
  created_at: string
  // Joined data
  user?: {
    id: string
    email: string
    first_name?: string
    last_name?: string
  }
  team?: {
    id: string
    name: string
  }
}

interface AddCollaboratorData {
  template_id: string
  user_id?: string
  team_id?: string
  permission: 'view' | 'edit' | 'admin'
}

interface UpdateCollaboratorData {
  permission: 'view' | 'edit' | 'admin'
}

export function useTemplateCollaborations(templateId?: string) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch collaborations for a template
  const { data: collaborations = [], isLoading, error } = useQuery({
    queryKey: ['template-collaborations', templateId],
    queryFn: async () => {
      if (!templateId) return []

      const { data, error } = await supabase
        .from('template_collaborations')
        .select(`
          *,
          user:users!template_collaborations_user_id_fkey(
            id, email, first_name, last_name
          ),
          team:teams!template_collaborations_team_id_fkey(
            id, name
          )
        `)
        .eq('template_id', templateId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []) as Collaborator[]
    },
    enabled: !!templateId && !!user
  })

  // Add a collaborator
  const addCollaborator = useMutation({
    mutationFn: async (data: AddCollaboratorData) => {
      if (!user) throw new Error('Not authenticated')

      const { data: collab, error } = await supabase
        .from('template_collaborations')
        .insert({
          template_id: data.template_id,
          user_id: data.user_id || null,
          team_id: data.team_id || null,
          permission: data.permission,
          invited_by: user.id
        })
        .select(`
          *,
          user:users!template_collaborations_user_id_fkey(
            id, email, first_name, last_name
          ),
          team:teams!template_collaborations_team_id_fkey(
            id, name
          )
        `)
        .single()

      if (error) throw error
      return collab as Collaborator
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['template-collaborations', variables.template_id] })
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Update collaborator permission
  const updateCollaborator = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateCollaboratorData }) => {
      const { data: collab, error } = await supabase
        .from('template_collaborations')
        .update({ permission: data.permission })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return collab as Collaborator
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template-collaborations', templateId] })
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Remove a collaborator
  const removeCollaborator = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('template_collaborations')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template-collaborations', templateId] })
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Share with organization (creates a collab with null user_id and team_id)
  const shareWithOrganization = useMutation({
    mutationFn: async ({ template_id, permission }: { template_id: string; permission: 'view' | 'edit' | 'admin' }) => {
      if (!user) throw new Error('Not authenticated')

      // First check if org-wide sharing already exists
      const { data: existing } = await supabase
        .from('template_collaborations')
        .select('id')
        .eq('template_id', template_id)
        .is('user_id', null)
        .is('team_id', null)
        .single()

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('template_collaborations')
          .update({ permission })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        // Create new
        const { error } = await supabase
          .from('template_collaborations')
          .insert({
            template_id,
            user_id: null,
            team_id: null,
            permission,
            invited_by: user.id
          })

        if (error) throw error
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['template-collaborations', variables.template_id] })
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Remove organization-wide sharing
  const removeOrganizationSharing = useMutation({
    mutationFn: async (template_id: string) => {
      const { error } = await supabase
        .from('template_collaborations')
        .delete()
        .eq('template_id', template_id)
        .is('user_id', null)
        .is('team_id', null)

      if (error) throw error
    },
    onSuccess: (_, template_id) => {
      queryClient.invalidateQueries({ queryKey: ['template-collaborations', template_id] })
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Helper: Get organization-wide collaboration if exists
  const orgCollaboration = collaborations.find(
    c => c.user_id === null && c.team_id === null
  )

  // Helper: Get user collaborations
  const userCollaborations = collaborations.filter(c => c.user_id !== null)

  // Helper: Get team collaborations
  const teamCollaborations = collaborations.filter(c => c.team_id !== null)

  // Check if template is shared with organization
  const isSharedWithOrg = !!orgCollaboration

  return {
    collaborations,
    userCollaborations,
    teamCollaborations,
    orgCollaboration,
    isSharedWithOrg,
    isLoading,
    error,
    addCollaborator: addCollaborator.mutateAsync,
    updateCollaborator: (id: string, data: UpdateCollaboratorData) =>
      updateCollaborator.mutateAsync({ id, data }),
    removeCollaborator: removeCollaborator.mutateAsync,
    shareWithOrganization: shareWithOrganization.mutateAsync,
    removeOrganizationSharing: removeOrganizationSharing.mutateAsync,
    isAdding: addCollaborator.isPending,
    isUpdating: updateCollaborator.isPending,
    isRemoving: removeCollaborator.isPending
  }
}

// Search users to add as collaborators
export function useSearchUsers(query: string) {
  return useQuery({
    queryKey: ['search-users', query],
    queryFn: async () => {
      if (!query.trim() || query.length < 2) return []

      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .or(`email.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
        .limit(10)

      if (error) throw error
      return data || []
    },
    enabled: query.length >= 2
  })
}

// Get available teams for sharing
export function useTeams() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['teams', user?.id],
    queryFn: async () => {
      if (!user) return []

      const { data, error } = await supabase
        .from('teams')
        .select(`
          id,
          name,
          team_members!inner(user_id)
        `)
        .eq('team_members.user_id', user.id)

      if (error) throw error
      return (data || []).map(t => ({
        id: t.id,
        name: t.name
      }))
    },
    enabled: !!user
  })
}
