import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { List, Search, Plus, Star, Users, Calendar } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { AssetListManager } from '../components/lists/AssetListManager'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface ListsPageProps {
  onListSelect?: (list: any) => void
}

export function ListsPage({ onListSelect }: ListsPageProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showListManager, setShowListManager] = useState(false)

  // Fetch all user's lists
  const { data: assetLists, isLoading } = useQuery({
    queryKey: ['asset-lists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_lists')
        .select(`
          *,
          asset_list_items(id),
          asset_list_collaborations(
            user_id,
            permission,
            collaborator_user:users!asset_list_collaborations_user_id_fkey(email, first_name, last_name)
          )
        `)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
      
      if (error) throw error
      
      return (data || []).map(list => ({
        ...list,
        item_count: list.asset_list_items?.length || 0,
        collaborators: (list.asset_list_collaborations || []).map(collab => ({
          ...collab,
          user: collab.collaborator_user
        }))
      }))
    }
  })

  const filteredLists = assetLists?.filter(list =>
    !searchQuery ||
    list.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (list.description && list.description.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || []

  const handleListClick = (list: any) => {
    if (onListSelect) {
      onListSelect({
        id: list.id,
        title: list.name,
        type: 'list',
        data: list
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Asset Lists</h1>
          <p className="text-gray-600">
            Organize your assets into custom lists for better tracking
          </p>
        </div>
        <Button onClick={() => setShowListManager(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New List
        </Button>
      </div>

      {/* Search */}
      <Card>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search lists by name or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </Card>

      {/* Lists Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <Card>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-4 h-4 bg-gray-200 rounded-full"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                  </div>
                  <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                </div>
              </Card>
            </div>
          ))}
        </div>
      ) : filteredLists.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredLists.map((list) => (
            <div
              key={list.id}
              onClick={() => handleListClick(list)}
              className="cursor-pointer"
            >
              <Card className="hover:shadow-md transition-shadow duration-200">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <div 
                    className="w-4 h-4 rounded-full border-2 border-white shadow-sm flex-shrink-0"
                    style={{ backgroundColor: list.color || '#3b82f6' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {list.name}
                      </h3>
                      {list.is_default && (
                        <Star className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                      )}
                    </div>
                    {list.description && (
                      <p className="text-sm text-gray-600 line-clamp-2 mt-1">
                        {list.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center text-gray-600">
                      <List className="h-4 w-4 mr-1" />
                      <span>{list.item_count} assets</span>
                    </div>
                    {list.collaborators && list.collaborators.length > 0 && (
                      <div className="flex items-center text-gray-600">
                        <Users className="h-4 w-4 mr-1" />
                        <span>{list.collaborators.length}</span>
                      </div>
                    )}
                  </div>
                  {list.collaborators && list.collaborators.length > 0 && (
                    <Badge variant="primary" size="sm">
                      <Share2 className="h-3 w-3 mr-1" />
                      Shared
                    </Badge>
                  )}
                </div>
                
                <div className="flex items-center text-xs text-gray-500">
                  <Calendar className="h-3 w-3 mr-1" />
                  Updated {formatDistanceToNow(new Date(list.updated_at || list.created_at || ''), { addSuffix: true })}
                </div>
              </div>
              </Card>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <List className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {assetLists?.length === 0 ? 'No lists yet' : 'No lists match your search'}
          </h3>
          <p className="text-gray-500 mb-4">
            {assetLists?.length === 0 
              ? 'Your default lists should be created automatically. Try refreshing the page.'
              : 'Try adjusting your search criteria.'
            }
          </p>
          {assetLists?.length === 0 && (
            <Button onClick={() => setShowListManager(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create First List
            </Button>
          )}
        </div>
      )}

      {/* List Manager Modal */}
      <AssetListManager
        isOpen={showListManager}
        onClose={() => setShowListManager(false)}
        onListSelect={onListSelect}
      />
    </div>
  )
}