import { Users } from 'lucide-react'
import { clsx } from 'clsx'

interface CoverageDisplayProps {
  assetId?: string
  coverage: Array<{
    id: string
    analyst_name: string
    created_at: string
    updated_at: string
  }>
  className?: string
}

export function CoverageDisplay({ coverage, className }: CoverageDisplayProps) {
  return (
    <div className={clsx('space-y-2', className)}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Coverage</p>
      {coverage && coverage.length > 0 ? (
        <div className="space-y-1">
          {coverage.map((analyst) => (
            <div key={analyst.id} className="flex items-center space-x-2">
              <Users className="h-3 w-3 text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-700 truncate">{analyst.analyst_name}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center space-x-2">
          <Users className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <span className="text-sm text-gray-500">Not Covered</span>
        </div>
      )}
    </div>
  )
}