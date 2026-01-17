import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import {
  InvestmentCaseTemplate,
  CreateInvestmentCaseTemplateData,
  UpdateInvestmentCaseTemplateData,
  mergeWithDefaults,
  DEFAULT_COVER_CONFIG,
  DEFAULT_STYLE_CONFIG,
  DEFAULT_BRANDING_CONFIG,
  DEFAULT_HEADER_FOOTER_CONFIG,
  DEFAULT_TOC_CONFIG
} from '../types/investmentCaseTemplates'

export function useInvestmentCaseTemplates() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all templates (user's own + shared org templates)
  const { data: templates = [], isLoading, error, refetch } = useQuery({
    queryKey: ['investment-case-templates', user?.id],
    queryFn: async () => {
      if (!user) return []

      // Fetch user's own templates
      const { data: ownTemplates, error: ownError } = await supabase
        .from('investment_case_templates')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })

      if (ownError) throw ownError

      // Fetch shared templates from user's organization
      const { data: orgMemberships } = await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('status', 'active')

      const orgIds = orgMemberships?.map(m => m.organization_id) || []

      let sharedTemplates: any[] = []
      if (orgIds.length > 0) {
        const { data: shared, error: sharedError } = await supabase
          .from('investment_case_templates')
          .select('*')
          .eq('is_shared', true)
          .in('organization_id', orgIds)
          .neq('user_id', user.id)
          .order('updated_at', { ascending: false })

        if (sharedError) {
          console.error('Error fetching shared templates:', sharedError)
        } else {
          sharedTemplates = shared || []
        }
      }

      // Combine and dedupe (own templates first)
      const allTemplates = [...(ownTemplates || []), ...sharedTemplates]
      const uniqueTemplates = allTemplates.filter((t, i, arr) =>
        arr.findIndex(x => x.id === t.id) === i
      )

      // Merge each template with defaults to ensure all fields are present
      return uniqueTemplates.map(t => mergeWithDefaults(t)) as InvestmentCaseTemplate[]
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000 // 30 minutes
  })

  // Separate my templates and shared templates
  const myTemplates = templates.filter(t => t.user_id === user?.id)
  const sharedTemplates = templates.filter(t => t.user_id !== user?.id)

  // Get user's default template
  const defaultTemplate = templates.find(t => t.is_default && t.user_id === user?.id)

  // Create a new template
  const createTemplate = useMutation({
    mutationFn: async (data: CreateInvestmentCaseTemplateData) => {
      if (!user) throw new Error('Not authenticated')

      // Get user's organization for sharing
      let organizationId = null
      if (data.is_shared) {
        const { data: membership } = await supabase
          .from('organization_memberships')
          .select('organization_id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .single()

        organizationId = membership?.organization_id
      }

      const { data: template, error } = await supabase
        .from('investment_case_templates')
        .insert({
          user_id: user.id,
          name: data.name,
          description: data.description || null,
          organization_id: organizationId,
          is_shared: data.is_shared || false,
          is_default: data.is_default || false,
          cover_config: { ...DEFAULT_COVER_CONFIG, ...data.cover_config },
          style_config: { ...DEFAULT_STYLE_CONFIG, ...data.style_config },
          branding_config: { ...DEFAULT_BRANDING_CONFIG, ...data.branding_config },
          header_footer_config: { ...DEFAULT_HEADER_FOOTER_CONFIG, ...data.header_footer_config },
          section_config: data.section_config || [],
          toc_config: { ...DEFAULT_TOC_CONFIG, ...data.toc_config }
        })
        .select()
        .single()

      if (error) throw error
      return mergeWithDefaults(template)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investment-case-templates'] })
    }
  })

  // Update a template
  const updateTemplate = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateInvestmentCaseTemplateData }) => {
      if (!user) throw new Error('Not authenticated')

      // Build update object
      const updateData: any = {}

      if (data.name !== undefined) updateData.name = data.name
      if (data.description !== undefined) updateData.description = data.description
      if (data.is_shared !== undefined) {
        updateData.is_shared = data.is_shared

        // Set/clear organization_id based on sharing
        if (data.is_shared) {
          const { data: membership } = await supabase
            .from('organization_memberships')
            .select('organization_id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .single()

          updateData.organization_id = membership?.organization_id || null
        } else {
          updateData.organization_id = null
        }
      }
      if (data.is_default !== undefined) updateData.is_default = data.is_default
      if (data.cover_config !== undefined) updateData.cover_config = data.cover_config
      if (data.style_config !== undefined) updateData.style_config = data.style_config
      if (data.branding_config !== undefined) updateData.branding_config = data.branding_config
      if (data.header_footer_config !== undefined) updateData.header_footer_config = data.header_footer_config
      if (data.section_config !== undefined) updateData.section_config = data.section_config
      if (data.toc_config !== undefined) updateData.toc_config = data.toc_config

      const { data: template, error } = await supabase
        .from('investment_case_templates')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single()

      if (error) throw error
      return mergeWithDefaults(template)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investment-case-templates'] })
    }
  })

  // Delete a template
  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated')

      // First delete any associated logo file
      const template = templates.find(t => t.id === id)
      if (template?.branding_config.logoPath) {
        await supabase.storage
          .from('template-branding')
          .remove([template.branding_config.logoPath])
      }

      const { error } = await supabase
        .from('investment_case_templates')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investment-case-templates'] })
    }
  })

  // Duplicate a template
  const duplicateTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      if (!user) throw new Error('Not authenticated')

      const template = templates.find(t => t.id === templateId)
      if (!template) throw new Error('Template not found')

      // Create a copy with reset metadata
      const { data: newTemplate, error } = await supabase
        .from('investment_case_templates')
        .insert({
          user_id: user.id,
          name: `${template.name} (Copy)`,
          description: template.description,
          organization_id: null,
          is_shared: false,
          is_default: false,
          cover_config: template.cover_config,
          style_config: template.style_config,
          branding_config: {
            ...template.branding_config,
            logoPath: null // Don't copy logo - user needs to re-upload
          },
          header_footer_config: template.header_footer_config,
          section_config: template.section_config,
          toc_config: template.toc_config
        })
        .select()
        .single()

      if (error) throw error
      return mergeWithDefaults(newTemplate)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investment-case-templates'] })
    }
  })

  // Set as default template
  const setDefaultTemplate = useMutation({
    mutationFn: async (templateId: string | null) => {
      if (!user) throw new Error('Not authenticated')

      if (templateId) {
        // The trigger will automatically unset other defaults
        const { error } = await supabase
          .from('investment_case_templates')
          .update({ is_default: true })
          .eq('id', templateId)
          .eq('user_id', user.id)

        if (error) throw error
      } else {
        // Clear default - unset all
        const { error } = await supabase
          .from('investment_case_templates')
          .update({ is_default: false })
          .eq('user_id', user.id)
          .eq('is_default', true)

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investment-case-templates'] })
    }
  })

  // Upload logo
  const uploadLogo = useMutation({
    mutationFn: async ({ templateId, file }: { templateId: string; file: File }) => {
      if (!user) throw new Error('Not authenticated')

      // Generate storage path
      const randomId = Math.random().toString(36).substring(2, 10)
      const extension = file.name.split('.').pop() || 'png'
      const storagePath = `${user.id}/${templateId}_${randomId}.${extension}`

      // Upload file
      const { error: uploadError } = await supabase.storage
        .from('template-branding')
        .upload(storagePath, file)

      if (uploadError) throw uploadError

      // Update template with logo path
      const { data: template, error: updateError } = await supabase
        .from('investment_case_templates')
        .update({
          branding_config: supabase.rpc('jsonb_set', {
            target: 'branding_config',
            path: ['logoPath'],
            value: storagePath
          })
        })
        .eq('id', templateId)
        .eq('user_id', user.id)
        .select()
        .single()

      // If jsonb_set doesn't work, try direct update
      if (updateError) {
        const existingTemplate = templates.find(t => t.id === templateId)
        if (existingTemplate) {
          const { data: template2, error: error2 } = await supabase
            .from('investment_case_templates')
            .update({
              branding_config: {
                ...existingTemplate.branding_config,
                logoPath: storagePath
              }
            })
            .eq('id', templateId)
            .eq('user_id', user.id)
            .select()
            .single()

          if (error2) throw error2
          return { template: mergeWithDefaults(template2), storagePath }
        }
        throw updateError
      }

      return { template: mergeWithDefaults(template), storagePath }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investment-case-templates'] })
    }
  })

  // Delete logo
  const deleteLogo = useMutation({
    mutationFn: async (templateId: string) => {
      if (!user) throw new Error('Not authenticated')

      const template = templates.find(t => t.id === templateId)
      if (!template?.branding_config.logoPath) return

      // Delete file from storage
      await supabase.storage
        .from('template-branding')
        .remove([template.branding_config.logoPath])

      // Update template to clear logo path
      const { error } = await supabase
        .from('investment_case_templates')
        .update({
          branding_config: {
            ...template.branding_config,
            logoPath: null
          }
        })
        .eq('id', templateId)
        .eq('user_id', user.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investment-case-templates'] })
    }
  })

  // Record usage (increment count and update last_used_at)
  const recordUsage = useMutation({
    mutationFn: async (templateId: string) => {
      await supabase.rpc('record_investment_case_template_usage', {
        p_template_id: templateId
      })
    },
    onSuccess: () => {
      // Don't invalidate immediately to avoid UI flicker
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['investment-case-templates'] })
      }, 2000)
    }
  })

  // Get signed URL for logo
  const getLogoUrl = async (logoPath: string): Promise<string | null> => {
    if (!logoPath) return null

    const { data, error } = await supabase.storage
      .from('template-branding')
      .createSignedUrl(logoPath, 60 * 60) // 1 hour

    if (error) {
      console.error('Error getting logo URL:', error)
      return null
    }

    return data.signedUrl
  }

  return {
    templates,
    myTemplates,
    sharedTemplates,
    defaultTemplate,
    isLoading,
    error,
    refetch,
    createTemplate: createTemplate.mutateAsync,
    updateTemplate: (id: string, data: UpdateInvestmentCaseTemplateData) =>
      updateTemplate.mutateAsync({ id, data }),
    deleteTemplate: deleteTemplate.mutateAsync,
    duplicateTemplate: duplicateTemplate.mutateAsync,
    setDefaultTemplate: setDefaultTemplate.mutateAsync,
    uploadLogo: uploadLogo.mutateAsync,
    deleteLogo: deleteLogo.mutateAsync,
    recordUsage: recordUsage.mutate,
    getLogoUrl,
    isCreating: createTemplate.isPending,
    isUpdating: updateTemplate.isPending,
    isDeleting: deleteTemplate.isPending,
    isDuplicating: duplicateTemplate.isPending,
    isUploadingLogo: uploadLogo.isPending,
    isDeletingLogo: deleteLogo.isPending
  }
}
