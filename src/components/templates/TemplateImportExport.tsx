import { useState, useRef } from 'react'
import { Download, Upload, X, FileText, FileJson, AlertCircle, Check, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import mammoth from 'mammoth'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import { Template, TemplateVariable, extractVariables } from '../../hooks/useTemplates'
import { Button } from '../ui/Button'

interface TemplateImportExportProps {
  templates: Template[]
  selectedTemplateIds?: string[]
  onImport: (templates: ImportedTemplate[]) => Promise<void>
  onClose: () => void
}

export interface ExportedTemplate {
  name: string
  content: string
  content_html?: string
  description?: string
  category: string
  shortcut?: string
  variables: TemplateVariable[]
  tags?: string[] // Tag names for reference
}

export interface ImportedTemplate {
  name: string
  content: string
  content_html?: string
  description?: string
  category: string
  shortcut?: string
  variables: TemplateVariable[]
}

type ImportConflict = {
  imported: ImportedTemplate
  existing: Template
  resolution: 'skip' | 'replace' | 'rename'
}

type ExportFormat = 'json' | 'docx' | 'txt'

export function TemplateImportExport({
  templates,
  selectedTemplateIds,
  onImport,
  onClose
}: TemplateImportExportProps) {
  const [mode, setMode] = useState<'export' | 'import'>('export')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('docx')
  const [exportSelection, setExportSelection] = useState<Set<string>>(
    new Set(selectedTemplateIds || templates.map(t => t.id))
  )
  const [importedData, setImportedData] = useState<ImportedTemplate[] | null>(null)
  const [conflicts, setConflicts] = useState<ImportConflict[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [importSuccess, setImportSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Export templates to Word document
  const exportToWord = async () => {
    const selected = templates.filter(t => exportSelection.has(t.id))

    const children: any[] = []

    selected.forEach((template, index) => {
      // Template name as heading
      children.push(
        new Paragraph({
          text: template.name,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: index > 0 ? 400 : 0 }
        })
      )

      // Category and shortcut info
      const metaText = [
        `Category: ${template.category}`,
        template.shortcut ? `Shortcut: .t.${template.shortcut}` : null,
        template.description ? `Description: ${template.description}` : null
      ].filter(Boolean).join(' | ')

      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: metaText,
              italics: true,
              size: 20,
              color: '666666'
            })
          ],
          spacing: { after: 200 }
        })
      )

      // Template content
      const content = template.content || ''
      content.split('\n').forEach(line => {
        children.push(
          new Paragraph({
            text: line || ' ',
            spacing: { after: 100 }
          })
        )
      })

      // Separator between templates
      if (index < selected.length - 1) {
        children.push(
          new Paragraph({
            text: '─'.repeat(50),
            spacing: { before: 200, after: 200 }
          })
        )
      }
    })

    const doc = new Document({
      sections: [{
        properties: {},
        children
      }]
    })

    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `templates-${new Date().toISOString().split('T')[0]}.docx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Export templates to JSON
  const exportToJson = () => {
    const selected = templates.filter(t => exportSelection.has(t.id))
    const exportData: ExportedTemplate[] = selected.map(t => ({
      name: t.name,
      content: t.content,
      content_html: t.content_html || undefined,
      description: t.description || undefined,
      category: t.category,
      shortcut: t.shortcut || undefined,
      variables: t.variables,
      tags: t.tags?.map(tag => tag.name)
    }))

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `templates-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Export templates to plain text
  const exportToText = () => {
    const selected = templates.filter(t => exportSelection.has(t.id))
    let textContent = ''

    selected.forEach((template, index) => {
      textContent += `=== ${template.name} ===\n`
      textContent += `Category: ${template.category}\n`
      if (template.shortcut) textContent += `Shortcut: .t.${template.shortcut}\n`
      if (template.description) textContent += `Description: ${template.description}\n`
      textContent += '\n'
      textContent += template.content || ''
      textContent += '\n'
      if (index < selected.length - 1) {
        textContent += '\n' + '─'.repeat(50) + '\n\n'
      }
    })

    const blob = new Blob([textContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `templates-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      if (exportFormat === 'docx') {
        await exportToWord()
      } else if (exportFormat === 'json') {
        exportToJson()
      } else {
        exportToText()
      }
      onClose()
    } catch (err) {
      console.error('Export error:', err)
    } finally {
      setIsExporting(false)
    }
  }

  // Parse Word document
  const parseWordFile = async (file: File): Promise<ImportedTemplate[]> => {
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.convertToHtml({ arrayBuffer })
    const html = result.value

    // Parse the HTML to extract templates
    // Look for headings as template names
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    const templates: ImportedTemplate[] = []
    const headings = doc.querySelectorAll('h1, h2, h3')

    if (headings.length === 0) {
      // No headings - treat entire document as one template
      const fileName = file.name.replace(/\.docx?$/i, '')
      templates.push({
        name: fileName,
        content: doc.body.textContent || '',
        content_html: html,
        category: 'general',
        variables: extractVariables(doc.body.textContent || '')
      })
    } else {
      // Each heading is a template
      headings.forEach((heading, index) => {
        const name = heading.textContent?.trim() || `Template ${index + 1}`

        // Get content until next heading
        let content = ''
        let contentHtml = ''
        let sibling = heading.nextElementSibling

        while (sibling && !['H1', 'H2', 'H3'].includes(sibling.tagName)) {
          content += (sibling.textContent || '') + '\n'
          contentHtml += sibling.outerHTML
          sibling = sibling.nextElementSibling
        }

        content = content.trim()

        // Try to extract category from first line if it looks like metadata
        let category = 'general'
        let description = ''
        const lines = content.split('\n')
        if (lines[0]?.toLowerCase().includes('category:')) {
          const catMatch = lines[0].match(/category:\s*([^|]+)/i)
          if (catMatch) category = catMatch[1].trim().toLowerCase()
          content = lines.slice(1).join('\n').trim()
        }

        templates.push({
          name,
          content,
          content_html: contentHtml,
          category,
          description,
          variables: extractVariables(content)
        })
      })
    }

    return templates
  }

  // Parse plain text file
  const parseTextFile = (text: string, fileName: string): ImportedTemplate[] => {
    // Check if file uses our export format with === markers
    const templateBlocks = text.split(/={3,}\s*([^=]+)\s*={3,}/)

    if (templateBlocks.length > 1) {
      const templates: ImportedTemplate[] = []
      for (let i = 1; i < templateBlocks.length; i += 2) {
        const name = templateBlocks[i].trim()
        const content = templateBlocks[i + 1]?.trim() || ''

        // Parse category from content
        let category = 'general'
        let cleanContent = content
        const catMatch = content.match(/^Category:\s*(.+)$/m)
        if (catMatch) {
          category = catMatch[1].trim().toLowerCase()
          cleanContent = content.replace(/^Category:\s*.+$/m, '').trim()
        }

        // Remove shortcut and description lines from content
        cleanContent = cleanContent
          .replace(/^Shortcut:\s*.+$/m, '')
          .replace(/^Description:\s*.+$/m, '')
          .trim()

        templates.push({
          name,
          content: cleanContent,
          category,
          variables: extractVariables(cleanContent)
        })
      }
      return templates
    }

    // Single template from file
    return [{
      name: fileName.replace(/\.txt$/i, ''),
      content: text,
      category: 'general',
      variables: extractVariables(text)
    }]
  }

  // Parse JSON file
  const parseJsonFile = (text: string): ImportedTemplate[] => {
    const data = JSON.parse(text)

    if (!Array.isArray(data)) {
      throw new Error('Invalid format: Expected an array of templates')
    }

    return data.map((item: any) => {
      if (!item.name || (!item.content && !item.content_html)) {
        throw new Error('Each template must have a name and content')
      }

      return {
        name: item.name,
        content: item.content || '',
        content_html: item.content_html,
        description: item.description,
        category: item.category || 'general',
        shortcut: item.shortcut,
        variables: item.variables || extractVariables(item.content || item.content_html || '')
      }
    })
  }

  // Handle file selection for import
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImportError(null)
    setConflicts([])
    setImportedData(null)

    try {
      let imported: ImportedTemplate[] = []
      const fileName = file.name.toLowerCase()

      if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
        imported = await parseWordFile(file)
      } else if (fileName.endsWith('.json')) {
        const text = await file.text()
        imported = parseJsonFile(text)
      } else if (fileName.endsWith('.txt')) {
        const text = await file.text()
        imported = parseTextFile(text, file.name)
      } else {
        // Try to detect format from content
        const text = await file.text()
        try {
          imported = parseJsonFile(text)
        } catch {
          imported = parseTextFile(text, file.name)
        }
      }

      setImportedData(imported)

      // Check for conflicts
      const foundConflicts: ImportConflict[] = []
      imported.forEach(imp => {
        const existing = templates.find(
          t => t.name.toLowerCase() === imp.name.toLowerCase() ||
            (imp.shortcut && t.shortcut?.toLowerCase() === imp.shortcut.toLowerCase())
        )
        if (existing) {
          foundConflicts.push({
            imported: imp,
            existing,
            resolution: 'skip'
          })
        }
      })
      setConflicts(foundConflicts)

    } catch (err) {
      console.error('Import error:', err)
      setImportError(err instanceof Error ? err.message : 'Failed to parse file')
    }
  }

  // Process import with conflict resolutions
  const handleImport = async () => {
    if (!importedData) return

    setIsImporting(true)
    setImportError(null)

    try {
      const toImport: ImportedTemplate[] = []
      const conflictMap = new Map(conflicts.map(c => [c.imported.name, c]))

      importedData.forEach(imp => {
        const conflict = conflictMap.get(imp.name)

        if (conflict) {
          if (conflict.resolution === 'skip') {
            return
          }
          if (conflict.resolution === 'rename') {
            toImport.push({
              ...imp,
              name: `${imp.name} (Imported)`,
              shortcut: imp.shortcut ? `${imp.shortcut}_imported` : undefined
            })
          } else {
            toImport.push(imp)
          }
        } else {
          toImport.push(imp)
        }
      })

      await onImport(toImport)
      setImportSuccess(true)

      setTimeout(() => {
        onClose()
      }, 1500)

    } catch (err) {
      console.error('Import error:', err)
      setImportError(err instanceof Error ? err.message : 'Failed to import templates')
    } finally {
      setIsImporting(false)
    }
  }

  const toggleExportSelection = (id: string) => {
    setExportSelection(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAllForExport = () => {
    setExportSelection(new Set(templates.map(t => t.id)))
  }

  const selectNoneForExport = () => {
    setExportSelection(new Set())
  }

  const updateConflictResolution = (index: number, resolution: 'skip' | 'replace' | 'rename') => {
    setConflicts(prev => prev.map((c, i) =>
      i === index ? { ...c, resolution } : c
    ))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Import / Export Templates</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setMode('export')}
            className={clsx(
              'flex-1 px-4 py-2 text-sm font-medium transition-colors',
              mode === 'export'
                ? 'text-primary-700 border-b-2 border-primary-600 bg-primary-50'
                : 'text-gray-600 hover:bg-gray-50'
            )}
          >
            <Download className="w-4 h-4 inline mr-2" />
            Export
          </button>
          <button
            onClick={() => setMode('import')}
            className={clsx(
              'flex-1 px-4 py-2 text-sm font-medium transition-colors',
              mode === 'import'
                ? 'text-primary-700 border-b-2 border-primary-600 bg-primary-50'
                : 'text-gray-600 hover:bg-gray-50'
            )}
          >
            <Upload className="w-4 h-4 inline mr-2" />
            Import
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {mode === 'export' ? (
            <div className="space-y-4">
              {/* Export Format Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Export Format</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setExportFormat('docx')}
                    className={clsx(
                      'flex-1 px-3 py-2 text-sm rounded-lg border transition-colors flex items-center justify-center gap-2',
                      exportFormat === 'docx'
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    <FileText className="w-4 h-4" />
                    Word (.docx)
                  </button>
                  <button
                    onClick={() => setExportFormat('txt')}
                    className={clsx(
                      'flex-1 px-3 py-2 text-sm rounded-lg border transition-colors flex items-center justify-center gap-2',
                      exportFormat === 'txt'
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    <FileText className="w-4 h-4" />
                    Text (.txt)
                  </button>
                  <button
                    onClick={() => setExportFormat('json')}
                    className={clsx(
                      'flex-1 px-3 py-2 text-sm rounded-lg border transition-colors flex items-center justify-center gap-2',
                      exportFormat === 'json'
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    <FileJson className="w-4 h-4" />
                    JSON
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Select templates ({exportSelection.size} selected)
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={selectAllForExport}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    Select all
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={selectNoneForExport}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    Select none
                  </button>
                </div>
              </div>

              <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                {templates.map(template => (
                  <label
                    key={template.id}
                    className={clsx(
                      'flex items-center gap-3 p-2 cursor-pointer transition-colors',
                      exportSelection.has(template.id) ? 'bg-primary-50' : 'hover:bg-gray-50'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={exportSelection.has(template.id)}
                      onChange={() => toggleExportSelection(template.id)}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {template.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {template.category}
                        {template.shortcut && ` - .t.${template.shortcut}`}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {importSuccess ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-3">
                    <Check className="w-6 h-6 text-green-600" />
                  </div>
                  <p className="text-lg font-medium text-gray-900">Import Successful!</p>
                  <p className="text-sm text-gray-500">Your templates have been imported</p>
                </div>
              ) : !importedData ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors"
                >
                  <FileText className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                  <p className="text-sm font-medium text-gray-900 mb-1">
                    Click to select a file
                  </p>
                  <p className="text-xs text-gray-500">
                    Supports Word (.docx), Text (.txt), and JSON files
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    Tip: Use headings in Word to separate multiple templates
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx,.doc,.txt,.json,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,application/json"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <FileText className="w-4 h-4" />
                    <span>{importedData.length} template{importedData.length !== 1 ? 's' : ''} ready to import</span>
                  </div>

                  {conflicts.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-amber-700 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''} found
                      </p>

                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {conflicts.map((conflict, index) => (
                          <div
                            key={index}
                            className="p-3 bg-amber-50 border border-amber-200 rounded-lg"
                          >
                            <p className="text-sm font-medium text-gray-900 mb-2">
                              "{conflict.imported.name}" already exists
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => updateConflictResolution(index, 'skip')}
                                className={clsx(
                                  'px-2 py-1 text-xs rounded transition-colors',
                                  conflict.resolution === 'skip'
                                    ? 'bg-gray-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                )}
                              >
                                Skip
                              </button>
                              <button
                                onClick={() => updateConflictResolution(index, 'replace')}
                                className={clsx(
                                  'px-2 py-1 text-xs rounded transition-colors',
                                  conflict.resolution === 'replace'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                )}
                              >
                                Replace
                              </button>
                              <button
                                onClick={() => updateConflictResolution(index, 'rename')}
                                className={clsx(
                                  'px-2 py-1 text-xs rounded transition-colors',
                                  conflict.resolution === 'rename'
                                    ? 'bg-primary-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                )}
                              >
                                Import as copy
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                    {importedData.map((template, index) => {
                      const conflict = conflicts.find(c => c.imported.name === template.name)
                      const willSkip = conflict?.resolution === 'skip'

                      return (
                        <div
                          key={index}
                          className={clsx(
                            'p-2 border-b border-gray-100 last:border-0',
                            willSkip && 'opacity-50'
                          )}
                        >
                          <p className={clsx(
                            'text-sm font-medium',
                            willSkip ? 'text-gray-400 line-through' : 'text-gray-900'
                          )}>
                            {template.name}
                            {conflict?.resolution === 'rename' && ' (Imported)'}
                          </p>
                          <p className="text-xs text-gray-500">{template.category}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {importError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {importError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {mode === 'export' ? (
            <Button
              onClick={handleExport}
              disabled={exportSelection.size === 0 || isExporting}
            >
              {isExporting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              <Download className="w-4 h-4 mr-1" />
              Export ({exportSelection.size})
            </Button>
          ) : (
            importedData && !importSuccess && (
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                <Upload className="w-4 h-4 mr-1" />
                Import Templates
              </Button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
