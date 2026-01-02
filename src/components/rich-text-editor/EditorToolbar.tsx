import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import { clsx } from 'clsx'
import {
  Bold, Italic, Underline, Strikethrough, Highlighter,
  List, ListOrdered, CheckSquare, Quote,
  Link as LinkIcon, Minus, Undo2, Redo2, ChevronDown,
  AlignLeft, AlignCenter, AlignRight,
  IndentIncrease, IndentDecrease, Eraser, Plus,
  Image, Table, Calendar, Paperclip, CalendarPlus, X, Check,
  ClipboardList, ListTree, FileUp, Paintbrush
} from 'lucide-react'

interface EditorToolbarProps {
  editor: Editor
  onInsertEvent?: () => void
  onInsertAttachment?: () => void
  contextType?: string
  contextId?: string
}

const HIGHLIGHT_COLORS = [
  { name: 'Yellow', color: '#fef08a' },
  { name: 'Green', color: '#bbf7d0' },
  { name: 'Blue', color: '#bfdbfe' },
  { name: 'Pink', color: '#fbcfe8' },
  { name: 'Orange', color: '#fed7aa' },
  { name: 'Purple', color: '#e9d5ff' },
  { name: 'Red', color: '#fecaca' },
  { name: 'Cyan', color: '#a5f3fc' }
]

const TEXT_COLORS = [
  { name: 'Black', color: '#000000' },
  { name: 'Dark Gray', color: '#374151' },
  { name: 'Gray', color: '#6b7280' },
  { name: 'Red', color: '#dc2626' },
  { name: 'Orange', color: '#ea580c' },
  { name: 'Yellow', color: '#ca8a04' },
  { name: 'Green', color: '#16a34a' },
  { name: 'Teal', color: '#0d9488' },
  { name: 'Blue', color: '#2563eb' },
  { name: 'Indigo', color: '#4f46e5' },
  { name: 'Purple', color: '#7c3aed' },
  { name: 'Pink', color: '#db2777' }
]

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]

const FONT_FAMILIES = [
  { label: 'Default', value: '', isDefault: true },
  { label: 'Sans Serif', value: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, Cambria, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' }
]

const HEADING_OPTIONS = [
  { label: 'Normal', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 }
]

export function EditorToolbar({
  editor,
  onInsertEvent,
  onInsertAttachment,
  contextType,
  contextId
}: EditorToolbarProps) {
  const [showHeadingMenu, setShowHeadingMenu] = useState(false)
  const [showHighlightMenu, setShowHighlightMenu] = useState(false)
  const [showColorMenu, setShowColorMenu] = useState(false)
  const [showSizeMenu, setShowSizeMenu] = useState(false)
  const [showFontMenu, setShowFontMenu] = useState(false)
  const [showListMenu, setShowListMenu] = useState(false)
  const [showInsertMenu, setShowInsertMenu] = useState(false)
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [showImageModal, setShowImageModal] = useState(false)
  const [showTableModal, setShowTableModal] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imageAlt, setImageAlt] = useState('')
  const [tableSize, setTableSize] = useState({ rows: 3, cols: 3 })
  const [tableHover, setTableHover] = useState({ rows: 0, cols: 0 })
  const [isFormatPainterActive, setIsFormatPainterActive] = useState(false)
  const [storedFormat, setStoredFormat] = useState<{
    bold: boolean
    italic: boolean
    underline: boolean
    strike: boolean
    color: string | null
    highlight: string | null
    fontSize: string | null
    fontFamily: string | null
  } | null>(null)

  const headingRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const colorRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<HTMLDivElement>(null)
  const fontRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const insertRef = useRef<HTMLDivElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  // Get current font family
  const currentFontFamily = useMemo(() => {
    const attrs = editor.getAttributes('textStyle')
    const family = attrs.fontFamily
    // If no explicit font family set, show Default
    if (!family || family === 'null' || family === 'undefined') {
      return 'Default'
    }
    // Find exact match in our font list
    const match = FONT_FAMILIES.find(f => f.value && f.value === family)
    return match?.label || 'Default'
  }, [editor.state])

  // Get current font size
  const currentFontSize = useMemo(() => {
    const attrs = editor.getAttributes('textStyle')
    const size = attrs.fontSize || ''
    if (!size) return '12'
    return size.replace('pt', '').replace('px', '')
  }, [editor.state])

  // Get current heading level
  const currentHeading = useMemo(() => {
    if (editor.isActive('heading', { level: 1 })) return 'Heading 1'
    if (editor.isActive('heading', { level: 2 })) return 'Heading 2'
    if (editor.isActive('heading', { level: 3 })) return 'Heading 3'
    return 'Normal'
  }, [editor.state])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (headingRef.current && !headingRef.current.contains(e.target as Node)) setShowHeadingMenu(false)
      if (highlightRef.current && !highlightRef.current.contains(e.target as Node)) setShowHighlightMenu(false)
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setShowColorMenu(false)
      if (sizeRef.current && !sizeRef.current.contains(e.target as Node)) setShowSizeMenu(false)
      if (fontRef.current && !fontRef.current.contains(e.target as Node)) setShowFontMenu(false)
      if (listRef.current && !listRef.current.contains(e.target as Node)) setShowListMenu(false)
      if (insertRef.current && !insertRef.current.contains(e.target as Node)) setShowInsertMenu(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const addLink = () => {
    if (linkUrl) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run()
      setLinkUrl('')
      setShowLinkInput(false)
    }
  }

  const insertImage = () => {
    if (imageUrl) {
      editor.chain().focus().setImage({ src: imageUrl, alt: imageAlt }).run()
      setImageUrl('')
      setImageAlt('')
      setShowImageModal(false)
    }
  }

  const applyFontSize = (size: number) => {
    (editor.chain().focus() as any).setFontSize(`${size}pt`).run()
    setShowSizeMenu(false)
  }

  const applyFontFamily = (family: string) => {
    if (family) {
      (editor.chain().focus() as any).setFontFamily(family).run()
    } else {
      (editor.chain().focus() as any).unsetFontFamily().run()
    }
    setShowFontMenu(false)
  }

  // Format Painter - use ref to avoid stale closures
  const storedFormatRef = useRef(storedFormat)
  storedFormatRef.current = storedFormat

  const formatPainterActiveRef = useRef(isFormatPainterActive)
  formatPainterActiveRef.current = isFormatPainterActive

  const captureFormat = useCallback(() => {
    const textStyleAttrs = editor.getAttributes('textStyle')
    const highlightAttrs = editor.getAttributes('highlight')

    const format = {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      color: textStyleAttrs.color || null,
      highlight: highlightAttrs.color || null,
      fontSize: textStyleAttrs.fontSize || null,
      fontFamily: textStyleAttrs.fontFamily || null
    }

    setStoredFormat(format)
    setIsFormatPainterActive(true)
  }, [editor])

  const applyStoredFormat = useCallback(() => {
    const format = storedFormatRef.current
    if (!format) return

    const { from, to } = editor.state.selection
    if (from === to) return // No selection

    // Build the chain properly
    let chain = editor.chain().focus()

    // First unset all marks on the selection
    chain = chain.unsetAllMarks()

    // Apply each format individually
    if (format.bold) chain = chain.setBold()
    if (format.italic) chain = chain.setItalic()
    if (format.underline) chain = chain.setUnderline()
    if (format.strike) chain = chain.setStrike()

    // Run the basic marks first
    chain.run()

    // Now apply text style attributes separately for better reliability
    if (format.color) {
      editor.chain().focus().setColor(format.color).run()
    }
    if (format.highlight) {
      editor.chain().focus().setHighlight({ color: format.highlight }).run()
    }
    if (format.fontSize) {
      (editor.chain().focus() as any).setFontSize(format.fontSize).run()
    }
    if (format.fontFamily) {
      (editor.chain().focus() as any).setFontFamily(format.fontFamily).run()
    }

    // Deactivate format painter after applying
    setIsFormatPainterActive(false)
    setStoredFormat(null)
  }, [editor])

  // Listen for mouseup to apply format after user finishes selecting
  useEffect(() => {
    if (!isFormatPainterActive) return

    const editorElement = editor.view.dom

    // Change cursor to indicate paint mode
    editorElement.style.cursor = 'crosshair'

    const handleMouseUp = (e: MouseEvent) => {
      // Small delay to ensure selection is complete
      setTimeout(() => {
        if (formatPainterActiveRef.current) {
          const { from, to } = editor.state.selection
          if (from !== to) {
            applyStoredFormat()
          }
        }
      }, 10)
    }

    editorElement.addEventListener('mouseup', handleMouseUp)

    return () => {
      editorElement.removeEventListener('mouseup', handleMouseUp)
      editorElement.style.cursor = ''
    }
  }, [isFormatPainterActive, editor, applyStoredFormat])

  // Cancel format painter on Escape key
  useEffect(() => {
    if (!isFormatPainterActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFormatPainterActive(false)
        setStoredFormat(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isFormatPainterActive])

  const ToolButton = ({
    onClick,
    isActive = false,
    disabled = false,
    title,
    children,
    className
  }: {
    onClick: () => void
    isActive?: boolean
    disabled?: boolean
    title: string
    children: React.ReactNode
    className?: string
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        'p-1.5 rounded transition-all duration-150',
        isActive
          ? 'bg-primary-100 text-primary-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        disabled && 'opacity-40 cursor-not-allowed',
        className
      )}
    >
      {children}
    </button>
  )

  const Divider = () => <div className="w-px h-5 bg-gray-200 mx-1" />

  return (
    <>
      <div className="flex flex-wrap items-center gap-0.5 p-2 bg-gray-50 border border-gray-200 rounded-t-lg border-b-0">
        {/* Undo/Redo */}
        <div className="flex items-center gap-0.5 mr-1">
          <ToolButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </ToolButton>
        </div>

        <Divider />

        {/* Font Family - Shows current selection */}
        <div className="relative" ref={fontRef}>
          <button
            onClick={() => setShowFontMenu(!showFontMenu)}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-all min-w-[90px]',
              showFontMenu ? 'bg-gray-200' : 'hover:bg-gray-100',
              'text-gray-700 border border-gray-200'
            )}
          >
            <span className="truncate flex-1 text-left">{currentFontFamily}</span>
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          </button>

          {showFontMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[160px]">
              {FONT_FAMILIES.map((font) => (
                <button
                  key={font.label}
                  onClick={() => applyFontFamily(font.value)}
                  className={clsx(
                    'w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 flex items-center justify-between',
                    currentFontFamily === font.label && 'bg-primary-50 text-primary-700'
                  )}
                  style={{ fontFamily: font.value || 'inherit' }}
                >
                  <span>{font.label}</span>
                  {currentFontFamily === font.label && <Check className="w-3 h-3" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Font Size - Shows current size */}
        <div className="relative" ref={sizeRef}>
          <button
            onClick={() => setShowSizeMenu(!showSizeMenu)}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-all min-w-[50px]',
              showSizeMenu ? 'bg-gray-200' : 'hover:bg-gray-100',
              'text-gray-700 border border-gray-200'
            )}
          >
            <span className="flex-1 text-left">{currentFontSize}</span>
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          </button>

          {showSizeMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 w-24">
              {/* Custom size input */}
              <div className="px-2 pb-1 mb-1 border-b border-gray-100">
                <input
                  type="number"
                  min="1"
                  max="200"
                  placeholder="Size"
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const value = parseInt((e.target as HTMLInputElement).value)
                      if (value > 0 && value <= 200) {
                        applyFontSize(value)
                      }
                    }
                  }}
                  autoFocus
                />
              </div>
              {/* Preset sizes */}
              <div className="max-h-48 overflow-y-auto">
                {FONT_SIZES.map((size) => (
                  <button
                    key={size}
                    onClick={() => applyFontSize(size)}
                    className={clsx(
                      'w-full px-3 py-1.5 text-xs text-left transition-colors flex items-center justify-between',
                      currentFontSize === String(size)
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'hover:bg-gray-50'
                    )}
                  >
                    <span>{size}</span>
                    {currentFontSize === String(size) && <Check className="w-3 h-3" />}
                  </button>
                ))}
              </div>
              {/* Reset option */}
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={() => { (editor.chain().focus() as any).unsetFontSize().run(); setShowSizeMenu(false) }}
                  className="w-full px-3 py-1.5 text-xs text-left text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                >
                  Reset to default
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Headings - Shows current selection */}
        <div className="relative" ref={headingRef}>
          <button
            onClick={() => setShowHeadingMenu(!showHeadingMenu)}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-all min-w-[80px]',
              showHeadingMenu ? 'bg-gray-200' : 'hover:bg-gray-100',
              editor.isActive('heading') ? 'text-primary-700' : 'text-gray-700',
              'border border-gray-200'
            )}
          >
            <span className="truncate flex-1 text-left">{currentHeading}</span>
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          </button>

          {showHeadingMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[120px]">
              {HEADING_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => {
                    if (opt.level === 0) {
                      editor.chain().focus().setParagraph().run()
                    } else {
                      editor.chain().focus().toggleHeading({ level: opt.level as 1|2|3 }).run()
                    }
                    setShowHeadingMenu(false)
                  }}
                  className={clsx(
                    'w-full px-3 py-1.5 text-left hover:bg-gray-50 flex items-center justify-between',
                    currentHeading === opt.label && 'bg-primary-50 text-primary-700'
                  )}
                  style={{
                    fontSize: opt.level === 0 ? '0.875rem' : `${1.25 - opt.level * 0.15}rem`,
                    fontWeight: opt.level > 0 ? 600 : 400
                  }}
                >
                  <span>{opt.label}</span>
                  {currentHeading === opt.label && <Check className="w-3 h-3" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <Divider />

        {/* Text Formatting */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            title="Bold (Ctrl+B)"
          >
            <Bold className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            title="Italic (Ctrl+I)"
          >
            <Italic className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive('underline')}
            title="Underline (Ctrl+U)"
          >
            <Underline className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive('strike')}
            title="Strikethrough"
          >
            <Strikethrough className="w-4 h-4" />
          </ToolButton>
        </div>

        <Divider />

        {/* Text Color */}
        <div className="relative" ref={colorRef}>
          <button
            onClick={() => setShowColorMenu(!showColorMenu)}
            className={clsx(
              'flex items-center gap-0.5 p-1.5 rounded transition-all',
              showColorMenu ? 'bg-gray-200' : 'hover:bg-gray-100'
            )}
            title="Text Color"
          >
            <div className="w-4 h-4 flex flex-col items-center justify-center">
              <span className="text-xs font-bold leading-none">A</span>
              <div className="w-3.5 h-1 rounded-sm bg-current mt-0.5" />
            </div>
            <ChevronDown className="w-3 h-3 text-gray-500" />
          </button>

          {showColorMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 p-2 z-50">
              <div className="grid grid-cols-6 gap-1">
                {TEXT_COLORS.map((color) => (
                  <button
                    key={color.name}
                    onClick={() => { editor.chain().focus().setColor(color.color).run(); setShowColorMenu(false) }}
                    className="w-6 h-6 rounded border border-gray-200 hover:scale-110 transition-transform"
                    style={{ backgroundColor: color.color }}
                    title={color.name}
                  />
                ))}
              </div>
              <button
                onClick={() => { editor.chain().focus().unsetColor().run(); setShowColorMenu(false) }}
                className="w-full mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500 hover:text-gray-700"
              >
                Reset
              </button>
            </div>
          )}
        </div>

        {/* Highlight */}
        <div className="relative" ref={highlightRef}>
          <button
            onClick={() => setShowHighlightMenu(!showHighlightMenu)}
            className={clsx(
              'flex items-center gap-0.5 p-1.5 rounded transition-all',
              showHighlightMenu ? 'bg-yellow-100' : 'hover:bg-gray-100',
              editor.isActive('highlight') ? 'text-yellow-700' : 'text-gray-600'
            )}
            title="Highlight"
          >
            <Highlighter className="w-4 h-4" />
            <ChevronDown className="w-3 h-3" />
          </button>

          {showHighlightMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 p-2 z-50">
              <div className="grid grid-cols-4 gap-1">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color.name}
                    onClick={() => { editor.chain().focus().toggleHighlight({ color: color.color }).run(); setShowHighlightMenu(false) }}
                    className="w-7 h-7 rounded border-2 border-transparent hover:border-gray-400 transition-all"
                    style={{ backgroundColor: color.color }}
                    title={color.name}
                  />
                ))}
              </div>
              <button
                onClick={() => { editor.chain().focus().unsetHighlight().run(); setShowHighlightMenu(false) }}
                className="w-full mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500 hover:text-gray-700"
              >
                Remove
              </button>
            </div>
          )}
        </div>

        <Divider />

        {/* Lists */}
        <div className="relative" ref={listRef}>
          <button
            onClick={() => setShowListMenu(!showListMenu)}
            className={clsx(
              'flex items-center gap-0.5 p-1.5 rounded transition-all',
              showListMenu ? 'bg-gray-200' : 'hover:bg-gray-100',
              (editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList'))
                ? 'text-primary-700' : 'text-gray-600'
            )}
            title="Lists"
          >
            <List className="w-4 h-4" />
            <ChevronDown className="w-3 h-3" />
          </button>

          {showListMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[150px]">
              <button
                onClick={() => { editor.chain().focus().toggleBulletList().run(); setShowListMenu(false) }}
                className={clsx('w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2', editor.isActive('bulletList') && 'bg-primary-50 text-primary-700')}
              >
                <List className="w-4 h-4" /> Bullet List
              </button>
              <button
                onClick={() => { editor.chain().focus().toggleOrderedList().run(); setShowListMenu(false) }}
                className={clsx('w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2', editor.isActive('orderedList') && 'bg-primary-50 text-primary-700')}
              >
                <ListOrdered className="w-4 h-4" /> Numbered List
              </button>
              <button
                onClick={() => { editor.chain().focus().toggleTaskList().run(); setShowListMenu(false) }}
                className={clsx('w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2', editor.isActive('taskList') && 'bg-primary-50 text-primary-700')}
              >
                <CheckSquare className="w-4 h-4" /> Checklist
              </button>
            </div>
          )}
        </div>

        {/* Alignment */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            isActive={editor.isActive({ textAlign: 'left' })}
            title="Align Left"
          >
            <AlignLeft className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            isActive={editor.isActive({ textAlign: 'center' })}
            title="Align Center"
          >
            <AlignCenter className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            isActive={editor.isActive({ textAlign: 'right' })}
            title="Align Right"
          >
            <AlignRight className="w-4 h-4" />
          </ToolButton>
        </div>

        {/* Indentation */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            onClick={() => {
              // Try list indentation first, then paragraph indentation
              if (editor.can().sinkListItem('listItem')) {
                editor.chain().focus().sinkListItem('listItem').run()
              } else if (editor.can().sinkListItem('taskItem')) {
                editor.chain().focus().sinkListItem('taskItem').run()
              } else {
                (editor.commands as any).indent()
              }
            }}
            title="Increase Indent (Tab)"
          >
            <IndentIncrease className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            onClick={() => {
              // Try list outdentation first, then paragraph outdentation
              if (editor.can().liftListItem('listItem')) {
                editor.chain().focus().liftListItem('listItem').run()
              } else if (editor.can().liftListItem('taskItem')) {
                editor.chain().focus().liftListItem('taskItem').run()
              } else {
                (editor.commands as any).outdent()
              }
            }}
            title="Decrease Indent (Shift+Tab)"
          >
            <IndentDecrease className="w-4 h-4" />
          </ToolButton>
        </div>

        <Divider />

        {/* Quote */}
        <ToolButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          title="Quote"
        >
          <Quote className="w-4 h-4" />
        </ToolButton>

        {/* Link */}
        <div className="relative">
          <ToolButton
            onClick={() => {
              if (editor.isActive('link')) {
                editor.chain().focus().unsetLink().run()
              } else {
                setShowLinkInput(!showLinkInput)
                setTimeout(() => linkInputRef.current?.focus(), 0)
              }
            }}
            isActive={editor.isActive('link')}
            title="Link (Ctrl+K)"
          >
            <LinkIcon className="w-4 h-4" />
          </ToolButton>

          {showLinkInput && (
            <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 p-3 z-50 w-72">
              <p className="text-xs font-medium text-gray-500 mb-2">Insert Link</p>
              <input
                ref={linkInputRef}
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addLink()
                  else if (e.key === 'Escape') setShowLinkInput(false)
                }}
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setShowLinkInput(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={addLink}
                  className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded hover:bg-primary-700"
                >
                  Insert
                </button>
              </div>
            </div>
          )}
        </div>

        <Divider />

        {/* Insert Menu */}
        <div className="relative" ref={insertRef}>
          <button
            onClick={() => setShowInsertMenu(!showInsertMenu)}
            className={clsx(
              'flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-all',
              showInsertMenu ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100 text-gray-700'
            )}
          >
            <Plus className="w-4 h-4" />
            <span>Insert</span>
            <ChevronDown className="w-3 h-3" />
          </button>

          {showInsertMenu && (
            <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[180px]">
              <button
                onClick={() => { setShowImageModal(true); setShowInsertMenu(false) }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <Image className="w-4 h-4 text-blue-500" /> Image
              </button>
              <button
                onClick={() => {
                  setShowTableModal(true)
                  setShowInsertMenu(false)
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <Table className="w-4 h-4 text-green-500" /> Table
              </button>
              <button
                onClick={() => { editor.chain().focus().setHorizontalRule().run(); setShowInsertMenu(false) }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <Minus className="w-4 h-4 text-gray-500" /> Divider
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => {
                  editor.chain().focus().insertContent({
                    type: 'inlineTask',
                    attrs: {
                      contextType: contextType || '',
                      contextId: contextId || ''
                    }
                  }).run()
                  setShowInsertMenu(false)
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <ClipboardList className="w-4 h-4 text-indigo-500" /> Task
              </button>
              <button
                onClick={() => {
                  editor.chain().focus().insertContent({
                    type: 'inlineEvent',
                    attrs: {
                      contextType: contextType || '',
                      contextId: contextId || ''
                    }
                  }).run()
                  setShowInsertMenu(false)
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <CalendarPlus className="w-4 h-4 text-blue-500" /> Event
              </button>
              <button
                onClick={() => {
                  editor.chain().focus().insertContent({
                    type: 'fileAttachment',
                    attrs: {
                      contextType: contextType || '',
                      contextId: contextId || ''
                    }
                  }).run()
                  setShowInsertMenu(false)
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <FileUp className="w-4 h-4 text-gray-500" /> File
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => {
                  console.log('Inserting tableOfContents', editor.extensionManager.extensions.map((e: any) => e.name))
                  try {
                    editor.chain().focus().insertContent({
                      type: 'tableOfContents'
                    }).run()
                  } catch (err) {
                    console.error('Error inserting TOC:', err)
                  }
                  setShowInsertMenu(false)
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <ListTree className="w-4 h-4 text-teal-500" /> Table of Contents
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => { editor.chain().focus().insertContent(new Date().toLocaleDateString()).run(); setShowInsertMenu(false) }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <Calendar className="w-4 h-4 text-orange-500" /> Current Date
              </button>
              <button
                onClick={() => { editor.chain().focus().insertContent(new Date().toLocaleTimeString()).run(); setShowInsertMenu(false) }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <Calendar className="w-4 h-4 text-purple-500" /> Current Time
              </button>
              {onInsertEvent && (
                <>
                  <div className="border-t border-gray-100 my-1" />
                  <button
                    onClick={() => { onInsertEvent(); setShowInsertMenu(false) }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                  >
                    <CalendarPlus className="w-4 h-4 text-indigo-500" /> Calendar Event
                  </button>
                </>
              )}
              {onInsertAttachment && (
                <button
                  onClick={() => { onInsertAttachment(); setShowInsertMenu(false) }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <Paperclip className="w-4 h-4 text-gray-500" /> Attachment
                </button>
              )}
            </div>
          )}
        </div>

        {/* Format Painter & Clear Formatting */}
        <div className="ml-auto flex items-center gap-0.5">
          <ToolButton
            onClick={() => {
              if (isFormatPainterActive) {
                setIsFormatPainterActive(false)
                setStoredFormat(null)
              } else {
                captureFormat()
              }
            }}
            isActive={isFormatPainterActive}
            title={isFormatPainterActive ? "Cancel Format Painter (Esc)" : "Format Painter - Copy formatting from selected text"}
          >
            <Paintbrush className={clsx("w-4 h-4", isFormatPainterActive && "text-primary-600")} />
          </ToolButton>
          <ToolButton
            onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
            title="Clear Formatting"
          >
            <Eraser className="w-4 h-4" />
          </ToolButton>
        </div>
      </div>

      {/* Image Insert Modal */}
      {showImageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowImageModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Insert Image</h3>
              <button onClick={() => setShowImageModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Image URL</label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Alt Text (optional)</label>
                <input
                  type="text"
                  value={imageAlt}
                  onChange={(e) => setImageAlt(e.target.value)}
                  placeholder="Describe the image"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {imageUrl && (
                <div className="border rounded-lg p-2 bg-gray-50">
                  <p className="text-xs text-gray-500 mb-2">Preview:</p>
                  <img
                    src={imageUrl}
                    alt={imageAlt || 'Preview'}
                    className="max-h-32 rounded"
                    onError={(e) => (e.target as HTMLImageElement).style.display = 'none'}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowImageModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={insertImage}
                disabled={!imageUrl}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Insert Image
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table Insert Modal */}
      {showTableModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowTableModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Insert Table</h3>
              <button onClick={() => setShowTableModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Grid Selector */}
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  Select size: <span className="font-medium text-gray-900">{tableHover.rows || tableSize.rows} x {tableHover.cols || tableSize.cols}</span>
                </p>
                <div className="inline-grid gap-1 p-2 bg-gray-50 rounded-lg" style={{ gridTemplateColumns: 'repeat(8, 1fr)' }}>
                  {Array.from({ length: 8 }).map((_, row) =>
                    Array.from({ length: 8 }).map((_, col) => (
                      <button
                        key={`${row}-${col}`}
                        className={clsx(
                          'w-5 h-5 rounded border transition-colors',
                          (tableHover.rows > row && tableHover.cols > col) || (!tableHover.rows && tableSize.rows > row && tableSize.cols > col)
                            ? 'bg-primary-500 border-primary-600'
                            : 'bg-white border-gray-300 hover:border-primary-400'
                        )}
                        onMouseEnter={() => setTableHover({ rows: row + 1, cols: col + 1 })}
                        onMouseLeave={() => setTableHover({ rows: 0, cols: 0 })}
                        onClick={() => {
                          setTableSize({ rows: row + 1, cols: col + 1 })
                          editor.chain().focus().insertTable({ rows: row + 1, cols: col + 1, withHeaderRow: true }).run()
                          setShowTableModal(false)
                        }}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Manual Input */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Rows</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={tableSize.rows}
                    onChange={(e) => setTableSize(s => ({ ...s, rows: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <span className="text-gray-400 mt-5">x</span>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Columns</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={tableSize.cols}
                    onChange={(e) => setTableSize(s => ({ ...s, cols: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowTableModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  editor.chain().focus().insertTable({ rows: tableSize.rows, cols: tableSize.cols, withHeaderRow: true }).run()
                  setShowTableModal(false)
                }}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                Insert Table
              </button>
            </div>
          </div>
        </div>
      )}

      </>
  )
}
