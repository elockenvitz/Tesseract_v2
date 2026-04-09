import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'

export interface BugReport {
  id: string
  organization_id: string
  reported_by: string
  title: string
  description: string | null
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'investigating' | 'resolved' | 'closed' | 'wont_fix'
  page_url: string | null
  browser_info: Record<string, any> | null
  console_errors: any[] | null
  metadata: Record<string, any>
  resolved_by: string | null
  resolved_at: string | null
  resolution_notes: string | null
  created_at: string
  updated_at: string
}

interface SubmitBugReportParams {
  title: string
  description?: string
  severity?: BugReport['severity']
  page_url?: string
  browser_info?: Record<string, any>
  console_errors?: any[]
}

export function useBugReports() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  // Fetch user's own bug reports
  const { data: myReports = [], isLoading } = useQuery({
    queryKey: ['bug-reports', 'mine', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bug_reports')
        .select('*')
        .eq('reported_by', user!.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data || []) as BugReport[]
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  })

  // Submit a new bug report
  const submitReport = useMutation({
    mutationFn: async (params: SubmitBugReportParams) => {
      if (!user?.id || !currentOrgId) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('bug_reports')
        .insert({
          organization_id: currentOrgId,
          reported_by: user.id,
          title: params.title,
          description: params.description || null,
          severity: params.severity || 'medium',
          page_url: params.page_url || window.location.href,
          browser_info: params.browser_info || {
            userAgent: navigator.userAgent,
            language: navigator.language,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          },
          console_errors: params.console_errors || null,
        })
        .select()
        .single()

      if (error) throw error
      return data as BugReport
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bug-reports'] })
    },
  })

  return {
    myReports,
    isLoading,
    submitReport,
  }
}

/**
 * Hook for platform admins to view all bug reports across orgs.
 */
export function useAllBugReports() {
  return useQuery({
    queryKey: ['bug-reports', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bug_reports')
        .select('*, reporter:users!bug_reports_reported_by_fkey(id, email, first_name, last_name), org:organizations!bug_reports_organization_id_fkey(id, name, slug)')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data || []
    },
    staleTime: 30_000,
  })
}
