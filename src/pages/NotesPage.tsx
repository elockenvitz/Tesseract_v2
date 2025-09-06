import { Card } from '../components/ui/Card'
import { FileText } from 'lucide-react'

export function NotesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Research Notes</h1>
        <p className="text-gray-600 mt-1">Organize and manage your investment research</p>
      </div>
      
      <Card>
        <div className="text-center py-12">
          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Notes Page</h3>
          <p className="text-gray-500">This page will display all your research notes and documentation.</p>
        </div>
      </Card>
    </div>
  )
}