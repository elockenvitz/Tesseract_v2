import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings, Save, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'

interface SettingsPageProps {
  onClose?: () => void
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  return (
    <div className="space-y-6">
      {/* Header with close button */}
      {onClose && (
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">Account Settings</h1>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      
      <div>
        {!onClose && <h1 className="text-2xl font-bold text-gray-900">Settings</h1>}
        <p className="text-gray-600 mt-1">Manage your account and application preferences</p>
      </div>
      
      <Card>
        <div className="text-center py-12">
          <Settings className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Settings Page</h3>
          <p className="text-gray-500">This page will contain account settings and preferences.</p>
        </div>
      </Card>
    </div>
  )
}