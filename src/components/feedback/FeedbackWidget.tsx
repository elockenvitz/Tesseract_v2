/**
 * FeedbackWidget — Floating feedback button + modal for pilot users.
 *
 * Four modes: Bug, Feedback, Question, Refer-a-friend.
 * All land in the bug_reports table (metadata.feedback_type distinguishes them),
 * so ops can review from the same queue.
 */

import { useState, useCallback, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  MessageSquarePlus, X, Bug, Lightbulb, HelpCircle, UserPlus,
  Loader2, CheckCircle2, Send,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'

type FeedbackType = 'bug' | 'feedback' | 'question' | 'referral'

const FEEDBACK_TYPES: { type: FeedbackType; label: string; icon: typeof Bug; color: string }[] = [
  { type: 'bug',      label: 'Bug',      icon: Bug,         color: 'text-red-500 bg-red-50 border-red-200 hover:bg-red-100' },
  { type: 'feedback', label: 'Feedback', icon: Lightbulb,   color: 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100' },
  { type: 'question', label: 'Question', icon: HelpCircle,  color: 'text-blue-500 bg-blue-50 border-blue-200 hover:bg-blue-100' },
  { type: 'referral', label: 'Refer',    icon: UserPlus,    color: 'text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100' },
]

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export function FeedbackWidget() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const [isOpen, setIsOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>('feedback')

  // Generic feedback fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  // Referral fields
  const [friendName, setFriendName] = useState('')
  const [friendEmail, setFriendEmail] = useState('')
  const [friendNote, setFriendNote] = useState('')

  const [submitted, setSubmitted] = useState(false)

  const resetFields = useCallback(() => {
    setTitle('')
    setDescription('')
    setFriendName('')
    setFriendEmail('')
    setFriendNote('')
  }, [])

  const handleClose = useCallback(() => {
    setIsOpen(false)
    setSubmitted(false)
    setType('feedback')
    resetFields()
  }, [resetFields])

  const submitM = useMutation({
    mutationFn: async () => {
      if (!user?.id || !currentOrgId) throw new Error('Not authenticated')

      if (type === 'referral') {
        const name = friendName.trim()
        const email = friendEmail.trim()
        const note = friendNote.trim()
        if (!email) throw new Error('Friend\'s email is required')
        if (!isValidEmail(email)) throw new Error('Please enter a valid email address')

        const { error } = await supabase.from('bug_reports').insert({
          organization_id: currentOrgId,
          reported_by: user.id,
          title: `Referral: ${name || email}`,
          description: note || null,
          severity: 'low',
          status: 'open',
          page_url: window.location.href,
          browser_info: {
            userAgent: navigator.userAgent,
            screenSize: `${window.innerWidth}x${window.innerHeight}`,
            timestamp: new Date().toISOString(),
          },
          metadata: {
            feedback_type: 'referral',
            referral: { name: name || null, email, note: note || null },
          },
        })
        if (error) throw error
        return
      }

      // Bug / Feedback / Question
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
        setType('feedback')
        resetFields()
      }, 2200)
    },
  })

  const canSubmit = useMemo(() => {
    if (submitM.isPending) return false
    if (type === 'referral') return !!friendEmail.trim()
    return !!title.trim()
  }, [type, title, friendEmail, submitM.isPending])

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
        title="Send feedback or refer a friend"
      >
        <MessageSquarePlus className="w-5 h-5" />
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed bottom-5 right-5 z-50 w-[380px] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {type === 'referral' ? 'Refer a friend' : 'Send Feedback'}
            </h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>

          {submitted ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {type === 'referral' ? 'Thanks for the intro!' : 'Thanks for your feedback!'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {type === 'referral' ? "We'll follow up shortly." : "We'll review it shortly."}
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {/* Type selector — 4 buttons */}
              <div className="grid grid-cols-4 gap-1.5">
                {FEEDBACK_TYPES.map(ft => {
                  const Icon = ft.icon
                  const isActive = type === ft.type
                  return (
                    <button
                      key={ft.type}
                      onClick={() => setType(ft.type)}
                      className={clsx(
                        'flex flex-col items-center justify-center gap-1 px-1 py-2 rounded-lg border text-[11px] font-medium transition-all',
                        isActive ? ft.color : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {ft.label}
                    </button>
                  )
                })}
              </div>

              {type === 'referral' ? (
                <>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] text-emerald-800">
                    Know someone who'd be a great pilot user? Send us their info — we'll reach out and keep you posted.
                  </div>

                  {/* Friend name */}
                  <input
                    type="text"
                    placeholder="Friend's name (optional)"
                    value={friendName}
                    onChange={e => setFriendName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    autoFocus
                  />

                  {/* Friend email */}
                  <input
                    type="email"
                    placeholder="Friend's email *"
                    value={friendEmail}
                    onChange={e => setFriendEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />

                  {/* Note */}
                  <textarea
                    placeholder="Why they'd be a great fit (optional)..."
                    value={friendNote}
                    onChange={e => setFriendNote(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </>
              ) : (
                <>
                  {/* Title */}
                  <input
                    type="text"
                    placeholder={
                      type === 'bug'      ? "What's broken?" :
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

                  {/* Soft nudge toward referrals */}
                  <button
                    type="button"
                    onClick={() => setType('referral')}
                    className="w-full text-left text-[11px] text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
                  >
                    Know someone who'd be a great pilot user? Refer a friend →
                  </button>
                </>
              )}

              {/* Submit */}
              <button
                onClick={() => submitM.mutate()}
                disabled={!canSubmit}
                className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
              >
                {submitM.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {type === 'referral' ? 'Send referral' : 'Send'}
              </button>

              {submitM.isError && (
                <p className="text-xs text-red-500 text-center">
                  {(submitM.error as Error)?.message || 'Failed to send. Please try again.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
