import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { FileText, Calendar, User, Share2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface NotebookTabProps {
  notebook: any
}

export function NotebookTab({ notebook }: NotebookTabProps) {
  const getNoteTypeColor = (type: string | null) => {
    switch (type) {
      case 'meeting': return 'primary'
      case 'call': return 'success'
      case 'research': return 'warning'
      case 'idea': return 'error'
      case 'analysis': return 'default'
      case 'general': return 'default'
      default: return 'default'
    }
  }

  return (
    <div className="space-y-6">
      {/* Notebook Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            <h1 className="text-2xl font-bold text-gray-900">{notebook.title}</h1>
            {notebook.note_type && (
              <Badge variant={getNoteTypeColor(notebook.note_type)} size="sm">
                {notebook.note_type}
              </Badge>
            )}
            {notebook.is_shared && (
              <Badge variant="primary" size="sm">
                <Share2 className="h-3 w-3 mr-1" />
                Shared
              </Badge>
            )}
          </div>
          <div className="flex items-center space-x-6 text-sm text-gray-500">
            <div className="flex items-center whitespace-nowrap">
              <Calendar className="h-4 w-4 mr-1" />
              Created {formatDistanceToNow(new Date(notebook.created_at), { addSuffix: true })}
            </div>
            <div className="flex items-center whitespace-nowrap">
              <User className="h-4 w-4 mr-1" />
              You
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <Card>
        <div className="prose prose-sm max-w-none">
          <div className="whitespace-pre-wrap text-gray-700">
            {notebook.content || 'This notebook is empty. Start writing your notes here.'}
          </div>
        </div>
      </Card>

      {/* Metadata */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card padding="sm">
          <div className="flex items-center">
            <div className="p-2 bg-primary-100 rounded-lg">
              <FileText className="h-4 w-4 text-primary-600" />
            </div>
            <div className="ml-3">
              <p className="text-xs font-medium text-gray-600">Word Count</p>
              <p className="text-sm font-semibold text-gray-900">
                {notebook.content ? notebook.content.split(' ').length : 0}
              </p>
            </div>
          </div>
        </Card>

        <Card padding="sm">
          <div className="flex items-center">
            <div className="p-2 bg-success-100 rounded-lg">
              <Calendar className="h-4 w-4 text-success-600" />
            </div>
            <div className="ml-3">
              <p className="text-xs font-medium text-gray-600">Last Updated</p>
              <p className="text-sm font-semibold text-gray-900">
                {formatDistanceToNow(new Date(notebook.updated_at), { addSuffix: true })}
              </p>
            </div>
          </div>
        </Card>

        <Card padding="sm">
          <div className="flex items-center">
            <div className="p-2 bg-warning-100 rounded-lg">
              <Share2 className="h-4 w-4 text-warning-600" />
            </div>
            <div className="ml-3">
              <p className="text-xs font-medium text-gray-600">Sharing</p>
              <p className="text-sm font-semibold text-gray-900">
                {notebook.is_shared ? 'Public' : 'Private'}
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}