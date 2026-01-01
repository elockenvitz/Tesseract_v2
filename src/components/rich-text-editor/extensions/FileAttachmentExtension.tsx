import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  FileText, Image, FileSpreadsheet, FileVideo, FileAudio,
  File, Download, X, Loader2, ChevronDown, ChevronRight, ExternalLink,
  GripHorizontal
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../../lib/supabase'
// XLSX is lazy loaded to reduce bundle size

// Debounce helper
function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args)
    }, delay)
  }, [delay]) as T
}

const FILE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'image': Image,
  'video': FileVideo,
  'audio': FileAudio,
  'spreadsheet': FileSpreadsheet,
  'document': FileText,
  'default': File
}

const getFileCategory = (mimeType: string): string => {
  if (!mimeType) return 'default'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv') || mimeType.includes('sheet')) return 'spreadsheet'
  if (mimeType.includes('document') || mimeType.includes('word') || mimeType.includes('pdf')) return 'document'
  return 'default'
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Store for pending file uploads (since we can't serialize File objects in node attrs)
const pendingFileUploads = new Map<string, File>()

export function setPendingFileUpload(id: string, file: File) {
  pendingFileUploads.set(id, file)
}

export function getPendingFileUpload(id: string): File | undefined {
  return pendingFileUploads.get(id)
}

// Excel Preview Component
interface SheetData {
  name: string
  data: (string | number | boolean | null)[][]
  columns: string[]
}

function ExcelPreview({ fileUrl, width, height, onSizeChange }: { fileUrl: string; width: number; height: number; onSizeChange: (w: number, h: number) => void }) {
  const [sheets, setSheets] = useState<SheetData[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadExcel = async () => {
      try {
        setLoading(true)
        setError(null)

        // Lazy load xlsx library
        const XLSX = await import('xlsx')

        const response = await fetch(fileUrl)
        if (!response.ok) throw new Error('Failed to fetch file')

        const arrayBuffer = await response.arrayBuffer()
        const workbook = XLSX.read(arrayBuffer, { type: 'array' })

        const parsedSheets: SheetData[] = workbook.SheetNames.map(name => {
          const worksheet = workbook.Sheets[name]
          const jsonData = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(worksheet, { header: 1 })

          // Get column headers (first row or generate A, B, C...)
          const firstRow = jsonData[0] || []
          const maxCols = Math.max(...jsonData.map(row => (row as any[]).length), firstRow.length)
          const columns = Array.from({ length: maxCols }, (_, i) =>
            firstRow[i]?.toString() || String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26).toString() : '')
          )

          return {
            name,
            data: jsonData.slice(1), // Skip header row
            columns
          }
        })

        setSheets(parsedSheets)
      } catch (err: any) {
        console.error('Excel parse error:', err)
        setError(err.message || 'Failed to load spreadsheet')
      } finally {
        setLoading(false)
      }
    }

    loadExcel()
  }, [fileUrl])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 bg-gray-50 border-t border-gray-200">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500 mr-3" />
        <span className="text-sm text-gray-600">Loading spreadsheet...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12 text-sm text-red-500 bg-red-50 border-t border-gray-200">
        {error}
      </div>
    )
  }

  if (sheets.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-gray-500 bg-gray-50 border-t border-gray-200">
        No data found in spreadsheet
      </div>
    )
  }

  const currentSheet = sheets[activeSheet]
  const totalRows = currentSheet.data.length
  const displayRows = 200

  return (
    <ResizablePreviewContainer
      width={width}
      height={height}
      onSizeChange={onSizeChange}
      minWidth={400}
      maxWidth={1400}
      minHeight={150}
      maxHeight={800}
    >
      <div className="bg-white flex-1 flex flex-col min-h-0">
        {/* Header bar with sheet info */}
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-medium text-gray-700">
              {sheets.length} sheet{sheets.length > 1 ? 's' : ''} • {totalRows.toLocaleString()} rows • {currentSheet.columns.length} columns
            </span>
          </div>
        </div>

        {/* Sheet Tabs */}
        {sheets.length > 1 && (
          <div className="flex border-b border-gray-200 bg-white overflow-x-auto flex-shrink-0">
            {sheets.map((sheet, index) => (
              <button
                key={sheet.name}
                onClick={() => setActiveSheet(index)}
                className={clsx(
                  'px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                  index === activeSheet
                    ? 'border-emerald-500 text-emerald-700 bg-emerald-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                )}
              >
                {sheet.name}
              </button>
            ))}
          </div>
        )}

        {/* Data Table */}
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm border-collapse min-w-max">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-center font-semibold text-gray-500 border-r border-b border-gray-300 bg-gray-100 w-12 sticky left-0 z-20">
                  #
                </th>
                {currentSheet.columns.map((col, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-left font-semibold text-gray-800 border-r border-b border-gray-300 bg-gray-100 min-w-[120px] max-w-[300px]"
                  >
                    <div className="truncate" title={col}>
                      {col}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white">
              {currentSheet.data.slice(0, displayRows).map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={clsx(
                    'hover:bg-blue-50 transition-colors',
                    rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                  )}
                >
                  <td className="px-3 py-1.5 text-gray-400 border-r border-b border-gray-200 bg-gray-50 text-center font-mono text-xs sticky left-0">
                    {rowIndex + 2}
                  </td>
                  {currentSheet.columns.map((_, colIndex) => {
                    const cellValue = row[colIndex]
                    const displayValue = cellValue?.toString() || ''
                    const isNumber = typeof cellValue === 'number'

                    return (
                      <td
                        key={colIndex}
                        className={clsx(
                          'px-3 py-1.5 border-r border-b border-gray-200 max-w-[300px]',
                          isNumber ? 'text-right font-mono text-gray-700' : 'text-gray-700'
                        )}
                        title={displayValue}
                      >
                        <div className="truncate">
                          {isNumber ? cellValue.toLocaleString() : displayValue}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-t border-gray-200 flex-shrink-0">
          <span className="text-xs text-gray-400">
            Drag edges to resize
          </span>
          {totalRows > displayRows && (
            <span className="text-xs text-gray-500">
              Showing {displayRows.toLocaleString()} of {totalRows.toLocaleString()} rows
            </span>
          )}
        </div>
      </div>
    </ResizablePreviewContainer>
  )
}

// Resize Container Component with corner and edge handles
function ResizablePreviewContainer({
  children,
  width,
  height,
  onSizeChange,
  minWidth = 300,
  maxWidth = 1200,
  minHeight = 200,
  maxHeight = 800
}: {
  children: React.ReactNode
  width: number
  height: number
  onSizeChange: (w: number, h: number) => void
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState<string | null>(null)
  const [currentSize, setCurrentSize] = useState({ width, height })
  const dragStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 })
  const currentSizeRef = useRef({ width, height })

  // Keep ref in sync with state
  useEffect(() => {
    currentSizeRef.current = currentSize
  }, [currentSize])

  // Sync with props when not dragging
  useEffect(() => {
    if (!isDragging) {
      setCurrentSize({ width, height })
    }
  }, [width, height, isDragging])

  const handleMouseDown = (e: React.MouseEvent, handle: string) => {
    e.preventDefault()
    e.stopPropagation()

    // Capture current values at drag start
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: currentSize.width,
      height: currentSize.height
    }
    setIsDragging(handle)
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartRef.current.x
      const deltaY = e.clientY - dragStartRef.current.y

      let newWidth = dragStartRef.current.width
      let newHeight = dragStartRef.current.height

      // Handle horizontal resize
      if (isDragging.includes('e')) {
        newWidth = dragStartRef.current.width + deltaX
      }

      // Handle vertical resize
      if (isDragging.includes('s')) {
        newHeight = dragStartRef.current.height + deltaY
      }

      // Clamp values
      newWidth = Math.min(maxWidth, Math.max(minWidth, newWidth))
      newHeight = Math.min(maxHeight, Math.max(minHeight, newHeight))

      // Update local state immediately for smooth visuals
      setCurrentSize({ width: newWidth, height: newHeight })
    }

    const handleMouseUp = () => {
      // Use ref to get latest size value
      onSizeChange(currentSizeRef.current.width, currentSizeRef.current.height)
      setIsDragging(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, minWidth, maxWidth, minHeight, maxHeight, onSizeChange])

  return (
    <div
      ref={containerRef}
      className="relative block border border-gray-300 rounded-b overflow-hidden"
      style={{
        width: `${currentSize.width}px`,
        height: `${currentSize.height}px`,
        minHeight: `${minHeight}px`
      }}
    >
      <div className="absolute inset-0 flex flex-col overflow-hidden">
        {children}
      </div>

      {/* Right edge handle */}
      <div
        className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize bg-transparent hover:bg-primary-300/50 transition-colors z-20"
        onMouseDown={(e) => handleMouseDown(e, 'e')}
      />

      {/* Bottom edge handle */}
      <div
        className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize bg-transparent hover:bg-primary-300/50 transition-colors z-20"
        onMouseDown={(e) => handleMouseDown(e, 's')}
      />

      {/* Bottom-right corner handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize bg-gray-400 hover:bg-primary-400 transition-colors z-30 rounded-tl"
        onMouseDown={(e) => handleMouseDown(e, 'se')}
      />

      {/* Size indicator when dragging */}
      {isDragging && (
        <div className="absolute top-2 left-2 bg-black/80 text-white text-xs px-2 py-1 rounded pointer-events-none z-40">
          {Math.round(currentSize.width)} × {Math.round(currentSize.height)}
        </div>
      )}
    </div>
  )
}

// Image Preview Component
function ImagePreview({ fileUrl, fileName, width, height, onSizeChange }: { fileUrl: string; fileName: string; width: number; height: number; onSizeChange: (w: number, h: number) => void }) {
  const [error, setError] = useState(false)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)

  if (error) {
    return (
      <div className="text-center py-12 text-sm text-gray-500 bg-gray-50 border-t border-gray-200">
        Failed to load image preview
      </div>
    )
  }

  return (
    <ResizablePreviewContainer
      width={width}
      height={height}
      onSizeChange={onSizeChange}
      minWidth={200}
      maxWidth={1200}
      minHeight={150}
      maxHeight={800}
    >
      <div className="border-t border-gray-200 bg-gray-100 flex-1 flex flex-col min-h-0">
        {/* Header bar with image info */}
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Image className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-medium text-gray-700">
              {dimensions ? `${dimensions.width} × ${dimensions.height} px` : 'Loading...'}
            </span>
          </div>
          <span className="text-xs text-gray-400">Drag edges to resize</span>
        </div>
        {/* Image container */}
        <div className="flex-1 p-4 flex items-center justify-center overflow-auto bg-gray-100 min-h-0">
          <img
            src={fileUrl}
            alt={fileName}
            className="max-w-full max-h-full rounded-lg shadow-sm border border-gray-200 object-contain"
            onError={() => setError(true)}
            onLoad={(e) => {
              const img = e.currentTarget
              setDimensions({ width: img.naturalWidth, height: img.naturalHeight })
            }}
          />
        </div>
      </div>
    </ResizablePreviewContainer>
  )
}

// PDF/Document Preview Component
function DocumentPreview({ fileUrl, fileName, fileType, width, height, onSizeChange }: { fileUrl: string; fileName: string; fileType: string; width: number; height: number; onSizeChange: (w: number, h: number) => void }) {
  const [error, setError] = useState(false)
  const isPdf = fileType.includes('pdf')

  return (
    <ResizablePreviewContainer
      width={width}
      height={height}
      onSizeChange={onSizeChange}
      minWidth={300}
      maxWidth={1200}
      minHeight={200}
      maxHeight={900}
    >
      <div className="border-t border-gray-200 bg-white flex-1 flex flex-col min-h-0">
        {/* Header bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-orange-600" />
            <span className="text-xs font-medium text-gray-700">{fileName}</span>
          </div>
          <span className="text-xs text-gray-400">Drag edges to resize</span>
        </div>
        {/* Document container */}
        <div className="flex-1 overflow-hidden bg-gray-100 min-h-0">
          {isPdf ? (
            <iframe
              src={`${fileUrl}#toolbar=1&navpanes=0`}
              className="w-full h-full border-0"
              title={fileName}
              onError={() => setError(true)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <FileText className="w-16 h-16 text-gray-300 mb-4" />
              <p className="text-sm text-gray-600 mb-2">Preview not available for this file type</p>
              <p className="text-xs text-gray-400">Click the filename to download and view</p>
            </div>
          )}
        </div>
        {error && (
          <div className="p-4 text-center text-sm text-red-500 bg-red-50 flex-shrink-0">
            Failed to load document preview
          </div>
        )}
      </div>
    </ResizablePreviewContainer>
  )
}

function FileAttachmentView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadStartedRef = useRef(false)

  // Local state - initialized once from node attributes, never synced back
  // This prevents save operations from resetting the UI state
  const [localExpanded, setLocalExpanded] = useState(() => node.attrs.isExpanded === true)
  const [localWidth, setLocalWidth] = useState(() => node.attrs.previewWidth || 600)
  const [localHeight, setLocalHeight] = useState(() => node.attrs.previewHeight || 300)

  const category = getFileCategory(node.attrs.fileType)
  const IconComponent = FILE_ICONS[category] || FILE_ICONS.default
  const canPreview = category === 'spreadsheet' || category === 'image' || category === 'document'

  // Debounced save for size changes only (500ms delay)
  const debouncedUpdateSize = useDebouncedCallback((width: number, height: number) => {
    updateAttributes({ previewWidth: width, previewHeight: height })
  }, 500)

  // Toggle expanded state - update local AND persist immediately (no debounce)
  const handleToggleExpand = useCallback(() => {
    const newExpanded = !localExpanded
    setLocalExpanded(newExpanded)
    // Immediate update - no debounce for discrete toggle action
    updateAttributes({ isExpanded: newExpanded })
  }, [localExpanded, updateAttributes])

  // Save preview size - update local immediately, debounce persistence
  const handlePreviewSizeChange = useCallback((width: number, height: number) => {
    setLocalWidth(width)
    setLocalHeight(height)
    debouncedUpdateSize(width, height)
  }, [debouncedUpdateSize])

  const uploadFile = useCallback(async (file: File) => {
    if (uploadStartedRef.current) return
    uploadStartedRef.current = true

    setIsUploading(true)
    setError(null)
    setUploadProgress(10)

    try {
      // Check session is valid before uploading
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Not authenticated - please sign in and try again')
      }

      // Validate file
      if (!file || file.size === 0) {
        throw new Error('Invalid file - please try again')
      }

      // Check file size (50MB limit)
      const MAX_SIZE = 50 * 1024 * 1024
      if (file.size > MAX_SIZE) {
        throw new Error(`File too large (${formatFileSize(file.size)}). Maximum size is 50MB.`)
      }

      setUploadProgress(20)

      // Generate unique file path
      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(2, 9)
      const extension = file.name.split('.').pop() || 'bin'
      const filePath = `attachments/${node.attrs.contextType || 'general'}/${node.attrs.contextId || 'shared'}/${timestamp}_${randomId}.${extension}`

      setUploadProgress(30)

      // Read file as ArrayBuffer for more reliable upload
      const arrayBuffer = await file.arrayBuffer()
      const blob = new Blob([arrayBuffer], { type: file.type || 'application/octet-stream' })

      setUploadProgress(50)

      // Upload to Supabase Storage
      const { data, error: uploadError } = await supabase.storage
        .from('assets')
        .upload(filePath, blob, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'application/octet-stream'
        })

      if (uploadError) throw uploadError

      setUploadProgress(90)

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('assets')
        .getPublicUrl(filePath)

      setUploadProgress(100)

      // Update attributes
      updateAttributes({
        fileId: data.path,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
        filePath: filePath,
        fileUrl: urlData.publicUrl,
        pendingUploadId: null
      })
    } catch (err: any) {
      console.error('Upload error:', err)
      // Provide more detailed error messages
      let errorMessage = 'Failed to upload file'
      if (err.message === 'Failed to fetch') {
        errorMessage = 'Network error - please check your connection and try again'
      } else if (err.message === 'Load failed') {
        errorMessage = 'Upload failed - please try again'
      } else if (err.message?.includes('Not authenticated')) {
        errorMessage = err.message
      } else if (err.message?.includes('Invalid file')) {
        errorMessage = err.message
      } else if (err.message?.includes('File too large')) {
        errorMessage = err.message
      } else if (err.message?.includes('row-level security')) {
        errorMessage = 'Permission denied - please sign in again'
      } else if (err.message?.includes('Payload too large')) {
        errorMessage = 'File too large (max 50MB)'
      } else if (err.message?.includes('Bucket not found')) {
        errorMessage = 'Storage not configured - please contact support'
      } else if (err.message) {
        errorMessage = err.message
      }
      setError(errorMessage)
      uploadStartedRef.current = false
    } finally {
      setIsUploading(false)
    }
  }, [node.attrs.contextType, node.attrs.contextId, updateAttributes])

  // Check for pending file upload on mount and when pendingUploadId changes
  useEffect(() => {
    const pendingUploadId = node.attrs.pendingUploadId

    if (!pendingUploadId || node.attrs.fileUrl || uploadStartedRef.current) {
      return
    }

    // Try to get the file immediately
    const file = pendingFileUploads.get(pendingUploadId)
    if (file) {
      pendingFileUploads.delete(pendingUploadId)
      uploadFile(file)
      return
    }

    // If not found, try again after a short delay (race condition handling)
    const timeoutId = setTimeout(() => {
      const delayedFile = pendingFileUploads.get(pendingUploadId)
      if (delayedFile && !uploadStartedRef.current) {
        pendingFileUploads.delete(pendingUploadId)
        uploadFile(delayedFile)
      } else if (!delayedFile && !uploadStartedRef.current) {
        // File not found after delay - show error
        setError('File not found. Please try again.')
      }
    }, 500)

    // Timeout to prevent infinite spinning - if no upload starts in 5 seconds, show error
    const failsafeTimeout = setTimeout(() => {
      if (!uploadStartedRef.current && !node.attrs.fileUrl) {
        setError('Upload timed out. Please try again.')
      }
    }, 5000)

    return () => {
      clearTimeout(timeoutId)
      clearTimeout(failsafeTimeout)
    }
  }, [node.attrs.pendingUploadId, node.attrs.fileUrl, uploadFile])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    uploadStartedRef.current = false
    await uploadFile(file)
  }

  const handleOpenInNewTab = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (node.attrs.fileUrl) {
      window.open(node.attrs.fileUrl, '_blank')
    }
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!node.attrs.filePath && !node.attrs.fileUrl) return

    const fileName = node.attrs.fileName || 'download'

    try {
      let blob: Blob

      // Try using Supabase storage download first
      if (node.attrs.filePath) {
        const { data, error } = await supabase.storage
          .from('assets')
          .download(node.attrs.filePath)

        if (error) throw error
        blob = data
      } else {
        const response = await fetch(node.attrs.fileUrl, { mode: 'cors' })
        if (!response.ok) throw new Error('Fetch failed')
        blob = await response.blob()
      }

      // Save file using the most reliable method
      saveFile(blob, fileName, node.attrs.fileType)
    } catch (err) {
      console.error('Download failed:', err)
      window.open(node.attrs.fileUrl, '_blank')
    }
  }

  // Reliable file save function that works across browsers
  const saveFile = (blob: Blob, fileName: string, mimeType?: string) => {
    // Create blob with correct mime type
    const fileBlob = new Blob([blob], { type: mimeType || blob.type || 'application/octet-stream' })

    // For IE/Edge Legacy
    if (typeof (window.navigator as any).msSaveOrOpenBlob !== 'undefined') {
      (window.navigator as any).msSaveOrOpenBlob(fileBlob, fileName)
      return
    }

    // For modern browsers - create object URL
    const blobUrl = URL.createObjectURL(fileBlob)

    // Create hidden link
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = fileName

    // Required for Firefox
    link.style.visibility = 'hidden'
    link.style.position = 'absolute'
    link.style.left = '-9999px'

    document.body.appendChild(link)

    // Dispatch click event (more reliable than .click())
    const clickEvent = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: false
    })
    link.dispatchEvent(clickEvent)

    // Cleanup after delay
    setTimeout(() => {
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)
    }, 300)
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    // Delete from storage if we have a file
    if (node.attrs.filePath) {
      try {
        await supabase.storage.from('assets').remove([node.attrs.filePath])
      } catch (err) {
        console.error('Failed to delete file from storage:', err)
      }
    }
    deleteNode()
  }

  const toggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    handleToggleExpand()
  }, [handleToggleExpand])

  // Show uploading state
  if (isUploading || (node.attrs.pendingUploadId && !node.attrs.fileUrl && !error)) {
    return (
      <NodeViewWrapper className="file-attachment-wrapper my-1" data-drag-handle>
        <div className="inline-flex items-center gap-2 px-2 py-1 rounded bg-gray-50 border border-gray-200 max-w-md">
          <Loader2 className="w-4 h-4 text-primary-500 animate-spin flex-shrink-0" />
          <span className="text-sm text-gray-600 truncate">
            {node.attrs.fileName || 'Uploading...'}
          </span>
          <span className="text-xs text-gray-400">{uploadProgress}%</span>
        </div>
      </NodeViewWrapper>
    )
  }

  // Show error state
  if (error) {
    return (
      <NodeViewWrapper className="file-attachment-wrapper my-1" data-drag-handle>
        <div className="inline-flex items-center gap-2 px-2 py-1 rounded bg-red-50 border border-red-200 max-w-md">
          <File className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-600 truncate flex-1">{error}</span>
          <button
            onClick={() => {
              setError(null)
              uploadStartedRef.current = false
              fileInputRef.current?.click()
            }}
            className="text-xs text-red-600 hover:text-red-800 underline"
          >
            Retry
          </button>
          <button
            onClick={() => deleteNode()}
            className="p-0.5 text-red-400 hover:text-red-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </NodeViewWrapper>
    )
  }

  // Show upload UI if no file attached yet
  if (!node.attrs.fileUrl) {
    return (
      <NodeViewWrapper className="file-attachment-wrapper my-1" data-drag-handle>
        <div
          className={clsx(
            'inline-flex items-center gap-2 px-3 py-2 rounded border-2 border-dashed cursor-pointer transition-colors',
            selected ? 'border-primary-400 bg-primary-50' : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
          )}
          onClick={() => fileInputRef.current?.click()}
        >
          <File className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-500">Click to upload a file</span>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </NodeViewWrapper>
    )
  }

  // Compact file link view (default)
  return (
    <NodeViewWrapper className="file-attachment-wrapper my-1" data-drag-handle>
      <div
        className={clsx(
          'rounded border transition-all max-w-lg',
          selected ? 'ring-1 ring-primary-500 border-primary-300' : 'border-gray-200',
          localExpanded ? 'bg-white' : 'bg-gray-50 hover:bg-gray-100'
        )}
      >
        {/* Compact Header */}
        <div
          className={clsx(
            'flex items-center gap-2 px-2 py-1.5 cursor-pointer',
            canPreview && 'hover:bg-gray-100'
          )}
          onClick={canPreview ? toggleExpand : undefined}
        >
          {/* Expand/collapse toggle for previewable files */}
          {canPreview && (
            <button
              onClick={toggleExpand}
              className="p-0.5 text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              {localExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* File icon */}
          <div className={clsx(
            'w-5 h-5 rounded flex items-center justify-center flex-shrink-0',
            category === 'image' && 'bg-blue-100 text-blue-600',
            category === 'spreadsheet' && 'bg-emerald-100 text-emerald-600',
            category === 'video' && 'bg-purple-100 text-purple-600',
            category === 'audio' && 'bg-green-100 text-green-600',
            category === 'document' && 'bg-orange-100 text-orange-600',
            category === 'default' && 'bg-gray-100 text-gray-600'
          )}>
            <IconComponent className="w-3 h-3" />
          </div>

          {/* File name as download link */}
          <button
            onClick={handleDownload}
            className="text-sm text-primary-600 hover:text-primary-800 hover:underline truncate flex-1 text-left"
            title={`Download ${node.attrs.fileName}`}
          >
            {node.attrs.fileName}
          </button>

          {/* File size */}
          <span className="text-xs text-gray-400 flex-shrink-0">
            {formatFileSize(node.attrs.fileSize)}
          </span>

          {/* Actions */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={handleOpenInNewTab}
              className="p-1 text-gray-400 hover:text-primary-600 rounded transition-colors"
              title="Open in new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleDownload}
              className="p-1 text-gray-400 hover:text-primary-600 rounded transition-colors"
              title="Download"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleDelete}
              className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
              title="Remove"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Expanded Preview */}
        {localExpanded && (
          <>
            {category === 'spreadsheet' && (
              <ExcelPreview
                fileUrl={node.attrs.fileUrl}
                width={localWidth}
                height={localHeight}
                onSizeChange={handlePreviewSizeChange}
              />
            )}
            {category === 'image' && (
              <ImagePreview
                fileUrl={node.attrs.fileUrl}
                fileName={node.attrs.fileName}
                width={localWidth}
                height={localHeight}
                onSizeChange={handlePreviewSizeChange}
              />
            )}
            {category === 'document' && (
              <DocumentPreview
                fileUrl={node.attrs.fileUrl}
                fileName={node.attrs.fileName}
                fileType={node.attrs.fileType}
                width={localWidth}
                height={localHeight}
                onSizeChange={handlePreviewSizeChange}
              />
            )}
          </>
        )}
      </div>
    </NodeViewWrapper>
  )
}

// TipTap Extension
export const FileAttachmentExtension = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      fileId: {
        default: null,
        parseHTML: element => element.getAttribute('data-file-id'),
        renderHTML: attributes => attributes.fileId ? { 'data-file-id': attributes.fileId } : {}
      },
      fileName: {
        default: '',
        parseHTML: element => element.getAttribute('data-file-name') || '',
        renderHTML: attributes => attributes.fileName ? { 'data-file-name': attributes.fileName } : {}
      },
      fileSize: {
        default: 0,
        parseHTML: element => parseInt(element.getAttribute('data-file-size') || '0', 10),
        renderHTML: attributes => attributes.fileSize ? { 'data-file-size': String(attributes.fileSize) } : {}
      },
      fileType: {
        default: '',
        parseHTML: element => element.getAttribute('data-file-type') || '',
        renderHTML: attributes => attributes.fileType ? { 'data-file-type': attributes.fileType } : {}
      },
      filePath: {
        default: '',
        parseHTML: element => element.getAttribute('data-file-path') || '',
        renderHTML: attributes => attributes.filePath ? { 'data-file-path': attributes.filePath } : {}
      },
      fileUrl: {
        default: '',
        parseHTML: element => element.getAttribute('data-file-url') || '',
        renderHTML: attributes => attributes.fileUrl ? { 'data-file-url': attributes.fileUrl } : {}
      },
      contextType: {
        default: '',
        parseHTML: element => element.getAttribute('data-context-type') || '',
        renderHTML: attributes => attributes.contextType ? { 'data-context-type': attributes.contextType } : {}
      },
      contextId: {
        default: '',
        parseHTML: element => element.getAttribute('data-context-id') || '',
        renderHTML: attributes => attributes.contextId ? { 'data-context-id': attributes.contextId } : {}
      },
      previewWidth: {
        default: 600,
        parseHTML: element => parseInt(element.getAttribute('data-preview-width') || '600', 10),
        renderHTML: attributes => attributes.previewWidth ? { 'data-preview-width': String(attributes.previewWidth) } : {}
      },
      previewHeight: {
        default: 300,
        parseHTML: element => parseInt(element.getAttribute('data-preview-height') || '300', 10),
        renderHTML: attributes => attributes.previewHeight ? { 'data-preview-height': String(attributes.previewHeight) } : {}
      },
      isExpanded: {
        default: false,
        parseHTML: element => element.getAttribute('data-is-expanded') === 'true',
        renderHTML: attributes => attributes.isExpanded ? { 'data-is-expanded': 'true' } : {}
      },
      pendingUploadId: { default: null }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="file-attachment"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const text = node.attrs.fileName ? `File: ${node.attrs.fileName}` : 'File Attachment'
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'file-attachment' }), text]
  },

  renderText({ node }) {
    return node.attrs.fileName ? `[Attachment: ${node.attrs.fileName}]` : '[File Attachment]'
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView)
  }
})

export default FileAttachmentExtension
