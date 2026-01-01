// src/components/notes/NotebookTab.tsx
import { useEffect, useState } from 'react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { FileText, Calendar, User as UserIcon, Share2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { supabase } from '../../lib/supabase'

type UserLite = {
  id?: string
  email?: string
  first_name?: string | null
  last_name?: string | null
}

type Notebook = {
  id: string
  title: string
  content: string
  note_type: string | null
  is_shared: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  // If your parent query already joins these, we'll use them directly:
  created_by_user?: UserLite
  updated_by_user?: UserLite
}

interface NotebookTabProps {
  notebook: Notebook
}

export function NotebookTab({ notebook }: NotebookTabProps) {
  const [createdByUser, setCreatedByUser] = useState<UserLite | null>(
    notebook.created_by_user ?? null
  )
  const [updatedByUser, setUpdatedByUser] = useState<UserLite | null>(
    notebook.updated_by_user ?? null
  )

  // Fallback: if parent didn't include joined users, fetch them here by ID
  useEffect(() => {
    const needCreated = !createdByUser && notebook.created_by
    const needUpdated = !updatedByUser && notebook.updated_by

    if (!needCreated && !needUpdated) return

    const ids: string[] = []
    if (needCreated && notebook.created_by) ids.push(notebook.created_by)
    if (
      needUpdated &&
      notebook.updated_by &&
      notebook.updated_by !== notebook.created_by
    ) {
      ids.push(notebook.updated_by)
    }

    if (ids.length === 0) return

    ;(async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', ids)

      if (error) {
        console.error('Failed to load users for notebook', error)
        return
      }

      const byId = new Map<string, UserLite>()
      data?.forEach((u) => u.id && byId.set(u.id, u))

      if (needCreated && notebook.created_by) {
        setCreatedByUser(byId.get(notebook.created_by) ?? null)
      }
      if (needUpdated && notebook.updated_by) {
        setUpdatedByUser(byId.get(notebook.updated_by) ?? null)
      }
    })()
  }, [
    createdByUser,
    updatedByUser,
    notebook.created_by,
    notebook.updated_by,
  ])

  const getUserDisplayName = (u?: UserLite | null) => {
    if (!u) return 'Unknown user'
    if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`
    if (u.email) return u.email.split('@')[0]
    return 'Unknown user'
  }

  // Safe date formatting helper
  const formatDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return 'Unknown'
    try {
      const date = new Date(dateStr)
      if (isNaN(date.getTime())) return 'Unknown'
      return formatDistanceToNow(date, { addSuffix: true })
    } catch {
      return 'Unknown'
    }
  }

  const getNoteTypeColor = (type: string | null) => {
    switch (type) {
      case 'meeting':
        return 'primary'
      case 'call':
        return 'success'
      case 'research':
        return 'warning'
      case 'idea':
        return 'error'
      case 'analysis':
      case 'general':
      default:
        return 'default'
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

          {/* Meta line: created + updated with names */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
            <div className="flex items-center whitespace-nowrap">
              <Calendar className="h-4 w-4 mr-1" />
              Created {formatDate(notebook.created_at)} by {getUserDisplayName(createdByUser)}
            </div>

            <div className="flex items-center whitespace-nowrap">
              <UserIcon className="h-4 w-4 mr-1" />
              Last edited {formatDate(notebook.updated_at)} by {getUserDisplayName(updatedByUser)}
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
                {formatDate(notebook.updated_at)}
              </p>
              <p className="text-xs text-gray-500">
                by {getUserDisplayName(updatedByUser)}
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
