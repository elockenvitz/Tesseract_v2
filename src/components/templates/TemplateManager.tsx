import { useState } from 'react'
import { Plus, Download, Loader2, X } from 'lucide-react'
import { useTemplates, Template, extractVariables } from '../../hooks/useTemplates'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../common/Toast'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { TemplateEditor, TemplateFormData } from './TemplateEditor'
import { TemplateList } from './TemplateList'
import { TemplateSharingModal } from './TemplateSharingModal'
import { TemplateImportExport, ImportedTemplate } from './TemplateImportExport'

export function TemplateManager() {
  const { user } = useAuth()
  const { success } = useToast()
  const {
    templates,
    myTemplates,
    sharedTemplates,
    favoriteTemplates,
    recentlyUsedTemplates,
    isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    recordUsage,
    toggleFavorite,
    isCreating,
    isUpdating,
    isDeleting
  } = useTemplates()

  const [showEditor, setShowEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [sharingTemplate, setSharingTemplate] = useState<Template | null>(null)
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null)
  const [showImportExport, setShowImportExport] = useState(false)

  const handleCreateNew = () => {
    setEditingTemplate(null)
    setShowEditor(true)
  }

  const handleEdit = (template: Template) => {
    setEditingTemplate(template)
    setShowEditor(true)
  }

  const handleSave = async (data: TemplateFormData) => {
    const variables = extractVariables(data.content_html || data.content)

    if (editingTemplate) {
      await updateTemplate(editingTemplate.id, {
        name: data.name,
        content: data.content,
        content_html: data.content_html,
        description: data.description || undefined,
        category: data.category,
        shortcut: data.shortcut || null,
        variables,
        tag_ids: data.tag_ids
      })
    } else {
      await createTemplate({
        name: data.name,
        content: data.content,
        content_html: data.content_html,
        description: data.description || undefined,
        category: data.category,
        shortcut: data.shortcut || null,
        variables,
        tag_ids: data.tag_ids
      })
    }

    setShowEditor(false)
    setEditingTemplate(null)
  }

  const handleDelete = async (template: Template) => {
    await deleteTemplate(template.id)
  }

  const handleShare = (template: Template) => {
    setSharingTemplate(template)
  }

  const handleCopy = (template: Template) => {
    const content = template.content_html || template.content
    navigator.clipboard.writeText(content)
    success('Copied to clipboard')
  }

  const handleToggleFavorite = (template: Template) => {
    toggleFavorite(template.id)
  }

  const handleUse = (template: Template) => {
    recordUsage(template.id)
    const content = template.content_html || template.content
    navigator.clipboard.writeText(content)
    success('Template copied', `"${template.name}" copied to clipboard`)
  }

  const handlePreview = (template: Template) => {
    setPreviewTemplate(template)
  }

  const handleImport = async (imported: ImportedTemplate[]) => {
    for (const template of imported) {
      await createTemplate({
        name: template.name,
        content: template.content,
        content_html: template.content_html,
        description: template.description,
        category: template.category,
        shortcut: template.shortcut || null,
        variables: template.variables
      })
    }
  }

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </Card>
    )
  }

  // Show editor in full-screen mode
  if (showEditor) {
    return (
      <Card className="h-full p-0 overflow-hidden">
        <TemplateEditor
          template={editingTemplate || undefined}
          onSave={handleSave}
          onCancel={() => {
            setShowEditor(false)
            setEditingTemplate(null)
          }}
          onShare={editingTemplate ? () => {
            setSharingTemplate(editingTemplate)
          } : undefined}
          isSaving={isCreating || isUpdating}
        />
      </Card>
    )
  }

  return (
    <Card padding="sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Text Templates</h3>
          <p className="text-sm text-gray-500 mt-1">
            Create reusable text snippets. Use <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">.template</code> or <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">.t</code> in any text input.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowImportExport(true)}
          >
            <Download className="w-4 h-4 mr-1" />
            Import/Export
          </Button>
          <Button
            onClick={handleCreateNew}
            size="sm"
          >
            <Plus className="w-4 h-4 mr-1" />
            New Template
          </Button>
        </div>
      </div>

      {/* Template List */}
      <TemplateList
        templates={templates}
        recentlyUsed={recentlyUsedTemplates}
        favorites={favoriteTemplates}
        isLoading={isLoading}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onShare={handleShare}
        onCopy={handleCopy}
        onToggleFavorite={handleToggleFavorite}
        onUse={handleUse}
        onPreview={handlePreview}
        currentUserId={user?.id}
      />

      {/* Sharing Modal */}
      {sharingTemplate && (
        <TemplateSharingModal
          template={sharingTemplate}
          onClose={() => setSharingTemplate(null)}
        />
      )}

      {/* Import/Export Modal */}
      {showImportExport && (
        <TemplateImportExport
          templates={myTemplates}
          onImport={handleImport}
          onClose={() => setShowImportExport(false)}
        />
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60">
          <div className="bg-gray-100 rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            {/* Minimal Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-200/80">
              <span className="text-sm text-gray-600">Preview: {previewTemplate.name}</span>
              <button
                onClick={() => setPreviewTemplate(null)}
                className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-300 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Note-like Content Area */}
            <div className="flex-1 overflow-auto p-6 bg-gray-100">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 min-h-[300px]">
                <div className="p-6">
                  <div
                    className="prose prose-sm sm:prose max-w-none
                      prose-headings:text-gray-900 prose-headings:font-semibold
                      prose-p:text-gray-700 prose-p:leading-relaxed
                      prose-strong:text-gray-900
                      prose-ul:text-gray-700 prose-ol:text-gray-700
                      prose-li:marker:text-gray-400
                      prose-a:text-primary-600 prose-a:no-underline hover:prose-a:underline
                      prose-blockquote:border-l-primary-500 prose-blockquote:text-gray-600
                      prose-code:text-primary-700 prose-code:bg-primary-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none"
                    dangerouslySetInnerHTML={{
                      __html: previewTemplate.content_html || previewTemplate.content.replace(/\n/g, '<br>')
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end px-4 py-3 bg-gray-200/80">
              <Button
                size="sm"
                onClick={() => {
                  handleUse(previewTemplate)
                  setPreviewTemplate(null)
                }}
              >
                Use Template
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
