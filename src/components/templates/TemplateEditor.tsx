import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { X, Save, Loader2, Eye, Edit3, Share2, Tag, ChevronDown, ChevronUp, AlertCircle, Zap, Type } from 'lucide-react'
import { clsx } from 'clsx'
import { Template } from '../../hooks/useTemplates'
import { RichTextEditor, RichTextEditorRef } from '../rich-text-editor/RichTextEditor'
import { Button } from '../ui/Button'
import { TemplateTagPicker } from './TemplateTagPicker'
import {
  extractVariables,
  validateTemplate,
  highlightVariables,
  DYNAMIC_COMMANDS,
  type TemplateVariable,
  type DynamicVariable
} from '../../utils/templateVariables'

interface TemplateEditorProps {
  template?: Template
  onSave: (data: TemplateFormData) => Promise<void>
  onCancel: () => void
  onShare?: () => void
  isSaving?: boolean
}

export interface TemplateFormData {
  name: string
  content: string
  content_html: string
  description: string
  category: string
  shortcut: string
  tag_ids: string[]
}

const CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'meeting', label: 'Meeting Notes' },
  { id: 'report', label: 'Reports' },
  { id: 'email', label: 'Email' },
  { id: 'research', label: 'Research' },
]

export function TemplateEditor({
  template,
  onSave,
  onCancel,
  onShare,
  isSaving = false
}: TemplateEditorProps) {
  const editorRef = useRef<RichTextEditorRef>(null)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formData, setFormData] = useState<TemplateFormData>({
    name: template?.name || '',
    content: template?.content || '',
    content_html: template?.content_html || '',
    description: template?.description || '',
    category: template?.category || 'general',
    shortcut: template?.shortcut || '',
    tag_ids: template?.tags?.map(t => t.id) || []
  })

  const [previewHtml, setPreviewHtml] = useState('')
  const [showVariables, setShowVariables] = useState(true)

  // Extract variables and validate using the utility
  const variables = useMemo(() => extractVariables(formData.content), [formData.content])
  const validationIssues = useMemo(() => validateTemplate(formData.content), [formData.content])

  const standardVars = useMemo(
    () => variables.filter((v): v is TemplateVariable & { type: 'standard' } => v.type === 'standard'),
    [variables]
  )
  const dynamicVars = useMemo(
    () => variables.filter((v): v is DynamicVariable => v.type === 'dynamic'),
    [variables]
  )

  // Update preview when content changes
  const handleContentChange = useCallback((html: string, plainText: string) => {
    setFormData(prev => ({
      ...prev,
      content: plainText,
      content_html: html
    }))
    setPreviewHtml(html)
  }, [])

  // Initialize editor content
  useEffect(() => {
    if (template?.content_html) {
      setPreviewHtml(template.content_html)
    } else if (template?.content) {
      // Convert plain text to HTML for preview
      const html = '<p>' + template.content
        .replace(/\n\n+/g, '</p><p>')
        .replace(/\n/g, '<br>') + '</p>'
      setPreviewHtml(html)
    }
  }, [template])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.name.trim()) {
      setError('Template name is required')
      return
    }

    if (!formData.content.trim() && !formData.content_html.trim()) {
      setError('Template content is required')
      return
    }

    try {
      await onSave(formData)
    } catch (err) {
      console.error('Error saving template:', err)
      setError(err instanceof Error ? err.message : 'Failed to save template')
    }
  }

  const handleTagsChange = (tagIds: string[]) => {
    setFormData(prev => ({ ...prev, tag_ids: tagIds }))
    setShowTagPicker(false)
  }

  // Get styled preview with highlighted variables
  const getStyledPreview = () => {
    // Use utility function for consistent highlighting
    return highlightVariables(previewHtml)
  }

  const getCategoryLabel = (id: string) => CATEGORIES.find(c => c.id === id)?.label || id

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Compact Header with Name, Category, Shortcut */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-gray-50">
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Template name..."
          className="flex-1 min-w-0 px-3 py-1.5 text-base font-medium bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />

        {/* Shortcut */}
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">.t.</span>
          <input
            type="text"
            value={formData.shortcut}
            onChange={(e) => setFormData({
              ...formData,
              shortcut: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '')
            })}
            placeholder="shortcut"
            className="w-28 pl-7 pr-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        {/* Category */}
        <select
          value={formData.category}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
          className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
        >
          {CATEGORIES.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.label}</option>
          ))}
        </select>

        {/* Mode Toggle */}
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          <button
            type="button"
            onClick={() => setMode('edit')}
            className={clsx(
              'px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors',
              mode === 'edit'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            )}
          >
            <Edit3 className="w-3.5 h-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={clsx(
              'px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors border-l border-gray-300',
              mode === 'preview'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            )}
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>
        </div>

        {/* Expand Toggle (for tags/description) */}
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className={clsx(
            'p-1.5 rounded-lg transition-colors',
            showSettings ? 'bg-primary-100 text-primary-700' : 'text-gray-500 hover:bg-gray-100'
          )}
          title="Tags & description"
        >
          {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={onCancel}
          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Collapsible Settings Panel (Tags & Description only) */}
      {showSettings && (
        <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-4">
          {/* Tags */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">Tags:</label>
            {formData.tag_ids.length === 0 ? (
              <button
                type="button"
                onClick={() => setShowTagPicker(true)}
                className="px-2 py-1 text-xs text-gray-500 hover:text-primary-600 border border-dashed border-gray-300 rounded-lg flex items-center gap-1"
              >
                <Tag className="w-3 h-3" />
                Add
              </button>
            ) : (
              <div className="flex items-center gap-1">
                {template?.tags?.filter(t => formData.tag_ids.includes(t.id)).slice(0, 3).map(tag => (
                  <span
                    key={tag.id}
                    className="px-2 py-0.5 text-xs rounded-full text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
                {formData.tag_ids.length > 3 && (
                  <span className="text-xs text-gray-500">+{formData.tag_ids.length - 3}</span>
                )}
                <button
                  type="button"
                  onClick={() => setShowTagPicker(true)}
                  className="px-1.5 py-0.5 text-xs text-gray-500 hover:text-primary-600"
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          {/* Description */}
          <div className="flex-1">
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Description (optional)"
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-2 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Main Content Area - Editor or Preview */}
      <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden relative">
          {mode === 'edit' ? (
            /* Editor Mode */
            <div className="h-full flex flex-col">
              {/* Hint bar with variable toggle */}
              <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span>
                    <code className="px-1 py-0.5 bg-purple-100 text-purple-700 rounded">{'{{var}}'}</code> fill-in
                  </span>
                  <span>
                    <code className="px-1 py-0.5 bg-blue-100 text-blue-700 rounded">{'{{.price}}'}</code> live data
                  </span>
                  <span>
                    <code className="px-1 py-0.5 bg-blue-100 text-blue-700 rounded">{'{{.price:AAPL}}'}</code> explicit
                  </span>
                </div>
                {variables.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowVariables(!showVariables)}
                    className={clsx(
                      'flex items-center gap-1 px-2 py-0.5 rounded transition-colors',
                      showVariables ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-200'
                    )}
                  >
                    <Zap className="w-3 h-3" />
                    {variables.length} var{variables.length !== 1 ? 's' : ''}
                  </button>
                )}
              </div>

              {/* Variables Panel */}
              {showVariables && variables.length > 0 && (
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs">
                  {/* Validation warnings */}
                  {validationIssues.length > 0 && (
                    <div className="mb-2 flex items-start gap-2 text-amber-700 bg-amber-50 px-2 py-1.5 rounded">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <div>
                        {validationIssues.map((issue, i) => (
                          <div key={i}>{issue}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    {/* Standard Variables */}
                    {standardVars.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Type className="w-3 h-3 text-purple-600" />
                        <span className="text-gray-500">Fill-in:</span>
                        {standardVars.map((v, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-mono"
                            title="User will provide this value"
                          >
                            {v.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Dynamic Variables */}
                    {dynamicVars.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-blue-600" />
                        <span className="text-gray-500">Live:</span>
                        {dynamicVars.map((v, i) => {
                          const cmd = DYNAMIC_COMMANDS[v.command]
                          return (
                            <span
                              key={i}
                              className={clsx(
                                'px-1.5 py-0.5 rounded font-mono',
                                cmd ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                              )}
                              title={cmd?.description || 'Unknown command'}
                            >
                              .{v.command}{v.symbol ? `:${v.symbol}` : ''}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Editor fills remaining space */}
              <div className="flex-1 overflow-auto template-editor-scroll">
                <RichTextEditor
                  ref={editorRef}
                  value={template?.content_html || template?.content || ''}
                  onChange={handleContentChange}
                  placeholder="Start typing your template content..."
                  className="h-full"
                  minHeight="400px"
                />
              </div>
              {/* Override sticky toolbar position for template editor context */}
              <style>{`
                .template-editor-scroll .rich-text-editor > .sticky {
                  top: 0 !important;
                }
                /* Variable highlighting styles */
                .template-var {
                  padding: 0.125rem 0.25rem;
                  border-radius: 0.25rem;
                  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                  font-size: 0.875em;
                }
                .template-var-standard {
                  background-color: rgb(243 232 255);
                  color: rgb(126 34 206);
                }
                .template-var-dynamic {
                  background-color: rgb(219 234 254);
                  color: rgb(29 78 216);
                }
                .template-var-unresolved {
                  background-color: rgb(254 226 226);
                  color: rgb(185 28 28);
                }
              `}</style>
            </div>
          ) : (
            /* Preview Mode */
            <div className="h-full flex flex-col bg-gray-50">
              <div className="flex-1 overflow-auto p-6">
                <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  {/* Template Name */}
                  <div className="mb-4 pb-4 border-b border-gray-100">
                    <h1 className="text-xl font-semibold text-gray-900">
                      {formData.name || 'Untitled Template'}
                    </h1>
                    <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                      <span className="px-2 py-0.5 bg-gray-100 rounded">{getCategoryLabel(formData.category)}</span>
                      {formData.shortcut && (
                        <span className="font-mono">.t.{formData.shortcut}</span>
                      )}
                    </div>
                  </div>

                  {/* Content Preview */}
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: getStyledPreview() }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {template && onShare && (
              <Button type="button" variant="outline" size="sm" onClick={onShare}>
                <Share2 className="w-4 h-4 mr-1" />
                Share
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              <Save className="w-4 h-4 mr-1" />
              {template ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </form>

      {/* Tag Picker Modal */}
      {showTagPicker && (
        <TemplateTagPicker
          selectedTagIds={formData.tag_ids}
          onSave={handleTagsChange}
          onClose={() => setShowTagPicker(false)}
        />
      )}
    </div>
  )
}
