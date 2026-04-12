/**
 * PilotWelcomeBanner — Guided getting-started checklist for pilot clients.
 *
 * Tracks progress across key platform workflows and guides new users
 * through the core features they need to learn for adoption.
 */

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X, ChevronDown, ChevronRight, CheckCircle2, Circle,
  FileText, Lightbulb, MessageSquare, Beaker, Star,
  ArrowRight, BookOpen, Sparkles, Target, PenLine,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'

interface PilotWelcomeBannerProps {
  onNavigate: (result: any) => void
}

interface TutorialStep {
  id: string
  label: string
  description: string
  hint: string
  icon: typeof FileText
  done: boolean
  action: () => void
  category: 'research' | 'collaborate' | 'trade'
}

export function PilotWelcomeBanner({ onNavigate }: PilotWelcomeBannerProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(`pilot-banner-dismissed-${currentOrgId}`) === 'true' } catch { return false }
  })
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(`pilot-banner-expanded-${currentOrgId}`) !== 'false' } catch { return true }
  })

  // Track completion of tutorial steps
  const { data: progress } = useQuery({
    queryKey: ['pilot-tutorial-progress', currentOrgId, user?.id],
    queryFn: async () => {
      if (!user?.id) return null

      const [
        assetNotesRes,
        thoughtsRes,
        tradeIdeasRes,
        simulationsRes,
        promptsRes,
        ratingsRes,
        contributionsRes,
      ] = await Promise.all([
        // Has the user written a note on an asset?
        supabase.from('asset_notes').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
        // Has the user posted a thought?
        supabase.from('quick_thoughts').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        // Has the user created a trade idea?
        supabase.from('trade_queue_items').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
        // Has the user created a simulation?
        supabase.from('simulations').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
        // Has the user used a prompt?
        supabase.from('user_quick_prompt_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        // Has the user rated an asset?
        supabase.from('analyst_ratings').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        // Has the user made a contribution on an asset?
        supabase.from('asset_contributions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])

      return {
        hasNote: (assetNotesRes.count ?? 0) > 0,
        hasThought: (thoughtsRes.count ?? 0) > 0,
        hasTradeIdea: (tradeIdeasRes.count ?? 0) > 0,
        hasSimulation: (simulationsRes.count ?? 0) > 0,
        hasPrompt: (promptsRes.count ?? 0) > 0,
        hasRating: (ratingsRes.count ?? 0) > 0,
        hasContribution: (contributionsRes.count ?? 0) > 0,
      }
    },
    enabled: !!currentOrgId && !!user?.id,
    staleTime: 30_000,
  })

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    try { localStorage.setItem(`pilot-banner-dismissed-${currentOrgId}`, 'true') } catch {}
  }, [currentOrgId])

  const toggleExpanded = useCallback(() => {
    setExpanded(prev => {
      const next = !prev
      try { localStorage.setItem(`pilot-banner-expanded-${currentOrgId}`, String(next)) } catch {}
      return next
    })
  }, [currentOrgId])

  if (dismissed || !progress) return null

  // Navigate to a specific asset (AAPL as default for tutorial)
  const openAsset = (symbol = 'AAPL') => {
    onNavigate({ type: 'asset', id: symbol, title: symbol, data: { symbol } })
  }

  const steps: TutorialStep[] = [
    // Research workflow
    {
      id: 'explore-asset',
      label: 'Explore an asset page',
      description: 'Open any asset to see its research fields, workflow status, and history.',
      hint: 'Try searching for a ticker in the search bar, or click below to open AAPL.',
      icon: BookOpen,
      done: (progress.hasContribution || progress.hasNote || progress.hasRating),
      action: () => openAsset(),
      category: 'research',
    },
    {
      id: 'fill-research',
      label: 'Fill out a research field',
      description: 'Add your thesis, bull/bear case, or any research field on an asset page.',
      hint: 'On the asset page, click any empty field to start typing. Your input is saved automatically.',
      icon: PenLine,
      done: progress.hasContribution,
      action: () => openAsset(),
      category: 'research',
    },
    {
      id: 'rate-asset',
      label: 'Rate an asset',
      description: 'Set your conviction rating (e.g., Overweight / Neutral / Underweight).',
      hint: 'On the asset page, find the rating section and select your view.',
      icon: Star,
      done: progress.hasRating,
      action: () => openAsset(),
      category: 'research',
    },
    {
      id: 'take-note',
      label: 'Take a note',
      description: 'Write a research note on an asset — capture your analysis and key takeaways.',
      hint: 'On the asset page, go to the Notes tab and click "New Note".',
      icon: FileText,
      done: progress.hasNote,
      action: () => openAsset(),
      category: 'research',
    },
    // Communicate & collaborate
    {
      id: 'post-thought',
      label: 'Post a thought',
      description: 'Share a quick insight or observation with your team via Thoughts.',
      hint: 'Click the lightbulb icon in the header, or use the Thoughts panel to post.',
      icon: Lightbulb,
      done: progress.hasThought,
      action: () => openAsset(),
      category: 'collaborate',
    },
    {
      id: 'use-prompt',
      label: 'Use a prompt',
      description: 'Address a specific question or task using the prompt system.',
      hint: 'On any asset page, use the command bar or dot-commands to trigger a prompt.',
      icon: Sparkles,
      done: progress.hasPrompt,
      action: () => openAsset(),
      category: 'collaborate',
    },
    // Trade workflow
    {
      id: 'create-idea',
      label: 'Create a trade idea',
      description: 'Submit a trade idea with your thesis — it enters the idea pipeline for review.',
      hint: 'Use the "+" button or go to the Ideas tab to create a new trade idea.',
      icon: Target,
      done: progress.hasTradeIdea,
      action: () => onNavigate({ type: 'trade-queue', id: 'trade-queue', title: 'Ideas', data: {} }),
      category: 'trade',
    },
    {
      id: 'run-simulation',
      label: 'Run a simulation',
      description: 'Open Trade Lab to size positions and see portfolio impact before committing.',
      hint: 'Go to Trade Lab, select your portfolio, and try sizing a position using the simulation table.',
      icon: Beaker,
      done: progress.hasSimulation,
      action: () => onNavigate({ type: 'trade-lab', id: 'trade-lab', title: 'Trade Lab', data: {} }),
      category: 'trade',
    },
  ]

  const completedCount = steps.filter(s => s.done).length
  const allDone = completedCount === steps.length

  // Group steps by category
  const categories = [
    { key: 'research', label: 'Research', steps: steps.filter(s => s.category === 'research') },
    { key: 'collaborate', label: 'Communicate', steps: steps.filter(s => s.category === 'collaborate') },
    { key: 'trade', label: 'Trade', steps: steps.filter(s => s.category === 'trade') },
  ]

  return (
    <div className="relative bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/20 rounded-xl border border-indigo-200/60 dark:border-indigo-800/40">
      {/* Header — always visible */}
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={toggleExpanded} className="flex items-center gap-2 text-left">
          {expanded
            ? <ChevronDown className="w-4 h-4 text-indigo-400" />
            : <ChevronRight className="w-4 h-4 text-indigo-400" />
          }
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Getting Started
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {allDone ? 'All done!' : `${completedCount} of ${steps.length} complete`}
            </p>
          </div>
        </button>

        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <div className="w-24 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${(completedCount / steps.length) * 100}%` }}
            />
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {categories.map(cat => (
            <div key={cat.key}>
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
                {cat.label}
              </p>
              <div className="space-y-1">
                {cat.steps.map(step => (
                  <button
                    key={step.id}
                    onClick={step.action}
                    className={clsx(
                      'w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-all group',
                      step.done
                        ? 'bg-white/40 dark:bg-gray-800/20'
                        : 'bg-white/80 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800/70 hover:shadow-sm'
                    )}
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      {step.done ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <step.icon className="w-4 h-4 text-indigo-400 dark:text-indigo-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className={clsx(
                          'text-xs font-medium',
                          step.done ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-200'
                        )}>
                          {step.label}
                        </p>
                        {!step.done && (
                          <ArrowRight className="w-3 h-3 text-gray-300 group-hover:text-indigo-400 transition-colors flex-shrink-0" />
                        )}
                      </div>
                      {!step.done && (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-relaxed">
                          {step.hint}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
