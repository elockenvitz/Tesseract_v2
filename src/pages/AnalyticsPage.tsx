import { Card } from '../components/ui/Card'
import { BarChart3 } from 'lucide-react'

export function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-gray-600 mt-1">Analyze your investment performance and trends</p>
      </div>
      
      <Card>
        <div className="text-center py-12">
          <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Analytics Page</h3>
          <p className="text-gray-500">This page will display charts and analytics for your investments.</p>
        </div>
      </Card>
    </div>
  )
}