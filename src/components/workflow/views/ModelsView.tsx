/**
 * ModelsView Component
 *
 * Complete Models tab view for workflows.
 * Displays and manages document templates/models that can be uploaded
 * and downloaded for this workflow.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { FileText, Download, Trash2, Upload } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'

export interface WorkflowTemplate {
  id: string
  workflow_id: string
  template_name: string
  template_description?: string
  file_path: string
  file_size?: number
  uploaded_by: string
  uploaded_at: string
}

export interface ModelsViewProps {
  /** Workflow templates/models */
  templates?: WorkflowTemplate[]

  /** Whether templates are currently loading */
  isLoading?: boolean

  /** Whether user has admin permission */
  canEdit?: boolean

  /** Callback when upload button is clicked */
  onUpload?: () => void

  /** Callback when download button is clicked */
  onDownload?: (template: WorkflowTemplate) => void

  /** Callback when delete button is clicked */
  onDelete?: (template: WorkflowTemplate) => void
}

export function ModelsView({
  templates = [],
  isLoading = false,
  canEdit = false,
  onUpload,
  onDownload,
  onDelete
}: ModelsViewProps) {
  const hasTemplates = templates.length > 0

  // Format file size for display
  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return 'Unknown size'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-gray-900">Files</h3>
        </div>
        {canEdit && onUpload && (
          <Button onClick={onUpload}>
            <Upload className="w-4 h-4 mr-2" />
            Upload File
          </Button>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-sm text-gray-500 mt-2">Loading templates...</p>
        </div>
      )}

      {/* Templates Grid */}
      {!isLoading && hasTemplates && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <Card key={template.id}>
              <div className="p-4">
                {/* Template Icon and Name */}
                <div className="flex items-start space-x-3 mb-3">
                  <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-gray-900 truncate">
                      {template.template_name}
                    </h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatFileSize(template.file_size)}
                    </p>
                  </div>
                </div>

                {/* Description */}
                {template.template_description && (
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                    {template.template_description}
                  </p>
                )}

                {/* Upload Info */}
                <div className="text-xs text-gray-400 mb-3">
                  Uploaded {new Date(template.uploaded_at).toLocaleDateString()}
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-2">
                  {onDownload && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDownload(template)}
                      className="flex-1"
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Download
                    </Button>
                  )}
                  {canEdit && onDelete && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDelete(template)}
                      title="Delete Template"
                    >
                      <Trash2 className="w-3 h-3 text-red-600" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !hasTemplates && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <div className="max-w-md mx-auto">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-6 h-6 text-gray-400" />
            </div>
            <h4 className="text-lg font-medium text-gray-900 mb-2">No files yet</h4>
            <p className="text-sm text-gray-500">
              Upload files using the button above. Files will be accessible when working through
              this workflow and stored in the Files tab for future use.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
