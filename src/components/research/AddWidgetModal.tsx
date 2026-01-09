import { useState } from 'react'
import { X, FileText, CheckSquare, Hash, Calendar, Gauge, Clock } from 'lucide-react'
import { Button } from '../ui/Button'
import { WIDGET_TYPE_OPTIONS, type WidgetType } from '../../hooks/useUserAssetWidgets'

interface AddWidgetModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (widgetType: WidgetType, title: string, description?: string) => Promise<void>
  isAdding?: boolean
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  CheckSquare,
  Hash,
  Calendar,
  Gauge,
  Clock
}

export function AddWidgetModal({ isOpen, onClose, onAdd, isAdding }: AddWidgetModalProps) {
  const [selectedType, setSelectedType] = useState<WidgetType | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [step, setStep] = useState<'type' | 'details'>('type')

  const handleClose = () => {
    setSelectedType(null)
    setTitle('')
    setDescription('')
    setStep('type')
    onClose()
  }

  const handleSelectType = (type: WidgetType) => {
    setSelectedType(type)
    // Set default title based on type
    const option = WIDGET_TYPE_OPTIONS.find(o => o.value === type)
    setTitle(option?.label || '')
    setStep('details')
  }

  const handleAdd = async () => {
    if (!selectedType || !title.trim()) return
    await onAdd(selectedType, title.trim(), description.trim() || undefined)
    handleClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === 'type' ? 'Add Widget' : 'Widget Details'}
          </h2>
          <button
            onClick={handleClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'type' ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 mb-4">
                Choose the type of widget you want to add to this asset:
              </p>
              <div className="grid grid-cols-2 gap-3">
                {WIDGET_TYPE_OPTIONS.map(option => {
                  const Icon = ICON_MAP[option.icon]
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleSelectType(option.value)}
                      className="flex flex-col items-start p-4 border border-gray-200 rounded-lg hover:border-primary-300 hover:bg-primary-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {Icon && <Icon className="w-5 h-5 text-primary-600" />}
                        <span className="font-medium text-gray-900">{option.label}</span>
                      </div>
                      <p className="text-xs text-gray-500">{option.description}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Back button */}
              <button
                onClick={() => setStep('type')}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                ← Back to widget types
              </button>

              {/* Selected type indicator */}
              {selectedType && (
                <div className="flex items-center gap-2 p-3 bg-primary-50 rounded-lg">
                  {(() => {
                    const option = WIDGET_TYPE_OPTIONS.find(o => o.value === selectedType)
                    const Icon = option ? ICON_MAP[option.icon] : null
                    return (
                      <>
                        {Icon && <Icon className="w-5 h-5 text-primary-600" />}
                        <span className="text-sm font-medium text-primary-700">
                          {option?.label}
                        </span>
                      </>
                    )
                  })()}
                </div>
              )}

              {/* Title input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Key Assumptions"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  autoFocus
                />
              </div>

              {/* Description input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of what this widget tracks..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'details' && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!title.trim() || isAdding}
            >
              {isAdding ? 'Adding...' : 'Add Widget'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
