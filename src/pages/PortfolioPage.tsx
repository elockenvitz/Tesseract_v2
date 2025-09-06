import { Card } from '../components/ui/Card'
import { Briefcase } from 'lucide-react'

export function PortfolioPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Portfolio</h1>
        <p className="text-gray-600 mt-1">Track your portfolio performance and allocations</p>
      </div>
      
      <Card>
        <div className="text-center py-12">
          <Briefcase className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Portfolio Page</h3>
          <p className="text-gray-500">This page will display your portfolio overview and performance metrics.</p>
        </div>
      </Card>
    </div>
  )
}