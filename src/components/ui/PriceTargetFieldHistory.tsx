import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, User, Calendar, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from './Card'
import { Badge } from './Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface PriceTargetFieldHistoryProps {
  priceTargetId: string
  fieldName: string
  caseType: 'bull' | 'base' | 'bear'
  className?: string
}

interface FieldChange {
  id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_by_name: string | null
  changed_at: string
  change_type: 'insert' | 'update'
}

export function PriceTargetFieldHistory({ 
  priceTargetId, 
  fieldName, 
  caseType, 
  className 
}: PriceTargetFieldHistoryProps) {
  const [expanded, setExpanded] = useState(false)
  const { user: currentUser } = useAuth()

  const { data: changes, isLoading } = useQuery({
    queryKey: ['price-target-history', priceTargetId, fieldName],
    queryFn: async () => {
      console.log('🔍 Fetching price target history for:', { priceTargetId, fieldName, caseType })
      
      const { data, error } = await supabase
        .from('price_target_history')
        .select(`
          id,
          field_name,
          old_value,
          new_value,
          changed_by,
          changed_at
        `)
        .eq('price_target_id', priceTargetId)
        .eq('field_name', fieldName)
        .order('changed_at', { ascending: false })
      
      if (error) {
        console.error('❌ Failed to fetch price target history:', error)
        throw error
      }
      
      // Get unique user IDs from the records
      const userIds = new Set<string>()
      data?.forEach(record => {
        if (record.changed_by) userIds.add(record.changed_by)
      })
      
      // Fetch user details for all user IDs
      let userDetails: { [key: string]: any } = {}
      if (userIds.size > 0) {
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, email, first_name, last_name')
          .in('id', Array.from(userIds))
        
        if (!usersError && users) {
          users.forEach(user => {
            userDetails[user.id] = user
          })
        }
      }
      
      // Helper function to get user display name
      const getUserDisplayName = (userId: string | null) => {
        if (!userId) return 'Unknown User'
        
        // If it's the current user, show "You"
        if (currentUser && userId === currentUser.id) {
          return 'You'
        }
        
        const user = userDetails[userId]
        if (!user) return 'Unknown User'
        
        if (user.first_name && user.last_name) {
          return `${user.first_name} ${user.last_name}`
        }
        
        if (user.email) {
          return user.email.split('@')[0]
        }
        
        return 'Unknown User'
      }
      
      // Transform the data to match the expected FieldChange format
      const transformedData: FieldChange[] = data?.map(record => ({
        id: record.id,
        field_name: record.field_name,
        old_value: record.old_value,
        new_value: record.new_value,
        changed_by: record.changed_by,
        changed_by_name: getUserDisplayName(record.changed_by),
        changed_at: record.changed_at,
        change_type: record.old_value === null ? 'insert' : 'update'
      })) || []
      
      console.log('✅ Price target history data received:', transformedData?.length || 0, 'records')
      return transformedData
    },
    enabled: expanded,
    refetchInterval: expanded ? 500 : false, // Refetch every 500ms when expanded
    staleTime: 0 // Always fetch fresh data
  })

  const getChangeTypeColor = (type: string) => {
    switch (type) {
      case 'insert': return 'success'
      case 'update': return 'warning'
      default: return 'default'
    }
  }

  const formatFieldName = (name: string) => {
    return name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const formatValue = (value: string | null, field: string) => {
    if (!value) return 'Empty'
    
    if (field === 'price') {
      const numValue = parseFloat(value)
      return isNaN(numValue) ? value : `$${numValue.toFixed(2)}`
    }
    
    return value
  }

  const getCaseColor = (caseType: string) => {
    switch (caseType) {
      case 'bull': return 'text-success-600'
      case 'base': return 'text-warning-600'
      case 'bear': return 'text-error-600'
      default: return 'text-gray-600'
    }
  }

  return (
    <Card className={clsx('h-full flex flex-col', className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <History className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">
            <span className={clsx('capitalize', getCaseColor(caseType))}>{caseType}</span> Case {formatFieldName(fieldName)} History
          </span>
        </div>
        <div className="flex items-center space-x-2">
          {changes && changes.length > 0 && (
            <Badge variant="default" size="sm">
              {changes.length} changes
            </Badge>
          )}
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-gray-200">
          {isLoading ? (
            <div className="p-4 flex-1">
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                        <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : changes && changes.length > 0 ? (
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {changes.map((change, index) => (
                <div
                  key={change.id}
                  className={clsx(
                    'p-3 border-b border-gray-100 last:border-b-0 flex-shrink-0',
                    index === 0 && 'bg-blue-50' // Highlight most recent change
                  )}
                >
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0">
                      <div className="w-5 h-5 bg-gray-100 rounded-full flex items-center justify-center">
                        <User className="h-3 w-3 text-gray-600" />
                      </div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="text-xs font-medium text-gray-900">
                          {change.changed_by_name || 'Unknown User'}
                        </span>
                        <Badge variant={getChangeTypeColor(change.change_type)} size="sm">
                          {change.change_type}
                        </Badge>
                        <Badge variant="default" size="sm">
                          <span className={getCaseColor(caseType)}>{caseType} case</span>
                        </Badge>
                      </div>
                      
                      <div className="space-y-1">
                        {change.change_type === 'update' && (
                          <>
                            <div className="text-xs text-gray-600">
                              <span className="font-medium">From:</span>
                              <div className="mt-1 p-1.5 bg-red-50 border border-red-200 rounded text-red-800 text-xs">
                                {formatValue(change.old_value, fieldName)}
                              </div>
                            </div>
                            <div className="text-xs text-gray-600">
                              <span className="font-medium">To:</span>
                              <div className="mt-1 p-1.5 bg-green-50 border border-green-200 rounded text-green-800 text-xs">
                                {formatValue(change.new_value, fieldName)}
                              </div>
                            </div>
                          </>
                        )}
                        
                        {change.change_type === 'insert' && (
                          <div className="text-xs text-gray-600">
                            <span className="font-medium">Initial value:</span>
                            <div className="mt-1 p-1.5 bg-green-50 border border-green-200 rounded text-green-800 text-xs">
                              {formatValue(change.new_value, fieldName)}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center space-x-2 mt-1 text-xs text-gray-400">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {formatDistanceToNow(new Date(change.changed_at), { addSuffix: true })}
                        </span>
                        <span>•</span>
                        <span>
                          {new Date(change.changed_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-gray-500 flex-1 flex flex-col items-center justify-center">
              <History className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm">No changes recorded for this {caseType} case {fieldName.toLowerCase()} yet</p>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}