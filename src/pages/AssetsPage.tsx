import { Card } from '../components/ui/Card'
import { TrendingUp } from 'lucide-react'

export function AssetsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Assets</h1>
        <p className="text-gray-600 mt-1">Manage your investment assets and ideas</p>
      </div>
      
      <Card>
        <div className="text-center py-12">
          <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Assets Page</h3>
          <p className="text-gray-500">This page will display all your investment assets.</p>
        </div>
      </Card>
    </div>
  )
}