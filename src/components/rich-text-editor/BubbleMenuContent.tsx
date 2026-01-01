import React, { useState } from 'react'
import { Editor } from '@tiptap/react'
import { clsx } from 'clsx'
import {
  Bold, Italic, Underline, Strikethrough, Code, Highlighter,
  Link as LinkIcon, ChevronDown
} from 'lucide-react'

interface BubbleMenuContentProps {
  editor: Editor
}

const HIGHLIGHT_COLORS = [
  { name: 'Yellow', color: '#fef08a' },
  { name: 'Green', color: '#bbf7d0' },
  { name: 'Blue', color: '#bfdbfe' },
  { name: 'Pink', color: '#fbcfe8' },
  { name: 'Orange', color: '#fed7aa' }
]

export function BubbleMenuContent({ editor }: BubbleMenuContentProps) {
  const [showColors, setShowColors] = useState(false)
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  const ToolButton = ({
    onClick,
    isActive = false,
    title,
    children
  }: {
    onClick: () => void
    isActive?: boolean
    title: string
    children: React.ReactNode
  }) => (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        'p-1.5 rounded transition-all',
        isActive
          ? 'bg-primary-100 text-primary-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      )}
    >
      {children}
    </button>
  )

  const addLink = () => {
    if (linkUrl) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run()
      setLinkUrl('')
      setShowLinkInput(false)
    }
  }

  return (
    <>
      <ToolButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold"
      >
        <Bold className="w-4 h-4" />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic"
      >
        <Italic className="w-4 h-4" />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        title="Underline"
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
      <ToolButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive('code')}
        title="Code"
      >
        <Code className="w-4 h-4" />
      </ToolButton>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-200 mx-0.5" />

      {/* Highlight with colors */}
      <div className="relative">
        <button
          onClick={() => setShowColors(!showColors)}
          className={clsx(
            'flex items-center p-1.5 rounded transition-all',
            editor.isActive('highlight')
              ? 'bg-yellow-100 text-yellow-700'
              : 'text-gray-600 hover:bg-gray-100'
          )}
          title="Highlight"
        >
          <Highlighter className="w-4 h-4" />
          <ChevronDown className="w-3 h-3 ml-0.5" />
        </button>

        {showColors && (
          <div className="absolute bottom-full left-0 mb-1 bg-white rounded-lg shadow-xl border border-gray-200 p-2 z-50">
            <div className="flex items-center gap-1">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color.name}
                  onClick={() => {
                    editor.chain().focus().toggleHighlight({ color: color.color }).run()
                    setShowColors(false)
                  }}
                  className={clsx(
                    'w-5 h-5 rounded-full border-2 transition-all hover:scale-110',
                    editor.isActive('highlight', { color: color.color })
                      ? 'border-gray-800'
                      : 'border-transparent'
                  )}
                  style={{ backgroundColor: color.color }}
                  title={color.name}
                />
              ))}
              <button
                onClick={() => {
                  editor.chain().focus().unsetHighlight().run()
                  setShowColors(false)
                }}
                className="w-5 h-5 rounded-full border-2 border-gray-300 bg-white flex items-center justify-center text-gray-400 hover:text-gray-600 transition-all"
                title="Remove"
              >
                ×
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-200 mx-0.5" />

      {/* Link */}
      <div className="relative">
        <button
          onClick={() => {
            if (editor.isActive('link')) {
              editor.chain().focus().unsetLink().run()
            } else {
              setShowLinkInput(!showLinkInput)
            }
          }}
          className={clsx(
            'p-1.5 rounded transition-all',
            editor.isActive('link')
              ? 'bg-primary-100 text-primary-700'
              : 'text-gray-600 hover:bg-gray-100'
          )}
          title="Link"
        >
          <LinkIcon className="w-4 h-4" />
        </button>

        {showLinkInput && (
          <div className="absolute bottom-full left-0 mb-1 bg-white rounded-lg shadow-xl border border-gray-200 p-2 z-50 w-56">
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 mb-2"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addLink()
                } else if (e.key === 'Escape') {
                  setShowLinkInput(false)
                }
              }}
            />
            <div className="flex justify-end gap-1">
              <button
                onClick={() => setShowLinkInput(false)}
                className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={addLink}
                className="px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700"
              >
                Add Link
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
