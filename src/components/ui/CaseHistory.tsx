import { History, Calendar, Target, Clock, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from './Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'

interface CaseHistoryProps {
  priceTargetId: string
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

export function CaseHistory({ priceTargetId, caseType, className }: CaseHistoryProps) {
  const { user: currentUser } = useAuth()

  const { data: changes, isLoading } = useQuery({
    queryKey: ['case-history', priceTargetId, caseType],
    queryFn: async () => {
      if (!priceTargetId) return []
      
      console.log('🔍 Fetching case history for:', { priceTargetId, caseType })
      
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
        .order('changed_at', { ascending: false })
      
      if (error) {
        console.error('❌ Failed to fetch case history:', error)
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
      
      console.log('✅ Case history data received:', transformedData?.length || 0, 'records')
      return transformedData
    },
    enabled: !!priceTargetId,
    refetchInterval: 500, // Refetch every 500ms
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


  const getFieldIcon = (fieldName: string) => {
    switch (fieldName) {
      case 'price': return <Target className="h-3 w-3" />
      case 'timeframe': return <Clock className="h-3 w-3" />
      case 'reasoning': return <FileText className="h-3 w-3" />
      default: return <History className="h-3 w-3" />
    }
  }

  // Group changes by date for better organization
  const groupedChanges = changes?.reduce((groups, change) => {
    const date = new Date(change.changed_at).toDateString()
    if (!groups[date]) {
      groups[date] = []
    }
    groups[date].push(change)
    return groups
  }, {} as { [key: string]: FieldChange[] }) || {}

  return (
    <div className={clsx('h-full flex flex-col', className)}>
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
          {Object.entries(groupedChanges).map(([date, dateChanges]) => (
            <div key={date} className="border-b border-gray-100 last:border-b-0">
              <div className="sticky top-0 bg-gray-50 px-4 py-2 border-b border-gray-200">
                <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  {new Date(date).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </h4>
              </div>
              
              {dateChanges.map((change, index) => (
                <div
                  key={change.id}
                  className={clsx(
                    'p-4 border-b border-gray-50 last:border-b-0',
                    index === 0 && date === Object.keys(groupedChanges)[0] && 'bg-blue-50' // Highlight most recent change
                  )}
                >
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0">
                      <div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center">
                        {getFieldIcon(change.field_name)}
                      </div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="text-sm font-medium text-gray-900">
                          {change.changed_by_name || 'Unknown User'}
                        </span>
                        <span className="text-xs text-gray-500">updated</span>
                        <Badge variant="default" size="sm">
                          {formatFieldName(change.field_name)}
                        </Badge>
                        <Badge variant={getChangeTypeColor(change.change_type)} size="sm">
                          {change.change_type}
                        </Badge>
                      </div>
                      
                      <div className="space-y-2">
                        {change.change_type === 'update' && (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="text-xs">
                              <span className="font-medium text-gray-600">From:</span>
                              <div className="mt-1 p-2 bg-red-50 border border-red-200 rounded text-red-800">
                                {formatValue(change.old_value, change.field_name)}
                              </div>
                            </div>
                            <div className="text-xs">
                              <span className="font-medium text-gray-600">To:</span>
                              <div className="mt-1 p-2 bg-green-50 border border-green-200 rounded text-green-800">
                                {formatValue(change.new_value, change.field_name)}
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {change.change_type === 'insert' && (
                          <div className="text-xs">
                            <span className="font-medium text-gray-600">Initial value:</span>
                            <div className="mt-1 p-2 bg-green-50 border border-green-200 rounded text-green-800">
                              {formatValue(change.new_value, change.field_name)}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center space-x-2 mt-2 text-xs text-gray-400">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {formatDistanceToNow(new Date(change.changed_at), { addSuffix: true })}
                        </span>
                        <span>•</span>
                        <span>
                          {new Date(change.changed_at).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="p-6 text-center text-gray-500 flex-1 flex flex-col items-center justify-center">
          <History className="h-8 w-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm">No changes recorded for this {caseType} case yet</p>
          <p className="text-xs text-gray-400 mt-1">Changes will appear here when you update price targets</p>
        </div>
      )}
    </div>
  )
}