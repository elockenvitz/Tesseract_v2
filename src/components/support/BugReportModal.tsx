/**
 * BugReportModal — In-app bug reporting form.
 * Captures title, description, severity, current URL, and browser info.
 */

import { useState, useMemo } from 'react'
import { X, Bug, AlertTriangle, AlertCircle, Info } from 'lucide-react'
import { useBugReports } from '../../hooks/useBugReports'
import { useToast } from '../common/Toast'
import type { BugReport } from '../../hooks/useBugReports'
import { TabStateManager } from '../../lib/tabStateManager'

interface BugReportModalProps {
  onClose: () => void
}

const SEVERITY_OPTIONS: { value: BugReport['severity']; label: string; icon: typeof Info; cls: string }[] = [
  { value: 'low', label: 'Low', icon: Info, cls: 'text-gray-500 border-gray-300 hover:border-gray-400' },
  { value: 'medium', label: 'Medium', icon: AlertCircle, cls: 'text-amber-600 border-amber-300 hover:border-amber-400' },
  { value: 'high', label: 'High', icon: AlertTriangle, cls: 'text-orange-600 border-orange-300 hover:border-orange-400' },
  { value: 'critical', label: 'Critical', icon: AlertTriangle, cls: 'text-red-600 border-red-300 hover:border-red-400' },
]

export function BugReportModal({ onClose }: BugReportModalProps) {
  const { submitReport } = useBugReports()
  const { success, error: showError } = useToast()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<BugReport['severity']>('medium')

  // Read active tab context from session storage
  const pageContext = useMemo(() => {
    try {
      const state = TabStateManager.loadMainTabState()
      if (!state) return null
      const activeTab = state.tabs.find((t: any) => t.id === state.activeTabId) || state.tabs.find((t: any) => t.isActive)
      if (!activeTab) return null
      return {
        tabType: activeTab.type,
        tabTitle: activeTab.title,
        tabId: activeTab.id,
        assetSymbol: activeTab.data?.symbol || activeTab.data?.assetSymbol || null,
        portfolioName: activeTab.data?.name || activeTab.data?.portfolioName || null,
        subPage: activeTab.data?.activeSubPage || activeTab.data?.subPage || null,
      }
    } catch {
      return null
    }
  }, [])

  const handleSubmit = async () => {
    if (!title.trim()) return

    try {
      const contextLabel = pageContext
        ? [
            pageContext.tabType,
            pageContext.tabTitle,
            pageContext.assetSymbol && `asset:${pageContext.assetSymbol}`,
            pageContext.portfolioName && `portfolio:${pageContext.portfolioName}`,
            pageContext.subPage && `subpage:${pageContext.subPage}`,
          ].filter(Boolean).join(' / ')
        : window.location.pathname

      await submitReport.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        severity,
        page_url: contextLabel,
        browser_info: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          activeTab: pageContext || null,
        },
      })
      success('Bug report submitted. Thank you for your feedback.')
      onClose()
    } catch (err: any) {
      showError(err.message || 'Failed to submit report')
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />

      {/* Modal */}
      <div className="fixed bottom-20 right-5 z-50 w-[420px] max-h-[80vh] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-gray-600" />
            <h2 className="text-sm font-semibold text-gray-800">Report an Issue</h2>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">What went wrong?</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the issue"
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Details (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs. actual behavior..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Severity */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Severity</label>
            <div className="flex gap-2">
              {SEVERITY_OPTIONS.map((opt) => {
                const Icon = opt.icon
                const isSelected = severity === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setSeverity(opt.value)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                      isSelected
                        ? `${opt.cls} bg-gray-50 border-2`
                        : 'text-gray-400 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Context (auto-captured) */}
          <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-0.5">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1">Auto-captured</p>
            {pageContext ? (
              <>
                <p className="text-xs text-gray-500 truncate">
                  View: <span className="font-medium text-gray-600">{pageContext.tabTitle}</span>
                  <span className="text-gray-400"> ({pageContext.tabType})</span>
                </p>
                {pageContext.assetSymbol && (
                  <p className="text-xs text-gray-500 truncate">Asset: <span className="font-medium text-gray-600">{pageContext.assetSymbol}</span></p>
                )}
                {pageContext.portfolioName && (
                  <p className="text-xs text-gray-500 truncate">Portfolio: <span className="font-medium text-gray-600">{pageContext.portfolioName}</span></p>
                )}
                {pageContext.subPage && (
                  <p className="text-xs text-gray-500 truncate">Section: <span className="font-medium text-gray-600">{pageContext.subPage}</span></p>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-500 truncate">Page: {window.location.pathname}</p>
            )}
            <p className="text-xs text-gray-500 truncate">Browser: {navigator.userAgent.split(' ').slice(-2).join(' ')}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitReport.isPending}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-white disabled:opacity-50 transition-colors"
          >
            {submitReport.isPending ? 'Submitting...' : 'Submit Report'}
          </button>
        </div>
      </div>
    </>
  )
}
