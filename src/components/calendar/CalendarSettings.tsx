import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  Settings, X, Plus, Trash2, RefreshCw, Check, AlertCircle,
  Calendar, ExternalLink, ChevronRight, ToggleLeft, ToggleRight
} from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'

// Provider configurations
const PROVIDERS = {
  google: {
    name: 'Google Calendar',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    ),
    color: 'bg-white border-gray-300 hover:bg-gray-50',
    description: 'Sync with Google Calendar'
  },
  microsoft: {
    name: 'Outlook Calendar',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path fill="#0078D4" d="M24 12c0 6.627-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0s12 5.373 12 12z"/>
        <path fill="#fff" d="M12 6v6l4 2"/>
        <path fill="#fff" d="M7 8h10v8H7z" opacity="0.3"/>
        <path fill="#fff" d="M8 9h4v6H8z"/>
      </svg>
    ),
    color: 'bg-white border-gray-300 hover:bg-gray-50',
    description: 'Sync with Outlook or Microsoft 365'
  },
  apple: {
    name: 'Apple Calendar',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path fill="#000" d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    ),
    color: 'bg-white border-gray-300 hover:bg-gray-50',
    description: 'Sync with iCloud Calendar'
  }
} as const

type Provider = keyof typeof PROVIDERS

interface CalendarConnection {
  id: string
  provider: Provider
  provider_email: string | null
  is_active: boolean
  sync_enabled: boolean
  sync_direction: 'import' | 'export' | 'bidirectional'
  last_synced_at: string | null
  sync_error: string | null
  created_at: string
  connected_calendars: {
    id: string
    calendar_name: string
    calendar_color: string | null
    is_primary: boolean
    sync_enabled: boolean
  }[]
}

interface CalendarSettingsProps {
  isOpen: boolean
  onClose: () => void
}

export function CalendarSettings({ isOpen, onClose }: CalendarSettingsProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [connectingProvider, setConnectingProvider] = useState<Provider | null>(null)

  // Fetch calendar connections
  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['calendar-connections', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calendar_connections')
        .select(`
          *,
          connected_calendars (
            id,
            calendar_name,
            calendar_color,
            is_primary,
            sync_enabled
          )
        `)
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as CalendarConnection[]
    },
    enabled: isOpen && !!user?.id
  })

  // Disconnect calendar
  const disconnectMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const { error } = await supabase
        .from('calendar_connections')
        .delete()
        .eq('id', connectionId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-connections'] })
    }
  })

  // Toggle sync for a calendar
  const toggleCalendarSync = useMutation({
    mutationFn: async ({ calendarId, enabled }: { calendarId: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('connected_calendars')
        .update({ sync_enabled: enabled })
        .eq('id', calendarId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-connections'] })
    }
  })

  // Update sync direction
  const updateSyncDirection = useMutation({
    mutationFn: async ({ connectionId, direction }: { connectionId: string; direction: string }) => {
      const { error } = await supabase
        .from('calendar_connections')
        .update({ sync_direction: direction })
        .eq('id', connectionId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-connections'] })
    }
  })

  // Trigger manual sync
  const triggerSync = useMutation({
    mutationFn: async (connectionId: string) => {
      // This will call the edge function
      const { data, error } = await supabase.functions.invoke('calendar-sync', {
        body: { connectionId, syncType: 'full' }
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-connections'] })
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
    }
  })

  // Connect to a provider
  const handleConnect = async (provider: Provider) => {
    setConnectingProvider(provider)

    // Get the OAuth URL from edge function
    try {
      const { data, error } = await supabase.functions.invoke('calendar-oauth-start', {
        body: { provider }
      })

      if (error) throw error

      // Open OAuth popup
      if (data?.authUrl) {
        const popup = window.open(
          data.authUrl,
          'calendar-oauth',
          'width=600,height=700,scrollbars=yes'
        )

        // Listen for OAuth callback
        const handleMessage = (event: MessageEvent) => {
          if (event.data?.type === 'calendar-oauth-success') {
            queryClient.invalidateQueries({ queryKey: ['calendar-connections'] })
            popup?.close()
            window.removeEventListener('message', handleMessage)
            setConnectingProvider(null)
          } else if (event.data?.type === 'calendar-oauth-error') {
            console.error('OAuth error:', event.data.error)
            popup?.close()
            window.removeEventListener('message', handleMessage)
            setConnectingProvider(null)
          }
        }

        window.addEventListener('message', handleMessage)
      }
    } catch (error) {
      console.error('Failed to start OAuth:', error)
      setConnectingProvider(null)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white dark:bg-gray-900 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Calendar Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-8 overflow-y-auto" style={{ height: 'calc(100vh - 73px)' }}>
          {/* Connect New Calendar */}
          <section>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
              Connect a Calendar
            </h3>
            <div className="space-y-2">
              {(Object.entries(PROVIDERS) as [Provider, typeof PROVIDERS[Provider]][]).map(([key, provider]) => {
                const isConnected = connections.some(c => c.provider === key && c.is_active)
                const isConnecting = connectingProvider === key

                return (
                  <button
                    key={key}
                    onClick={() => !isConnected && handleConnect(key)}
                    disabled={isConnected || isConnecting}
                    className={clsx(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all',
                      isConnected
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 cursor-default'
                        : provider.color,
                      !isConnected && !isConnecting && 'cursor-pointer'
                    )}
                  >
                    {provider.icon}
                    <div className="flex-1 text-left">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {provider.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {provider.description}
                      </div>
                    </div>
                    {isConnected ? (
                      <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                        <Check className="h-4 w-4" />
                        Connected
                      </span>
                    ) : isConnecting ? (
                      <RefreshCw className="h-4 w-4 text-gray-400 animate-spin" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Connected Calendars */}
          {connections.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
                Connected Calendars
              </h3>
              <div className="space-y-4">
                {connections.map(connection => (
                  <div
                    key={connection.id}
                    className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden"
                  >
                    {/* Connection Header */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800">
                      {PROVIDERS[connection.provider]?.icon}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white truncate">
                          {connection.provider_email || PROVIDERS[connection.provider]?.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {connection.last_synced_at
                            ? `Last synced ${format(new Date(connection.last_synced_at), 'MMM d, h:mm a')}`
                            : 'Never synced'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => triggerSync.mutate(connection.id)}
                          disabled={triggerSync.isPending}
                          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700"
                          title="Sync now"
                        >
                          <RefreshCw className={clsx('h-4 w-4', triggerSync.isPending && 'animate-spin')} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Disconnect this calendar? Events already synced will remain.')) {
                              disconnectMutation.mutate(connection.id)
                            }
                          }}
                          className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                          title="Disconnect"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Sync Error */}
                    {connection.sync_error && (
                      <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{connection.sync_error}</span>
                      </div>
                    )}

                    {/* Sync Direction */}
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 block">
                        Sync Direction
                      </label>
                      <div className="flex gap-2">
                        {[
                          { value: 'import', label: 'Import only' },
                          { value: 'bidirectional', label: 'Two-way sync' },
                          { value: 'export', label: 'Export only' }
                        ].map(option => (
                          <button
                            key={option.value}
                            onClick={() => updateSyncDirection.mutate({
                              connectionId: connection.id,
                              direction: option.value
                            })}
                            className={clsx(
                              'flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                              connection.sync_direction === option.value
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Calendar List */}
                    {connection.connected_calendars.length > 0 && (
                      <div className="divide-y divide-gray-100 dark:divide-gray-700">
                        {connection.connected_calendars.map(calendar => (
                          <div
                            key={calendar.id}
                            className="flex items-center gap-3 px-4 py-2"
                          >
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: calendar.calendar_color || '#3b82f6' }}
                            />
                            <span className="flex-1 text-sm text-gray-700 dark:text-gray-300 truncate">
                              {calendar.calendar_name}
                              {calendar.is_primary && (
                                <span className="ml-2 text-xs text-gray-400">(Primary)</span>
                              )}
                            </span>
                            <button
                              onClick={() => toggleCalendarSync.mutate({
                                calendarId: calendar.id,
                                enabled: !calendar.sync_enabled
                              })}
                              className="text-gray-400 hover:text-gray-600"
                            >
                              {calendar.sync_enabled ? (
                                <ToggleRight className="h-5 w-5 text-blue-600" />
                              ) : (
                                <ToggleLeft className="h-5 w-5" />
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Empty State */}
          {!isLoading && connections.length === 0 && (
            <div className="text-center py-8">
              <Calendar className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">
                No calendars connected yet
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                Connect Google or Outlook to sync your events
              </p>
            </div>
          )}

          {/* Help Text */}
          <section className="text-xs text-gray-500 dark:text-gray-400 space-y-2">
            <p>
              <strong>Import only:</strong> Events from your external calendar appear here, but changes here won't sync back.
            </p>
            <p>
              <strong>Two-way sync:</strong> Events sync both directions. Changes in either place update both.
            </p>
            <p>
              <strong>Export only:</strong> Events created here sync to your external calendar.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
