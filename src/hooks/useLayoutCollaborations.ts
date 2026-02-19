import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface LayoutCollaborator {
  id: string
  layout_id: string
  user_id: string | null
  team_id: string | null
  org_node_id: string | null
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
  org_node?: {
    id: string
    name: string
    node_type: string
  }
}

interface AddCollaboratorData {
  layout_id: string
  user_id?: string
  team_id?: string
  org_node_id?: string
  permission: 'view' | 'edit' | 'admin'
}

interface UpdateCollaboratorData {
  permission: 'view' | 'edit' | 'admin'
}

export function useLayoutCollaborations(layoutId?: string) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch collaborations for a layout
  const { data: collaborations = [], isLoading, error } = useQuery({
    queryKey: ['layout-collaborations', layoutId],
    queryFn: async () => {
      if (!layoutId) return []

      const { data, error } = await supabase
        .from('layout_collaborations')
        .select(`
          *,
          user:users!layout_collaborations_user_id_fkey(
            id, email, first_name, last_name
          ),
          team:teams!layout_collaborations_team_id_fkey(
            id, name
          ),
          org_node:org_chart_nodes!layout_collaborations_org_node_id_fkey(
            id, name, node_type
          )
        `)
        .eq('layout_id', layoutId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []) as LayoutCollaborator[]
    },
    enabled: !!layoutId && !!user
  })

  // Add a collaborator
  const addCollaborator = useMutation({
    mutationFn: async (data: AddCollaboratorData) => {
      if (!user) throw new Error('Not authenticated')

      const { data: collab, error } = await supabase
        .from('layout_collaborations')
        .insert({
          layout_id: data.layout_id,
          user_id: data.user_id || null,
          team_id: data.team_id || null,
          org_node_id: data.org_node_id || null,
          permission: data.permission,
          invited_by: user.id
        })
        .select(`
          *,
          user:users!layout_collaborations_user_id_fkey(
            id, email, first_name, last_name
          ),
          team:teams!layout_collaborations_team_id_fkey(
            id, name
          ),
          org_node:org_chart_nodes!layout_collaborations_org_node_id_fkey(
            id, name, node_type
          )
        `)
        .single()

      if (error) throw error
      return collab as LayoutCollaborator
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['layout-collaborations', variables.layout_id] })
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts'] })
      queryClient.invalidateQueries({ queryKey: ['layout-collab-summaries'] })
    }
  })

  // Update collaborator permission
  const updateCollaborator = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateCollaboratorData }) => {
      const { data: collab, error } = await supabase
        .from('layout_collaborations')
        .update({ permission: data.permission })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return collab as LayoutCollaborator
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['layout-collaborations', layoutId] })
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts'] })
      queryClient.invalidateQueries({ queryKey: ['layout-collab-summaries'] })
    }
  })

  // Remove a collaborator
  const removeCollaborator = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('layout_collaborations')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['layout-collaborations', layoutId] })
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts'] })
      queryClient.invalidateQueries({ queryKey: ['layout-collab-summaries'] })
    }
  })

  // Share with entire organization (creates a collab with null user_id, team_id, and org_node_id)
  const shareWithOrganization = useMutation({
    mutationFn: async ({ layout_id, permission }: { layout_id: string; permission: 'view' | 'edit' | 'admin' }) => {
      if (!user) throw new Error('Not authenticated')

      // First check if org-wide sharing already exists
      const { data: existing } = await supabase
        .from('layout_collaborations')
        .select('id')
        .eq('layout_id', layout_id)
        .is('user_id', null)
        .is('team_id', null)
        .is('org_node_id', null)
        .single()

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('layout_collaborations')
          .update({ permission })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        // Create new
        const { error } = await supabase
          .from('layout_collaborations')
          .insert({
            layout_id,
            user_id: null,
            team_id: null,
            org_node_id: null,
            permission,
            invited_by: user.id
          })

        if (error) throw error
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['layout-collaborations', variables.layout_id] })
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts'] })
      queryClient.invalidateQueries({ queryKey: ['layout-collab-summaries'] })
    }
  })

  // Remove organization-wide sharing
  const removeOrganizationSharing = useMutation({
    mutationFn: async (layout_id: string) => {
      const { error } = await supabase
        .from('layout_collaborations')
        .delete()
        .eq('layout_id', layout_id)
        .is('user_id', null)
        .is('team_id', null)
        .is('org_node_id', null)

      if (error) throw error
    },
    onSuccess: (_, layout_id) => {
      queryClient.invalidateQueries({ queryKey: ['layout-collaborations', layout_id] })
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts'] })
      queryClient.invalidateQueries({ queryKey: ['layout-collab-summaries'] })
    }
  })

  // Helper: Get organization-wide collaboration if exists
  const orgCollaboration = collaborations.find(
    c => c.user_id === null && c.team_id === null && c.org_node_id === null
  )

  // Helper: Get user collaborations
  const userCollaborations = collaborations.filter(c => c.user_id !== null)

  // Helper: Get team collaborations
  const teamCollaborations = collaborations.filter(c => c.team_id !== null)

  // Helper: Get org node collaborations
  const nodeCollaborations = collaborations.filter(c => c.org_node_id !== null)

  // Check if layout is shared with organization
  const isSharedWithOrg = !!orgCollaboration

  return {
    collaborations,
    userCollaborations,
    teamCollaborations,
    nodeCollaborations,
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

/**
 * Hook to fetch available teams and org nodes for sharing
 */
export function useShareableEntities() {
  const { user } = useAuth()

  // Fetch teams the user is a member of
  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['shareable-teams', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('team_memberships')
        .select(`
          team:teams(id, name, slug, color)
        `)
        .eq('user_id', user.id)

      if (error) throw error
      return (data || [])
        .map(tm => tm.team)
        .filter((t): t is { id: string; name: string; slug: string; color: string | null } => !!t)
    },
    enabled: !!user?.id
  })

  // Fetch org nodes the user can share with (from their organization)
  const { data: orgNodes = [], isLoading: nodesLoading } = useQuery({
    queryKey: ['shareable-org-nodes', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // Get user's organization
      const { data: membership } = await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()

      if (!membership) return []

      // Get org nodes for the organization
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id')
        .eq('organization_id', membership.organization_id)
        .eq('is_active', true)
        .order('sort_order')

      if (error) throw error
      return (data || []) as Array<{
        id: string
        name: string
        node_type: string
        parent_id: string | null
      }>
    },
    enabled: !!user?.id
  })

  // Fetch users in the same organization for direct sharing
  const { data: orgUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['shareable-users', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // Get user's organization
      const { data: membership } = await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()

      if (!membership) return []

      // Get users in the organization (excluding current user)
      const { data, error } = await supabase
        .from('organization_memberships')
        .select(`
          user:users(id, email, first_name, last_name)
        `)
        .eq('organization_id', membership.organization_id)
        .eq('status', 'active')
        .neq('user_id', user.id)

      if (error) throw error
      return (data || [])
        .map(m => m.user)
        .filter((u): u is { id: string; email: string; first_name: string | null; last_name: string | null } => !!u)
        .map(u => ({
          ...u,
          full_name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email
        }))
    },
    enabled: !!user?.id
  })

  return {
    teams,
    orgNodes,
    orgUsers,
    isLoading: teamsLoading || nodesLoading || usersLoading
  }
}
