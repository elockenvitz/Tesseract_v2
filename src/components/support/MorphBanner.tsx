/**
 * MorphBanner — Top-of-page banner shown during active morph sessions.
 * Displays target user/org info, remaining time, and end session button.
 */

import { useState, useEffect } from 'react'
import { Eye, X, Clock } from 'lucide-react'
import { useMorphSession } from '../../hooks/useMorphSession'
import { useToast } from '../common/Toast'

export function MorphBanner() {
  const { activeSession, isMorphing, endMorph } = useMorphSession()
  const { success } = useToast()
  const [remainingMs, setRemainingMs] = useState(0)

  // Countdown timer
  useEffect(() => {
    if (!activeSession?.expires_at) return

    const update = () => {
      const remaining = new Date(activeSession.expires_at).getTime() - Date.now()
      setRemainingMs(Math.max(0, remaining))
    }

    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [activeSession?.expires_at])

  // Push the rest of the app down by the banner height so the fixed bar
  // doesn't overlap the sticky header / page content.
  useEffect(() => {
    if (!isMorphing) return
    const prev = document.body.style.paddingTop
    document.body.style.paddingTop = '32px'
    return () => { document.body.style.paddingTop = prev }
  }, [isMorphing])

  if (!isMorphing || !activeSession) return null

  const minutes = Math.floor(remainingMs / 60000)
  const seconds = Math.floor((remainingMs % 60000) / 1000)
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`

  const handleEnd = async () => {
    try {
      await endMorph.mutateAsync(activeSession.id)
      success('Morph session ended')
    } catch {
      // Error handled by mutation
    }
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-orange-600 text-white px-4 py-1.5 flex items-center justify-center gap-3 text-sm font-medium shadow-lg">
      <Eye className="w-4 h-4 flex-shrink-0" />
      <span>
        Viewing as <strong>{activeSession.target_name || activeSession.target_email}</strong>
        {' '}&middot;{' '}Read-only mode
      </span>
      <span className="flex items-center gap-1 text-orange-200">
        <Clock className="w-3.5 h-3.5" />
        {timeStr}
      </span>
      <button
        onClick={handleEnd}
        disabled={endMorph.isPending}
        className="ml-2 px-2.5 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white text-xs font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
      >
        <X className="w-3 h-3" />
        End Session
      </button>
    </div>
  )
}
