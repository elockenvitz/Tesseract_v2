/**
 * MorphBanner — Compact inline morph-session indicator, designed to live in
 * the top header next to the search bar. No fixed positioning, no body padding
 * adjustments — just a pill that fits into normal flex flow so it doesn't
 * shift the rest of the layout.
 */

import { useState, useEffect } from 'react'
import { Eye, X, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import { useMorphSession } from '../../hooks/useMorphSession'
import { useToast } from '../common/Toast'

interface MorphBannerProps {
  /** When true, renders a tight pill (for placement inside the header). */
  compact?: boolean
  className?: string
}

export function MorphBanner({ compact = true, className }: MorphBannerProps) {
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

  if (!isMorphing || !activeSession) return null

  const minutes = Math.floor(remainingMs / 60000)
  const seconds = Math.floor((remainingMs % 60000) / 1000)
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`

  const handleEnd = async () => {
    try {
      await endMorph.mutateAsync(activeSession.id)
      success('Morph session ended')
    } catch {
      // handled by mutation
    }
  }

  const targetLabel = activeSession.target_name || activeSession.target_email

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-2 rounded-full bg-orange-600 text-white shadow-sm ring-1 ring-orange-700',
        compact ? 'px-2.5 py-1 text-xs' : 'px-4 py-1.5 text-sm',
        className
      )}
      title={`Viewing as ${targetLabel} · Read-only`}
    >
      <Eye className={clsx('flex-shrink-0', compact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
      <span className="font-medium whitespace-nowrap max-w-[16ch] truncate">
        Viewing as <strong className="font-semibold">{targetLabel}</strong>
      </span>
      <span className="flex items-center gap-1 text-orange-100/90 tabular-nums">
        <Clock className={clsx(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
        {timeStr}
      </span>
      <button
        onClick={handleEnd}
        disabled={endMorph.isPending}
        className="ml-1 px-1.5 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white text-[10px] font-medium transition-colors flex items-center gap-0.5 disabled:opacity-50"
        title="End session"
      >
        <X className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        End
      </button>
    </div>
  )
}
