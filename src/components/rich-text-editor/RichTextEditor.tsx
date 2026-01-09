import React, { useEffect, forwardRef, useImperativeHandle, useRef, useCallback, memo } from 'react'
import { supabase } from '../../lib/supabase'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Highlight } from '@tiptap/extension-highlight'
import { Underline } from '@tiptap/extension-underline'
import { Link } from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { FontSizeExtension } from './extensions/FontSizeExtension'
import { FontFamilyExtension } from './extensions/FontFamilyExtension'
import { IndentExtension } from './extensions/IndentExtension'
import { DragHandleExtension } from './extensions/DragHandleExtension'
import { Dropcursor } from '@tiptap/extension-dropcursor'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { TextAlign } from '@tiptap/extension-text-align'
import { ResizableImageExtension } from './extensions/ResizableImageExtension'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { clsx } from 'clsx'
import { EditorToolbar } from './EditorToolbar'
import { TableControls } from './TableControls'
import { MentionExtension, MentionList, type MentionItem } from './extensions/MentionExtension'
import { AssetExtension, AssetList, type AssetItem } from './extensions/AssetExtension'
import { HashtagExtension, HashtagList, type HashtagItem } from './extensions/HashtagExtension'
import { NoteLinkExtension, NoteLinkList, type NoteLinkItem } from './extensions/NoteLinkExtension'
import { InlineTaskExtension } from './extensions/InlineTaskExtension'
import { InlineEventExtension } from './extensions/InlineEventExtension'
import { TableOfContentsExtension } from './extensions/TableOfContentsExtension'
import { FileAttachmentExtension, setPendingFileUpload } from './extensions/FileAttachmentExtension'
import { CaptureExtension } from './extensions/CaptureExtension'
import { CaptureSuggestionExtension } from './extensions/CaptureSuggestionExtension'
import { ChartExtension } from './extensions/ChartExtension'
import { DataValueExtension } from './extensions/DataValueExtension'
import { DotCommandSuggestionExtension, TemplateWithShortcut } from './extensions/DotCommandSuggestionExtension'
import { DotCommandExtension } from './extensions/DotCommandExtension'
import { AIPromptExtension } from './extensions/AIPromptExtension'
import { VisibilityBlockExtension, type VisibilityType } from './extensions/VisibilityBlockExtension'
import { useCaptureMode } from '../../contexts/CaptureContext'
import { useScreenCapture } from '../../hooks/useScreenCapture'
import { useCapture } from '../../hooks/useCapture'
import { useUrlMetadata } from '../../hooks/useUrlMetadata'
import { ScreenshotModal } from '../capture/ScreenshotModal'
import type { CaptureEntityType } from '../../types/capture'

export interface RichTextEditorRef {
  getHTML: () => string
  getText: () => string
  setContent: (content: string) => void
  focus: () => void
  insertText: (text: string) => void
  insertHTML: (html: string) => void
  appendHTML: (html: string) => void
}

export interface RichTextEditorProps {
  value: string
  onChange: (html: string, text: string) => void
  placeholder?: string
  className?: string
  editorClassName?: string
  minHeight?: string
  enableMentions?: boolean
  enableAssets?: boolean
  enableHashtags?: boolean
  onMentionSearch?: (query: string) => Promise<MentionItem[]>
  onAssetSearch?: (query: string) => Promise<AssetItem[]>
  onHashtagSearch?: (query: string) => Promise<HashtagItem[]>
  onHashtagSelect?: (hashtag: HashtagItem) => void
  onMentionSelect?: (mention: MentionItem) => void
  onAssetSelect?: (asset: AssetItem) => void
  onInsertEvent?: () => void
  onInsertAttachment?: () => void
  readOnly?: boolean
  // Asset context for data commands - if set, .price etc will reference this asset
  assetContext?: { id: string; symbol: string } | null
  // Templates with shortcuts for .template commands
  templates?: TemplateWithShortcut[]
  // Note linking
  enableNoteLinks?: boolean
  onNoteLinkSearch?: (query: string) => Promise<NoteLinkItem[]>
  onNoteLinkSelect?: (note: NoteLinkItem) => void
  onNoteLinkNavigate?: (note: NoteLinkItem) => void
}

const RichTextEditorInner = forwardRef<RichTextEditorRef, RichTextEditorProps>(({
  value,
  onChange,
  placeholder = 'Start writing...',
  className,
  editorClassName,
  minHeight = '300px',
  enableMentions = true,
  enableAssets = true,
  enableHashtags = true,
  enableNoteLinks = false,
  onMentionSearch,
  onAssetSearch,
  onHashtagSearch,
  onNoteLinkSearch,
  onHashtagSelect,
  onMentionSelect,
  onAssetSelect,
  onNoteLinkSelect,
  onNoteLinkNavigate,
  onInsertEvent,
  onInsertAttachment,
  readOnly = false,
  assetContext,
  templates = []
}, ref) => {
  // Track if we're currently updating from parent to avoid cursor reset
  const isExternalUpdate = useRef(false)
  const lastValueRef = useRef(value)

  // Get capture mode context
  const { startCaptureMode } = useCaptureMode()

  // Screen capture hook
  const { capture: captureScreen, isCapturing: isCapturingScreen } = useScreenCapture()

  // Capture hook for uploading screenshots
  const { uploadScreenshot, createScreenshotCapture } = useCapture()

  // URL metadata hook for embeds
  const { fetchMetadata: fetchUrlMetadata, isLoading: isLoadingMetadata } = useUrlMetadata()

  // Get editor ref for use in callbacks
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  // Store pending capture command range
  const captureCommandRange = useRef<{ from: number; to: number } | null>(null)

  // Screenshot modal state
  const [screenshotState, setScreenshotState] = React.useState<{
    isOpen: boolean
    dataUrl: string | null
    blob: Blob | null
    commandRange: { from: number; to: number } | null
  }>({
    isOpen: false,
    dataUrl: null,
    blob: null,
    commandRange: null
  })
  const [isUploadingScreenshot, setIsUploadingScreenshot] = React.useState(false)

  // AI prompt mode state (inline, not modal)
  const [isAIPromptMode, setIsAIPromptMode] = React.useState(false)
  const [isAILoading, setIsAILoading] = React.useState(false)

  // Help modal state
  const [isHelpModalOpen, setIsHelpModalOpen] = React.useState(false)

  // Handle screenshot confirmation
  const handleScreenshotConfirm = useCallback(async (metadata: {
    sourceUrl: string
    title: string
    notes: string
    tags: string[]
  }) => {
    const currentEditor = editorRef.current
    const range = screenshotState.commandRange
    const blob = screenshotState.blob

    if (!currentEditor || !range || !blob) return

    setIsUploadingScreenshot(true)

    try {
      // Upload screenshot to Supabase Storage
      const storagePath = await uploadScreenshot(blob)

      // Delete the .screenshot command text and insert the capture node
      currentEditor
        .chain()
        .focus()
        .deleteRange(range)
        .insertScreenshotCapture({
          screenshotPath: storagePath,
          screenshotSourceUrl: metadata.sourceUrl,
          displayTitle: metadata.title,
          screenshotNotes: metadata.notes,
          screenshotTags: metadata.tags
        })
        .run()

      // Close modal
      setScreenshotState({
        isOpen: false,
        dataUrl: null,
        blob: null,
        commandRange: null
      })
    } catch (error) {
      console.error('Failed to upload screenshot:', error)
      // TODO: Show error toast
    } finally {
      setIsUploadingScreenshot(false)
    }
  }, [screenshotState, uploadScreenshot])

  // Handle screenshot cancel
  const handleScreenshotCancel = useCallback(() => {
    setScreenshotState({
      isOpen: false,
      dataUrl: null,
      blob: null,
      commandRange: null
    })
  }, [])

  // Handle AI prompt submission (inline mode)
  const handleAISubmit = useCallback(async (prompt: string, model: string | null): Promise<string | null> => {
    setIsAILoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: prompt,
            conversationHistory: [],
            model: model || 'claude'
          }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to generate content')
      }

      const data = await response.json()
      return data.response
    } catch (err) {
      console.error('AI generation error:', err)
      return null
    } finally {
      setIsAILoading(false)
    }
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        code: false,
        heading: {
          levels: [1, 2, 3]
        },
        bulletList: {
          HTMLAttributes: {
            class: 'bullet-list'
          }
        },
        orderedList: {
          HTMLAttributes: {
            class: 'ordered-list'
          }
        },
        listItem: {
          HTMLAttributes: {
            class: 'list-item'
          }
        },
        blockquote: {
          HTMLAttributes: {
            class: 'blockquote'
          }
        }
      }),
      Underline,
      Highlight.configure({
        multicolor: true
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'editor-link'
        }
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty'
      }),
      TextStyle,
      Color,
      FontSizeExtension,
      FontFamilyExtension,
      IndentExtension,
      DragHandleExtension,
      Dropcursor.configure({
        color: '#6366f1',
        width: 2
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph']
      }),
      ResizableImageExtension,
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'editor-table'
        }
      }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList.configure({
        HTMLAttributes: {
          class: 'task-list'
        }
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class: 'task-item'
        }
      }),
      InlineTaskExtension,
      InlineEventExtension,
      TableOfContentsExtension,
      FileAttachmentExtension,
      CaptureExtension,
      CaptureSuggestionExtension,
      ChartExtension,
      DataValueExtension,
      DotCommandExtension,
      VisibilityBlockExtension,
      DotCommandSuggestionExtension.configure({
        onAICommand: (model?: string) => {
          // Insert .AI command text so the AIPromptExtension can take over
          const currentEditor = editorRef.current
          if (!currentEditor) return
          const modelSuffix = model ? `.${model}` : ''
          currentEditor.chain().focus().insertContent(`.AI${modelSuffix} `).run()
        },
        onCaptureCommand: () => {
          // Store current cursor position for later deletion
          const currentEditor = editorRef.current
          if (!currentEditor) return
          const pos = currentEditor.state.selection.from
          captureCommandRange.current = { from: pos, to: pos }

          startCaptureMode((capture) => {
            const range = captureCommandRange.current
            if (!currentEditor || !range) return

            currentEditor
              .chain()
              .focus()
              .insertCaptureFromPicker({
                captureType: capture.captureType,
                entityType: capture.entityType,
                entityId: capture.entityId,
                entityDisplay: capture.entityDisplay,
                snapshotData: capture.snapshotData
              })
              .run()

            captureCommandRange.current = null
          })
        },
        onScreenshotCommand: async () => {
          const result = await captureScreen()
          if (result) {
            const currentEditor = editorRef.current
            const pos = currentEditor?.state.selection.from || 0
            setScreenshotState({
              isOpen: true,
              dataUrl: result.dataUrl,
              blob: result.blob,
              commandRange: { from: pos, to: pos }
            })
          }
        },
        onEmbedCommand: () => {
          // The embed text was already inserted by the extension
          // User will type the URL after it
        },
        onTaskCommand: () => {
          const currentEditor = editorRef.current
          if (!currentEditor) return
          currentEditor.chain().focus().insertContent({
            type: 'inlineTask',
            attrs: {}
          }).run()
        },
        onEventCommand: () => {
          onInsertEvent?.()
        },
        onDividerCommand: () => {
          // Already handled in the extension
        },
        onHelpCommand: () => {
          setIsHelpModalOpen(true)
        },
        templates: templates,
        onTemplateCommand: (shortcut: string, templateId: string) => {
          const currentEditor = editorRef.current
          if (!currentEditor) return

          // Find the template by ID from the passed templates
          const template = templates.find(t => t.id === templateId)
          if (template) {
            // Insert template content - convert plain text to HTML paragraphs if needed
            const content = template.content.includes('<')
              ? template.content
              : `<p>${template.content.replace(/\n/g, '</p><p>')}</p>`
            currentEditor.chain().focus().insertContent(content).run()
          }
        },
        onDataCommand: (type: string, overrideSymbol?: string) => {
          const currentEditor = editorRef.current
          if (!currentEditor) return

          // Use override symbol if provided, otherwise use asset context
          const symbol = overrideSymbol || assetContext?.symbol

          if (symbol) {
            // Insert a dataValue node that will fetch and display the actual data
            currentEditor.chain().focus().insertContent({
              type: 'dataValue',
              attrs: {
                dataType: type,
                symbol: symbol.toUpperCase(),
                isLive: false, // Static by default
                showSymbol: true,
                snapshotValue: null, // Will be fetched
                snapshotAt: null
              }
            }).insertContent(' ').run()
          } else {
            // No symbol available - re-insert the command so user can add a symbol
            // e.g., .price. and they can type AAPL after
            currentEditor.chain().focus().insertContent(`.${type}.`).run()
          }
        },
        onChartCommand: (chartType: string, symbol?: string) => {
          const currentEditor = editorRef.current
          if (!currentEditor) return

          // Use override symbol if provided, otherwise use asset context
          const chartSymbol = symbol || assetContext?.symbol

          // Always insert a chart node - it will show a placeholder if no symbol
          currentEditor.chain().focus().insertContent({
            type: 'chart',
            attrs: {
              chartType: chartType || 'price',
              symbol: chartSymbol || '',
              assetName: chartSymbol || '',
              timeframe: '1M',
              height: 300,
              isLive: !!chartSymbol,
              embeddedAt: new Date().toISOString()
            }
          }).run()
        },
        onVisibilityCommand: (type: VisibilityType, targetId?: string, targetName?: string) => {
          console.log('[VisibilityCommand] called with type:', type)
          const currentEditor = editorRef.current
          if (!currentEditor) {
            console.log('[VisibilityCommand] no editor ref!')
            return
          }

          // Insert a new visibility block (handles both selection wrap and empty insertion)
          console.log('[VisibilityCommand] inserting visibility block')
          currentEditor.chain().focus().insertVisibilityBlock({
            visibilityType: type,
            targetId: targetId || null,
            targetName: targetName || (type === 'private' ? 'Private' : type === 'team' ? 'Team Only' : 'Portfolio Only')
          }).run()
          console.log('[VisibilityCommand] done')
        }
      }),
      AIPromptExtension.configure({
        onSubmit: handleAISubmit,
        onStateChange: setIsAIPromptMode
      }),
      ...(enableMentions ? [MentionExtension.configure({
        onSelect: onMentionSelect,
        suggestion: {
          char: '@',
          items: async ({ query }: { query: string }) => {
            if (onMentionSearch) {
              return await onMentionSearch(query)
            }
            return []
          },
          render: () => {
            let component: any

            return {
              onStart: (props: any) => {
                component = new MentionList(props)
              },
              onUpdate: (props: any) => {
                component?.updateProps(props)
              },
              onKeyDown: (props: any) => {
                return component?.onKeyDown(props) ?? false
              },
              onExit: () => {
                component?.destroy()
              }
            }
          }
        }
      })] : []),
      ...(enableAssets ? [AssetExtension.configure({
        onSelect: onAssetSelect,
        suggestion: {
          char: '$',
          items: async ({ query }: { query: string }) => {
            if (onAssetSearch) {
              return await onAssetSearch(query)
            }
            return []
          },
          render: () => {
            let component: any

            return {
              onStart: (props: any) => {
                component = new AssetList(props)
              },
              onUpdate: (props: any) => {
                component?.updateProps(props)
              },
              onKeyDown: (props: any) => {
                return component?.onKeyDown(props) ?? false
              },
              onExit: () => {
                component?.destroy()
              }
            }
          }
        }
      })] : []),
      ...(enableHashtags ? [HashtagExtension.configure({
        onSelect: onHashtagSelect,
        suggestion: {
          char: '#',
          items: async ({ query }: { query: string }) => {
            if (onHashtagSearch) {
              return await onHashtagSearch(query)
            }
            return []
          },
          render: () => {
            let component: any

            return {
              onStart: (props: any) => {
                component = new HashtagList(props)
              },
              onUpdate: (props: any) => {
                component?.updateProps(props)
              },
              onKeyDown: (props: any) => {
                return component?.onKeyDown(props) ?? false
              },
              onExit: () => {
                component?.destroy()
              }
            }
          }
        }
      })] : []),
      ...(enableNoteLinks ? [NoteLinkExtension.configure({
        onSelect: onNoteLinkSelect,
        onNavigate: onNoteLinkNavigate,
        suggestion: {
          char: '[[',
          allowSpaces: true,
          startOfLine: false,
          items: async ({ query }: { query: string }) => {
            if (onNoteLinkSearch) {
              return await onNoteLinkSearch(query)
            }
            return []
          },
          command: ({ editor, range, props }: any) => {
            // Call onSelect callback if provided
            if (onNoteLinkSelect) {
              onNoteLinkSelect({
                id: props.id,
                title: props.title,
                entityType: props.entityType,
                entityId: props.entityId,
                entityName: props.entityName
              })
            }

            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: 'noteLink',
                  attrs: props
                },
                {
                  type: 'text',
                  text: ' '
                }
              ])
              .run()
          },
          render: () => {
            let component: any

            return {
              onStart: (props: any) => {
                component = new NoteLinkList(props)
              },
              onUpdate: (props: any) => {
                component?.updateProps(props)
              },
              onKeyDown: (props: any) => {
                return component?.onKeyDown(props) ?? false
              },
              onExit: () => {
                component?.destroy()
              }
            }
          }
        }
      })] : [])
    ],
    content: value,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      // Don't trigger onChange if this update was from external source
      if (isExternalUpdate.current) {
        isExternalUpdate.current = false
        return
      }

      const html = editor.getHTML()
      const text = editor.getText()
      lastValueRef.current = html
      onChange(html, text)
    },
    editorProps: {
      attributes: {
        class: clsx(
          'prose prose-sm max-w-none focus:outline-none',
          editorClassName
        ),
        style: `min-height: ${minHeight}; padding: 0.5rem 1rem;`
      },
      // Smart paste handling
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain')
        const html = event.clipboardData?.getData('text/html')
        const files = event.clipboardData?.files

        // Handle file paste (images)
        if (files && files.length > 0) {
          const file = files[0]
          if (file.type.startsWith('image/')) {
            const reader = new FileReader()
            reader.onload = (e) => {
              const result = e.target?.result as string
              editor?.chain().focus().insertContent({
                type: 'resizableImage',
                attrs: { src: result }
              }).run()
            }
            reader.readAsDataURL(file)
            return true
          }
        }

        // Handle URL paste - convert to embed
        if (text && !html) {
          const urlPattern = /^(https?:\/\/[^\s]+)$/i
          if (urlPattern.test(text.trim())) {
            const url = text.trim()
            // Check if it's an image URL
            const imagePattern = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i
            if (imagePattern.test(url)) {
              editor?.chain().focus().insertContent({
                type: 'resizableImage',
                attrs: { src: url }
              }).run()
              return true
            }
            // For other URLs, create an embed with metadata
            // Insert a temporary loading placeholder, then replace with embed
            const currentEditor = editorRef.current
            if (currentEditor) {
              // Insert a temporary link while fetching metadata
              currentEditor.chain().focus().insertContent({
                type: 'capture',
                attrs: {
                  captureType: 'embed',
                  externalUrl: url,
                  externalTitle: new URL(url).hostname,
                  externalDescription: 'Loading...',
                  externalImageUrl: '',
                  externalFaviconUrl: `${new URL(url).origin}/favicon.ico`,
                  displayTitle: new URL(url).hostname
                }
              }).run()

              // Fetch metadata in background and update
              fetchUrlMetadata(url).then(metadata => {
                // We can't easily update the node in place, but the initial insert is sufficient
                // The metadata will be fetched for the display
              }).catch(() => {
                // Fallback already handled by initial insert
              })
            }
            return true
          }
        }

        return false
      },
      // Smart drop handling
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files
        const text = event.dataTransfer?.getData('text/plain')

        // Handle file drop
        if (files && files.length > 0) {
          const file = files[0]
          event.preventDefault()

          if (file.type.startsWith('image/')) {
            // Handle image files - insert as resizable image
            const reader = new FileReader()
            reader.onload = (e) => {
              const result = e.target?.result as string
              editor?.chain().focus().insertContent({
                type: 'resizableImage',
                attrs: { src: result }
              }).run()
            }
            reader.readAsDataURL(file)
          } else {
            // Handle non-image files - insert as file attachment
            const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
            setPendingFileUpload(uploadId, file)
            editor?.chain().focus().insertContent({
              type: 'fileAttachment',
              attrs: {
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                pendingUploadId: uploadId
              }
            }).run()
          }
          return true
        }

        // Handle URL drop
        if (text) {
          const urlPattern = /^(https?:\/\/[^\s]+)$/i
          if (urlPattern.test(text.trim())) {
            event.preventDefault()
            const imagePattern = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i
            if (imagePattern.test(text.trim())) {
              editor?.chain().focus().insertContent({
                type: 'resizableImage',
                attrs: { src: text.trim() }
              }).run()
            } else {
              editor?.chain().focus().insertContent(`<a href="${text.trim()}">${text.trim()}</a>`).run()
            }
            return true
          }
        }

        return false
      }
    }
  })

  // Sync external value changes WITHOUT resetting cursor
  useEffect(() => {
    if (!editor) return

    // Don't sync while editor has focus - user is actively typing
    if (editor.isFocused) {
      // Just update the ref so we don't trigger again
      lastValueRef.current = value
      return
    }

    // Only update if the value actually changed from outside
    // and is different from what the editor currently has
    const currentHTML = editor.getHTML()

    if (value !== lastValueRef.current && value !== currentHTML) {
      // Mark as external update to prevent onChange from firing
      isExternalUpdate.current = true
      lastValueRef.current = value

      // Preserve cursor position
      const { from, to } = editor.state.selection
      editor.commands.setContent(value, false)

      // Try to restore cursor position
      try {
        const docLength = editor.state.doc.content.size
        const safeFrom = Math.min(from, docLength)
        const safeTo = Math.min(to, docLength)
        editor.commands.setTextSelection({ from: safeFrom, to: safeTo })
      } catch (e) {
        // If restoring fails, just focus at the end
      }
    }
  }, [value, editor])

  // Sync editor ref for callbacks
  useEffect(() => {
    if (editor) {
      (editorRef as any).current = editor
    }
  }, [editor])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() ?? '',
    getText: () => editor?.getText() ?? '',
    setContent: (content: string) => {
      if (editor) {
        isExternalUpdate.current = true
        lastValueRef.current = content
        editor.commands.setContent(content)
      }
    },
    focus: () => {
      editor?.commands.focus()
    },
    insertText: (text: string) => {
      editor?.commands.insertContent(text)
    },
    insertHTML: (html: string) => {
      editor?.commands.insertContent(html, { parseOptions: { preserveWhitespace: true } })
    },
    appendHTML: (html: string) => {
      if (editor) {
        // Move to end of document and insert
        editor.commands.focus('end')
        editor.commands.insertContent(html, { parseOptions: { preserveWhitespace: true } })
      }
    }
  }), [editor])

  if (!editor) {
    return (
      <div className={clsx('animate-pulse bg-gray-100 rounded-lg', className)} style={{ minHeight }} />
    )
  }

  return (
    <div className={clsx('rich-text-editor relative', className)}>
      {/* Toolbar - Sticky */}
      {!readOnly && (
        <div className="sticky top-[41px] z-10 bg-white">
          <EditorToolbar
            editor={editor}
            onInsertEvent={onInsertEvent}
            onInsertAttachment={onInsertAttachment}
          />
        </div>
      )}

      {/* Editor Content */}
      <div className="editor-container border border-gray-200 border-t-0 rounded-b-lg bg-white overflow-hidden relative">
        <EditorContent editor={editor} className="editor-content" />
      </div>

      {/* Table Controls (hover + right-click) */}
      <TableControls editor={editor} />

      {/* Screenshot Modal */}
      <ScreenshotModal
        isOpen={screenshotState.isOpen}
        screenshotDataUrl={screenshotState.dataUrl}
        screenshotBlob={screenshotState.blob}
        onConfirm={handleScreenshotConfirm}
        onCancel={handleScreenshotCancel}
        isUploading={isUploadingScreenshot}
      />

      {/* AI Prompt Mode Indicator */}
      {isAIPromptMode && (
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2 bg-purple-50 border-b border-purple-200 z-20 rounded-t-lg">
          <div className="flex items-center gap-2 text-sm text-purple-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            <span className="font-medium">AI Prompt Mode</span>
            {isAILoading && (
              <span className="flex items-center gap-1 text-purple-600">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Generating...
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-purple-600">
            <span className="px-1.5 py-0.5 bg-purple-100 rounded">Enter</span> to submit
            <span className="px-1.5 py-0.5 bg-purple-100 rounded">Esc</span> to cancel
          </div>
        </div>
      )}

      {/* Help Modal */}
      {isHelpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setIsHelpModalOpen(false)}>
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Dot Commands Reference</h2>
              <button
                onClick={() => setIsHelpModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
              <div className="space-y-6">
                {/* AI Commands */}
                <div>
                  <h3 className="text-sm font-semibold text-purple-600 mb-2">AI Commands</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-purple-600">.AI</span><span className="text-gray-600">Generate content with AI (type prompt, press Enter)</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-purple-600">.AI.claude</span><span className="text-gray-600">Generate with Claude model</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-purple-600">.AI.gpt</span><span className="text-gray-600">Generate with GPT model</span></div>
                  </div>
                </div>

                {/* Data Commands */}
                <div>
                  <h3 className="text-sm font-semibold text-emerald-600 mb-2">Data Commands</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-emerald-600">.price</span><span className="text-gray-600">Current stock price</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-emerald-600">.volume</span><span className="text-gray-600">Trading volume</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-emerald-600">.marketcap</span><span className="text-gray-600">Market capitalization</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-emerald-600">.change</span><span className="text-gray-600">Price change %</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-emerald-600">.pe</span><span className="text-gray-600">P/E ratio</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-emerald-600">.dividend</span><span className="text-gray-600">Dividend yield</span></div>
                  </div>
                </div>

                {/* Capture Commands */}
                <div>
                  <h3 className="text-sm font-semibold text-violet-600 mb-2">Capture Commands</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-violet-600">.capture</span><span className="text-gray-600">Capture a platform element (live or static)</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-amber-600">.screenshot</span><span className="text-gray-600">Take a screenshot of your screen</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-blue-600">.embed</span><span className="text-gray-600">Embed a URL with rich preview</span></div>
                  </div>
                </div>

                {/* Chart Commands */}
                <div>
                  <h3 className="text-sm font-semibold text-cyan-600 mb-2">Chart Commands</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-cyan-600">.chart</span><span className="text-gray-600">Insert an embedded chart</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-cyan-600">.chart.price</span><span className="text-gray-600">Price chart (line/area)</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-cyan-600">.chart.volume</span><span className="text-gray-600">Volume chart</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-cyan-600">.chart.performance</span><span className="text-gray-600">Performance chart (%)</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-cyan-600">.chart.comparison</span><span className="text-gray-600">Multi-asset comparison</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-cyan-600">.chart.technicals</span><span className="text-gray-600">Chart with indicators</span></div>
                  </div>
                </div>

                {/* Content Commands */}
                <div>
                  <h3 className="text-sm font-semibold text-cyan-600 mb-2">Content Commands</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-cyan-600">.task</span><span className="text-gray-600">Add an inline task</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-pink-600">.event</span><span className="text-gray-600">Add a calendar event</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-orange-600">.template</span><span className="text-gray-600">Insert a template</span></div>
                  </div>
                </div>

                {/* Visibility Commands */}
                <div>
                  <h3 className="text-sm font-semibold text-amber-600 mb-2">Visibility Commands</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-amber-600">.private</span><span className="text-gray-600">Private note (only you can see)</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-blue-600">.team</span><span className="text-gray-600">Visible to your team only</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-purple-600">.portfolio</span><span className="text-gray-600">Visible to portfolio members</span></div>
                  </div>
                </div>

                {/* Other Commands */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-600 mb-2">Other Commands</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-indigo-600">.toc</span><span className="text-gray-600">Insert table of contents</span></div>
                    <div className="flex gap-3"><span className="w-36 flex-shrink-0 font-mono text-gray-500">.divider</span><span className="text-gray-600">Insert a horizontal divider</span></div>
                  </div>
                </div>

                {/* Tips */}
                <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
                  <p className="font-medium text-gray-700 mb-1">Tips:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Type <code className="px-1 bg-gray-200 rounded">.command</code> then <code className="px-1 bg-gray-200 rounded">Space</code> to activate</li>
                    <li>Use <code className="px-1 bg-gray-200 rounded">@</code> to mention users, <code className="px-1 bg-gray-200 rounded">$</code> for assets, <code className="px-1 bg-gray-200 rounded">#</code> for tags</li>
                    <li>Use <code className="px-1 bg-gray-200 rounded">[[</code> to link to other notes</li>
                    <li>Arrow keys to navigate suggestions, Enter/Tab to select</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom styles */}
      <style>{`
        .ProseMirror {
          outline: none;
        }

        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #9ca3af;
          pointer-events: none;
          height: 0;
        }

        /* Headings */
        .ProseMirror h1 {
          font-size: 1.75rem;
          font-weight: 700;
          line-height: 1.2;
          margin: 1rem 0 0.5rem 0;
          color: #111827;
        }

        .ProseMirror h2 {
          font-size: 1.375rem;
          font-weight: 600;
          line-height: 1.3;
          margin: 0.875rem 0 0.5rem 0;
          color: #1f2937;
        }

        .ProseMirror h3 {
          font-size: 1.125rem;
          font-weight: 600;
          line-height: 1.4;
          margin: 0.75rem 0 0.5rem 0;
          color: #374151;
        }

        /* Paragraphs */
        .ProseMirror p {
          margin: 0.375rem 0;
          line-height: 1.6;
          color: #374151;
          font-size: 0.9375rem;
        }

        /* Highlights - no extra spacing */
        .ProseMirror mark {
          background-color: #fef08a;
          border-radius: 2px;
        }

        .ProseMirror mark[data-color="#fef08a"] { background-color: #fef08a; }
        .ProseMirror mark[data-color="#bbf7d0"] { background-color: #bbf7d0; }
        .ProseMirror mark[data-color="#bfdbfe"] { background-color: #bfdbfe; }
        .ProseMirror mark[data-color="#fbcfe8"] { background-color: #fbcfe8; }
        .ProseMirror mark[data-color="#fed7aa"] { background-color: #fed7aa; }
        .ProseMirror mark[data-color="#e9d5ff"] { background-color: #e9d5ff; }
        .ProseMirror mark[data-color="#fecaca"] { background-color: #fecaca; }
        .ProseMirror mark[data-color="#a5f3fc"] { background-color: #a5f3fc; }

        /* Bullet Lists */
        .ProseMirror ul.bullet-list {
          list-style: none;
          padding-left: 1.25rem;
          margin: 0.375rem 0;
        }

        .ProseMirror ul.bullet-list > li {
          position: relative;
          margin: 0.125rem 0;
        }

        .ProseMirror ul.bullet-list > li::before {
          content: '';
          position: absolute;
          left: -1rem;
          top: 0.55em;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background-color: #6366f1;
        }

        .ProseMirror ul.bullet-list ul.bullet-list > li::before {
          background-color: transparent;
          border: 1.5px solid #6366f1;
        }

        .ProseMirror ul.bullet-list ul.bullet-list ul.bullet-list > li::before {
          border-radius: 0;
          background-color: #6366f1;
        }

        /* Ordered Lists */
        .ProseMirror ol.ordered-list {
          list-style: none;
          padding-left: 1.25rem;
          margin: 0.375rem 0;
          counter-reset: item;
        }

        .ProseMirror ol.ordered-list > li {
          position: relative;
          margin: 0.125rem 0;
          counter-increment: item;
        }

        .ProseMirror ol.ordered-list > li::before {
          content: counter(item) ".";
          position: absolute;
          left: -1.25rem;
          color: #6366f1;
          font-weight: 600;
          font-size: 0.875rem;
        }

        /* Task Lists - Compact styling with centered checkbox */
        .ProseMirror ul.task-list {
          list-style: none;
          padding-left: 0;
          margin: 0.375rem 0;
        }

        .ProseMirror li.task-item {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          padding: 0.125rem 0;
          margin: 0;
        }

        .ProseMirror li.task-item > label {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          height: 1.5rem;
          margin-top: 0;
        }

        .ProseMirror li.task-item > label > input[type="checkbox"] {
          width: 1rem;
          height: 1rem;
          border-radius: 0.25rem;
          cursor: pointer;
          accent-color: #6366f1;
          margin: 0;
        }

        .ProseMirror li.task-item > div {
          flex: 1;
          min-width: 0;
        }

        .ProseMirror li.task-item > div > p {
          margin: 0;
          line-height: 1.5rem;
          font-size: 0.9375rem;
        }

        .ProseMirror li.task-item[data-checked="true"] > div > p {
          text-decoration: line-through;
          color: #9ca3af;
        }

        /* Blockquotes - Compact styling */
        .ProseMirror blockquote.blockquote {
          border-left: 3px solid #6366f1;
          padding: 0.25rem 0.75rem;
          margin: 0.5rem 0;
          background: transparent;
          color: #64748b;
        }

        .ProseMirror blockquote.blockquote p {
          margin: 0;
          font-style: italic;
          font-size: 0.9375rem;
        }

        /* Links */
        .ProseMirror a.editor-link {
          color: #4f46e5;
          text-decoration: underline;
          cursor: pointer;
        }

        .ProseMirror a.editor-link:hover {
          color: #4338ca;
        }

        /* Images */
        .ProseMirror img.editor-image {
          max-width: 100%;
          height: auto;
          border-radius: 0.375rem;
          margin: 0.5rem 0;
        }

        /* Horizontal Rule */
        .ProseMirror hr {
          border: none;
          border-top: 1px solid #e5e7eb;
          margin: 1rem 0;
        }

        /* Tables */
        .ProseMirror table,
        .ProseMirror table.editor-table {
          border-collapse: collapse;
          width: auto;
          margin: 0.75rem 0;
          font-size: 0.875rem;
          border: 1px solid #e5e7eb;
        }

        .ProseMirror table th,
        .ProseMirror table td,
        .ProseMirror table.editor-table th,
        .ProseMirror table.editor-table td {
          border: 1px solid #d1d5db;
          padding: 0.5rem 0.75rem;
          text-align: left;
          vertical-align: top;
          min-width: 80px;
          position: relative;
        }

        .ProseMirror table th,
        .ProseMirror table.editor-table th {
          background: #f3f4f6;
          font-weight: 600;
          color: #374151;
        }

        .ProseMirror table td,
        .ProseMirror table.editor-table td {
          background: #ffffff;
        }

        .ProseMirror table tr:hover td,
        .ProseMirror table.editor-table tr:hover td {
          background: #f9fafb;
        }

        .ProseMirror .selectedCell {
          background: #dbeafe !important;
        }

        .ProseMirror .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: 0;
          width: 4px;
          background-color: #6366f1;
          pointer-events: none;
        }

        .ProseMirror.resize-cursor {
          cursor: col-resize;
        }

        /* Table wrapper */
        .ProseMirror .tableWrapper {
          margin: 0.75rem 0;
          overflow-x: auto;
        }

        /* Text alignment */
        .ProseMirror .text-left { text-align: left; }
        .ProseMirror .text-center { text-align: center; }
        .ProseMirror .text-right { text-align: right; }
        .ProseMirror .text-justify { text-align: justify; }

        /* Mentions, Assets, Hashtags */
        .ProseMirror .mention {
          background-color: #dbeafe;
          color: #1d4ed8;
          padding: 0.1rem 0.3rem;
          border-radius: 0.25rem;
          font-weight: 500;
          font-size: 0.875rem;
        }

        .ProseMirror .asset {
          background-color: #d1fae5;
          color: #047857;
          padding: 0.1rem 0.3rem;
          border-radius: 0.25rem;
          font-weight: 600;
          font-size: 0.875rem;
        }

        .ProseMirror .hashtag {
          background-color: #fef3c7;
          color: #92400e;
          padding: 0.1rem 0.3rem;
          border-radius: 0.25rem;
          font-weight: 500;
          font-size: 0.875rem;
        }

        .ProseMirror .note-link {
          background-color: #f3e8ff;
          color: #7c3aed;
          padding: 0.1rem 0.4rem;
          border-radius: 0.25rem;
          font-weight: 500;
          font-size: 0.875rem;
          cursor: pointer;
          transition: background-color 0.15s, color 0.15s;
          text-decoration: none;
        }

        .ProseMirror .note-link:hover {
          background-color: #ede9fe;
          color: #6d28d9;
        }

        /* Selection */
        .ProseMirror ::selection {
          background-color: #c7d2fe;
        }

        /* Inline Task */
        .inline-task-wrapper {
          width: 100%;
        }

        .inline-task {
          width: 100%;
          max-width: 100%;
        }

        .inline-task input,
        .inline-task textarea,
        .inline-task button {
          font-family: inherit;
        }

        /* Editor content area */
        .editor-content {
          position: relative;
          padding-left: 28px;
        }

        /* Drag Handle */
        .editor-drag-handle {
          position: absolute;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: grab;
          border-radius: 4px;
          color: #94a3b8;
          opacity: 0;
          transition: opacity 0.15s, background 0.15s, color 0.15s;
          z-index: 50;
          pointer-events: auto;
        }

        .editor-drag-handle:hover {
          opacity: 1 !important;
          background: #f1f5f9;
          color: #64748b;
        }

        .editor-drag-handle:active {
          cursor: grabbing;
          background: #e0e7ff;
          color: #4f46e5;
        }

        /* Drop Line Indicator */
        .editor-drop-line {
          position: absolute;
          left: 0;
          right: 0;
          height: 2px;
          background: #6366f1;
          opacity: 0;
          transition: opacity 0.1s;
          pointer-events: none;
          z-index: 40;
          border-radius: 1px;
          box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.2);
        }

        /* Dropcursor */
        .ProseMirror-dropcursor {
          border-left: 2px solid #6366f1 !important;
        }

        /* Visibility Block */
        .visibility-block-wrapper {
          margin: 0.5rem 0;
        }

        .visibility-block-content {
          min-height: 1.5em;
          outline: none;
        }

        .visibility-block-content p {
          margin: 0.25rem 0;
        }

        .visibility-block-content:focus {
          outline: none;
        }

        .visibility-block-content p.is-empty:first-child::before {
          content: 'Type here...';
          color: #9ca3af;
          pointer-events: none;
          float: left;
          height: 0;
        }
      `}</style>
    </div>
  )
})

RichTextEditorInner.displayName = 'RichTextEditor'

// Memoize to prevent unnecessary re-renders
export const RichTextEditor = memo(RichTextEditorInner)
