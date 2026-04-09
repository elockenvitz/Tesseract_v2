/**
 * useSessionTracking — Tracks user sessions with heartbeat.
 *
 * Creates a session row on mount, sends heartbeats every 2 minutes
 * while the tab is visible, and ends the session on unmount/tab close.
 */

import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const HEARTBEAT_INTERVAL = 2 * 60 * 1000 // 2 minutes

export function useSessionTracking() {
  const { user } = useAuth()
  const sessionIdRef = useRef<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!user?.id) return

    const orgId = (user as any)?.current_organization_id ?? null

    // Start session
    const startSession = async () => {
      try {
        const { data, error } = await supabase
          .from('user_sessions')
          .insert({
            user_id: user.id,
            organization_id: orgId,
            user_agent: navigator.userAgent,
          })
          .select('id')
          .single()

        if (!error && data) {
          sessionIdRef.current = data.id
        }
      } catch {
        // Non-blocking — session tracking is best-effort
      }
    }

    // Heartbeat
    const sendHeartbeat = async () => {
      if (!sessionIdRef.current || document.hidden) return
      try {
        await supabase.rpc('session_heartbeat', { p_session_id: sessionIdRef.current })
      } catch {
        // Non-blocking
      }
    }

    // End session
    const endSession = () => {
      if (!sessionIdRef.current) return
      // Use sendBeacon for reliability on tab close
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/end_session`
      const body = JSON.stringify({ p_session_id: sessionIdRef.current })
      const headers = {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${supabase.auth.getSession().then(s => s.data.session?.access_token)}`,
      }

      // Try sendBeacon first (works on tab close), fall back to fetch
      try {
        const blob = new Blob([body], { type: 'application/json' })
        navigator.sendBeacon(url, blob)
      } catch {
        fetch(url, { method: 'POST', headers, body, keepalive: true }).catch(() => {})
      }

      sessionIdRef.current = null
    }

    // Visibility change handler — pause/resume heartbeats
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden — stop heartbeats (session will be cleaned up by cron if not resumed)
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      } else {
        // Tab visible again — send immediate heartbeat and resume interval
        sendHeartbeat()
        if (!intervalRef.current) {
          intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL)
        }
      }
    }

    startSession()
    intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL)

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', endSession)

    return () => {
      endSession()
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', endSession)
    }
  }, [user?.id])
}
