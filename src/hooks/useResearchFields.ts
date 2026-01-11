import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// ============================================================================
// TYPES
// ============================================================================

export interface ResearchSection {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  display_order: number
  is_system: boolean
  created_at: string
  updated_at: string
}

export interface ResearchField {
  id: string
  organization_id: string
  section_id: string
  name: string
  slug: string
  description: string | null
  field_type: FieldType
  config: Record<string, unknown>
  is_universal: boolean
  is_system: boolean
  is_archived: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  section?: ResearchSection
}

export interface ResearchFieldPreset {
  id: string
  name: string
  slug: string
  description: string | null
  suggested_section: string
  field_type: FieldType
  config: Record<string, unknown>
  category: string | null
  created_at: string
}

export interface TeamResearchField {
  id: string
  team_id: string
  field_id: string
  is_active: boolean
  is_required: boolean
  display_order: number
  created_at: string
  updated_at: string
  field?: ResearchField
  viewers?: ResearchFieldViewer[]
}

export interface ResearchFieldViewer {
  id: string
  team_field_id: string
  user_id: string
  granted_by: string | null
  granted_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    full_name?: string
  }
}

export type FieldType =
  | 'rich_text'
  | 'numeric'
  | 'date'
  | 'rating'
  | 'checklist'
  | 'excel_table'
  | 'chart'
  | 'documents'
  | 'price_target'
  | 'estimates'
  | 'timeline'
  | 'metric'

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  rich_text: 'Rich Text',
  numeric: 'Numeric',
  date: 'Date',
  rating: 'Rating',
  checklist: 'Checklist',
  excel_table: 'Excel Table',
  chart: 'Chart',
  documents: 'Documents',
  price_target: 'Price Target',
  estimates: 'Estimates',
  timeline: 'Timeline',
  metric: 'Metric'
}

export const FIELD_TYPE_ICONS: Record<FieldType, string> = {
  rich_text: 'FileText',
  numeric: 'Hash',
  date: 'Calendar',
  rating: 'Star',
  checklist: 'CheckSquare',
  excel_table: 'Table',
  chart: 'BarChart2',
  documents: 'FileStack',
  price_target: 'Target',
  estimates: 'TrendingUp',
  timeline: 'Clock',
  metric: 'Gauge'
}

// ============================================================================
// HOOK: useResearchSections
// ============================================================================

export function useResearchSections() {
  const { data: sections = [], isLoading, error } = useQuery({
    queryKey: ['research-sections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_sections')
        .select('*')
        .order('display_order', { ascending: true })

      if (error) throw error
      return data as ResearchSection[]
    }
  })

  return { sections, isLoading, error }
}

// ============================================================================
// HOOK: useResearchFields
// ============================================================================

export function useResearchFields() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Fetch all fields with their sections
  const { data: fields = [], isLoading, error, refetch } = useQuery({
    queryKey: ['research-fields'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_fields')
        .select(`
          *,
          section:research_sections(*)
        `)
        .eq('is_archived', false)
        .order('name', { ascending: true })

      if (error) throw error
      return data as ResearchField[]
    }
  })

  // Group fields by section
  const fieldsBySection = fields.reduce((acc, field) => {
    const sectionSlug = field.section?.slug || 'unknown'
    if (!acc[sectionSlug]) acc[sectionSlug] = []
    acc[sectionSlug].push(field)
    return acc
  }, {} as Record<string, ResearchField[]>)

  // Separate universal and custom fields
  const universalFields = fields.filter(f => f.is_universal)
  const customFields = fields.filter(f => !f.is_universal)

  // Create field mutation
  const createField = useMutation({
    mutationFn: async (input: {
      name: string
      slug: string
      description?: string
      section_id: string
      field_type: FieldType
      config?: Record<string, unknown>
      is_universal?: boolean
    }) => {
      // Get organization_id from section
      const { data: section } = await supabase
        .from('research_sections')
        .select('organization_id')
        .eq('id', input.section_id)
        .single()

      if (!section) throw new Error('Section not found')

      const { data, error } = await supabase
        .from('research_fields')
        .insert({
          ...input,
          organization_id: section.organization_id,
          config: input.config || {},
          is_universal: input.is_universal ?? false,
          is_system: false,
          created_by: user?.id
        })
        .select(`*, section:research_sections(*)`)
        .single()

      if (error) throw error
      return data as ResearchField
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-fields'] })
    }
  })

  // Update field mutation
  const updateField = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ResearchField> & { id: string }) => {
      const { data, error } = await supabase
        .from('research_fields')
        .update(updates)
        .eq('id', id)
        .select(`*, section:research_sections(*)`)
        .single()

      if (error) throw error
      return data as ResearchField
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-fields'] })
    }
  })

  // Archive field mutation (soft delete)
  const archiveField = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('research_fields')
        .update({ is_archived: true })
        .eq('id', id)
        .eq('is_system', false) // Can't archive system fields

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-fields'] })
    }
  })

  // Add field from preset
  const addFromPreset = useMutation({
    mutationFn: async ({ presetSlug, sectionSlug }: { presetSlug: string; sectionSlug?: string }) => {
      const { data, error } = await supabase
        .rpc('add_field_from_preset', {
          p_organization_id: fields[0]?.organization_id, // Use org from existing fields
          p_preset_slug: presetSlug,
          p_section_slug: sectionSlug || null
        })

      if (error) throw error
      return data as string // Returns field ID
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-fields'] })
    }
  })

  return {
    fields,
    fieldsBySection,
    universalFields,
    customFields,
    isLoading,
    error,
    refetch,
    createField,
    updateField,
    archiveField,
    addFromPreset,
    isCreating: createField.isPending,
    isUpdating: updateField.isPending,
    isArchiving: archiveField.isPending
  }
}

// ============================================================================
// HOOK: useResearchFieldPresets
// ============================================================================

export function useResearchFieldPresets() {
  const { data: presets = [], isLoading, error } = useQuery({
    queryKey: ['research-field-presets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_field_presets')
        .select('*')
        .order('category', { ascending: true })
        .order('name', { ascending: true })

      if (error) throw error
      return data as ResearchFieldPreset[]
    }
  })

  // Group presets by category
  const presetsByCategory = presets.reduce((acc, preset) => {
    const category = preset.category || 'other'
    if (!acc[category]) acc[category] = []
    acc[category].push(preset)
    return acc
  }, {} as Record<string, ResearchFieldPreset[]>)

  return { presets, presetsByCategory, isLoading, error }
}

// ============================================================================
// HOOK: useTeamResearchFields
// ============================================================================

export function useTeamResearchFields(teamId?: string) {
  const queryClient = useQueryClient()

  // Fetch team's configured fields
  const { data: teamFields = [], isLoading, error, refetch } = useQuery({
    queryKey: ['team-research-fields', teamId],
    queryFn: async () => {
      if (!teamId) return []

      const { data, error } = await supabase
        .from('team_research_fields')
        .select(`
          *,
          field:research_fields(
            *,
            section:research_sections(*)
          ),
          viewers:research_field_viewers(
            *,
            user:users(id, first_name, last_name)
          )
        `)
        .eq('team_id', teamId)
        .order('display_order', { ascending: true })

      if (error) throw error

      return (data || []).map(tf => ({
        ...tf,
        viewers: (tf.viewers || []).map((v: any) => ({
          ...v,
          user: v.user ? {
            ...v.user,
            full_name: [v.user.first_name, v.user.last_name].filter(Boolean).join(' ') || 'Unknown'
          } : undefined
        }))
      })) as TeamResearchField[]
    },
    enabled: !!teamId
  })

  // Active fields only
  const activeFields = teamFields.filter(tf => tf.is_active)

  // Required fields
  const requiredFields = teamFields.filter(tf => tf.is_required)

  // Add field to team
  const addFieldToTeam = useMutation({
    mutationFn: async ({ fieldId, displayOrder }: { fieldId: string; displayOrder?: number }) => {
      if (!teamId) throw new Error('No team selected')

      const { data, error } = await supabase
        .from('team_research_fields')
        .insert({
          team_id: teamId,
          field_id: fieldId,
          is_active: true,
          is_required: false,
          display_order: displayOrder ?? teamFields.length
        })
        .select(`
          *,
          field:research_fields(*, section:research_sections(*))
        `)
        .single()

      if (error) throw error
      return data as TeamResearchField
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-research-fields', teamId] })
    }
  })

  // Update team field configuration
  const updateTeamField = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TeamResearchField> & { id: string }) => {
      const { data, error } = await supabase
        .from('team_research_fields')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as TeamResearchField
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-research-fields', teamId] })
    }
  })

  // Remove field from team
  const removeFieldFromTeam = useMutation({
    mutationFn: async (teamFieldId: string) => {
      const { error } = await supabase
        .from('team_research_fields')
        .delete()
        .eq('id', teamFieldId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-research-fields', teamId] })
    }
  })

  // Reorder fields
  const reorderFields = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      // Update each field's display_order
      const updates = orderedIds.map((id, index) =>
        supabase
          .from('team_research_fields')
          .update({ display_order: index })
          .eq('id', id)
      )

      await Promise.all(updates)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-research-fields', teamId] })
    }
  })

  // Add viewer to team field
  const addViewer = useMutation({
    mutationFn: async ({ teamFieldId, userId }: { teamFieldId: string; userId: string }) => {
      const { data, error } = await supabase
        .from('research_field_viewers')
        .insert({
          team_field_id: teamFieldId,
          user_id: userId
        })
        .select(`
          *,
          user:users(id, first_name, last_name)
        `)
        .single()

      if (error) throw error
      return data as ResearchFieldViewer
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-research-fields', teamId] })
    }
  })

  // Remove viewer from team field
  const removeViewer = useMutation({
    mutationFn: async (viewerId: string) => {
      const { error } = await supabase
        .from('research_field_viewers')
        .delete()
        .eq('id', viewerId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-research-fields', teamId] })
    }
  })

  return {
    teamFields,
    activeFields,
    requiredFields,
    isLoading,
    error,
    refetch,
    addFieldToTeam,
    updateTeamField,
    removeFieldFromTeam,
    reorderFields,
    addViewer,
    removeViewer,
    isAdding: addFieldToTeam.isPending,
    isUpdating: updateTeamField.isPending,
    isRemoving: removeFieldFromTeam.isPending
  }
}

// ============================================================================
// HOOK: useUserTeams (for team selector)
// ============================================================================

export function useUserTeamsForResearch() {
  const { user } = useAuth()

  const { data: teams = [], isLoading, error } = useQuery({
    queryKey: ['user-teams-research', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('team_memberships')
        .select(`
          team_id,
          is_team_admin,
          team:teams(id, name, slug, color)
        `)
        .eq('user_id', user.id)

      if (error) throw error

      return (data || []).map(tm => ({
        id: tm.team?.id,
        name: tm.team?.name,
        slug: tm.team?.slug,
        color: tm.team?.color,
        isAdmin: tm.is_team_admin
      })).filter(t => t.id) as Array<{
        id: string
        name: string
        slug: string
        color: string | null
        isAdmin: boolean
      }>
    },
    enabled: !!user?.id
  })

  // Teams where user is admin
  const adminTeams = teams.filter(t => t.isAdmin)

  return { teams, adminTeams, isLoading, error }
}

// ============================================================================
// HOOK: useUserResearchLayout
// ============================================================================
// Returns the fields a user can see, organized by section
// Combines: universal fields + team fields from user's teams + explicit viewer access

export interface AccessibleField {
  field: ResearchField
  accessType: 'universal' | 'team_member' | 'viewer'
  teamId?: string
  teamName?: string
  isRequired: boolean
  displayOrder: number
}

export interface ResearchLayoutSection {
  section: ResearchSection
  fields: AccessibleField[]
}

export function useUserResearchLayout() {
  const { user } = useAuth()

  const { data, isLoading, error } = useQuery({
    queryKey: ['user-research-layout', user?.id],
    queryFn: async () => {
      if (!user?.id) return { sections: [], fields: [] }

      // 1. Get all sections for user's org
      const { data: sections, error: sectionsError } = await supabase
        .from('research_sections')
        .select('*')
        .order('display_order', { ascending: true })

      if (sectionsError) throw sectionsError

      // 2. Get ALL fields (visibility is controlled by user layout preferences, not is_universal)
      const { data: allFields, error: fieldsError } = await supabase
        .from('research_fields')
        .select('*, section:research_sections(*)')
        .eq('is_archived', false)

      if (fieldsError) throw fieldsError

      console.log('🔬 useUserResearchLayout - sections:', sections?.length, 'fields:', allFields?.length)
      console.log('🔬 Fields:', allFields?.map(f => ({ id: f.id, name: f.name, section: f.section?.slug })))

      // Build accessible fields list - all fields are accessible
      // Visibility is controlled by user's layout preferences in useUserAssetPagePreferences
      const accessibleFields: AccessibleField[] = (allFields || []).map(field => ({
        field: field as ResearchField,
        accessType: 'universal' as const,
        isRequired: false,
        displayOrder: 0
      }))

      // Group fields by section
      // Keep system sections (thesis, forecasts, supporting_docs) even if empty
      // because they use hardcoded components
      const systemSectionSlugs = ['thesis', 'forecasts', 'supporting_docs']

      const layoutSections: ResearchLayoutSection[] = (sections || []).map(section => {
        const sectionFields = accessibleFields
          .filter(af => af.field.section_id === section.id)
          .sort((a, b) => a.field.name.localeCompare(b.field.name))

        return {
          section: section as ResearchSection,
          fields: sectionFields
        }
      }).filter(ls => ls.fields.length > 0 || systemSectionSlugs.includes(ls.section.slug))

      return {
        sections: layoutSections,
        fields: accessibleFields
      }
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000 // 5 minutes
  })

  // Helper to check if user has access to a specific field
  const hasFieldAccess = (fieldSlug: string) => {
    return data?.fields.some(af => af.field.slug === fieldSlug) ?? false
  }

  // Get fields by section slug
  const getFieldsForSection = (sectionSlug: string) => {
    const section = data?.sections.find(s => s.section.slug === sectionSlug)
    return section?.fields || []
  }

  // Get contextual (non-universal) fields the user can see
  const contextualFields = data?.fields.filter(f => f.accessType !== 'universal') || []

  return {
    sections: data?.sections || [],
    fields: data?.fields || [],
    contextualFields,
    isLoading,
    error,
    hasFieldAccess,
    getFieldsForSection
  }
}

// ============================================================================
// HOOK: useDiscoverableFields
// ============================================================================
// Returns fields the user can see exist but doesn't have access to

export interface DiscoverableField {
  field: ResearchField
  teamId: string
  teamName: string
  canRequestAccess: boolean
  pendingRequest?: {
    id: string
    status: string
    createdAt: string
  }
}

export function useDiscoverableFields() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['discoverable-fields', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // Get user's team IDs
      const { data: teamMemberships } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)

      const userTeamIds = new Set((teamMemberships || []).map(tm => tm.team_id))

      // Get all team research fields the user can "discover" but not access
      // These are contextual fields from other teams in the same org
      const { data: allTeamFields, error: fieldsError } = await supabase
        .from('team_research_fields')
        .select(`
          id,
          team_id,
          field_id,
          is_active,
          field:research_fields(*, section:research_sections(*)),
          team:teams(id, name, organization_id)
        `)
        .eq('is_active', true)

      if (fieldsError) throw fieldsError

      // Get user's pending access requests
      const { data: pendingRequests } = await supabase
        .from('research_field_access_requests')
        .select('team_field_id, id, status, created_at')
        .eq('user_id', user.id)
        .in('status', ['pending'])

      const requestsByTeamFieldId = new Map(
        (pendingRequests || []).map(r => [r.team_field_id, r])
      )

      // Get fields user already has viewer access to
      const { data: viewerAccess } = await supabase
        .from('research_field_viewers')
        .select('team_field_id')
        .eq('user_id', user.id)

      const viewerAccessIds = new Set((viewerAccess || []).map(v => v.team_field_id))

      // Filter to contextual fields user doesn't have access to
      const discoverableFields: DiscoverableField[] = []

      for (const tf of (allTeamFields || [])) {
        // Skip if:
        // - Field is universal (everyone has access)
        // - User is on this team
        // - User already has viewer access
        if (
          tf.field?.is_universal ||
          userTeamIds.has(tf.team_id) ||
          viewerAccessIds.has(tf.id)
        ) {
          continue
        }

        // Check if field is from same org
        // (We'd need org membership check here - for now include all)

        const pendingRequest = requestsByTeamFieldId.get(tf.id)

        discoverableFields.push({
          field: tf.field as ResearchField,
          teamId: tf.team_id,
          teamName: tf.team?.name || 'Unknown Team',
          canRequestAccess: !pendingRequest,
          pendingRequest: pendingRequest ? {
            id: pendingRequest.id,
            status: pendingRequest.status,
            createdAt: pendingRequest.created_at
          } : undefined
        })
      }

      return discoverableFields
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000
  })

  // Request access mutation
  const requestAccess = useMutation({
    mutationFn: async ({ teamFieldId, reason }: { teamFieldId: string; reason?: string }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // First find the team_research_field
      const { data: teamField } = await supabase
        .from('team_research_fields')
        .select('id, field:research_fields(name)')
        .eq('field_id', teamFieldId)
        .single()

      if (!teamField) throw new Error('Field configuration not found')

      const { data, error } = await supabase
        .from('research_field_access_requests')
        .insert({
          team_field_id: teamField.id,
          user_id: user.id,
          request_reason: reason || null
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discoverable-fields'] })
    }
  })

  // Cancel request mutation
  const cancelRequest = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from('research_field_access_requests')
        .delete()
        .eq('id', requestId)
        .eq('user_id', user?.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discoverable-fields'] })
    }
  })

  // Group by section
  const discoverableBySection = (data || []).reduce((acc, df) => {
    const sectionSlug = df.field.section?.slug || 'unknown'
    if (!acc[sectionSlug]) acc[sectionSlug] = []
    acc[sectionSlug].push(df)
    return acc
  }, {} as Record<string, DiscoverableField[]>)

  return {
    discoverableFields: data || [],
    discoverableBySection,
    isLoading,
    error,
    refetch,
    requestAccess,
    cancelRequest,
    isRequesting: requestAccess.isPending
  }
}

// ============================================================================
// HOOK: usePendingAccessRequests (for team admins)
// ============================================================================

export interface AccessRequest {
  id: string
  user: {
    id: string
    firstName: string | null
    lastName: string | null
    fullName: string
  }
  field: ResearchField
  teamFieldId: string
  reason: string | null
  status: string
  createdAt: string
}

export function usePendingAccessRequests(teamId?: string) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: requests = [], isLoading, error } = useQuery({
    queryKey: ['access-requests', teamId],
    queryFn: async () => {
      if (!teamId) return []

      // Verify user is team admin
      const { data: membership } = await supabase
        .from('team_memberships')
        .select('is_team_admin')
        .eq('team_id', teamId)
        .eq('user_id', user?.id)
        .single()

      if (!membership?.is_team_admin) return []

      const { data, error } = await supabase
        .from('research_field_access_requests')
        .select(`
          id,
          request_reason,
          status,
          created_at,
          user:users(id, first_name, last_name),
          team_field:team_research_fields(
            id,
            field:research_fields(*)
          )
        `)
        .eq('team_field.team_id', teamId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (error) throw error

      return (data || []).map(r => ({
        id: r.id,
        user: {
          id: r.user?.id,
          firstName: r.user?.first_name,
          lastName: r.user?.last_name,
          fullName: [r.user?.first_name, r.user?.last_name].filter(Boolean).join(' ') || 'Unknown'
        },
        field: r.team_field?.field as ResearchField,
        teamFieldId: r.team_field?.id,
        reason: r.request_reason,
        status: r.status,
        createdAt: r.created_at
      })) as AccessRequest[]
    },
    enabled: !!teamId && !!user?.id
  })

  // Approve request
  const approveRequest = useMutation({
    mutationFn: async (requestId: string) => {
      const request = requests.find(r => r.id === requestId)
      if (!request) throw new Error('Request not found')

      // Add viewer access
      await supabase
        .from('research_field_viewers')
        .insert({
          team_field_id: request.teamFieldId,
          user_id: request.user.id,
          granted_by: user?.id
        })

      // Update request status
      const { error } = await supabase
        .from('research_field_access_requests')
        .update({
          status: 'approved',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', requestId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] })
      queryClient.invalidateQueries({ queryKey: ['team-research-fields'] })
    }
  })

  // Deny request
  const denyRequest = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from('research_field_access_requests')
        .update({
          status: 'denied',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', requestId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] })
    }
  })

  return {
    requests,
    isLoading,
    error,
    approveRequest,
    denyRequest,
    isApproving: approveRequest.isPending,
    isDenying: denyRequest.isPending
  }
}
