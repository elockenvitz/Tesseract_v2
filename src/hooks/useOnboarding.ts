import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface OnboardingStatus {
  id: string
  user_id: string
  wizard_completed: boolean
  current_step: number
  steps_completed: string[]
  skipped_steps: string[]
  started_at: string
  completed_at: string | null
  last_updated_at: string
}

export interface UserProfileExtended {
  id: string
  user_id: string
  title: string | null
  user_type: 'investor' | 'operations' | 'compliance' | null
  // Investor fields
  investment_style: string[]
  time_horizon: string[]
  market_cap_focus: string[]
  geography_focus: string[]
  sector_focus: string[]
  asset_class_focus: string[]
  universe_scope: 'broad' | 'specific' | null
  specific_tickers: string[]
  strategy_description: string | null
  investment_focus_summary: string | null
  // Operations fields
  ops_departments: string[]
  ops_workflow_types: string[]
  ops_role_description: string | null
  // Compliance fields
  compliance_areas: string[]
  compliance_divisions: string[]
  compliance_role_description: string | null
  // Data integrations
  market_data_provider: 'factset' | 'bloomberg' | 'capiq' | 'refinitiv' | 'other' | 'none' | null
  market_data_provider_other: string | null
  needs_realtime_prices: boolean
  needs_index_data: boolean
  needs_fundamentals: boolean
  needs_estimates: boolean
  needs_news_feeds: boolean
  integration_notes: string | null
  // Timestamps
  created_at: string
  updated_at: string
}

export function useOnboarding() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch onboarding status
  const { data: onboardingStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ['onboarding-status', user?.id],
    queryFn: async () => {
      if (!user?.id) return null

      const { data, error } = await supabase
        .from('user_onboarding_status')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows returned, which is fine for new users
        console.error('Error fetching onboarding status:', error)
        throw error
      }

      return data as OnboardingStatus | null
    },
    enabled: !!user?.id,
    staleTime: 30000,
  })

  // Fetch extended profile
  const { data: profileExtended, isLoading: profileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['profile-extended', user?.id],
    queryFn: async () => {
      if (!user?.id) return null

      const { data, error } = await supabase
        .from('user_profile_extended')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching extended profile:', error)
        throw error
      }

      return data as UserProfileExtended | null
    },
    enabled: !!user?.id,
    staleTime: 30000,
  })

  // Initialize onboarding status for new users
  const initializeOnboarding = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('No user')

      const { data, error } = await supabase
        .from('user_onboarding_status')
        .insert({
          user_id: user.id,
          wizard_completed: false,
          current_step: 1,
          steps_completed: [],
          skipped_steps: [],
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-status', user?.id] })
    },
  })

  // Update onboarding status
  const updateOnboardingStatus = useMutation({
    mutationFn: async (updates: Partial<OnboardingStatus>) => {
      if (!user?.id) throw new Error('No user')

      const { data, error } = await supabase
        .from('user_onboarding_status')
        .update(updates)
        .eq('user_id', user.id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-status', user?.id] })
    },
  })

  // Mark wizard as complete
  const completeWizard = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('No user')

      const { data, error } = await supabase
        .from('user_onboarding_status')
        .update({
          wizard_completed: true,
          completed_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-status', user?.id] })
    },
  })

  // Update extended profile
  const updateProfileExtended = useMutation({
    mutationFn: async (updates: Partial<UserProfileExtended>) => {
      if (!user?.id) throw new Error('No user')

      // Check if profile exists
      const { data: existing } = await supabase
        .from('user_profile_extended')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from('user_profile_extended')
          .update(updates)
          .eq('user_id', user.id)
          .select()
          .single()

        if (error) throw error
        return data
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('user_profile_extended')
          .insert({
            user_id: user.id,
            ...updates,
          })
          .select()
          .single()

        if (error) throw error
        return data
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile-extended', user?.id] })
    },
  })

  // Check if this is the first time (no onboarding record at all)
  const isFirstTime = !statusLoading && user && !onboardingStatus

  // Check if wizard should be shown
  // Only show wizard if:
  // 1. User exists and data is loaded
  // 2. User has an onboarding record that is NOT completed
  // Existing users without an onboarding record should NOT be forced into the wizard
  // They can access it manually from their profile if they want
  const shouldShowWizard = !statusLoading && !profileLoading && user && (
    onboardingStatus && !onboardingStatus.wizard_completed
  )

  return {
    onboardingStatus,
    profileExtended,
    isLoading: statusLoading || profileLoading,
    shouldShowWizard,
    isFirstTime,
    initializeOnboarding,
    updateOnboardingStatus,
    completeWizard,
    updateProfileExtended,
    refetchStatus,
    refetchProfile,
  }
}
