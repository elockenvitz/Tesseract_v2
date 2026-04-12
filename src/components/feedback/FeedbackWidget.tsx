/**
 * FeedbackWidget — Floating feedback button + modal for pilot users.
 *
 * Allows users to report bugs or share feedback from any page.
 * Saves to bug_reports table, visible in ops portal under Support.
 */

import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  MessageSquarePlus, X, Bug, Lightbulb, HelpCircle,
  Loader2, CheckCircle2, Send,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'

type FeedbackType = 'bug' | 'feedback' | 'question'

const FEEDBACK_TYPES = [
  { type: 'bug' as FeedbackType, label: 'Bug', icon: Bug, color: 'text-red-500 bg-red-50 border-red-200 hover:bg-red-100' },
  { type: 'feedback' as FeedbackType, label: 'Feedback', icon: Lightbulb, color: 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100' },
  { type: 'question' as FeedbackType, label: 'Question', icon: HelpCircle, color: 'text-blue-500 bg-blue-50 border-blue-200 hover:bg-blue-100' },
]

export function FeedbackWidget() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const [isOpen, setIsOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>('feedback')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const submitM = useMutation({
    mutationFn: async () => {
      if (!user?.id || !currentOrgId) throw new Error('Not authenticated')

      const { error } = await supabase.from('bug_reports').insert({
        organization_id: currentOrgId,
        reported_by: user.id,
        title: title.trim(),
        description: description.trim() || null,
        severity: type === 'bug' ? 'medium' : 'low',
        status: 'open',
        page_url: window.location.href,
        browser_info: {
          userAgent: navigator.userAgent,
          screenSize: `${window.innerWidth}x${window.innerHeight}`,
          timestamp: new Date().toISOString(),
        },
        metadata: {
          feedback_type: type,
        },
      })

      if (error) throw error
    },
    onSuccess: () => {
      setSubmitted(true)
      setTimeout(() => {
        setIsOpen(false)
        setSubmitted(false)
        setTitle('')
        setDescription('')
        setType('feedback')
      }, 2000)
    },
  })

  const handleClose = useCallback(() => {
    setIsOpen(false)
    setSubmitted(false)
    setTitle('')
    setDescription('')
    setType('feedback')
  }, [])

  if (!user) return null

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(true)}
        className={clsx(
          'fixed bottom-5 right-5 z-50 w-11 h-11 rounded-full shadow-lg flex items-center justify-center transition-all',
          'bg-indigo-600 hover:bg-indigo-700 text-white hover:scale-105',
          isOpen && 'hidden'
        )}
        title="Send feedback"
      >
        <MessageSquarePlus className="w-5 h-5" />
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed bottom-5 right-5 z-50 w-[360px] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Send Feedback</h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>

          {submitted ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Thanks for your feedback!</p>
              <p className="text-xs text-gray-500 mt-1">We'll review it shortly.</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {/* Type selector */}
              <div className="flex gap-2">
                {FEEDBACK_TYPES.map(ft => {
                  const Icon = ft.icon
                  return (
                    <button
                      key={ft.type}
                      onClick={() => setType(ft.type)}
                      className={clsx(
                        'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                        type === ft.type ? ft.color : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {ft.label}
                    </button>
                  )
                })}
              </div>

              {/* Title */}
              <input
                type="text"
                placeholder={
                  type === 'bug' ? "What's broken?" :
                  type === 'question' ? "What do you need help with?" :
                  "What's on your mind?"
                }
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                autoFocus
              />

              {/* Description */}
              <textarea
                placeholder="Tell us more (optional)..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />

              {/* Current page indicator */}
              <p className="text-[10px] text-gray-400 truncate">
                Page: {window.location.pathname}
              </p>

              {/* Submit */}
              <button
                onClick={() => submitM.mutate()}
                disabled={!title.trim() || submitM.isPending}
                className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
              >
                {submitM.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Send
              </button>

              {submitM.isError && (
                <p className="text-xs text-red-500 text-center">
                  Failed to send. Please try again.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
