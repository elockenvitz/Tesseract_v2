import { useState } from 'react'
import { clsx } from 'clsx'
import {
  FileText,
  Plus,
  Edit2,
  Trash2,
  Copy,
  Check,
  X,
  Loader2,
  Share2,
  Star,
  MoreVertical,
  Eye
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { useInvestmentCaseTemplates } from '../../hooks/useInvestmentCaseTemplates'
import { InvestmentCaseTemplate } from '../../types/investmentCaseTemplates'
import { InvestmentCaseTemplateEditor } from './InvestmentCaseTemplateEditor'

export function InvestmentCaseTemplateManager() {
  const {
    myTemplates,
    sharedTemplates,
    isLoading,
    createTemplate,
    deleteTemplate,
    duplicateTemplate,
    setDefaultTemplate,
    isCreating,
    isDeleting,
    isDuplicating
  } = useInvestmentCaseTemplates()

  const [editingTemplate, setEditingTemplate] = useState<InvestmentCaseTemplate | null>(null)
  const [isCreateMode, setIsCreateMode] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null)

  const handleCreate = () => {
    setEditingTemplate(null)
    setIsCreateMode(true)
    setShowEditor(true)
  }

  const handleEdit = (template: InvestmentCaseTemplate) => {
    setEditingTemplate(template)
    setShowEditor(true)
    setActionMenuOpen(null)
  }

  const handleDuplicate = async (template: InvestmentCaseTemplate) => {
    try {
      setActionMenuOpen(null)
      await duplicateTemplate(template.id)
    } catch (err) {
      console.error('Failed to duplicate template:', err)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteTemplate(id)
      setDeleteConfirm(null)
    } catch (err) {
      console.error('Failed to delete template:', err)
    }
  }

  const handleSetDefault = async (template: InvestmentCaseTemplate) => {
    try {
      setActionMenuOpen(null)
      await setDefaultTemplate(template.is_default ? null : template.id)
    } catch (err) {
      console.error('Failed to set default template:', err)
    }
  }

  const closeEditor = () => {
    setShowEditor(false)
    setEditingTemplate(null)
    setIsCreateMode(false)
  }

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </Card>
    )
  }

  return (
    <>
      <Card padding="sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-gray-900">PDF Templates</h3>
            <p className="text-sm text-gray-500 mt-1">
              Create templates for customizing PDF document output with branding, colors, and layout.
            </p>
          </div>
          <Button onClick={handleCreate} size="sm" disabled={isCreating}>
            {isCreating ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Plus className="w-4 h-4 mr-1" />
            )}
            New Template
          </Button>
        </div>

        {/* My Templates */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-700">
            My Templates ({myTemplates.length})
          </h4>

          {myTemplates.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
              <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                No PDF templates yet. Create one to customize your investment case exports.
              </p>
              <Button onClick={handleCreate} variant="outline" size="sm" className="mt-3">
                <Plus className="w-4 h-4 mr-1" />
                Create Template
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {myTemplates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onEdit={() => handleEdit(template)}
                  onDuplicate={() => handleDuplicate(template)}
                  onDelete={() => setDeleteConfirm(template.id)}
                  onSetDefault={() => handleSetDefault(template)}
                  isDeleting={deleteConfirm === template.id}
                  onConfirmDelete={() => handleDelete(template.id)}
                  onCancelDelete={() => setDeleteConfirm(null)}
                  actionMenuOpen={actionMenuOpen === template.id}
                  onToggleMenu={() => setActionMenuOpen(
                    actionMenuOpen === template.id ? null : template.id
                  )}
                  isProcessing={isDuplicating || isDeleting}
                />
              ))}
            </div>
          )}
        </div>

        {/* Shared Templates */}
        {sharedTemplates.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-200 space-y-3">
            <h4 className="text-sm font-medium text-gray-700">
              Shared Templates ({sharedTemplates.length})
            </h4>
            <div className="space-y-2">
              {sharedTemplates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  isShared
                  onDuplicate={() => handleDuplicate(template)}
                  actionMenuOpen={actionMenuOpen === template.id}
                  onToggleMenu={() => setActionMenuOpen(
                    actionMenuOpen === template.id ? null : template.id
                  )}
                  isProcessing={isDuplicating}
                />
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Editor Modal */}
      {showEditor && (editingTemplate || isCreateMode) && (
        <InvestmentCaseTemplateEditor
          template={editingTemplate}
          isCreateMode={isCreateMode}
          onClose={closeEditor}
        />
      )}
    </>
  )
}

// ============================================================================
// Template Card Component
// ============================================================================

interface TemplateCardProps {
  template: InvestmentCaseTemplate
  isShared?: boolean
  onEdit?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  onSetDefault?: () => void
  isDeleting?: boolean
  onConfirmDelete?: () => void
  onCancelDelete?: () => void
  actionMenuOpen?: boolean
  onToggleMenu?: () => void
  isProcessing?: boolean
}

function TemplateCard({
  template,
  isShared,
  onEdit,
  onDuplicate,
  onDelete,
  onSetDefault,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
  actionMenuOpen,
  onToggleMenu,
  isProcessing
}: TemplateCardProps) {
  const hasBranding = !!template.branding_config.logoPath || !!template.branding_config.firmName
  const hasCustomColors = template.style_config.colors.primary !== '#3b82f6'

  return (
    <div className={clsx(
      'p-3 border rounded-lg transition-colors',
      isDeleting
        ? 'border-red-300 bg-red-50'
        : 'border-gray-200 hover:border-gray-300'
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="font-medium text-gray-900 truncate">{template.name}</span>
            {template.is_default && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 rounded">
                <Star className="w-3 h-3" />
                Default
              </span>
            )}
            {template.is_shared && (
              <Share2 className="w-3 h-3 text-blue-500" title="Shared with team" />
            )}
          </div>
          {template.description && (
            <p className="text-sm text-gray-500 mt-1 truncate">{template.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            {hasBranding && (
              <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                Branded
              </span>
            )}
            {hasCustomColors && (
              <span className="text-xs px-1.5 py-0.5 rounded flex items-center gap-1"
                style={{
                  backgroundColor: `${template.style_config.colors.primary}20`,
                  color: template.style_config.colors.primary
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: template.style_config.colors.primary }}
                />
                Custom Colors
              </span>
            )}
            {template.section_config.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                {template.section_config.filter(s => s.enabled).length} sections
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 ml-2 relative">
          {isDeleting ? (
            <>
              <button
                onClick={onConfirmDelete}
                className="p-1.5 text-red-600 hover:bg-red-100 rounded"
                title="Confirm delete"
                disabled={isProcessing}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={onCancelDelete}
                className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              {!isShared && onEdit && (
                <button
                  onClick={onEdit}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                  title="Edit"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onToggleMenu}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                title="More actions"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {/* Action Menu */}
              {actionMenuOpen && (
                <div className="absolute right-0 top-8 z-10 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
                  {isShared && (
                    <button
                      onClick={onEdit}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Eye className="w-4 h-4" />
                      View
                    </button>
                  )}
                  <button
                    onClick={onDuplicate}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    disabled={isProcessing}
                  >
                    <Copy className="w-4 h-4" />
                    Duplicate
                  </button>
                  {!isShared && onSetDefault && (
                    <button
                      onClick={onSetDefault}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Star className="w-4 h-4" />
                      {template.is_default ? 'Remove Default' : 'Set as Default'}
                    </button>
                  )}
                  {!isShared && onDelete && (
                    <button
                      onClick={onDelete}
                      className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {template.usage_count > 0 && (
        <p className="text-xs text-gray-400 mt-2">
          Used {template.usage_count} time{template.usage_count !== 1 ? 's' : ''}
          {template.last_used_at && (
            <> &middot; Last used {new Date(template.last_used_at).toLocaleDateString()}</>
          )}
        </p>
      )}
    </div>
  )
}
