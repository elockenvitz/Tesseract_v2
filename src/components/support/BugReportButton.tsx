/**
 * BugReportButton — Floating bug report button (bottom-right corner).
 * Opens the BugReportModal when clicked.
 */

import { useState } from 'react'
import { Bug } from 'lucide-react'
import { BugReportModal } from './BugReportModal'

export function BugReportButton() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-40 w-10 h-10 rounded-full bg-gray-800 hover:bg-gray-700 text-white shadow-lg flex items-center justify-center transition-all hover:scale-105"
        title="Report a bug"
      >
        <Bug className="w-4.5 h-4.5" />
      </button>

      {isOpen && (
        <BugReportModal onClose={() => setIsOpen(false)} />
      )}
    </>
  )
}
