/**
 * OpsHeader — Minimal header for the Tesseract Operations Portal.
 */

import { ArrowLeft, Hexagon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function OpsHeader() {
  const navigate = useNavigate()

  return (
    <header className="h-12 flex-shrink-0 bg-gray-900 text-white flex items-center justify-between px-4 border-b border-gray-800">
      <div className="flex items-center gap-3">
        <Hexagon className="w-5 h-5 text-indigo-400" />
        <span className="text-sm font-semibold tracking-wide">Tesseract Operations</span>
      </div>
      <button
        onClick={() => navigate('/dashboard')}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Product
      </button>
    </header>
  )
}
