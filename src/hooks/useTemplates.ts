import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface TemplateVariable {
  name: string
  default?: string
  isDynamic?: boolean      // true for {{.price}} style variables
  command?: string         // 'price', 'chart.price' etc.
  explicitSymbol?: string  // 'AAPL' for {{.price:AAPL}}
}

export interface TemplateTag {
  id: string
  name: string
  color: string
}

export interface TemplateCollaboration {
  id: string
  user_id: string | null
  team_id: string | null
  permission: 'view' | 'edit' | 'admin'
  user?: { id: string; email: string; first_name?: string; last_name?: string }
  team?: { id: string; name: string }
}

export interface Template {
  id: string
  user_id: string
  name: string
  content: string
  content_html: string | null
  description: string | null
  variables: TemplateVariable[]
  category: string
  shortcut: string | null
  is_shared: boolean
  is_favorite: boolean
  usage_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
  // Joined data
  tags?: TemplateTag[]
  collaborations?: TemplateCollaboration[]
  permission?: 'owner' | 'view' | 'edit' | 'admin'
}

interface CreateTemplateData {
  name: string
  content: string
  content_html?: string
  description?: string
  variables?: TemplateVariable[]
  category?: string
  shortcut?: string | null
  is_shared?: boolean
  tag_ids?: string[]
}

interface UpdateTemplateData {
  name?: string
  content?: string
  content_html?: string
  description?: string
  variables?: TemplateVariable[]
  category?: string
  shortcut?: string | null
  is_shared?: boolean
  is_favorite?: boolean
  tag_ids?: string[]
}

export function useTemplates() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all templates (user's own + shared)
  const { data: templates = [], isLoading, error } = useQuery({
    queryKey: ['templates', user?.id],
    queryFn: async () => {
      if (!user) return []

      // First try with tags (if tables exist), fallback to basic query
      let data: any[] = []
      let queryError: any = null

      // Try fetching with tags
      const tagsResult = await supabase
        .from('text_templates')
        .select(`
          *,
          template_tag_assignments(
            tag:template_tags(id, name, color)
          )
        `)
        .or(`user_id.eq.${user.id},is_shared.eq.true`)
        .order('usage_count', { ascending: false })
        .order('name', { ascending: true })

      if (tagsResult.error) {
        // Tags tables might not exist yet, fallback to basic query
        console.log('Tags query failed, using basic query:', tagsResult.error.message)
        const basicResult = await supabase
          .from('text_templates')
          .select('*')
          .or(`user_id.eq.${user.id},is_shared.eq.true`)
          .order('usage_count', { ascending: false })
          .order('name', { ascending: true })

        if (basicResult.error) {
          queryError = basicResult.error
        } else {
          data = basicResult.data || []
        }
      } else {
        data = tagsResult.data || []
      }

      if (queryError) throw queryError

      // Transform the data to flatten tags
      const templatesWithTags = data.map((t: any) => ({
        ...t,
        tags: t.template_tag_assignments
          ?.map((ta: any) => ta.tag)
          .filter(Boolean) || [],
        template_tag_assignments: undefined,
        permission: t.user_id === user.id ? 'owner' : undefined
      })) as Template[]

      return templatesWithTags
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
          content_html: data.content_html || null,
          description: data.description || null,
          variables: data.variables || [],
          category: data.category || 'general',
          shortcut: data.shortcut || null,
          is_shared: data.is_shared || false
        })
        .select()
        .single()

      if (error) throw error

      // Add tag assignments if provided
      if (data.tag_ids && data.tag_ids.length > 0) {
        await supabase
          .from('template_tag_assignments')
          .insert(data.tag_ids.map(tag_id => ({
            template_id: template.id,
            tag_id
          })))
      }

      return template as Template
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Update template
  const updateTemplate = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTemplateData }) => {
      const { tag_ids, ...updateData } = data

      const { data: template, error } = await supabase
        .from('text_templates')
        .update(updateData)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      // Update tag assignments if provided
      if (tag_ids !== undefined) {
        // Remove existing assignments
        await supabase
          .from('template_tag_assignments')
          .delete()
          .eq('template_id', id)

        // Add new assignments
        if (tag_ids.length > 0) {
          await supabase
            .from('template_tag_assignments')
            .insert(tag_ids.map(tag_id => ({
              template_id: id,
              tag_id
            })))
        }
      }

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

  // Record template usage (increment usage_count and update last_used_at)
  const recordUsage = useMutation({
    mutationFn: async (id: string) => {
      // Try the new RPC function first
      const { error } = await supabase
        .rpc('record_template_usage', { p_template_id: id })

      // Fall back to manual update if RPC doesn't exist
      if (error) {
        await supabase
          .from('text_templates')
          .update({
            usage_count: supabase.rpc('increment', { row_id: id }) as any,
            last_used_at: new Date().toISOString()
          })
          .eq('id', id)

        // If that also fails, do a read-modify-write
        const { data: template } = await supabase
          .from('text_templates')
          .select('usage_count')
          .eq('id', id)
          .single()

        if (template) {
          await supabase
            .from('text_templates')
            .update({
              usage_count: (template.usage_count || 0) + 1,
              last_used_at: new Date().toISOString()
            })
            .eq('id', id)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  // Toggle favorite status
  const toggleFavorite = useMutation({
    mutationFn: async (id: string) => {
      // Try RPC function first
      const { data, error } = await supabase
        .rpc('toggle_template_favorite', { p_template_id: id })

      if (error) {
        // Fall back to manual toggle
        const template = templates.find(t => t.id === id)
        if (template) {
          await supabase
            .from('text_templates')
            .update({ is_favorite: !template.is_favorite })
            .eq('id', id)
        }
      }

      return data
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
  const sharedTemplates = templates.filter(t => t.user_id !== user?.id)

  // Get favorite templates
  const favoriteTemplates = templates.filter(t => t.is_favorite)

  // Get recently used templates (last 10, sorted by last_used_at)
  const recentlyUsedTemplates = [...templates]
    .filter(t => t.last_used_at)
    .sort((a, b) => {
      const aDate = a.last_used_at ? new Date(a.last_used_at).getTime() : 0
      const bDate = b.last_used_at ? new Date(b.last_used_at).getTime() : 0
      return bDate - aDate
    })
    .slice(0, 10)

  // Get unique categories
  const categories = [...new Set(templates.map(t => t.category))]

  // Get templates by tag
  const getByTag = (tagId: string): Template[] => {
    return templates.filter(t => t.tags?.some(tag => tag.id === tagId))
  }

  // Advanced search with filters
  const searchTemplatesAdvanced = (options: {
    query?: string
    category?: string
    tagIds?: string[]
    onlyFavorites?: boolean
    onlyMine?: boolean
    onlyShared?: boolean
  }): Template[] => {
    let results = templates

    if (options.query?.trim()) {
      const lowerQuery = options.query.toLowerCase()
      results = results.filter(t =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.content.toLowerCase().includes(lowerQuery) ||
        t.description?.toLowerCase().includes(lowerQuery)
      )
    }

    if (options.category) {
      results = results.filter(t => t.category === options.category)
    }

    if (options.tagIds && options.tagIds.length > 0) {
      results = results.filter(t =>
        options.tagIds!.some(tagId => t.tags?.some(tag => tag.id === tagId))
      )
    }

    if (options.onlyFavorites) {
      results = results.filter(t => t.is_favorite)
    }

    if (options.onlyMine) {
      results = results.filter(t => t.user_id === user?.id)
    }

    if (options.onlyShared) {
      results = results.filter(t => t.user_id !== user?.id)
    }

    return results
  }

  return {
    templates,
    myTemplates,
    sharedTemplates,
    favoriteTemplates,
    recentlyUsedTemplates,
    templatesWithShortcuts,
    categories,
    isLoading,
    error,
    createTemplate: createTemplate.mutateAsync,
    updateTemplate: (id: string, data: UpdateTemplateData) => updateTemplate.mutateAsync({ id, data }),
    deleteTemplate: deleteTemplate.mutateAsync,
    recordUsage: recordUsage.mutate,
    toggleFavorite: toggleFavorite.mutate,
    searchTemplates,
    searchTemplatesAdvanced,
    getByCategory,
    getByShortcut,
    getByTag,
    isCreating: createTemplate.isPending,
    isUpdating: updateTemplate.isPending,
    isDeleting: deleteTemplate.isPending,
    isTogglingFavorite: toggleFavorite.isPending
  }
}

// Apply template variables to content
export function applyTemplateVariables(
  content: string,
  variables: TemplateVariable[],
  values: Record<string, string> = {}
): string {
  let result = content

  // Apply standard variables
  variables.filter(v => !v.isDynamic).forEach(variable => {
    const value = values[variable.name] ?? variable.default ?? ''
    const regex = new RegExp(`\\{\\{\\s*${variable.name}\\s*\\}\\}`, 'g')
    result = result.replace(regex, value)
  })

  return result
}

// Standard variable pattern: {{variableName}}
const STANDARD_VAR_REGEX = /\{\{\s*(\w+)\s*\}\}/g

// Dynamic variable pattern: {{.command}} or {{.command:SYMBOL}}
// Examples: {{.price}}, {{.price:AAPL}}, {{.chart.price}}, {{.chart.price:MSFT}}
const DYNAMIC_VAR_REGEX = /\{\{\.(\w+(?:\.\w+)?)(?::([A-Z0-9]+))?\}\}/g

// Extract variables from template content
export function extractVariables(content: string): TemplateVariable[] {
  const variables: TemplateVariable[] = []
  const seen = new Set<string>()

  // Extract standard variables {{name}}
  let match
  const standardRegex = new RegExp(STANDARD_VAR_REGEX.source, 'g')
  while ((match = standardRegex.exec(content)) !== null) {
    const name = match[1]
    // Skip if it looks like a dynamic variable (starts with .)
    if (!seen.has(name) && !name.startsWith('.')) {
      seen.add(name)
      variables.push({ name, isDynamic: false })
    }
  }

  // Extract dynamic variables {{.command}} or {{.command:SYMBOL}}
  const dynamicRegex = new RegExp(DYNAMIC_VAR_REGEX.source, 'g')
  while ((match = dynamicRegex.exec(content)) !== null) {
    const command = match[1]
    const explicitSymbol = match[2]
    const key = explicitSymbol ? `.${command}:${explicitSymbol}` : `.${command}`

    if (!seen.has(key)) {
      seen.add(key)
      variables.push({
        name: key,
        isDynamic: true,
        command,
        explicitSymbol
      })
    }
  }

  return variables
}

// Check if a variable is a dynamic command
export function isDynamicVariable(variable: TemplateVariable): boolean {
  return variable.isDynamic === true
}

// Get the display name for a variable
export function getVariableDisplayName(variable: TemplateVariable): string {
  if (variable.isDynamic) {
    return variable.explicitSymbol
      ? `.${variable.command}:${variable.explicitSymbol}`
      : `.${variable.command}`
  }
  return variable.name
}

// Convert dynamic variables in HTML content to data nodes
// This is used when applying a template to insert live data
export function processDynamicVariables(
  html: string,
  contextSymbol?: string
): string {
  // Replace {{.command}} with context symbol
  let result = html.replace(
    /\{\{\.(\w+(?:\.\w+)?)\}\}/g,
    (_, command) => {
      if (!contextSymbol) {
        return `{{.${command}}}` // Keep as-is if no context
      }
      // Convert to a data-value span that can be processed
      return `<span data-type="dynamicData" data-command="${command}" data-symbol="${contextSymbol}"></span>`
    }
  )

  // Replace {{.command:SYMBOL}} with explicit symbol
  result = result.replace(
    /\{\{\.(\w+(?:\.\w+)?):([A-Z0-9]+)\}\}/g,
    (_, command, symbol) => {
      return `<span data-type="dynamicData" data-command="${command}" data-symbol="${symbol}"></span>`
    }
  )

  return result
}
