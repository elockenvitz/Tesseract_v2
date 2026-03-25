/**
 * useMyPriorities — Re-exports from useAttention for backward compatibility.
 *
 * The My Priorities page now uses useAttention directly. This file exists
 * so any remaining imports from useMyPriorities don't break.
 */

export { useAttention as useMyPriorities } from './useAttention'
