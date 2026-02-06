/**
 * Toast Notification System
 *
 * Provides user feedback for actions (success, error, info, warning).
 * Uses React Context for global toast management.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  type: ToastType
  message: string
  description?: string
  duration?: number
  action?: ToastAction
}

export interface ToastOptions {
  description?: string
  duration?: number
  action?: ToastAction
}

interface ToastContextType {
  toasts: Toast[]
  showToast: (type: ToastType, message: string, options?: ToastOptions) => void
  hideToast: (id: string) => void
  success: (message: string, options?: string | ToastOptions) => void
  error: (message: string, options?: string | ToastOptions) => void
  info: (message: string, options?: string | ToastOptions) => void
  warning: (message: string, options?: string | ToastOptions) => void
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
    (type: ToastType, message: string, options?: ToastOptions) => {
      const id = `toast-${Date.now()}-${Math.random()}`
      const duration = options?.duration ?? 5000
      const newToast: Toast = {
        id,
        type,
        message,
        description: options?.description,
        duration,
        action: options?.action
      }

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

  // Helper to normalize options - supports both string (description) and ToastOptions
  const normalizeOptions = (options?: string | ToastOptions): ToastOptions | undefined => {
    if (!options) return undefined
    if (typeof options === 'string') return { description: options }
    return options
  }

  const success = useCallback(
    (message: string, options?: string | ToastOptions) => showToast('success', message, normalizeOptions(options)),
    [showToast]
  )

  const error = useCallback(
    (message: string, options?: string | ToastOptions) => showToast('error', message, { ...normalizeOptions(options), duration: 7000 }),
    [showToast]
  )

  const info = useCallback(
    (message: string, options?: string | ToastOptions) => showToast('info', message, normalizeOptions(options)),
    [showToast]
  )

  const warning = useCallback(
    (message: string, options?: string | ToastOptions) => showToast('warning', message, normalizeOptions(options)),
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
  const { id, type, message, description, action } = toast

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
          {action && (
            <button
              onClick={() => {
                action.onClick()
                onClose(id)
              }}
              className={`text-xs mt-2 font-medium ${iconColor} hover:underline focus:outline-none focus:underline`}
            >
              {action.label} →
            </button>
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
