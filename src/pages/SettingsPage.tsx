import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings, Save, X, Moon, Sun } from 'lucide-react'
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

      {/* Account Settings */}
      <Card>
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Account</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">Manage your account information and preferences</p>
          </div>

          <div className="text-center py-8">
            <Settings className="h-8 w-8 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Additional account settings coming soon</p>
          </div>
        </div>
      </Card>
    </div>
  )
}