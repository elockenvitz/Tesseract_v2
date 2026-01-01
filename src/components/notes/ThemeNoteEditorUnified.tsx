import React from 'react'
import { UniversalNoteEditor } from './UniversalNoteEditor'

interface ThemeNoteEditorProps {
  themeId: string
  themeName: string
  selectedNoteId?: string
  onNoteSelect: (noteId: string) => void
  onClose?: () => void
}

export function ThemeNoteEditor({
  themeId,
  themeName,
  selectedNoteId,
  onNoteSelect,
  onClose
}: ThemeNoteEditorProps) {
  return (
    <UniversalNoteEditor
      entityType="theme"
      entityId={themeId}
      entityName={themeName}
      selectedNoteId={selectedNoteId}
      onNoteSelect={onNoteSelect}
      onClose={onClose}
    />
  )
}