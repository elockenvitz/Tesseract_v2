import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, User, Calendar, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from './Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface FieldHistoryProps {
  assetId: string
  recordId: string
  fieldName?: string
  className?: string
  isExpanded?: boolean
}

interface FieldChange {
  id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_by_email: string | null
  changed_at: string
  change_type: 'insert' | 'update' | 'delete'
}

export function FieldHistory({ assetId, fieldName, className, isExpanded = false }: FieldHistoryProps) {
  const [internalExpanded, setInternalExpanded] = useState(false)
  const { user: currentUser } = useAuth()
  
  // Use external isExpanded prop if provided, otherwise use internal state
  const expanded = isExpanded || internalExpanded

  const { data: changes, isLoading } = useQuery({
    queryKey: ['asset-field-history', assetId, fieldName],
    queryFn: async () => {
      try {
        console.log('🔍 Fetching asset field history for:', { assetId: assetId.substring(0, 8), fieldName })
        
        // Use the RPC function to get asset field history
        const { data, error } = await supabase.rpc('get_asset_field_history', {
          p_asset_id: assetId,
          p_field_name: fieldName
        })
        
        if (error) throw error
        
        // Transform the data to match the expected FieldChange format
        const transformedData = data?.map((record: any) => ({
          id: record.id,
          field_name: record.field_name,
          old_value: record.old_value,
          new_value: record.new_value,
          changed_by: record.changed_by,
          changed_by_email: currentUser && record.changed_by === currentUser.id ? 'You' : record.changed_by_name,
          changed_at: record.changed_at,
          change_type: record.old_value ? 'update' : 'insert'
        })) || []
        
        console.log('✅ Asset field history data received:', transformedData?.length || 0, 'records')
        return transformedData
      } catch (error) {
        console.error('💥 Failed to fetch asset field history:', error)
        return []
      }
    },
    enabled: expanded,
    refetchInterval: expanded ? 3000 : false,
    staleTime: 0
  })

  const getChangeTypeColor = (type: string) => {
    switch (type) {
      case 'insert': return 'success'
      case 'update': return 'warning'
      case 'delete': return 'error'
      default: return 'default'
    }
  }

  const formatFieldName = (name: string) => {
    return name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const truncateValue = (value: string | null, maxLength = 100) => {
    if (!value) return 'Empty'
    if (value.length <= maxLength) return value
    return value.substring(0, maxLength) + '...'
  }

  return (
    <div className={clsx('h-full flex flex-col', className)}>
      {!isExpanded && (
        <button
          onClick={() => setInternalExpanded(!internalExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center space-x-2">
            <History className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">
              {fieldName ? `${formatFieldName(fieldName)} History` : 'Change History'}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            {changes && changes.length > 0 && (
              <Badge variant="default" size="sm">
                {changes.length} changes
              </Badge>
            )}
            {internalExpanded ? (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-400" />
            )}
          </div>
        </button>
      )}

      {expanded && (
        <div className={clsx(
          "flex-1 flex flex-col min-h-0",
          !isExpanded && "border-t border-gray-200"
        )}>
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
                          {change.changed_by_email || 'Unknown User'}
                        </span>
                        <Badge variant={getChangeTypeColor(change.change_type)} size="sm">
                          {change.change_type}
                        </Badge>
                        {!fieldName && (
                          <Badge variant="default" size="sm">
                            {formatFieldName(change.field_name)}
                          </Badge>
                        )}
                      </div>
                      
                      <div className="space-y-1">
                        {change.change_type === 'update' && (
                          <>
                            <div className="text-xs text-gray-600">
                              <span className="font-medium">From:</span>
                              <div className="mt-1 p-1.5 bg-red-50 border border-red-200 rounded text-red-800 text-xs max-h-16 overflow-y-auto custom-scrollbar">
                                {truncateValue(change.old_value)}
                              </div>
                            </div>
                            <div className="text-xs text-gray-600">
                              <span className="font-medium">To:</span>
                              <div className="mt-1 p-1.5 bg-green-50 border border-green-200 rounded text-green-800 text-xs max-h-16 overflow-y-auto custom-scrollbar">
                                {truncateValue(change.new_value)}
                              </div>
                            </div>
                          </>
                        )}
                        
                        {change.change_type === 'insert' && (
                          <div className="text-xs text-gray-600">
                            <span className="font-medium">Initial value:</span>
                            <div className="mt-1 p-1.5 bg-green-50 border border-green-200 rounded text-green-800 text-xs max-h-16 overflow-y-auto custom-scrollbar">
                              {truncateValue(change.new_value)}
                            </div>
                          </div>
                        )}
                        
                        {change.change_type === 'delete' && (
                          <div className="text-xs text-gray-600">
                            <span className="font-medium">Deleted value:</span>
                            <div className="mt-1 p-1.5 bg-red-50 border border-red-200 rounded text-red-800 text-xs max-h-16 overflow-y-auto custom-scrollbar">
                              {truncateValue(change.old_value)}
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
              <p className="text-sm">
                {isExpanded ? "No changes recorded for this field yet" : "No changes recorded yet"}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}