import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface TemplateVariable {
  name: string
  default?: string
}

export interface Template {
  id: string
  user_id: string
  name: string
  content: string
  variables: TemplateVariable[]
  category: string
  shortcut: string | null
  is_shared: boolean
  usage_count: number
  created_at: string
  updated_at: string
}

interface CreateTemplateData {
  name: string
  content: string
  variables?: TemplateVariable[]
  category?: string
  shortcut?: string | null
  is_shared?: boolean
}

interface UpdateTemplateData {
  name?: string
  content?: string
  variables?: TemplateVariable[]
  category?: string
  shortcut?: string | null
  is_shared?: boolean
}

export function useTemplates() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all templates (user's own + shared)
  const { data: templates = [], isLoading, error } = useQuery({
    queryKey: ['templates', user?.id],
    queryFn: async () => {
      if (!user) return []

      const { data, error } = await supabase
        .from('text_templates')
        .select('*')
        .or(`user_id.eq.${user.id},is_shared.eq.true`)
        .order('usage_count', { ascending: false })
        .order('name', { ascending: true })

      if (error) throw error
      return (data || []) as Template[]
    },
    enabled: !!user
  })

  // Create template
  const createTemplate = useMutation({
    mutationFn: async (data: CreateTemplateData) => {
      if (!user) throw new Error('Not authenticated')

      const { data: template, error } = await supabase
        .from('text_templates')
        .insert({
          user_id: user.id,
          name: data.name,
          content: data.content,
          variables: data.variables || [],
          category: data.category || 'general',
          shortcut: data.shortcut || null,
          is_shared: data.is_shared || false
        })
        .select()
        .single()

      if (error) throw error
      return template as Template
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Update template
  const updateTemplate = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTemplateData }) => {
      const { data: template, error } = await supabase
        .from('text_templates')
        .update(data)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return template as Template
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Delete template
  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('text_templates')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Record template usage (increment usage_count)
  const recordUsage = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .rpc('increment_template_usage', { template_id: id })
        .single()

      // If RPC doesn't exist, fall back to manual increment
      if (error) {
        const { data: template } = await supabase
          .from('text_templates')
          .select('usage_count')
          .eq('id', id)
          .single()

        if (template) {
          await supabase
            .from('text_templates')
            .update({ usage_count: (template.usage_count || 0) + 1 })
            .eq('id', id)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Search templates by name or content
  const searchTemplates = (query: string): Template[] => {
    if (!query.trim()) return templates
    const lowerQuery = query.toLowerCase()
    return templates.filter(t =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.content.toLowerCase().includes(lowerQuery)
    )
  }

  // Get templates by category
  const getByCategory = (category: string): Template[] => {
    return templates.filter(t => t.category === category)
  }

  // Get template by shortcut
  const getByShortcut = (shortcut: string): Template | undefined => {
    return templates.find(t => t.shortcut?.toLowerCase() === shortcut.toLowerCase())
  }

  // Get all templates with shortcuts
  const templatesWithShortcuts = templates.filter(t => t.shortcut)

  // Get user's own templates
  const myTemplates = templates.filter(t => t.user_id === user?.id)

  // Get shared templates (not owned by current user)
  const sharedTemplates = templates.filter(t => t.user_id !== user?.id && t.is_shared)

  // Get unique categories
  const categories = [...new Set(templates.map(t => t.category))]

  return {
    templates,
    myTemplates,
    sharedTemplates,
    templatesWithShortcuts,
    categories,
    isLoading,
    error,
    createTemplate: createTemplate.mutateAsync,
    updateTemplate: (id: string, data: UpdateTemplateData) => updateTemplate.mutateAsync({ id, data }),
    deleteTemplate: deleteTemplate.mutateAsync,
    recordUsage: recordUsage.mutate,
    searchTemplates,
    getByCategory,
    getByShortcut,
    isCreating: createTemplate.isPending,
    isUpdating: updateTemplate.isPending,
    isDeleting: deleteTemplate.isPending
  }
}

// Apply template variables to content
export function applyTemplateVariables(
  content: string,
  variables: TemplateVariable[],
  values: Record<string, string> = {}
): string {
  let result = content

  variables.forEach(variable => {
    const value = values[variable.name] ?? variable.default ?? ''
    const regex = new RegExp(`\\{\\{\\s*${variable.name}\\s*\\}\\}`, 'g')
    result = result.replace(regex, value)
  })

  return result
}

// Extract variables from template content (finds {{variableName}} patterns)
export function extractVariables(content: string): TemplateVariable[] {
  const regex = /\{\{\s*(\w+)\s*\}\}/g
  const variables: TemplateVariable[] = []
  const seen = new Set<string>()

  let match
  while ((match = regex.exec(content)) !== null) {
    const name = match[1]
    if (!seen.has(name)) {
      seen.add(name)
      variables.push({ name })
    }
  }

  return variables
}
