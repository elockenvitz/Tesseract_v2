/**
 * The toast context, its types, and the accessor that tolerates its absence.
 *
 * Separate from `Toast.tsx` for the reason `CoverageRelevanceContext` is
 * separate from `CoverageRelevanceProvider`: a module that exports a
 * component and a module that exports hooks are different things to React
 * Refresh, and each extra non-component export costs the file its
 * fast-refresh boundary. `Toast.tsx` keeps the provider and `useToast`,
 * which 46 files import by path; this holds everything that is not a
 * component.
 *
 * The types live HERE and not in `Toast.tsx`. They were there first, and
 * importing them back from this module made a cycle: Rollup erased the
 * type-only edge so the production build was clean, while the dev server
 * left `ToastContext` undefined at the moment `useToast` read it, and the
 * whole dashboard hit its error boundary. A module that owns a context owns
 * the types that describe it. `Toast.tsx` re-exports them so no caller
 * changes.
 */
import { createContext, useContext } from 'react'

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

export interface ToastContextType {
  toasts: Toast[]
  showToast: (type: ToastType, message: string, options?: ToastOptions) => void
  hideToast: (id: string) => void
  success: (message: string, options?: string | ToastOptions) => void
  error: (message: string, options?: string | ToastOptions) => void
  info: (message: string, options?: string | ToastOptions) => void
  warning: (message: string, options?: string | ToastOptions) => void
}

export const ToastContext = createContext<ToastContextType | undefined>(undefined)

/**
 * The toast API for a component that must not take the page down when
 * nobody mounted a provider — a leaf rendered by a harness, a story, or a
 * test. Mirrors `useOrganizationOptional`: a throw in a leaf costs the
 * whole surface, and a missing provider should cost a message.
 *
 * The shape matches the real context, so callers need no null checks.
 */
const NO_TOAST: Pick<ToastContextType, 'showToast' | 'success' | 'error' | 'info' | 'warning'> = {
  showToast: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  warning: () => {},
}

export function useToastOptional() {
  return useContext(ToastContext) ?? NO_TOAST
}
