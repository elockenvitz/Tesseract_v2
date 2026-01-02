import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface TemplateTag {
  id: string
  name: string
  color: string
  user_id: string
  created_at: string
}

interface CreateTagData {
  name: string
  color?: string
}

interface UpdateTagData {
  name?: string
  color?: string
}

// Predefined tag colors
export const TAG_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6b7280', // gray
]

export function useTemplateTags() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all tags for the current user
  const { data: tags = [], isLoading, error } = useQuery({
    queryKey: ['template-tags', user?.id],
    queryFn: async () => {
      if (!user) return []

      const { data, error } = await supabase
        .from('template_tags')
        .select('*')
        .eq('user_id', user.id)
        .order('name', { ascending: true })

      if (error) throw error
      return (data || []) as TemplateTag[]
    },
    enabled: !!user
  })

  // Create a new tag
  const createTag = useMutation({
    mutationFn: async (data: CreateTagData) => {
      if (!user) throw new Error('Not authenticated')

      const { data: tag, error } = await supabase
        .from('template_tags')
        .insert({
          name: data.name,
          color: data.color || TAG_COLORS[0],
          user_id: user.id
        })
        .select()
        .single()

      if (error) throw error
      return tag as TemplateTag
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template-tags'] })
    }
  })

  // Update a tag
  const updateTag = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTagData }) => {
      const { data: tag, error } = await supabase
        .from('template_tags')
        .update(data)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return tag as TemplateTag
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template-tags'] })
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Delete a tag
  const deleteTag = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('template_tags')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template-tags'] })
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Find or create a tag by name
  const findOrCreateTag = async (name: string, color?: string): Promise<TemplateTag> => {
    // Check if tag exists
    const existingTag = tags.find(t => t.name.toLowerCase() === name.toLowerCase())
    if (existingTag) return existingTag

    // Create new tag
    return await createTag.mutateAsync({ name, color })
  }

  // Get a random color that hasn't been used recently
  const getNextColor = (): string => {
    const usedColors = new Set(tags.map(t => t.color))
    const availableColors = TAG_COLORS.filter(c => !usedColors.has(c))

    if (availableColors.length > 0) {
      return availableColors[0]
    }

    // All colors used, pick randomly
    return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]
  }

  return {
    tags,
    isLoading,
    error,
    createTag: createTag.mutateAsync,
    updateTag: (id: string, data: UpdateTagData) => updateTag.mutateAsync({ id, data }),
    deleteTag: deleteTag.mutateAsync,
    findOrCreateTag,
    getNextColor,
    isCreating: createTag.isPending,
    isUpdating: updateTag.isPending,
    isDeleting: deleteTag.isPending
  }
}

// Get all unique tags used across all templates (for filtering)
export function useAllTemplateTags() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['all-template-tags', user?.id],
    queryFn: async () => {
      if (!user) return []

      const { data, error } = await supabase
        .from('template_tags')
        .select(`
          *,
          template_tag_assignments(template_id)
        `)
        .eq('user_id', user.id)
        .order('name', { ascending: true })

      if (error) throw error

      // Add usage count
      return (data || []).map(tag => ({
        ...tag,
        usageCount: tag.template_tag_assignments?.length || 0,
        template_tag_assignments: undefined
      })) as (TemplateTag & { usageCount: number })[]
    },
    enabled: !!user
  })
}
