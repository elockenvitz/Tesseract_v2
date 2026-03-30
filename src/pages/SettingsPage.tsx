import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings, Save, X, Moon, Sun, Globe, Check } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../contexts/ThemeContext'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { AIConfigurationSection } from '../components/settings/AIConfigurationSection'

interface SettingsPageProps {
  onClose?: () => void
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="space-y-6">
      {/* Header with close button */}
      {onClose && (
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Account Settings</h1>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      <div>
        {!onClose && <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>}
        <p className="text-gray-600 dark:text-gray-300 mt-1">Manage your account and application preferences</p>
      </div>

      {/* Appearance Settings */}
      <Card>
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Appearance</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">Customize how Tesseract looks and feels</p>
          </div>

          {/* Dark Mode Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                {theme === 'dark' ? (
                  <Moon className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                ) : (
                  <Sun className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                )}
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-900 dark:text-white">Dark mode</h4>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                </p>
              </div>
            </div>

            <button
              onClick={toggleTheme}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                theme === 'dark'
                  ? 'bg-primary-600'
                  : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  theme === 'dark' ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </Card>

      {/* AI Configuration */}
      <AIConfigurationSection />

      {/* Account Settings — Timezone */}
      <TimezoneSection />
    </div>
  )
}

// ─── Timezone Section ──────────────────────────────────────────────────

const COMMON_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)', offset: 'UTC-5/UTC-4' },
  { value: 'America/Chicago', label: 'Central Time (CT)', offset: 'UTC-6/UTC-5' },
  { value: 'America/Denver', label: 'Mountain Time (MT)', offset: 'UTC-7/UTC-6' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)', offset: 'UTC-8/UTC-7' },
  { value: 'America/Anchorage', label: 'Alaska Time', offset: 'UTC-9/UTC-8' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time', offset: 'UTC-10' },
  { value: 'Europe/London', label: 'London (GMT/BST)', offset: 'UTC+0/UTC+1' },
  { value: 'Europe/Berlin', label: 'Central European (CET)', offset: 'UTC+1/UTC+2' },
  { value: 'Europe/Helsinki', label: 'Eastern European (EET)', offset: 'UTC+2/UTC+3' },
  { value: 'Asia/Dubai', label: 'Gulf Time (GST)', offset: 'UTC+4' },
  { value: 'Asia/Kolkata', label: 'India (IST)', offset: 'UTC+5:30' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)', offset: 'UTC+8' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)', offset: 'UTC+8' },
  { value: 'Asia/Tokyo', label: 'Japan (JST)', offset: 'UTC+9' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)', offset: 'UTC+10/UTC+11' },
]

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'America/New_York'
  }
}

function TimezoneSection() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: savedTimezone, isLoading } = useQuery({
    queryKey: ['user-timezone', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('timezone').eq('id', user!.id).single()
      return data?.timezone || null
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  })

  const browserTz = getBrowserTimezone()
  const effectiveTz = savedTimezone || browserTz
  const [selectedTz, setSelectedTz] = useState(effectiveTz)
  const [saved, setSaved] = useState(false)

  // Sync when data loads
  useEffect(() => {
    if (!isLoading) setSelectedTz(savedTimezone || browserTz)
  }, [savedTimezone, isLoading, browserTz])

  const saveMutation = useMutation({
    mutationFn: async (tz: string) => {
      const { error } = await supabase.from('users').update({ timezone: tz }).eq('id', user!.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-timezone'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const hasChanged = selectedTz !== (savedTimezone || browserTz)

  return (
    <Card>
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">Account</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300">Regional and account preferences</p>
        </div>

        <div className="flex items-start gap-3">
          <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg mt-0.5">
            <Globe className="h-5 w-5 text-gray-600 dark:text-gray-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white">Timezone</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Controls when scheduled processes run and how times are displayed.
              {!savedTimezone && (
                <span className="text-amber-600 dark:text-amber-400 ml-1">
                  Currently using your browser's timezone ({browserTz}).
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <select
                value={selectedTz}
                onChange={(e) => setSelectedTz(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <optgroup label="Common Timezones">
                  {COMMON_TIMEZONES.map(tz => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label} ({tz.offset})
                    </option>
                  ))}
                </optgroup>
                {/* If user's browser timezone isn't in the common list, add it */}
                {!COMMON_TIMEZONES.some(tz => tz.value === browserTz) && (
                  <optgroup label="Your Browser">
                    <option value={browserTz}>{browserTz}</option>
                  </optgroup>
                )}
                {/* If saved timezone isn't in list, show it */}
                {savedTimezone && !COMMON_TIMEZONES.some(tz => tz.value === savedTimezone) && savedTimezone !== browserTz && (
                  <optgroup label="Current Setting">
                    <option value={savedTimezone}>{savedTimezone}</option>
                  </optgroup>
                )}
              </select>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate(selectedTz)}
                disabled={!hasChanged || saveMutation.isPending}
              >
                {saved ? <Check className="w-4 h-4" /> : saveMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}