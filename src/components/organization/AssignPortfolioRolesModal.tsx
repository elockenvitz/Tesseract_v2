/**
 * AssignPortfolioRolesModal — lets the admin assign portfolio roles (with
 * optional focus) for every linked portfolio when adding a member to a team
 * node. Portfolios can be excluded individually.
 *
 * Used by: OrganizationPage when adding a member to a team-type node.
 */

import { useState, useMemo } from 'react'
import { Briefcase, ChevronDown, Check, X } from 'lucide-react'
import { ROLE_OPTIONS, getFocusOptionsForRole } from '../../lib/roles-config'

// ─── Types ──────────────────────────────────────────────────────────────

export interface LinkedPortfolio {
  nodeId: string
  portfolioId: string
  name: string
}

export interface PortfolioRoleAssignment {
  nodeId: string
  portfolioId: string
  role: string
  focus?: string
}

interface AssignPortfolioRolesModalProps {
  /** Team node the user is being added to */
  teamName: string
  /** User being added */
  userName: string
  /** All portfolios linked to this team node */
  linkedPortfolios: LinkedPortfolio[]
  /** Callback when confirmed */
  onConfirm: (assignments: PortfolioRoleAssignment[]) => void
  /** Callback when cancelled */
  onCancel: () => void
  /** Loading state */
  isLoading?: boolean
}

// ─── Component ──────────────────────────────────────────────────────────

export function AssignPortfolioRolesModal({
  teamName,
  userName,
  linkedPortfolios,
  onConfirm,
  onCancel,
  isLoading = false,
}: AssignPortfolioRolesModalProps) {
  // Role state per portfolio nodeId
  const [roles, setRoles] = useState<Record<string, string>>({})
  // Focus state per portfolio nodeId
  const [focuses, setFocuses] = useState<Record<string, string>>({})
  // Excluded portfolios
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  // "Apply to all" bulk role
  const [bulkRole, setBulkRole] = useState('')

  const includedPortfolios = useMemo(
    () => linkedPortfolios.filter((p) => !excluded.has(p.nodeId)),
    [linkedPortfolios, excluded],
  )

  const allAssigned = useMemo(
    () => includedPortfolios.length > 0 && includedPortfolios.every((p) => roles[p.nodeId]?.length > 0),
    [includedPortfolios, roles],
  )

  const assignedCount = useMemo(
    () => includedPortfolios.filter((p) => roles[p.nodeId]?.length > 0).length,
    [includedPortfolios, roles],
  )

  const handleSetRole = (nodeId: string, role: string) => {
    setRoles((prev) => ({ ...prev, [nodeId]: role }))
    // Clear focus when role changes (focus options depend on role)
    setFocuses((prev) => ({ ...prev, [nodeId]: '' }))
  }

  const handleSetFocus = (nodeId: string, focus: string) => {
    setFocuses((prev) => ({ ...prev, [nodeId]: focus }))
  }

  const toggleExclude = (nodeId: string) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  const handleApplyToAll = () => {
    if (!bulkRole) return
    const updated: Record<string, string> = { ...roles }
    const updatedFocus: Record<string, string> = { ...focuses }
    for (const p of includedPortfolios) {
      updated[p.nodeId] = bulkRole
      updatedFocus[p.nodeId] = ''
    }
    setRoles(updated)
    setFocuses(updatedFocus)
  }

  const handleConfirm = () => {
    if (!allAssigned) return
    const assignments: PortfolioRoleAssignment[] = includedPortfolios.map((p) => ({
      nodeId: p.nodeId,
      portfolioId: p.portfolioId,
      role: roles[p.nodeId],
      focus: focuses[p.nodeId] || undefined,
    }))
    onConfirm(assignments)
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-[70]" onClick={onCancel} />

      {/* Modal */}
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div
          className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
            <h3 className="text-base font-semibold text-gray-900">
              Assign Portfolio Roles
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Adding <span className="font-medium text-gray-700">{userName}</span> to{' '}
              <span className="font-medium text-gray-700">{teamName}</span>.
              Assign a role for each portfolio, or exclude portfolios that don't apply.
            </p>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Apply to all */}
            {linkedPortfolios.length > 1 && (
              <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
                <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
                  Apply to all:
                </span>
                <select
                  value={bulkRole}
                  onChange={(e) => setBulkRole(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">Select role...</option>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleApplyToAll}
                  disabled={!bulkRole}
                  className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Apply
                </button>
              </div>
            )}

            {/* Per-portfolio rows */}
            <div className="space-y-2">
              {linkedPortfolios.map((p) => {
                const isExcluded = excluded.has(p.nodeId)
                const selected = roles[p.nodeId] || ''
                const focusOpts = getFocusOptionsForRole(selected)
                const selectedFocus = focuses[p.nodeId] || ''

                return (
                  <div
                    key={p.nodeId}
                    className={`rounded-lg border transition-colors ${
                      isExcluded
                        ? 'border-gray-100 bg-gray-50 opacity-60'
                        : selected
                          ? 'border-indigo-200 bg-indigo-50/40'
                          : 'border-gray-200 bg-white'
                    }`}
                  >
                    {/* Main row */}
                    <div className="flex items-center gap-3 p-3">
                      <Briefcase className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className={`text-sm font-medium min-w-0 truncate flex-1 ${isExcluded ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                        {p.name}
                      </span>

                      {!isExcluded && (
                        <div className="relative shrink-0">
                          <select
                            value={selected}
                            onChange={(e) => handleSetRole(p.nodeId, e.target.value)}
                            className={`appearance-none pl-3 pr-7 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer ${
                              selected
                                ? 'border-indigo-300 bg-white text-gray-900'
                                : 'border-gray-300 bg-white text-gray-500'
                            }`}
                          >
                            <option value="">Select role...</option>
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                        </div>
                      )}

                      {!isExcluded && selected && (
                        <Check className="w-4 h-4 text-indigo-500 shrink-0" />
                      )}

                      {/* Exclude / re-include toggle */}
                      <button
                        type="button"
                        onClick={() => toggleExclude(p.nodeId)}
                        title={isExcluded ? 'Re-include this portfolio' : 'Exclude from assignment'}
                        className={`shrink-0 p-1 rounded transition-colors ${
                          isExcluded
                            ? 'text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50'
                            : 'text-gray-300 hover:text-red-500 hover:bg-red-50'
                        }`}
                      >
                        {isExcluded ? (
                          <span className="text-xs font-medium px-1">Undo</span>
                        ) : (
                          <X className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {/* Focus row (shown when role is selected and has focus options) */}
                    {!isExcluded && selected && focusOpts.length > 0 && (
                      <div className="px-3 pb-3 pt-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 shrink-0">Focus:</span>
                          <div className="flex flex-wrap gap-1">
                            {focusOpts.map((f) => (
                              <button
                                key={f}
                                type="button"
                                onClick={() => handleSetFocus(p.nodeId, selectedFocus === f ? '' : f)}
                                className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                                  selectedFocus === f
                                    ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                }`}
                              >
                                {f}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl flex items-center justify-between shrink-0">
            <span className="text-xs text-gray-500">
              {assignedCount} of {includedPortfolios.length} included portfolios assigned
              {excluded.size > 0 && (
                <span className="text-gray-400"> ({excluded.size} excluded)</span>
              )}
            </span>
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!allAssigned || isLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Adding...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
