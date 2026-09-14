/**
 * OpsHeader — Minimal header for the Tesseract Operations Portal.
 */

import { ArrowLeft, Hexagon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function OpsHeader() {
  const navigate = useNavigate()

  return (
    <header className="h-12 flex-shrink-0 bg-gray-900 text-white flex items-center justify-between gap-3 px-4 border-b border-gray-800">
      <div className="flex items-center gap-3 min-w-0">
        <Hexagon className="w-5 h-5 text-indigo-400 shrink-0" />
        <span className="text-sm font-semibold tracking-wide truncate">Tesseract Operations</span>
      </div>
      <button
        onClick={() => navigate('/dashboard')}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors shrink-0 whitespace-nowrap"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Product
      </button>
    </header>
  )
}
