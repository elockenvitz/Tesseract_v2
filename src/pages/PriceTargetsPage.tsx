import { Card } from '../components/ui/Card'
import { Target } from 'lucide-react'

export function PriceTargetsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Price Targets</h1>
        <p className="text-gray-600 mt-1">Set and track price targets for your investments</p>
      </div>
      
      <Card>
        <div className="text-center py-12">
          <Target className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Price Targets Page</h3>
          <p className="text-gray-500">This page will display all your price targets and alerts.</p>
        </div>
      </Card>
    </div>
  )
}