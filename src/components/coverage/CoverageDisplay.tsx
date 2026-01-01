import { Users, Star, Shield, UserCheck, User, FileText, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface CoverageRecord {
  id: string
  user_id?: string | null
  analyst_name: string
  role?: string | null
  portfolio_id?: string | null
  portfolio?: { name: string } | null
  portfolios?: { name: string }[]
  created_at: string
  updated_at: string
}

interface ThesisStatus {
  userId: string
  hasThesis: boolean
  lastUpdated?: string
  isStale?: boolean // More than 90 days old
}

interface CoverageDisplayProps {
  assetId?: string
  coverage: CoverageRecord[]
  className?: string
  showPortfolio?: boolean
  showHeader?: boolean
  thesisStatuses?: ThesisStatus[]
  showThesisStatus?: boolean
  onUserClick?: (user: { id: string; full_name: string }) => void
}

// Default role configurations for system roles
const systemRoleConfig: Record<string, { label: string; icon: typeof Star; color: string; bgColor: string }> = {
  primary: {
    label: 'Primary',
    icon: Star,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
  },
  secondary: {
    label: 'Secondary',
    icon: Shield,
    color: 'text-blue-500',
    bgColor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
  },
  tertiary: {
    label: 'Tertiary',
    icon: UserCheck,
    color: 'text-gray-400',
    bgColor: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
  },
}

export function CoverageDisplay({
  coverage,
  className,
  showPortfolio = false,
  showHeader = true,
  thesisStatuses = [],
  showThesisStatus = false,
  onUserClick
}: CoverageDisplayProps) {
  // Sort by role: primary first, then secondary, then tertiary, then custom roles, then no role
  const sortedCoverage = [...(coverage || [])].sort((a, b) => {
    const roleOrder: Record<string, number> = { primary: 0, secondary: 1, tertiary: 2 }
    const aOrder = a.role ? (roleOrder[a.role] ?? 3) : 4
    const bOrder = b.role ? (roleOrder[b.role] ?? 3) : 4
    return aOrder - bOrder
  })

  // Create a map of thesis statuses by user ID
  const thesisStatusMap = new Map(thesisStatuses.map(t => [t.userId, t]))

  return (
    <div className={clsx('space-y-2', className)}>
      {showHeader && (
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Coverage</p>
      )}
      {sortedCoverage && sortedCoverage.length > 0 ? (
        <div className="space-y-1.5">
          {sortedCoverage.map((analyst) => {
            const role = analyst.role
            const isSystemRole = role && systemRoleConfig[role]
            const config = isSystemRole ? systemRoleConfig[role] : null
            const RoleIcon = config?.icon || User

            // Get portfolio names - support both single portfolio and multiple portfolios
            const portfolioNames = analyst.portfolios?.map(p => p.name) ||
              (analyst.portfolio?.name ? [analyst.portfolio.name] : [])

            // Get thesis status for this analyst
            const thesisStatus = analyst.user_id ? thesisStatusMap.get(analyst.user_id) : null

            return (
              <div key={analyst.id} className="flex items-center space-x-2">
                <RoleIcon className={clsx('h-3 w-3 flex-shrink-0', config?.color || 'text-gray-400')} />
                <span
                  className={clsx(
                    'text-sm text-gray-700 dark:text-gray-300 truncate',
                    onUserClick && analyst.user_id && 'hover:text-primary-600 cursor-pointer hover:underline'
                  )}
                  onClick={() => {
                    if (onUserClick && analyst.user_id) {
                      onUserClick({ id: analyst.user_id, full_name: analyst.analyst_name })
                    }
                  }}
                >
                  {analyst.analyst_name}
                </span>
                {role && (
                  <span className={clsx(
                    'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                    config?.bgColor || 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                  )}>
                    {config?.label || role}
                  </span>
                )}
                {showPortfolio && portfolioNames.length > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                    ({portfolioNames.join(', ')})
                  </span>
                )}
                {/* Thesis status indicator */}
                {showThesisStatus && (
                  <span className={clsx(
                    'text-[10px] px-1.5 py-0.5 rounded-full font-medium inline-flex items-center gap-0.5',
                    thesisStatus?.hasThesis
                      ? thesisStatus.isStale
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  )}
                  title={thesisStatus?.hasThesis
                    ? `Thesis updated ${thesisStatus.lastUpdated ? formatDistanceToNow(new Date(thesisStatus.lastUpdated), { addSuffix: true }) : 'recently'}`
                    : 'No thesis on file'
                  }
                  >
                    {thesisStatus?.hasThesis ? (
                      <>
                        <FileText className="w-2.5 h-2.5" />
                        {thesisStatus.isStale ? 'Stale' : 'Current'}
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-2.5 h-2.5" />
                        No Thesis
                      </>
                    )}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex items-center space-x-2">
          <Users className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Not Covered</span>
        </div>
      )}
    </div>
  )
}
