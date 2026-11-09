import { useState, useSyncExternalStore } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '../ui/Button'
import {
  getPendingNavigation,
  resolveUnsavedNavigation,
  subscribeUnsavedGuard,
} from '../../lib/contributions/unsaved-edits-guard'

/**
 * UX1c-2b — the single prompt that fronts the in-app unsaved-research guard.
 *
 * Mounted once, high in the tree (DashboardPage), so it can front navigation
 * from anywhere — the Research sub-tabs and perspective switches inside
 * AssetTab as well as the main tab switch/close in DashboardPage that unmounts
 * AssetTab entirely. It renders nothing until a gesture is held.
 *
 * Three outcomes, matching the guard contract:
 *   Stay          keep editing (cancel the navigation)
 *   Discard       lose the changes and continue
 *   Save draft    run the existing draft-save, then continue only on success
 */
export function UnsavedEditsPrompt() {
  const pending = useSyncExternalStore(subscribeUnsavedGuard, getPendingNavigation)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!pending) return null

  const stay = () => {
    setError(null)
    void resolveUnsavedNavigation('stay')
  }

  const discard = () => {
    setError(null)
    void resolveUnsavedNavigation('discard')
  }

  const saveDraft = async () => {
    setError(null)
    setSaving(true)
    try {
      await resolveUnsavedNavigation('save')
      // On success the gesture has already navigated; this component unmounts
      // with the editor. Reset in case it stays mounted (clean navigation).
    } catch {
      // Save failed: the guard kept the gesture pending and all editor state.
      setError('Could not save your draft. Your changes are still here — try again or Stay.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-auto dark:bg-gray-800">
          <button
            onClick={stay}
            disabled={saving}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300"
            aria-label="Keep editing"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="p-6">
            <div className="flex items-center justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-warning-100 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-warning-600" />
              </div>
            </div>

            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-white">
                Unsaved changes to your Investment Case
              </h3>
              <p className="text-gray-600 text-sm leading-relaxed dark:text-gray-400">
                You're editing a section and haven't saved yet. Leaving now will discard your
                changes.
              </p>
              {error && (
                <p className="mt-3 text-error-600 text-sm dark:text-error-400">{error}</p>
              )}
            </div>

            <div className="flex flex-col space-y-2">
              <Button variant="primary" onClick={saveDraft} loading={saving} className="w-full">
                Save draft &amp; leave
              </Button>
              <div className="flex space-x-3">
                <Button variant="outline" onClick={stay} disabled={saving} className="flex-1">
                  Stay
                </Button>
                <Button variant="danger" onClick={discard} disabled={saving} className="flex-1">
                  Discard changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
