import { AlertTriangle, Zap, Target, Clock } from 'lucide-react'

export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'none'

export interface PriorityConfig {
  color: string
  icon: any
  label: string
}

// Standardized priority configuration based on prioritizer implementation
export const priorityConfig: Record<Priority, PriorityConfig> = {
  'critical': {
    color: 'bg-red-600 text-white',
    icon: AlertTriangle,
    label: 'Critical'
  },
  'high': {
    color: 'bg-orange-500 text-white',
    icon: Zap,
    label: 'High'
  },
  'medium': {
    color: 'bg-blue-500 text-white',
    icon: Target,
    label: 'Medium'
  },
  'low': {
    color: 'bg-green-500 text-white',
    icon: Clock,
    label: 'Low'
  },
  'none': {
    color: 'bg-gray-400 text-white',
    icon: Clock,
    label: 'None'
  }
}

// Utility function to get priority configuration
export const getPriorityConfig = (priority: string | null | undefined): PriorityConfig => {
  if (!priority) return priorityConfig['none']

  const normalizedPriority = priority.toLowerCase() as Priority
  return priorityConfig[normalizedPriority] || priorityConfig['none']
}

// Utility function to get priority badge classes
export const getPriorityBadgeClasses = (priority: string | null | undefined): string => {
  const config = getPriorityConfig(priority)
  return `inline-flex px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${config.color}`
}

// Utility function to get priority label
export const getPriorityLabel = (priority: string | null | undefined): string => {
  const config = getPriorityConfig(priority)
  return config.label
}

// Utility function to get priority icon
export const getPriorityIcon = (priority: string | null | undefined) => {
  const config = getPriorityConfig(priority)
  return config.icon
}

// Map old 4-value system to new 5-value system for backward compatibility
export const mapLegacyPriority = (priority: string | null | undefined): Priority => {
  if (!priority) return 'none'

  switch (priority.toLowerCase()) {
    case 'high': return 'high'
    case 'medium': return 'medium'
    case 'low': return 'low'
    case 'none': return 'none'
    case 'critical': return 'critical'
    default: return 'none'
  }
}