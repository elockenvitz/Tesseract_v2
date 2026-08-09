import { useState } from 'react'
import { clsx } from 'clsx'
import type { Editor } from '@tiptap/react'
import {
  Bold, Italic, Heading2, List, ListOrdered, CheckSquare, SlidersHorizontal, Undo2,
} from 'lucide-react'
import { BottomSheet } from '../mobile/BottomSheet'
import { EditorToolbar } from './EditorToolbar'

interface MobileFormatBarProps {
  editor: Editor
  onInsertEvent?: () => void
  onInsertAttachment?: () => void
  contextType?: string
  contextId?: string
}

/**
 * The formatting controls, on a phone.
 *
 * The desktop ribbon is forty controls that wrap. At 390px that is five or six
 * rows standing permanently between the title and the first line of text —
 * more of the screen spent on formatting than on writing, before a word is
 * typed.
 *
 * Making it scroll sideways was worse: the same forty controls, but now you
 * cannot see what exists or remember where anything is, and finding a tool
 * means swiping blind.
 *
 * The actual problem was that the whole ribbon was always present. Six controls
 * cover almost everything anyone does while writing on a phone — bold, italic,
 * a heading, two kinds of list, a checkbox — so those stay on one row, and the
 * complete ribbon is one tap away in a sheet where it has room to wrap and can
 * be read rather than scrolled past.
 */
export function MobileFormatBar({
  editor,
  onInsertEvent,
  onInsertAttachment,
  contextType,
  contextId,
}: MobileFormatBarProps) {
  const [sheetOpen, setSheetOpen] = useState(false)

  const Btn = ({
    active, onClick, label, children,
  }: {
    active?: boolean
    onClick: () => void
    label: string
    children: React.ReactNode
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={clsx(
        'flex-1 h-10 flex items-center justify-center rounded-md transition-colors no-touch-target',
        active
          ? 'bg-white text-primary-600 shadow-sm dark:bg-gray-700 dark:text-primary-400'
          : 'text-gray-500 dark:text-gray-400 active:bg-gray-200 dark:active:bg-gray-700'
      )}
    >
      {children}
    </button>
  )

  return (
    <>
      <div className="flex items-center gap-0.5 p-1 bg-gray-50 border border-gray-200 rounded-t-lg border-b-0 dark:border-gray-700 dark:bg-gray-900">
        <Btn
          label="Bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="w-4 h-4" />
        </Btn>
        <Btn
          label="Italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="w-4 h-4" />
        </Btn>
        <Btn
          label="Heading"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="w-4 h-4" />
        </Btn>
        <Btn
          label="Bullet list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="w-4 h-4" />
        </Btn>
        <Btn
          label="Numbered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="w-4 h-4" />
        </Btn>
        <Btn
          label="Checklist"
          active={editor.isActive('taskList')}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <CheckSquare className="w-4 h-4" />
        </Btn>

        <span className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-0.5" aria-hidden />

        <Btn
          label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 className="w-4 h-4" />
        </Btn>
        <Btn label="More formatting" onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal className="w-4 h-4" />
        </Btn>
      </div>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Formatting"
        snapPoints={[0.6, 0.9]}
      >
        <div className="px-3 pb-4">
          <EditorToolbar
            editor={editor}
            inSheet
            onInsertEvent={onInsertEvent}
            onInsertAttachment={onInsertAttachment}
            contextType={contextType}
            contextId={contextId}
          />
        </div>
      </BottomSheet>
    </>
  )
}
