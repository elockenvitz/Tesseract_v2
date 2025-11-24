/**
 * Toast Notification System
 *
 * Provides user feedback for actions (success, error, info, warning).
 * Uses React Context for global toast management.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  type: ToastType
  message: string
  description?: string
  duration?: number
}

interface ToastContextType {
  toasts: Toast[]
  showToast: (type: ToastType, message: string, description?: string, duration?: number) => void
  hideToast: (id: string) => void
  success: (message: string, description?: string) => void
  error: (message: string, description?: string) => void
  info: (message: string, description?: string) => void
  warning: (message: string, description?: string) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

interface ToastProviderProps {
  children: ReactNode
  maxToasts?: number
}

export function ToastProvider({ children, maxToasts = 5 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback(
    (type: ToastType, message: string, description?: string, duration: number = 5000) => {
      const id = `toast-${Date.now()}-${Math.random()}`
      const newToast: Toast = { id, type, message, description, duration }

      setToasts((prev) => {
        const updated = [...prev, newToast]
        // Keep only the most recent toasts
        return updated.slice(-maxToasts)
      })

      // Auto-hide after duration
      if (duration > 0) {
        setTimeout(() => {
          hideToast(id)
        }, duration)
      }
    },
    [maxToasts, hideToast]
  )

  const success = useCallback(
    (message: string, description?: string) => showToast('success', message, description),
    [showToast]
  )

  const error = useCallback(
    (message: string, description?: string) => showToast('error', message, description, 7000),
    [showToast]
  )

  const info = useCallback(
    (message: string, description?: string) => showToast('info', message, description),
    [showToast]
  )

  const warning = useCallback(
    (message: string, description?: string) => showToast('warning', message, description),
    [showToast]
  )

  return (
    <ToastContext.Provider value={{ toasts, showToast, hideToast, success, error, info, warning }}>
      {children}
      <ToastContainer toasts={toasts} onClose={hideToast} />
    </ToastContext.Provider>
  )
}

interface ToastContainerProps {
  toasts: Toast[]
  onClose: (id: string) => void
}

function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div
      className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  )
}

interface ToastItemProps {
  toast: Toast
  onClose: (id: string) => void
}

function ToastItem({ toast, onClose }: ToastItemProps) {
  const { id, type, message, description } = toast

  const config = {
    success: {
      icon: CheckCircle,
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
      iconColor: 'text-green-600',
      textColor: 'text-green-900',
      ariaLabel: 'Success',
    },
    error: {
      icon: XCircle,
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      iconColor: 'text-red-600',
      textColor: 'text-red-900',
      ariaLabel: 'Error',
    },
    info: {
      icon: Info,
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      iconColor: 'text-blue-600',
      textColor: 'text-blue-900',
      ariaLabel: 'Information',
    },
    warning: {
      icon: AlertTriangle,
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-200',
      iconColor: 'text-yellow-600',
      textColor: 'text-yellow-900',
      ariaLabel: 'Warning',
    },
  }

  const { icon: Icon, bgColor, borderColor, iconColor, textColor, ariaLabel } = config[type]

  // Handle Escape key to close toast
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose(id)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [id, onClose])

  return (
    <div
      className={`${bgColor} ${borderColor} border rounded-lg shadow-lg p-4 min-w-[320px] max-w-md pointer-events-auto animate-slide-in-right`}
      role="alert"
      aria-label={`${ariaLabel}: ${message}`}
    >
      <div className="flex items-start space-x-3">
        <Icon className={`w-5 h-5 ${iconColor} flex-shrink-0 mt-0.5`} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${textColor}`}>{message}</p>
          {description && (
            <p className={`text-xs mt-1 ${textColor} opacity-80`}>{description}</p>
          )}
        </div>
        <button
          onClick={() => onClose(id)}
          className={`flex-shrink-0 ${textColor} hover:opacity-70 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-${type === 'error' ? 'red' : type === 'success' ? 'green' : type === 'warning' ? 'yellow' : 'blue'}-500 rounded`}
          aria-label="Close notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
