import { useSearchParams } from 'react-router-dom'
import { Card } from '../components/ui/Card'
import { Search } from 'lucide-react'

export function SearchPage() {
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q') || ''

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Search Results</h1>
        {query && (
          <p className="text-gray-600 mt-1">Results for "{query}"</p>
        )}
      </div>
      
      <Card>
        <div className="text-center py-12">
          <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Search Page</h3>
          <p className="text-gray-500">
            {query 
              ? `Search functionality will be implemented here for: "${query}"`
              : 'This page will display search results across all your content.'
            }
          </p>
        </div>
      </Card>
    </div>
  )
}