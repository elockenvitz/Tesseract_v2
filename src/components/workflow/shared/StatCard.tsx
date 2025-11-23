/**
 * StatCard Component
 *
 * Reusable card component for displaying workflow statistics.
 * Used in the Overview tab to show metrics like usage count, active assets, etc.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { LucideIcon } from 'lucide-react'
import { Card } from '../../ui/Card'

export interface StatCardProps {
  /** Main statistic value to display */
  value: number | string

  /** Label for the statistic */
  label: string

  /** Icon to display */
  icon: LucideIcon

  /** Description text shown below the stat */
  description?: string

  /** Color theme for the icon background */
  colorScheme?: 'blue' | 'orange' | 'green' | 'purple' | 'indigo' | 'red'
}

const COLOR_SCHEMES = {
  blue: {
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600'
  },
  orange: {
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600'
  },
  green: {
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600'
  },
  purple: {
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600'
  },
  indigo: {
    iconBg: 'bg-indigo-100',
    iconColor: 'text-indigo-600'
  },
  red: {
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600'
  }
}

export function StatCard({
  value,
  label,
  icon: Icon,
  description,
  colorScheme = 'blue'
}: StatCardProps) {
  const colors = COLOR_SCHEMES[colorScheme]

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center">
          <div className={`p-2 ${colors.iconBg} rounded-lg`}>
            <Icon className={`w-6 h-6 ${colors.iconColor}`} />
          </div>
          <div className="ml-4">
            <div className="text-2xl font-bold text-gray-900">{value}</div>
            <div className="text-sm text-gray-500">{label}</div>
          </div>
        </div>
        {description && (
          <div className="mt-4 text-xs text-gray-400">
            {description}
          </div>
        )}
      </div>
    </Card>
  )
}
