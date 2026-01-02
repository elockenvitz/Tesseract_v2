import { useState } from 'react'
import { X, Plus, Check, Loader2, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useTemplateTags, TAG_COLORS } from '../../hooks/useTemplateTags'
import { Button } from '../ui/Button'

interface TemplateTagPickerProps {
  selectedTagIds: string[]
  onSave: (tagIds: string[]) => void
  onClose: () => void
}

export function TemplateTagPicker({ selectedTagIds, onSave, onClose }: TemplateTagPickerProps) {
  const { tags, createTag, deleteTag, isCreating, isDeleting, getNextColor } = useTemplateTags()
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedTagIds))
  const [showNewTag, setShowNewTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(getNextColor())
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const toggleTag = (tagId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(tagId)) {
        next.delete(tagId)
      } else {
        next.add(tagId)
      }
      return next
    })
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return

    try {
      const newTag = await createTag({ name: newTagName.trim(), color: newTagColor })
      setSelected(prev => new Set(prev).add(newTag.id))
      setNewTagName('')
      setNewTagColor(getNextColor())
      setShowNewTag(false)
    } catch (error) {
      console.error('Failed to create tag:', error)
    }
  }

  const handleDeleteTag = async (tagId: string) => {
    try {
      await deleteTag(tagId)
      setSelected(prev => {
        const next = new Set(prev)
        next.delete(tagId)
        return next
      })
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Failed to delete tag:', error)
    }
  }

  const handleSave = () => {
    onSave(Array.from(selected))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Select Tags</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tags List */}
        <div className="p-4 max-h-80 overflow-y-auto">
          {tags.length === 0 && !showNewTag ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500 mb-4">No tags yet. Create your first tag!</p>
              <Button size="sm" onClick={() => setShowNewTag(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Create Tag
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {tags.map(tag => (
                <div
                  key={tag.id}
                  className={clsx(
                    'flex items-center justify-between p-2 rounded-lg border transition-colors',
                    selected.has(tag.id)
                      ? 'border-primary-300 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className="flex-1 flex items-center gap-3 text-left"
                  >
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="text-sm font-medium text-gray-900">{tag.name}</span>
                    {selected.has(tag.id) && (
                      <Check className="w-4 h-4 text-primary-600 ml-auto" />
                    )}
                  </button>

                  {deleteConfirm === tag.id ? (
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => handleDeleteTag(tag.id)}
                        className="p-1 text-red-600 hover:bg-red-100 rounded"
                        disabled={isDeleting}
                      >
                        {isDeleting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(tag.id)}
                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded ml-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}

              {/* New Tag Form */}
              {showNewTag && (
                <div className="p-3 border border-primary-200 bg-primary-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="Tag name"
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleCreateTag()
                        } else if (e.key === 'Escape') {
                          setShowNewTag(false)
                        }
                      }}
                    />
                    <button
                      onClick={handleCreateTag}
                      disabled={!newTagName.trim() || isCreating}
                      className="p-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isCreating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => setShowNewTag(false)}
                      className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-lg"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Color Picker */}
                  <div className="flex flex-wrap gap-1.5">
                    {TAG_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewTagColor(color)}
                        className={clsx(
                          'w-6 h-6 rounded-full transition-transform',
                          newTagColor === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-110'
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Add Tag Button */}
              {!showNewTag && (
                <button
                  type="button"
                  onClick={() => setShowNewTag(true)}
                  className="w-full flex items-center gap-2 p-2 text-sm text-gray-500 hover:text-primary-600 hover:bg-gray-50 rounded-lg border border-dashed border-gray-300"
                >
                  <Plus className="w-4 h-4" />
                  Create new tag
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Apply Tags ({selected.size})
          </Button>
        </div>
      </div>
    </div>
  )
}
