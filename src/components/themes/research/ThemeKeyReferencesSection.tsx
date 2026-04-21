import React, { useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  Plus, Link2, FileText, Pin, PinOff, Trash2, ExternalLink, Library, X, Check, Star,
} from 'lucide-react'
import { Button } from '../../ui/Button'
import {
  useThemeKeyReferences,
  type ThemeKeyReference,
  type ThemeReferenceImportance,
} from '../../../hooks/useThemeKeyReferences'
import { useAuth } from '../../../hooks/useAuth'

interface ThemeKeyReferencesSectionProps {
  themeId: string
}

const IMPORTANCE_COLOR: Record<ThemeReferenceImportance, string> = {
  critical: 'text-rose-600',
  high:     'text-amber-600',
  normal:   'text-gray-400',
  low:      'text-gray-300',
}

function RefIcon({ ref }: { ref: ThemeKeyReference }) {
  if (ref.reference_type === 'external_link') return <Link2 className="w-4 h-4 text-blue-600" />
  if (ref.reference_type === 'note') return <FileText className="w-4 h-4 text-amber-600" />
  return <FileText className="w-4 h-4 text-purple-600" />
}

export function ThemeKeyReferencesSection({ themeId }: ThemeKeyReferencesSectionProps) {
  const { user } = useAuth()
  const { references, isLoading, add, isAdding, update, remove } = useThemeKeyReferences(themeId)

  const [showAdd, setShowAdd] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newImportance, setNewImportance] = useState<ThemeReferenceImportance>('normal')

  const handleAdd = async () => {
    const url = newUrl.trim()
    const title = newTitle.trim() || url
    if (!url) return
    try {
      await add({ reference_type: 'external_link', title, external_url: url, importance: newImportance })
      setNewUrl('')
      setNewTitle('')
      setNewImportance('normal')
      setShowAdd(false)
    } catch (e) {
      console.error('[theme-key-refs] add failed', e)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-50">
            <Library className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="text-base font-semibold text-gray-900">Key References</h3>
          {references.length > 0 && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
              {references.length}
            </span>
          )}
        </div>
        <Button size="sm" onClick={() => setShowAdd(s => !s)}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add reference
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 space-y-2">
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://..."
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
            autoFocus
          />
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title (optional, defaults to URL)"
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
          />
          <div className="flex items-center justify-between">
            <select
              value={newImportance}
              onChange={(e) => setNewImportance(e.target.value as ThemeReferenceImportance)}
              className="text-xs px-2 py-1 border border-gray-200 rounded bg-white"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => { setShowAdd(false); setNewUrl(''); setNewTitle('') }}>
                <X className="w-3.5 h-3.5 mr-1" /> Cancel
              </Button>
              <Button size="sm" onClick={handleAdd} disabled={!newUrl.trim() || isAdding}>
                <Check className="w-3.5 h-3.5 mr-1" /> Add
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-gray-500">Tip: for now, add any URL as a reference (research notes, filings, reports). Note & file attachment coming later.</p>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="p-4"><div className="h-16 bg-gray-100 rounded animate-pulse" /></div>
      ) : references.length === 0 ? (
        <div className="p-8 text-center">
          <Library className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No references yet.</p>
          <p className="text-xs text-gray-400 mt-1">Pin URLs, research notes, and docs that back up this theme.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {references.map(r => {
            const canManage = r.user_id === user?.id
            const href = r.reference_type === 'external_link' ? r.external_url || undefined : undefined
            return (
              <li key={r.id} className={clsx('px-4 py-2.5 flex items-center gap-3 group', r.is_pinned && 'bg-amber-50/30')}>
                <div className="shrink-0">
                  <RefIcon ref={r} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Star className={clsx('w-3 h-3', IMPORTANCE_COLOR[r.importance])} fill={r.importance === 'critical' || r.importance === 'high' ? 'currentColor' : 'none'} />
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-gray-900 hover:text-primary-600 hover:underline truncate inline-flex items-center gap-1">
                        {r.title}
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-gray-900 truncate">{r.title}</span>
                    )}
                    {r.is_pinned && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                        <Pin className="w-2.5 h-2.5" /> Pinned
                      </span>
                    )}
                  </div>
                  {r.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{r.description}</p>}
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Added {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </p>
                </div>
                {canManage && (
                  <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => update({ id: r.id, patch: { is_pinned: !r.is_pinned } as any })}
                      className="p-1 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded"
                      title={r.is_pinned ? 'Unpin' : 'Pin'}
                    >
                      {r.is_pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      className="p-1 text-gray-400 hover:text-error-600 hover:bg-error-50 rounded"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
