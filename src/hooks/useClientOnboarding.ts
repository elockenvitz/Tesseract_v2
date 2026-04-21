/**
 * useClientOnboarding — Manages org-level onboarding wizard state.
 *
 * Queries org_onboarding_status and provides mutations to:
 * - Complete a step
 * - Skip a step
 * - Finish the wizard
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export const ONBOARDING_STEPS = [
  { key: 'welcome', label: 'Welcome', number: 1 },
  { key: 'portfolios', label: 'Portfolios', number: 2 },
  { key: 'recommend_users', label: 'Recommend', number: 3 },
  { key: 'review', label: 'Launch', number: 4 },
] as const

export type OnboardingStepKey = typeof ONBOARDING_STEPS[number]['key']

export interface OrgOnboardingStatus {
  organization_id: string
  is_completed: boolean
  current_step: number
  steps_completed: string[]
  steps_skipped: string[]
  completed_by: string | null
  started_at: string
  completed_at: string | null
  updated_at: string
}

export function useClientOnboarding(orgId: string | null) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: status, isLoading } = useQuery({
    queryKey: ['org-onboarding-status', orgId],
    queryFn: async (): Promise<OrgOnboardingStatus | null> => {
      const { data, error } = await supabase
        .from('org_onboarding_status')
        .select('*')
        .eq('organization_id', orgId!)
        .maybeSingle()
      if (error) throw error
      return data as OrgOnboardingStatus | null
    },
    enabled: !!orgId,
    staleTime: 30_000,
  })

  const needsOnboarding = status && !status.is_completed
  const currentStepKey = ONBOARDING_STEPS[(status?.current_step || 1) - 1]?.key || 'welcome'

  const isStepCompleted = (key: OnboardingStepKey) =>
    status?.steps_completed?.includes(key) || false

  const isStepSkipped = (key: OnboardingStepKey) =>
    status?.steps_skipped?.includes(key) || false

  // Complete a step and advance
  // Accepts { key, fromStep } so the caller can pass the visible step number
  const completeStep = useMutation({
    mutationFn: async ({ key, fromStep }: { key: OnboardingStepKey; fromStep?: number }) => {
      if (!orgId) throw new Error('No organization selected. Try signing out and back in.')
      if (!status) throw new Error('Onboarding status not loaded yet. Please refresh.')

      const completed = [...new Set([...(status.steps_completed || []), key])]
      const base = fromStep ?? status.current_step ?? 1
      const nextStep = Math.min(base + 1, ONBOARDING_STEPS.length)

      const { error } = await supabase
        .from('org_onboarding_status')
        .update({
          steps_completed: completed,
          current_step: nextStep,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', orgId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-onboarding-status', orgId] })
    },
  })

  // Skip a step and advance
  const skipStep = useMutation({
    mutationFn: async ({ key, fromStep }: { key: OnboardingStepKey; fromStep?: number }) => {
      if (!orgId) throw new Error('No organization selected. Try signing out and back in.')
      if (!status) throw new Error('Onboarding status not loaded yet. Please refresh.')

      const skipped = [...new Set([...(status.steps_skipped || []), key])]
      const base = fromStep ?? status.current_step ?? 1
      const nextStep = Math.min(base + 1, ONBOARDING_STEPS.length)

      const { error } = await supabase
        .from('org_onboarding_status')
        .update({
          steps_skipped: skipped,
          current_step: nextStep,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', orgId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-onboarding-status', orgId] })
    },
  })

  // Go back to a previous step
  const goToStep = useMutation({
    mutationFn: async (stepNumber: number) => {
      if (!orgId) throw new Error('No organization selected.')
      const { error } = await supabase
        .from('org_onboarding_status')
        .update({
          current_step: stepNumber,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', orgId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-onboarding-status', orgId] })
    },
  })

  // Finish the wizard
  const finishOnboarding = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No organization selected. Try signing out and back in.')
      if (!user?.id) throw new Error('Your session expired. Please sign in again.')

      const completed = [...new Set([...(status?.steps_completed || []), 'review'])]

      const { error } = await supabase
        .from('org_onboarding_status')
        .update({
          is_completed: true,
          steps_completed: completed,
          completed_by: user.id,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', orgId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-onboarding-status', orgId] })
    },
  })

  return {
    status,
    isLoading,
    needsOnboarding,
    currentStepKey,
    isStepCompleted,
    isStepSkipped,
    completeStep,
    skipStep,
    goToStep,
    finishOnboarding,
  }
}
