import { Card } from '../components/ui/Card'
import { Tags } from 'lucide-react'

export function TagsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tags</h1>
        <p className="text-gray-600 mt-1">Organize your content with tags and categories</p>
      </div>
      
      <Card>
        <div className="text-center py-12">
          <Tags className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Tags Page</h3>
          <p className="text-gray-500">This page will display and manage your tags and categories.</p>
        </div>
      </Card>
    </div>
  )
}