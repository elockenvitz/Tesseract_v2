import { Card } from '../components/ui/Card'
import { HelpCircle } from 'lucide-react'

export function HelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Help & Support</h1>
        <p className="text-gray-600 mt-1">Get help and learn how to use Tesseract</p>
      </div>
      
      <Card>
        <div className="text-center py-12">
          <HelpCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Help Page</h3>
          <p className="text-gray-500">This page will contain documentation, FAQs, and support resources.</p>
        </div>
      </Card>
    </div>
  )
}