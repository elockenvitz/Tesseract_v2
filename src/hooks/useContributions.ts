import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAIConfig } from './useAIConfig'
import {
  findOrCreateRevision,
  addRevisionEvents,
  sectionToCategory,
  getSignificanceTier,
} from '../lib/revision-service'

export type ContributionVisibility = 'portfolio' | 'team' | 'department' | 'division' | 'firm'

export interface VisibilityTarget {
  id: string
  node_id: string
  node?: {
    id: string
    name: string
    color: string | null
    node_type: string
  }
}

export interface ContributionAttachment {
  type: 'link' | 'note' | 'file'
  title: string
  url?: string
  noteId?: string
  fileId?: string
  filePath?: string
  fileType?: string // e.g., 'pdf', 'xlsx', 'docx'
  addedAt?: string
}

export interface Contribution {
  id: string
  asset_id: string
  section: string
  content: string
  supporting_detail: string | null
  attachments: ContributionAttachment[]
  created_by: string
  team_id: string | null
  visibility: ContributionVisibility
  is_pinned: boolean
  is_archived: boolean
  pinned_by: string | null
  pinned_at: string | null
  archived_by: string | null
  archived_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
  // Draft support
  draft_content: string | null
  draft_updated_at: string | null
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    full_name?: string
  }
  team?: {
    id: string
    name: string
    color: string | null
  }
  visibility_targets?: VisibilityTarget[]
}

export interface ContributionHistory {
  id: string
  contribution_id: string
  old_content: string | null
  new_content: string
  changed_by: string
  changed_at: string
  user?: {
    id: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string
  }
}

// Helper to compute full name
const getFullName = (user: { first_name?: string | null; last_name?: string | null } | null) => {
  if (!user) return 'Unknown User'
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown User'
}

interface UseContributionsOptions {
  assetId: string
  section?: string
}

export function useContributions({ assetId, section }: UseContributionsOptions) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch contributions for an asset, grouped by user (one per user per section)
  const {
    data: contributions,
    isLoading,
    isFetching,
    error,
    refetch
  } = useQuery({
    queryKey: ['contributions', assetId, section],
    queryFn: async () => {
      let query = supabase
        .from('asset_contributions')
        .select(`
          *,
          user:users!asset_contributions_created_by_fkey(id, first_name, last_name),
          team:org_chart_nodes!asset_contributions_team_id_fkey(id, name, color),
          visibility_targets:contribution_visibility_targets(
            id,
            node_id,
            node:org_chart_nodes(id, name, color, node_type)
          )
        `)
        .eq('asset_id', assetId)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })

      if (section) {
        query = query.eq('section', section)
      }

      const { data, error } = await query

      if (error) throw error

      return (data || []).map(c => ({
        ...c,
        supporting_detail: c.supporting_detail || null,
        attachments: c.attachments || [],
        user: c.user ? { ...c.user, full_name: getFullName(c.user) } : undefined,
        visibility_targets: c.visibility_targets || []
      })) as Contribution[]
    },
    enabled: !!assetId,
    staleTime: Infinity, // Never refetch automatically
    gcTime: 30 * 60 * 1000
  })

  // Get the current user's contribution for this section
  const myContribution = contributions?.find(c => c.created_by === user?.id)

  // Get other users' contributions (sorted by most recent)
  const otherContributions = contributions?.filter(c => c.created_by !== user?.id) || []

  // Save contribution (upsert - create or update)
  const saveContribution = useMutation({
    mutationFn: async ({
      content,
      supportingDetail,
      attachments,
      sectionKey,
      visibility = 'firm' as ContributionVisibility,
      targetIds = []
    }: {
      content: string
      supportingDetail?: string
      attachments?: ContributionAttachment[]
      sectionKey: string
      visibility?: ContributionVisibility
      targetIds?: string[]
    }) => {
      // Check if user already has a contribution for this section
      const { data: existing } = await supabase
        .from('asset_contributions')
        .select('id')
        .eq('asset_id', assetId)
        .eq('section', sectionKey)
        .eq('created_by', user?.id)
        .maybeSingle()

      if (existing) {
        // Update existing contribution
        const { data, error } = await supabase
          .from('asset_contributions')
          .update({
            content,
            supporting_detail: supportingDetail || null,
            attachments: attachments || [],
            visibility,
            team_id: targetIds.length === 1 ? targetIds[0] : null,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select(`
            *,
            user:users!asset_contributions_created_by_fkey(id, first_name, last_name),
            team:org_chart_nodes!asset_contributions_team_id_fkey(id, name, color)
          `)
          .single()

        if (error) throw error

        // Update visibility targets
        await supabase
          .from('contribution_visibility_targets')
          .delete()
          .eq('contribution_id', existing.id)

        if (visibility !== 'firm' && targetIds.length > 0) {
          await supabase
            .from('contribution_visibility_targets')
            .insert(targetIds.map(nodeId => ({
              contribution_id: existing.id,
              node_id: nodeId
            })))
        }

        return {
          ...data,
          user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined
        } as Contribution
      } else {
        // Create new contribution
        const { data, error } = await supabase
          .from('asset_contributions')
          .insert({
            asset_id: assetId,
            section: sectionKey,
            content,
            supporting_detail: supportingDetail || null,
            attachments: attachments || [],
            created_by: user?.id,
            team_id: targetIds.length === 1 ? targetIds[0] : null,
            visibility
          })
          .select(`
            *,
            user:users!asset_contributions_created_by_fkey(id, first_name, last_name),
            team:org_chart_nodes!asset_contributions_team_id_fkey(id, name, color)
          `)
          .single()

        if (error) throw error

        // Save visibility targets
        if (targetIds.length > 0) {
          await supabase
            .from('contribution_visibility_targets')
            .insert(targetIds.map(nodeId => ({
              contribution_id: data.id,
              node_id: nodeId
            })))
        }

        return {
          ...data,
          user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined
        } as Contribution
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributions', assetId] })
      queryClient.invalidateQueries({ queryKey: ['contribution-history'] })
      queryClient.invalidateQueries({ queryKey: ['aggregate-history', assetId] })
    }
  })

  // Delete contribution
  const deleteContribution = useMutation({
    mutationFn: async () => {
      if (!myContribution) return

      const { error } = await supabase
        .from('asset_contributions')
        .delete()
        .eq('id', myContribution.id)
        .eq('created_by', user?.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributions', assetId] })
    }
  })

  // Save draft (without publishing)
  const saveDraft = useMutation({
    mutationFn: async ({
      content,
      sectionKey
    }: {
      content: string
      sectionKey: string
    }) => {
      // Check if user already has a contribution for this section
      const { data: existing } = await supabase
        .from('asset_contributions')
        .select('id')
        .eq('asset_id', assetId)
        .eq('section', sectionKey)
        .eq('created_by', user?.id)
        .maybeSingle()

      if (existing) {
        // Update existing contribution's draft
        const { data, error } = await supabase
          .from('asset_contributions')
          .update({
            draft_content: content,
            draft_updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select()
          .single()

        if (error) throw error
        return data as Contribution
      } else {
        // Create new contribution with draft only (no published content yet)
        const { data, error } = await supabase
          .from('asset_contributions')
          .insert({
            asset_id: assetId,
            section: sectionKey,
            content: '', // Empty published content
            draft_content: content,
            draft_updated_at: new Date().toISOString(),
            created_by: user?.id,
            visibility: 'firm'
          })
          .select()
          .single()

        if (error) throw error
        return data as Contribution
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributions', assetId] })
    }
  })

  // Publish draft (move draft_content to content)
  const publishDraft = useMutation({
    mutationFn: async ({
      sectionKey,
      visibility = 'firm' as ContributionVisibility,
      targetIds = []
    }: {
      sectionKey: string
      visibility?: ContributionVisibility
      targetIds?: string[]
    }) => {
      // Get the contribution with draft AND current published content (for revision diff)
      const { data: existing } = await supabase
        .from('asset_contributions')
        .select('id, content, draft_content')
        .eq('asset_id', assetId)
        .eq('section', sectionKey)
        .eq('created_by', user?.id)
        .maybeSingle()

      if (!existing || !existing.draft_content) {
        throw new Error('No draft to publish')
      }

      const oldContent = existing.content
      const newContent = existing.draft_content

      // Move draft to published content
      const { data, error } = await supabase
        .from('asset_contributions')
        .update({
          content: newContent,
          draft_content: null,
          draft_updated_at: null,
          visibility,
          team_id: targetIds.length === 1 ? targetIds[0] : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select(`
          *,
          user:users!asset_contributions_created_by_fkey(id, first_name, last_name),
          team:org_chart_nodes!asset_contributions_team_id_fkey(id, name, color)
        `)
        .single()

      if (error) throw error

      // Update visibility targets
      await supabase
        .from('contribution_visibility_targets')
        .delete()
        .eq('contribution_id', existing.id)

      if (visibility !== 'firm' && targetIds.length > 0) {
        await supabase
          .from('contribution_visibility_targets')
          .insert(targetIds.map(nodeId => ({
            contribution_id: existing.id,
            node_id: nodeId
          })))
      }

      // Create revision event (fire-and-forget, don't block publish)
      if (user?.id) {
        findOrCreateRevision({
          assetId,
          actorUserId: user.id,
          viewScopeType: 'firm',
        }).then(revisionId => {
          addRevisionEvents(revisionId, [{
            category: sectionToCategory(sectionKey),
            field_key: sectionKey,
            before_value: oldContent || null,
            after_value: newContent,
            significance_tier: getSignificanceTier(sectionKey, oldContent, newContent),
          }])
        }).catch(err => {
          console.warn('Failed to record revision event:', err)
        })
      }

      return {
        ...data,
        user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined
      } as Contribution
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributions', assetId] })
      queryClient.invalidateQueries({ queryKey: ['contribution-history'] })
      queryClient.invalidateQueries({ queryKey: ['aggregate-history', assetId] })
      queryClient.invalidateQueries({ queryKey: ['asset-revisions', assetId] })
    }
  })

  // Discard draft (clear draft_content without affecting published content)
  const discardDraft = useMutation({
    mutationFn: async ({
      sectionKey
    }: {
      sectionKey: string
    }) => {
      // Get the contribution
      const { data: existing } = await supabase
        .from('asset_contributions')
        .select('id, content')
        .eq('asset_id', assetId)
        .eq('section', sectionKey)
        .eq('created_by', user?.id)
        .maybeSingle()

      if (!existing) {
        throw new Error('No contribution found')
      }

      // If there's no published content, delete the entire contribution
      if (!existing.content) {
        const { error } = await supabase
          .from('asset_contributions')
          .delete()
          .eq('id', existing.id)

        if (error) throw error
        return null
      }

      // Otherwise just clear the draft
      const { data, error } = await supabase
        .from('asset_contributions')
        .update({
          draft_content: null,
          draft_updated_at: null
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) throw error
      return data as Contribution
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributions', assetId] })
    }
  })

  // Update visibility
  const updateVisibility = useMutation({
    mutationFn: async ({
      contributionId,
      visibility,
      targetIds = []
    }: {
      contributionId?: string
      visibility: ContributionVisibility
      targetIds?: string[]
    }) => {
      // Use passed contributionId or fall back to myContribution
      const contribId = contributionId || myContribution?.id
      if (!contribId) throw new Error('No contribution to update')

      console.log('Updating visibility:', {
        contributionId: contribId,
        visibility,
        targetIds
      })

      const { data, error } = await supabase
        .from('asset_contributions')
        .update({
          visibility,
          team_id: targetIds.length === 1 ? targetIds[0] : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', contribId)
        .eq('created_by', user?.id)
        .select()
        .single()

      if (error) {
        console.error('Error updating visibility:', error)
        throw error
      }

      console.log('Visibility updated:', data)

      // Update visibility targets
      const { error: deleteError } = await supabase
        .from('contribution_visibility_targets')
        .delete()
        .eq('contribution_id', contribId)

      if (deleteError) {
        console.error('Error deleting visibility targets:', deleteError)
      }

      if (visibility !== 'firm' && targetIds.length > 0) {
        const { error: insertError } = await supabase
          .from('contribution_visibility_targets')
          .insert(targetIds.map(nodeId => ({
            contribution_id: contribId,
            node_id: nodeId
          })))

        if (insertError) {
          console.error('Error inserting visibility targets:', insertError)
        }
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributions', assetId] })
    },
    onError: (error) => {
      console.error('updateVisibility mutation failed:', error)
    }
  })

  return {
    contributions: contributions || [],
    myContribution,
    otherContributions,
    isLoading,
    isFetching,
    error,
    refetch,
    saveContribution,
    deleteContribution,
    updateVisibility,
    // Draft methods
    saveDraft,
    publishDraft,
    discardDraft
  }
}

// Hook for fetching contribution history for a specific user's contribution
export function useContributionHistory(contributionId: string | undefined) {
  const { data: history, isLoading, error } = useQuery({
    queryKey: ['contribution-history', contributionId],
    queryFn: async () => {
      if (!contributionId) return []

      const { data, error } = await supabase
        .from('asset_contribution_history')
        .select(`
          *,
          user:users!asset_contribution_history_changed_by_fkey(id, first_name, last_name)
        `)
        .eq('contribution_id', contributionId)
        .order('changed_at', { ascending: false })

      if (error) throw error
      return (data || []).map(h => ({
        ...h,
        user: h.user ? { ...h.user, full_name: getFullName(h.user) } : undefined
      })) as ContributionHistory[]
    },
    enabled: !!contributionId
  })

  return {
    history: history || [],
    isLoading,
    error
  }
}

// Hook for fetching aggregate history across all contributions for a section
export function useAggregateHistory({ assetId, section }: { assetId: string; section: string }) {
  const { data: history, isLoading, error } = useQuery({
    queryKey: ['aggregate-history', assetId, section],
    queryFn: async () => {
      // First get all contribution IDs for this section
      const { data: contributions } = await supabase
        .from('asset_contributions')
        .select('id')
        .eq('asset_id', assetId)
        .eq('section', section)

      if (!contributions || contributions.length === 0) return []

      const contributionIds = contributions.map(c => c.id)

      // Fetch all history for these contributions
      const { data, error } = await supabase
        .from('asset_contribution_history')
        .select(`
          *,
          user:users!asset_contribution_history_changed_by_fkey(id, first_name, last_name),
          contribution:asset_contributions!asset_contribution_history_contribution_id_fkey(
            id,
            user:users!asset_contributions_created_by_fkey(id, first_name, last_name)
          )
        `)
        .in('contribution_id', contributionIds)
        .order('changed_at', { ascending: false })

      if (error) throw error

      return (data || []).map(h => ({
        ...h,
        user: h.user ? { ...h.user, full_name: getFullName(h.user) } : undefined,
        contribution: h.contribution ? {
          ...h.contribution,
          user: h.contribution.user ? { ...h.contribution.user, full_name: getFullName(h.contribution.user) } : undefined
        } : undefined
      }))
    },
    enabled: !!assetId && !!section
  })

  return {
    history: history || [],
    isLoading,
    error
  }
}

// Hook for AI-powered summarization of contributions
export function useContributionSummary({
  assetId,
  section,
  contributions
}: {
  assetId: string
  section: string
  contributions: Contribution[]
}) {
  const { user } = useAuth()
  const { effectiveConfig } = useAIConfig()
  const queryClient = useQueryClient()

  // Check if we have a cached summary
  const { data: cachedSummary, isLoading: cacheLoading } = useQuery({
    queryKey: ['contribution-summary', assetId, section],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contribution_summaries')
        .select('*')
        .eq('asset_id', assetId)
        .eq('section', section)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data
    },
    enabled: !!assetId && !!section
  })

  // Generate summary mutation
  const generateSummary = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated')
      if (!effectiveConfig.isConfigured) {
        throw new Error('AI not configured. Please set up AI in Settings.')
      }
      if (contributions.length === 0) {
        throw new Error('No contributions to summarize')
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Build the prompt with all contributions
      const contributionTexts = contributions.map(c =>
        `${c.user?.full_name || 'Unknown'}: ${c.content}`
      ).join('\n\n')

      const sectionLabels: Record<string, string> = {
        thesis: 'Investment Thesis',
        where_different: 'Where We Are Different',
        risks_to_thesis: 'Risks to Thesis'
      }

      const prompt = `Summarize the following ${sectionLabels[section] || section} views from multiple team members into a concise, unified summary. Highlight key themes, areas of agreement, and any notable differences in perspective. Keep it brief but comprehensive.

Views:
${contributionTexts}

Provide a 2-3 paragraph summary that captures the essence of the team's collective thinking.`

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: prompt,
            conversationHistory: [],
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate summary')
      }

      const data = await response.json()
      const summaryText = data.response as string

      // Cache the summary
      const { error: upsertError } = await supabase
        .from('contribution_summaries')
        .upsert({
          asset_id: assetId,
          section,
          summary: summaryText,
          contribution_count: contributions.length,
          last_contribution_at: contributions[0]?.updated_at,
          generated_at: new Date().toISOString(),
          generated_by: user.id
        }, {
          onConflict: 'asset_id,section'
        })

      if (upsertError) {
        console.error('Failed to cache summary:', upsertError)
      }

      return summaryText
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contribution-summary', assetId, section] })
    }
  })

  // Check if summary is stale (contributions changed since last summary)
  const isStale = cachedSummary && contributions.length > 0 && (
    cachedSummary.contribution_count !== contributions.length ||
    new Date(contributions[0]?.updated_at) > new Date(cachedSummary.last_contribution_at)
  )

  return {
    summary: cachedSummary?.summary || null,
    isLoading: cacheLoading,
    isGenerating: generateSummary.isPending,
    isStale,
    isConfigured: effectiveConfig.isConfigured,
    error: generateSummary.error,
    generateSummary: generateSummary.mutate,
    regenerateSummary: generateSummary.mutate
  }
}

// Types for structured thesis analysis
export type Sentiment = 'bullish' | 'neutral' | 'bearish'

export interface ThesisAnalysis {
  executiveSummary: string
  overallSentiment: Sentiment
  sentimentBreakdown: {
    bullish: number
    neutral: number
    bearish: number
  }
  consensusPoints: string[]
  divergentViews: {
    topic: string
    views: { analyst: string; position: string }[]
  }[]
  keyCatalysts: { theme: string; count: number; analysts: string[] }[]
  analystSentiments: {
    analystId: string
    name: string
    isCovering: boolean
    sentiment: Sentiment
    keyPoint: string
    updatedAt: string
  }[]
  generatedAt: string
  contributionCount: number
}

export type AggregationMethod = 'equal' | 'covering_only' | 'role_weighted' | 'recency'

// Hook for structured AI-powered thesis analysis
export function useThesisAnalysis({
  assetId,
  section,
  contributions,
  coveringAnalystIds = new Set()
}: {
  assetId: string
  section: string
  contributions: Contribution[]
  coveringAnalystIds?: Set<string>
}) {
  const { user } = useAuth()
  const { effectiveConfig } = useAIConfig()
  const queryClient = useQueryClient()

  // Check if we have a cached analysis
  const { data: cachedAnalysis, isLoading: cacheLoading } = useQuery({
    queryKey: ['thesis-analysis', assetId, section],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contribution_summaries')
        .select('*')
        .eq('asset_id', assetId)
        .eq('section', section)
        .single()

      if (error && error.code !== 'PGRST116') throw error

      // Parse the structured analysis from the summary field (stored as JSON)
      if (data?.summary) {
        try {
          const parsed = JSON.parse(data.summary)
          if (parsed.executiveSummary) {
            return {
              ...parsed,
              generatedAt: data.generated_at,
              contributionCount: data.contribution_count
            } as ThesisAnalysis
          }
        } catch {
          // Not structured data, return null
        }
      }
      return null
    },
    enabled: !!assetId && !!section
  })

  // Generate structured analysis mutation
  const generateAnalysis = useMutation({
    mutationFn: async (method: AggregationMethod = 'equal'): Promise<ThesisAnalysis> => {
      if (!user) throw new Error('Not authenticated')
      if (!effectiveConfig.isConfigured) {
        throw new Error('AI not configured. Please set up AI in Settings.')
      }
      if (contributions.length === 0) {
        throw new Error('No contributions to analyze')
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Filter/sort contributions based on method
      let filteredContributions = [...contributions]
      if (method === 'covering_only') {
        filteredContributions = contributions.filter(c => coveringAnalystIds.has(c.created_by))
        if (filteredContributions.length === 0) {
          throw new Error('No covering analyst contributions to analyze')
        }
      } else if (method === 'recency') {
        filteredContributions.sort((a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
      }

      // Build the prompt with contributions
      const contributionTexts = filteredContributions.map(c => {
        const isCovering = coveringAnalystIds.has(c.created_by)
        return `${c.user?.full_name || 'Unknown'}${isCovering ? ' (Covering Analyst)' : ''}: ${c.content}`
      }).join('\n\n---\n\n')

      const sectionLabels: Record<string, string> = {
        thesis: 'Investment Thesis',
        where_different: 'Where We Are Different (vs Consensus)',
        risks_to_thesis: 'Risks to Thesis'
      }

      // Build weighting instructions based on method
      const weightingInstructions = {
        equal: 'Treat all analyst views with equal weight.',
        covering_only: 'Only covering analyst views are included. These are the primary analysts responsible for this asset.',
        role_weighted: 'Weight covering analysts more heavily than other contributors. Primary covering analysts should have the most influence on consensus.',
        recency: 'Weight more recent views more heavily than older ones. The list is sorted by recency (most recent first).'
      }

      const prompt = `Analyze the following ${sectionLabels[section] || section} views from multiple analysts and provide a structured analysis.

WEIGHTING: ${weightingInstructions[method]}

ANALYST VIEWS:
${contributionTexts}

Provide your analysis as a JSON object with EXACTLY this structure (no markdown, just raw JSON):
{
  "executiveSummary": "A 2-3 sentence synthesis of the collective view",
  "overallSentiment": "bullish" | "neutral" | "bearish",
  "sentimentBreakdown": {
    "bullish": <number 0-100>,
    "neutral": <number 0-100>,
    "bearish": <number 0-100>
  },
  "consensusPoints": ["point 1", "point 2", ...],
  "divergentViews": [
    {
      "topic": "area of disagreement",
      "views": [
        { "analyst": "name", "position": "their view" }
      ]
    }
  ],
  "keyCatalysts": [
    { "theme": "catalyst name", "count": <number>, "analysts": ["name1", "name2"] }
  ],
  "analystSentiments": [
    {
      "analystId": "id or empty string",
      "name": "analyst name",
      "isCovering": true/false,
      "sentiment": "bullish" | "neutral" | "bearish",
      "keyPoint": "their main point in 1 sentence"
    }
  ]
}

IMPORTANT:
- Return ONLY valid JSON, no explanation text
- sentimentBreakdown percentages should sum to 100
- Extract 3-5 consensus points if possible
- Identify 1-3 areas of divergence if any exist
- Extract 3-8 key themes/catalysts mentioned
- Covering analysts are marked in the input - preserve this in analystSentiments`

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: prompt,
            conversationHistory: [],
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate analysis')
      }

      const data = await response.json()
      let analysisText = data.response as string

      // Clean up the response - remove markdown code blocks if present
      analysisText = analysisText.trim()
      if (analysisText.startsWith('```json')) {
        analysisText = analysisText.slice(7)
      } else if (analysisText.startsWith('```')) {
        analysisText = analysisText.slice(3)
      }
      if (analysisText.endsWith('```')) {
        analysisText = analysisText.slice(0, -3)
      }
      analysisText = analysisText.trim()

      // Parse the JSON response
      let analysis: Partial<ThesisAnalysis>
      try {
        analysis = JSON.parse(analysisText)
      } catch (e) {
        console.error('Failed to parse AI response:', analysisText)
        throw new Error('Failed to parse AI analysis response')
      }

      // Add contribution metadata
      const fullAnalysis: ThesisAnalysis = {
        executiveSummary: analysis.executiveSummary || 'Analysis could not be generated',
        overallSentiment: analysis.overallSentiment || 'neutral',
        sentimentBreakdown: analysis.sentimentBreakdown || { bullish: 33, neutral: 34, bearish: 33 },
        consensusPoints: analysis.consensusPoints || [],
        divergentViews: analysis.divergentViews || [],
        keyCatalysts: analysis.keyCatalysts || [],
        analystSentiments: (analysis.analystSentiments || []).map((a, idx) => ({
          ...a,
          analystId: a.analystId || contributions[idx]?.created_by || '',
          isCovering: a.isCovering ?? coveringAnalystIds.has(contributions[idx]?.created_by || ''),
          updatedAt: contributions.find(c => c.user?.full_name === a.name)?.updated_at || new Date().toISOString()
        })),
        generatedAt: new Date().toISOString(),
        contributionCount: contributions.length
      }

      // Cache the analysis (store as JSON string)
      const { error: upsertError } = await supabase
        .from('contribution_summaries')
        .upsert({
          asset_id: assetId,
          section,
          summary: JSON.stringify(fullAnalysis),
          contribution_count: contributions.length,
          last_contribution_at: contributions[0]?.updated_at,
          generated_at: new Date().toISOString(),
          generated_by: user.id
        }, {
          onConflict: 'asset_id,section'
        })

      if (upsertError) {
        console.error('Failed to cache analysis:', upsertError)
      }

      return fullAnalysis
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thesis-analysis', assetId, section] })
    }
  })

  // Check if analysis is stale (contributions changed since last analysis)
  const isStale = cachedAnalysis && contributions.length > 0 && (
    cachedAnalysis.contributionCount !== contributions.length ||
    (contributions[0]?.updated_at && cachedAnalysis.generatedAt &&
     new Date(contributions[0].updated_at) > new Date(cachedAnalysis.generatedAt))
  )

  return {
    analysis: cachedAnalysis || null,
    isLoading: cacheLoading,
    isGenerating: generateAnalysis.isPending,
    isStale: !!isStale,
    isConfigured: effectiveConfig.isConfigured,
    error: generateAnalysis.error as Error | null,
    generateAnalysis: generateAnalysis.mutate,
    regenerateAnalysis: generateAnalysis.mutate
  }
}

// Interface for unified thesis analysis (combining all 3 sections)
export interface UnifiedThesisAnalysis {
  executiveSummary: string
  overallSentiment: Sentiment
  sentimentBreakdown: {
    bullish: number
    neutral: number
    bearish: number
  }
  thesisSummary: string
  differentiatorsSummary: string
  risksSummary: string
  consensusPoints: string[]
  divergentViews: {
    topic: string
    views: { analyst: string; position: string }[]
  }[]
  keyCatalysts: { theme: string; count: number; analysts: string[] }[]
  analystSentiments: {
    analystId: string
    name: string
    isCovering: boolean
    sentiment: Sentiment
    keyPoint: string
    updatedAt: string
  }[]
  generatedAt: string
  contributionCount: number
}

// Hook for unified AI-powered thesis analysis (combines all 3 sections)
export function useUnifiedThesisAnalysis({
  assetId,
  thesisContributions,
  whereDiffContributions,
  risksContributions,
  coveringAnalystIds = new Set()
}: {
  assetId: string
  thesisContributions: Contribution[]
  whereDiffContributions: Contribution[]
  risksContributions: Contribution[]
  coveringAnalystIds?: Set<string>
}) {
  const { user } = useAuth()
  const { effectiveConfig } = useAIConfig()
  const queryClient = useQueryClient()

  // Combine all contributions for counting
  const allContributions = [...thesisContributions, ...whereDiffContributions, ...risksContributions]
  const uniqueContributors = new Set(allContributions.map(c => c.created_by))
  const totalContributorCount = uniqueContributors.size

  // Check if we have a cached analysis (using a special 'unified' section key)
  const { data: cachedAnalysis, isLoading: cacheLoading } = useQuery({
    queryKey: ['thesis-analysis', assetId, 'unified'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contribution_summaries')
        .select('*')
        .eq('asset_id', assetId)
        .eq('section', 'unified')
        .single()

      if (error && error.code !== 'PGRST116') throw error

      if (data?.summary) {
        try {
          const parsed = JSON.parse(data.summary)
          if (parsed.executiveSummary && parsed.thesisSummary) {
            return {
              ...parsed,
              generatedAt: data.generated_at,
              contributionCount: data.contribution_count
            } as UnifiedThesisAnalysis
          }
        } catch {
          // Not structured data
        }
      }
      return null
    },
    enabled: !!assetId
  })

  // Generate unified analysis mutation
  const generateAnalysisMutation = useMutation({
    mutationFn: async (method: AggregationMethod = 'equal'): Promise<UnifiedThesisAnalysis> => {
      if (!user) throw new Error('Not authenticated')
      if (!effectiveConfig.isConfigured) {
        throw new Error('AI not configured. Please set up AI in Settings.')
      }
      if (totalContributorCount === 0) {
        throw new Error('No contributions to analyze')
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Helper to format contributions for a section
      const formatContributions = (contributions: Contribution[], sectionName: string) => {
        if (contributions.length === 0) return ''

        let filtered = [...contributions]
        if (method === 'covering_only') {
          filtered = contributions.filter(c => coveringAnalystIds.has(c.created_by))
        } else if (method === 'recency') {
          filtered.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        }

        if (filtered.length === 0) return ''

        const texts = filtered.map(c => {
          const isCovering = coveringAnalystIds.has(c.created_by)
          return `- ${c.user?.full_name || 'Unknown'}${isCovering ? ' (Covering)' : ''}: ${c.content}`
        }).join('\n')

        return `### ${sectionName}\n${texts}`
      }

      const thesisText = formatContributions(thesisContributions, 'Investment Thesis')
      const diffText = formatContributions(whereDiffContributions, 'Where We Are Different')
      const risksText = formatContributions(risksContributions, 'Risks to Thesis')

      const allSectionsText = [thesisText, diffText, risksText].filter(Boolean).join('\n\n')

      if (!allSectionsText) {
        throw new Error('No contributions to analyze after filtering')
      }

      // Build weighting instructions
      const weightingInstructions = {
        equal: 'Treat all analyst views with equal weight.',
        covering_only: 'Only covering analyst views are included.',
        role_weighted: 'Weight covering analysts more heavily than other contributors.',
        recency: 'Weight more recent views more heavily (lists are sorted by recency).'
      }

      const prompt = `Analyze these analyst views across three thesis sections and provide a UNIFIED structured analysis.

WEIGHTING: ${weightingInstructions[method]}

ANALYST VIEWS:
${allSectionsText}

Provide your analysis as a JSON object with EXACTLY this structure (no markdown, just raw JSON):
{
  "executiveSummary": "A 2-3 sentence overall synthesis combining thesis, differentiators, and risks",
  "overallSentiment": "bullish" | "neutral" | "bearish",
  "sentimentBreakdown": {
    "bullish": <number 0-100>,
    "neutral": <number 0-100>,
    "bearish": <number 0-100>
  },
  "thesisSummary": "1-2 sentence summary of the investment thesis section",
  "differentiatorsSummary": "1-2 sentence summary of where the team differs from consensus",
  "risksSummary": "1-2 sentence summary of the key risks identified",
  "consensusPoints": ["point 1", "point 2", ...],
  "divergentViews": [
    {
      "topic": "area of disagreement",
      "views": [
        { "analyst": "name", "position": "their view" }
      ]
    }
  ],
  "keyCatalysts": [
    { "theme": "catalyst name", "count": <number>, "analysts": ["name1", "name2"] }
  ],
  "analystSentiments": [
    {
      "analystId": "",
      "name": "analyst name",
      "isCovering": true/false,
      "sentiment": "bullish" | "neutral" | "bearish",
      "keyPoint": "their main thesis point in 1 sentence"
    }
  ]
}

IMPORTANT:
- Return ONLY valid JSON, no explanation text
- sentimentBreakdown percentages should sum to 100
- Extract 3-5 consensus points across ALL sections
- Identify 1-3 areas of divergence if any exist
- Extract 3-8 key themes/catalysts mentioned across all sections
- Covering analysts are marked - preserve this in analystSentiments
- The executive summary should weave together thesis + differentiators + risks coherently`

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: prompt,
            conversationHistory: [],
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate analysis')
      }

      const data = await response.json()
      let analysisText = data.response as string

      // Clean up markdown code blocks
      analysisText = analysisText.trim()
      if (analysisText.startsWith('```json')) {
        analysisText = analysisText.slice(7)
      } else if (analysisText.startsWith('```')) {
        analysisText = analysisText.slice(3)
      }
      if (analysisText.endsWith('```')) {
        analysisText = analysisText.slice(0, -3)
      }
      analysisText = analysisText.trim()

      // Parse JSON
      let analysis: Partial<UnifiedThesisAnalysis>
      try {
        analysis = JSON.parse(analysisText)
      } catch (e) {
        console.error('Failed to parse AI response:', analysisText)
        throw new Error('Failed to parse AI analysis response')
      }

      // Build full analysis with defaults
      const fullAnalysis: UnifiedThesisAnalysis = {
        executiveSummary: analysis.executiveSummary || 'Analysis could not be generated',
        overallSentiment: analysis.overallSentiment || 'neutral',
        sentimentBreakdown: analysis.sentimentBreakdown || { bullish: 33, neutral: 34, bearish: 33 },
        thesisSummary: analysis.thesisSummary || 'No thesis summary available',
        differentiatorsSummary: analysis.differentiatorsSummary || 'No differentiators summary available',
        risksSummary: analysis.risksSummary || 'No risks summary available',
        consensusPoints: analysis.consensusPoints || [],
        divergentViews: analysis.divergentViews || [],
        keyCatalysts: analysis.keyCatalysts || [],
        analystSentiments: (analysis.analystSentiments || []).map((a) => ({
          ...a,
          analystId: a.analystId || '',
          isCovering: a.isCovering ?? false,
          updatedAt: allContributions.find(c => c.user?.full_name === a.name)?.updated_at || new Date().toISOString()
        })),
        generatedAt: new Date().toISOString(),
        contributionCount: totalContributorCount
      }

      // Cache with 'unified' section key
      const latestUpdate = allContributions.length > 0
        ? allContributions.reduce((latest, c) =>
            new Date(c.updated_at) > new Date(latest.updated_at) ? c : latest
          ).updated_at
        : new Date().toISOString()

      const { error: upsertError } = await supabase
        .from('contribution_summaries')
        .upsert({
          asset_id: assetId,
          section: 'unified',
          summary: JSON.stringify(fullAnalysis),
          contribution_count: totalContributorCount,
          last_contribution_at: latestUpdate,
          generated_at: new Date().toISOString(),
          generated_by: user.id
        }, {
          onConflict: 'asset_id,section'
        })

      if (upsertError) {
        console.error('Failed to cache unified analysis:', upsertError)
      }

      return fullAnalysis
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thesis-analysis', assetId, 'unified'] })
    }
  })

  // Check if analysis is stale
  const latestUpdate = allContributions.length > 0
    ? allContributions.reduce((latest, c) =>
        new Date(c.updated_at) > new Date(latest.updated_at) ? c : latest
      ).updated_at
    : null

  const isStale = cachedAnalysis && latestUpdate && (
    cachedAnalysis.contributionCount !== totalContributorCount ||
    new Date(latestUpdate) > new Date(cachedAnalysis.generatedAt)
  )

  return {
    analysis: cachedAnalysis || null,
    isLoading: cacheLoading,
    isGenerating: generateAnalysisMutation.isPending,
    isStale: !!isStale,
    isConfigured: effectiveConfig.isConfigured,
    error: generateAnalysisMutation.error as Error | null,
    generateAnalysis: generateAnalysisMutation.mutate
  }
}

// ============================================================================
// HISTORY EVOLUTION ANALYSIS
// ============================================================================

// Interface for evolution analysis results
export interface EvolutionAnalysis {
  insights: string[]
  thesisEvolution: string
  sentimentShift: {
    initial: Sentiment
    current: Sentiment
    trajectory: 'more_bullish' | 'more_bearish' | 'stable'
  }
  keyMilestones: {
    date: string
    type: 'thesis_shift' | 'risk_identified' | 'price_target_change' | 'conviction_change'
    description: string
    significance: 'high' | 'medium' | 'low'
  }[]
  priceTargetSummary: string | null
  riskEvolution: string | null
  convictionIndicators: string[]
  generatedAt: string
}

export interface HistoryEvent {
  id: string
  type: 'thesis' | 'where_different' | 'risks_to_thesis' | 'price_target' | 'reference' | 'rating'
  timestamp: Date
  userId: string
  userName: string
  content?: string
  previousContent?: string
  priceTarget?: number
  previousPriceTarget?: number
  scenarioLabel?: string
}

// Hook for AI-powered history evolution analysis
export function useHistoryEvolutionAnalysis({
  assetId,
  userId,
  historyEvents
}: {
  assetId: string
  userId?: string
  historyEvents: HistoryEvent[]
}) {
  const { user } = useAuth()
  const { effectiveConfig } = useAIConfig()
  const queryClient = useQueryClient()

  // Build cache key based on whether we're filtering by user
  const cacheSection = userId ? `evolution_analysis_${userId}` : 'evolution_analysis'

  // Check if we have a cached analysis
  const { data: cachedAnalysis, isLoading: cacheLoading } = useQuery({
    queryKey: ['evolution-analysis', assetId, cacheSection],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contribution_summaries')
        .select('*')
        .eq('asset_id', assetId)
        .eq('section', cacheSection)
        .single()

      if (error && error.code !== 'PGRST116') throw error

      if (data?.summary) {
        try {
          const parsed = JSON.parse(data.summary)
          if (parsed.insights) {
            return {
              ...parsed,
              generatedAt: data.generated_at
            } as EvolutionAnalysis
          }
        } catch {
          // Not structured data
        }
      }
      return null
    },
    enabled: !!assetId
  })

  // Generate evolution analysis mutation
  const generateAnalysisMutation = useMutation({
    mutationFn: async (): Promise<EvolutionAnalysis> => {
      if (!user) throw new Error('Not authenticated')
      if (!effectiveConfig.isConfigured) {
        throw new Error('AI not configured. Please set up AI in Settings.')
      }
      if (historyEvents.length === 0) {
        throw new Error('No history to analyze')
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Sort events chronologically
      const sortedEvents = [...historyEvents].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      )

      // Build timeline narrative for AI
      const eventDescriptions = sortedEvents.map(e => {
        const date = e.timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

        if (e.type === 'price_target') {
          const change = e.previousPriceTarget
            ? `$${e.previousPriceTarget} → $${e.priceTarget}`
            : `Set to $${e.priceTarget}`
          return `[${date}] Price Target: ${change}`
        }

        const typeLabels: Record<string, string> = {
          thesis: 'Investment Thesis',
          where_different: 'Where Different',
          risks_to_thesis: 'Risks',
          reference: 'Supporting Docs'
        }

        const hasChange = e.previousContent && e.content
        const action = hasChange ? 'Updated' : 'Added'
        const contentPreview = e.content ? e.content.slice(0, 200) + (e.content.length > 200 ? '...' : '') : ''

        return `[${date}] ${action} ${typeLabels[e.type] || e.type}: "${contentPreview}"`
      }).join('\n\n')

      // Count changes by type
      const thesisChanges = sortedEvents.filter(e => e.type === 'thesis').length
      const riskChanges = sortedEvents.filter(e => e.type === 'risks_to_thesis').length
      const priceChanges = sortedEvents.filter(e => e.type === 'price_target').length

      const prompt = `Analyze this investment thesis evolution timeline and provide structured insights.

TIMELINE OF CHANGES:
${eventDescriptions}

SUMMARY:
- ${thesisChanges} thesis changes
- ${riskChanges} risk updates
- ${priceChanges} price target revisions
- Time span: ${sortedEvents.length > 0 ? sortedEvents[0].timestamp.toLocaleDateString() : 'N/A'} to ${sortedEvents.length > 0 ? sortedEvents[sortedEvents.length - 1].timestamp.toLocaleDateString() : 'N/A'}

Provide your analysis as a JSON object with EXACTLY this structure (no markdown, just raw JSON):
{
  "insights": [
    "Insight 1 about how the thesis evolved",
    "Insight 2 about key perspective shifts",
    "Insight 3 about conviction changes"
  ],
  "thesisEvolution": "1-2 sentence summary of how the main thesis evolved over time",
  "sentimentShift": {
    "initial": "bullish" | "neutral" | "bearish",
    "current": "bullish" | "neutral" | "bearish",
    "trajectory": "more_bullish" | "more_bearish" | "stable"
  },
  "keyMilestones": [
    {
      "date": "YYYY-MM-DD",
      "type": "thesis_shift" | "risk_identified" | "price_target_change" | "conviction_change",
      "description": "What happened",
      "significance": "high" | "medium" | "low"
    }
  ],
  "priceTargetSummary": "Summary of price target changes if any, or null",
  "riskEvolution": "Summary of how risk perception evolved, or null",
  "convictionIndicators": ["Evidence of conviction increase/decrease from language changes"]
}

IMPORTANT:
- Return ONLY valid JSON, no explanation text
- Generate 3-5 actionable insights
- Identify 2-5 key milestones
- Analyze language for conviction shifts (more assertive = higher conviction)
- Focus on the "why" behind changes, not just "what" changed`

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: prompt,
            conversationHistory: [],
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate analysis')
      }

      const data = await response.json()
      let analysisText = data.response as string

      // Clean up markdown code blocks
      analysisText = analysisText.trim()
      if (analysisText.startsWith('```json')) {
        analysisText = analysisText.slice(7)
      } else if (analysisText.startsWith('```')) {
        analysisText = analysisText.slice(3)
      }
      if (analysisText.endsWith('```')) {
        analysisText = analysisText.slice(0, -3)
      }
      analysisText = analysisText.trim()

      // Parse JSON
      let analysis: Partial<EvolutionAnalysis>
      try {
        analysis = JSON.parse(analysisText)
      } catch (e) {
        console.error('Failed to parse AI response:', analysisText)
        throw new Error('Failed to parse AI analysis response')
      }

      // Build full analysis with defaults
      const fullAnalysis: EvolutionAnalysis = {
        insights: analysis.insights || ['No insights could be generated'],
        thesisEvolution: analysis.thesisEvolution || 'Unable to determine thesis evolution',
        sentimentShift: analysis.sentimentShift || {
          initial: 'neutral',
          current: 'neutral',
          trajectory: 'stable'
        },
        keyMilestones: analysis.keyMilestones || [],
        priceTargetSummary: analysis.priceTargetSummary || null,
        riskEvolution: analysis.riskEvolution || null,
        convictionIndicators: analysis.convictionIndicators || [],
        generatedAt: new Date().toISOString()
      }

      // Cache the analysis
      const { error: upsertError } = await supabase
        .from('contribution_summaries')
        .upsert({
          asset_id: assetId,
          section: cacheSection,
          summary: JSON.stringify(fullAnalysis),
          contribution_count: historyEvents.length,
          last_contribution_at: sortedEvents.length > 0
            ? sortedEvents[sortedEvents.length - 1].timestamp.toISOString()
            : new Date().toISOString(),
          generated_at: new Date().toISOString(),
          generated_by: user.id
        }, {
          onConflict: 'asset_id,section'
        })

      if (upsertError) {
        console.error('Failed to cache evolution analysis:', upsertError)
      }

      return fullAnalysis
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evolution-analysis', assetId, cacheSection] })
    }
  })

  // Check if analysis is stale
  const latestEvent = historyEvents.length > 0
    ? historyEvents.reduce((latest, e) =>
        e.timestamp > latest.timestamp ? e : latest
      )
    : null

  const isStale = cachedAnalysis && latestEvent && (
    new Date(latestEvent.timestamp) > new Date(cachedAnalysis.generatedAt)
  )

  return {
    analysis: cachedAnalysis || null,
    isLoading: cacheLoading,
    isGenerating: generateAnalysisMutation.isPending,
    isStale: !!isStale,
    isConfigured: effectiveConfig.isConfigured,
    error: generateAnalysisMutation.error as Error | null,
    generateAnalysis: generateAnalysisMutation.mutate
  }
}
